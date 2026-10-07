import { effectiveTaxRatePct, priceSellingDocument, roundMoney, toVisualiserQuote, toVisualiserInvoice, type CommercialSnapshot, type SellingDraftItem } from './pricing'

export type CommercialItem = { id?: string; name?: string; description?: string; qty: number; unitPrice: number; total?: number }
export type SavedCommercialDocument = {
  id?: string; customerId?: string; status?: string; items?: CommercialItem[]
  subtotal?: number; taxRate?: number; tax?: number; total?: number
  currency?: string | { code?: string; symbol?: string }; currencyCode?: string; currencySymbol?: string
  pricingSnapshot?: CommercialSnapshot; payments?: Array<{ amount: number }>
}
export type CurrentCommercialSettings = { currencyCode: string; currencySymbol?: string; taxRatePct?: number; taxRate?: number; taxLabel?: string }

export function createManualDraft(kind: 'quote' | 'invoice', settings: CurrentCommercialSettings) {
  const pricingSnapshot = priceSellingDocument({ items: [], currencyCode: settings.currencyCode,
    currencySymbol: settings.currencySymbol, taxRatePct: effectiveTaxRatePct(settings), taxLabel: settings.taxLabel })
  return kind === 'quote' ? toVisualiserQuote(pricingSnapshot) : toVisualiserInvoice(pricingSnapshot)
}

/** Only an explicit Draft edit makes a new financial agreement; saved tax/currency win over current settings. */
export function editManualDraft(document: SavedCommercialDocument, items: CommercialItem[], kind: 'quote' | 'invoice') {
  if (document.status !== 'Draft') throw new Error('Only Draft documents can have financial items edited')
  const currencyCode = document.pricingSnapshot?.currencyCode ?? document.currencyCode ??
    (typeof document.currency === 'string' ? document.currency : document.currency?.code) ?? 'ZAR'
  const currencySymbol = document.pricingSnapshot?.currencySymbol ?? document.currencySymbol ??
    (typeof document.currency === 'object' ? document.currency?.symbol : undefined)
  if (document.taxRate == null && !document.pricingSnapshot && Number(document.tax ?? 0) !== 0)
    throw new Error('Cannot edit a legacy Draft with tax but no saved tax rate')
  const taxRatePct = (document.pricingSnapshot?.taxRate ?? document.taxRate ?? 0) * 100
  const sellingItems: SellingDraftItem[] = items.map((item, index) => ({
    id: item.id ?? `item-${index}`, description: item.description ?? item.name ?? '',
    qty: Number(item.qty), unitPrice: Number(item.unitPrice),
  }))
  const pricingSnapshot = priceSellingDocument({ items: sellingItems, currencyCode, currencySymbol,
    taxRatePct, taxLabel: document.pricingSnapshot?.taxLabel })
  if (kind === 'invoice' && invoiceBalance({ total: pricingSnapshot.total, payments: document.payments,
    currencyCode: pricingSnapshot.currencyCode }) < 0)
    throw new Error('New total cannot be less than recorded payments')
  const fields = kind === 'quote' ? toVisualiserQuote(pricingSnapshot) : toVisualiserInvoice(pricingSnapshot)
  const savedItems = fields.items.map((item, index) => ({ ...item, id: items[index]?.id ?? `item-${index}` }))
  return { ...fields, items: savedItems, ...(kind === 'invoice' ? { payments: document.payments ?? [] } : {}) }
}

export function invoiceBalance(document: Pick<SavedCommercialDocument, 'total' | 'payments' | 'currencyCode' | 'currency' | 'pricingSnapshot'>): number {
  const paid = (document.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
  const code = document.pricingSnapshot?.currencyCode ?? document.currencyCode ??
    (typeof document.currency === 'string' ? document.currency : document.currency?.code) ?? 'GBP'
  return roundMoney(Number(document.total ?? 0) - paid, code)
}

/** No catalogue/settings access: copy even an inconsistent legacy agreement, never silently repair it. */
export function invoiceFromQuote(quote: SavedCommercialDocument) {
  const items = (quote.items ?? []).map((item, index) => ({ id: item.id ?? `quote-line-${index}`,
    name: item.name ?? item.description ?? '', description: item.description ?? item.name ?? '',
    qty: item.qty, unitPrice: item.unitPrice, ...(item.total !== undefined ? { total: item.total } : {}) }))
  const snapshot = quote.pricingSnapshot?.version === 1 ? quote.pricingSnapshot : undefined
  const currencyCode = snapshot?.currencyCode ?? quote.currencyCode ??
    (typeof quote.currency === 'string' ? quote.currency : quote.currency?.code) ?? 'ZAR'
  const currencySymbol = snapshot?.currencySymbol ?? quote.currencySymbol ??
    (typeof quote.currency === 'object' ? quote.currency?.symbol : undefined)
  const subtotal = quote.subtotal ?? snapshot?.subtotal
  const total = quote.total ?? snapshot?.total
  const tax = quote.tax ?? snapshot?.tax ?? (subtotal !== undefined && total !== undefined ? total - subtotal : undefined)
  return { quoteId: quote.id, customerId: quote.customerId, items, subtotal, taxRate: quote.taxRate ?? snapshot?.taxRate,
    tax, total, currencyCode, currencySymbol, currency: { code: currencyCode, symbol: currencySymbol },
    ...(snapshot ? { pricingSnapshot: snapshot } : {}), payments: [] as Array<{ amount: number }> }
}
