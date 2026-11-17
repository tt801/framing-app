import { priceVisualiser, type VisualiserPricingInput, type CommercialSnapshot } from './pricing'

export type PilotMaterial = {
  label: string
  product: { id?: string; name?: string } | null | undefined
  rate: unknown
}
type Result = { snapshot: CommercialSnapshot; issue: null } | { snapshot: null; issue: string }

/** Validate only new designs. Saved agreements never pass through this boundary. */
export function pricePilotDesign(input: VisualiserPricingInput, materials: PilotMaterial[], loading: boolean, failed: boolean): Result {
  if (loading) return { snapshot: null, issue: 'Catalogue and pricing settings are loading.' }
  if (failed) return { snapshot: null, issue: 'Could not load catalogue or pricing settings. Retry before creating a priced document.' }
  for (const { label, product, rate } of materials) {
    if (!product || product.id?.startsWith('supplier:'))
      return { snapshot: null, issue: `${label}: select an available company material before creating a priced document.` }
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0)
      return { snapshot: null, issue: `${label}: configure a finite, non-negative material rate in Admin. Explicit zero is valid.` }
  }
  if ([input.labourBase, input.marginMultiplier].some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0))
    return { snapshot: null, issue: 'Configure valid labour and selling multiplier settings before creating a priced document.' }
  try { return { snapshot: priceVisualiser(input), issue: null } }
  catch { return { snapshot: null, issue: 'Check dimensions, currency, tax and pricing settings before creating a priced document.' } }
}
