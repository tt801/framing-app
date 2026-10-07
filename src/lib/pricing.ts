/** Visualiser commercial pricing v1. Catalogue pricePer* inputs retain their legacy meaning. */
export type PricingProduct = { id?: string; name: string; pricePerMeter?: number; pricePerSqM?: number }
export type VisualiserPricingInput = {
  artWcm: number; artHcm: number; borderCm: number
  frame?: PricingProduct | null; mats: PricingProduct[]; glazing?: PricingProduct | null
  print?: PricingProduct | null; backer?: PricingProduct | null
  labourBase: number; marginMultiplier: number; taxRatePct: number
  taxLabel?: string; currencyCode: string; currencySymbol?: string
}
export type CommercialLine = {
  key: string; description: string; productId?: string
  qty: number; unit: 'design' | 'item'; materialQuantity?: number; materialUnit?: 'm' | 'm²' | 'design'
  rawAmount?: number; unitPrice: number; lineTotal: number
}
export type CommercialSnapshot = {
  version: 1; currencyCode: string; currencySymbol?: string
  marginMultiplier: number; pricingRule?: 'manual-selling'; taxRate: number; taxLabel?: string; taxMode: 'exclusive'
  items: CommercialLine[]; subtotal: number; tax: number; total: number
}

export function currencyMinorDigits(currencyCode: string): number {
  // Intl's currency metadata includes zero- and three-decimal currencies.
  return new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits
}

export function roundMoney(amount: number, currencyCode: string): number {
  if (!Number.isFinite(amount)) throw new Error('Invalid monetary amount')
  const factor = 10 ** currencyMinorDigits(currencyCode)
  return Math.round((amount + Number.EPSILON) * factor) / factor
}

/** taxRatePct is authoritative when present; older taxRate accepted as fraction or percent. */
export function effectiveTaxRatePct(settings: { taxRatePct?: unknown; taxRate?: unknown }): number {
  const pct = settings.taxRatePct
  if (pct !== undefined && pct !== null && pct !== '') return Number(pct)
  const legacy = Number(settings.taxRate ?? 0)
  return legacy > 1 ? legacy : legacy * 100
}

export function priceVisualiser(input: VisualiserPricingInput): CommercialSnapshot {
  const { artWcm, artHcm, borderCm, currencyCode, marginMultiplier, labourBase, taxRatePct } = input
  if (![artWcm, artHcm, borderCm, marginMultiplier, labourBase, taxRatePct].every(Number.isFinite) ||
    artWcm <= 0 || artHcm <= 0 || borderCm < 0 || marginMultiplier < 0 || labourBase < 0 || taxRatePct < 0) {
    throw new Error('Invalid Visualiser pricing input')
  }
  const visibleWcm = artWcm + 2 * borderCm
  const visibleHcm = artHcm + 2 * borderCm
  const area = visibleWcm * visibleHcm / 10000
  const artArea = artWcm * artHcm / 10000
  const perimeter = 2 * (visibleWcm + visibleHcm) / 100
  const lines: Array<CommercialLine & { rawAmount: number }> = []
  const add = (key: string, description: string, productId: string | undefined, materialQuantity: number, materialUnit: CommercialLine['materialUnit'], rate: number) => {
    if (!Number.isFinite(rate) || rate < 0) throw new Error('Invalid catalogue price')
    lines.push({ key, description, productId, qty: 1, unit: 'design', materialQuantity, materialUnit,
      rawAmount: rate * materialQuantity, unitPrice: 0, lineTotal: 0 })
  }
  add('frame', `Frame (${input.frame?.name ?? 'frame'})`, input.frame?.id, perimeter, 'm', input.frame?.pricePerMeter ?? 0)
  add('glazing', `Glazing (${input.glazing?.name ?? 'glazing'})`, input.glazing?.id, area, 'm²', input.glazing?.pricePerSqM ?? 0)
  input.mats.forEach((mat, index) => add(`mat${index + 1}`, `Mat ${index + 1} (${mat.name})`, mat.id, area, 'm²', mat.pricePerSqM ?? 0))
  if (input.print) add('print', `Printing (${input.print.name})`, input.print.id, artArea, 'm²', input.print.pricePerSqM ?? 0)
  if (input.backer) add('backer', input.backer.name, input.backer.id, area, 'm²', input.backer.pricePerSqM ?? 0)
  add('labour', 'Labour & overhead', undefined, 1, 'design', labourBase)

  const factor = 10 ** currencyMinorDigits(currencyCode)
  const subtotalUnits = Math.round((lines.reduce((sum, line) => sum + line.rawAmount, 0) * marginMultiplier + Number.EPSILON) * factor)
  const lineUnits = lines.map(line => Math.round((line.rawAmount * marginMultiplier + Number.EPSILON) * factor))
  let difference = subtotalUnits - lineUnits.reduce((sum, units) => sum + units, 0)
  // Allocate rounding pennies to existing charges without creating a negative line.
  for (let index = lineUnits.length - 1; index >= 0 && difference !== 0; index--) {
    if (difference > 0 && lines[index].rawAmount > 0) {
      lineUnits[index] += difference
      difference = 0
    } else if (difference < 0) {
      const removed = Math.min(lineUnits[index], -difference)
      lineUnits[index] -= removed
      difference += removed
    }
  }
  if (difference !== 0) throw new Error('Cannot reconcile selling lines')
  lines.forEach((line, index) => {
    line.unitPrice = lineUnits[index] / factor
    line.lineTotal = line.unitPrice
  })
  const subtotal = subtotalUnits / factor
  const taxRate = taxRatePct / 100
  const taxUnits = Math.round((subtotal * taxRate + Number.EPSILON) * factor)
  const tax = taxUnits / factor
  const total = (subtotalUnits + taxUnits) / factor
  return { version: 1, currencyCode, currencySymbol: input.currencySymbol, marginMultiplier,
    taxRate, taxLabel: input.taxLabel, taxMode: 'exclusive', items: lines, subtotal, tax, total }
}

export type SellingDraftItem = { id?: string; description: string; qty: number; unitPrice: number }
export type SellingDocumentInput = { items: SellingDraftItem[]; currencyCode: string; currencySymbol?: string; taxRatePct: number; taxLabel?: string }

/** Manual unit prices are already SELLING prices. Never apply the Visualiser multiplier. */
export function priceSellingDocument(input: SellingDocumentInput): CommercialSnapshot {
  const { currencyCode, taxRatePct } = input
  if (!Number.isFinite(taxRatePct) || taxRatePct < 0) throw new Error('Invalid tax rate')
  const factor = 10 ** currencyMinorDigits(currencyCode)
  const items: CommercialLine[] = input.items.map((item, index) => {
    if (![item.qty, item.unitPrice].every(Number.isFinite) || item.qty < 0 || item.unitPrice < 0)
      throw new Error('Invalid selling item')
    const unitPrice = roundMoney(item.unitPrice, currencyCode)
    const lineTotal = roundMoney(item.qty * unitPrice, currencyCode)
    return { key: item.id ?? `manual-${index}`, description: item.description, qty: item.qty,
      unit: 'item', unitPrice, lineTotal }
  })
  const subtotalUnits = items.reduce((sum, item) => sum + Math.round(item.lineTotal * factor), 0)
  const subtotal = subtotalUnits / factor
  const taxRate = taxRatePct / 100
  const taxUnits = Math.round(roundMoney(subtotal * taxRate, currencyCode) * factor)
  return { version: 1, pricingRule: 'manual-selling', currencyCode, currencySymbol: input.currencySymbol,
    marginMultiplier: 1, taxRate, taxLabel: input.taxLabel, taxMode: 'exclusive', items,
    subtotal, tax: taxUnits / factor, total: (subtotalUnits + taxUnits) / factor }
}

export function toVisualiserQuote(snapshot: CommercialSnapshot) {
  return { items: snapshot.items.map(line => ({ name: line.description, qty: line.qty, unitPrice: line.unitPrice, total: line.lineTotal })),
    subtotal: snapshot.subtotal, taxRate: snapshot.taxRate, tax: snapshot.tax, total: snapshot.total,
    currency: snapshot.currencyCode, currencyCode: snapshot.currencyCode, currencySymbol: snapshot.currencySymbol,
    pricingSnapshot: snapshot }
}

export function toVisualiserJobCosts(snapshot: CommercialSnapshot) {
  return { subtotal: snapshot.subtotal, taxRate: snapshot.taxRate, tax: snapshot.tax, total: snapshot.total,
    marginMultiplier: snapshot.marginMultiplier,
    lineItems: snapshot.items.map(line => ({ k: line.key, label: line.description, amount: line.lineTotal })),
    internalCostItems: snapshot.items.map(line => ({ k: line.key, amount: line.rawAmount })),
    pricingSnapshot: snapshot }
}

export function toVisualiserInvoice(snapshot: CommercialSnapshot) {
  return { items: snapshot.items.map(line => ({ id: `${line.key}-${Math.random().toString(36).slice(2, 9)}`,
    name: line.description, description: line.description, qty: line.qty, unitPrice: line.unitPrice })),
    subtotal: snapshot.subtotal, taxRate: snapshot.taxRate, tax: snapshot.tax, total: snapshot.total,
    currencyCode: snapshot.currencyCode, currencySymbol: snapshot.currencySymbol, pricingSnapshot: snapshot }
}
