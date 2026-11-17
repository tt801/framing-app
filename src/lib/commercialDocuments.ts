import { effectiveTaxRatePct, priceSellingDocument, roundMoney, toVisualiserQuote, toVisualiserInvoice, type CommercialLine, type CommercialSnapshot, type SellingDraftItem } from './pricing'

export type CommercialItem = { id?: string; productId?: string; name?: string; description?: string; qty: number; unitPrice: number; total?: number;
  unit?: CommercialLine['unit']; roundingAdjustment?: number }
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
  const originals = document.items ?? []
  const originalIndex = (item: CommercialItem, index: number) => originals.findIndex((old, i) =>
    (old.id ?? `line-${i}`) === (item.id ?? `line-${index}`))
  const samePrice = (item: CommercialItem, old: CommercialItem | undefined) => old && item.qty === old.qty
    && item.unitPrice === old.unitPrice && (item.unit ?? old.unit) === old.unit
  // Saving/relabeling an untouched agreement must not regenerate even inconsistent legacy totals.
  if (items.length === originals.length && items.every((item, index) => samePrice(item, originals[originalIndex(item, index)]))) {
    const savedItems = items.map((item, index) => ({ ...originals[originalIndex(item, index)],
      id: item.id ?? `line-${index}`, name: item.name ?? item.description ?? '', description: item.name ?? item.description ?? '' }))
    const snapshot = document.pricingSnapshot
    const renamed = items.some((item, index) => (item.name ?? item.description ?? '') !==
      (originals[originalIndex(item, index)].name ?? originals[originalIndex(item, index)].description ?? ''))
    const pricingSnapshot = snapshot && renamed ? { ...snapshot, items: snapshot.items.map((line, index) =>
      ({ ...line, description: savedItems[index]?.name ?? line.description })) } : snapshot
    return { ...document, items: savedItems, currency: kind === 'quote' ? currencyCode : { code: currencyCode, symbol: currencySymbol },
      currencyCode, currencySymbol, pricingSnapshot, ...(kind === 'invoice' ? { payments: document.payments ?? [] } : {}) }
  }
  if (document.taxRate == null && !document.pricingSnapshot && Number(document.tax ?? 0) !== 0)
    throw new Error('Cannot edit a legacy Draft with tax but no saved tax rate')
  const taxRatePct = (document.pricingSnapshot?.taxRate ?? document.taxRate ?? 0) * 100
  const sellingItems: SellingDraftItem[] = items.map((item, index) => {
    const previousIndex = originalIndex(item, index), old = originals[previousIndex]
    const savedLine = document.pricingSnapshot?.items[previousIndex]
    return { id: item.id ?? `line-${index}`, description: item.name ?? item.description ?? '',
      qty: Number(item.qty), unitPrice: Number(item.unitPrice), unit: item.unit ?? old?.unit,
      preserveUnitPrice: document.pricingSnapshot?.quantityBasis === 'material',
      ...(samePrice(item, old) ? { agreedLineTotal: old.total ?? savedLine?.lineTotal } : {}) }
  })
  const pricingSnapshot = priceSellingDocument({ items: sellingItems, currencyCode, currencySymbol,
    taxRatePct, taxLabel: document.pricingSnapshot?.taxLabel })
  if (document.pricingSnapshot?.quantityBasis === 'material') pricingSnapshot.quantityBasis = 'material'
  // Repricing changes selling amounts, not the identity of surviving material lines.
  // Resolve by the original item ID so removals cannot transfer a neighbour's references.
  pricingSnapshot.items = pricingSnapshot.items.map((line, index) => {
    const item = items[index], previousIndex = originalIndex(item, index)
    const old = originals[previousIndex], savedLine = document.pricingSnapshot?.items[previousIndex]
    const productId = old?.productId ?? savedLine?.productId ?? item.productId
    return { ...line,
      ...(savedLine ? { key: savedLine.key } : {}),
      ...(productId !== undefined ? { productId } : {}),
      ...(savedLine?.materialUnit !== undefined ? { materialUnit: savedLine.materialUnit } : {}),
      ...(savedLine?.materialQuantity !== undefined ? {
        materialQuantity: pricingSnapshot.quantityBasis === 'material' ? line.qty : savedLine.materialQuantity,
      } : {}),
    }
  })
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
    ...(item.productId !== undefined ? { productId: item.productId } : {}),
    qty: item.qty, unitPrice: item.unitPrice, ...(item.total !== undefined ? { total: item.total } : {}),
    ...(item.unit !== undefined ? { unit: item.unit } : {}),
    ...(item.roundingAdjustment !== undefined ? { roundingAdjustment: item.roundingAdjustment } : {}) }))
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
