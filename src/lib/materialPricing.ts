/** Validation for NEW catalogue-priced designs only. Never revalidate saved agreements. */
export type MaterialPricingMetadata = {
  id?: string; name?: string; allowZeroPrice?: boolean
  costPerSqm?: number; costPerMeter?: number; markupPct?: number; markupPercent?: number
}

export function materialRateIssue(product: MaterialPricingMetadata | null | undefined, rate: unknown, category: string): string | null {
  if (!product) return `Select an available ${category.toLowerCase()} material.`
  if (product.id?.startsWith('supplier:')) return 'Supplier-discovered products are not available for priced designs.'
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0)
    return `${category}: configure a valid base material rate in Admin. Purchase costs are not selling rates.`
  // Explicit numeric zero is a valid configured rate; absence is not zero.
  return null
}

export function pricingSettingsIssue(settings: { marginMultiplier?: unknown; labourBase?: unknown }): string | null {
  if (typeof settings.marginMultiplier !== 'number' || !Number.isFinite(settings.marginMultiplier) || settings.marginMultiplier <= 0)
    return 'Configure a positive global selling multiplier in Admin Settings.'
  if (typeof settings.labourBase !== 'number' || !Number.isFinite(settings.labourBase) || settings.labourBase < 0)
    return 'Configure a finite, non-negative labour base rate in Admin Settings.'
  return null
}
