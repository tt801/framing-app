import { materialRateIssue, type MaterialPricingMetadata } from '@/lib/materialPricing'

/** Costs and inactive markup metadata are intentionally not editable as selling rates. */
export default function MaterialRateEditor({ product, rate, unit, multiplier, currencySymbol, onChange }: {
  product: MaterialPricingMetadata; rate: number | undefined; unit: 'm' | 'm²'; multiplier: number; currencySymbol: string
  onChange: (rate: number | undefined, allowZeroPrice: boolean) => void
}) {
  const issue = materialRateIssue(product, rate, 'Material')
  const validMultiplier = Number.isFinite(multiplier) && multiplier > 0
  return <div className="space-y-1 min-w-48">
    <input aria-label="Base material rate" type="number" min="0" step="any"
      className="w-full rounded border border-slate-200 px-2 py-1 text-xs" value={rate ?? ''}
      onChange={event => onChange(event.target.value === '' ? undefined : event.target.valueAsNumber, false)} />
    <p className="text-xs">An explicitly entered zero rate is valid. A blank rate is not configured.</p>
    <p className="text-xs">Effective selling rate (excl. tax): {!issue && validMultiplier ? `${currencySymbol}${rate * multiplier}/${unit}` : 'Not configured'}</p>
    {issue && <p role="alert" className="text-xs text-rose-700">{issue}</p>}
    {(product.costPerSqm !== undefined || product.costPerMeter !== undefined) &&
      <p className="text-xs text-slate-500">Legacy purchase-cost metadata retained; not used as a selling rate.</p>}
  </div>
}
