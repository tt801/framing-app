import type { CanonicalProduct, EvidenceJson, EvidenceValue, PlanEntry, PrivateCost, ReviewEvidence } from './contracts.js'
import type { ReviewFieldChange } from '../../../src/lib/supplierFeedTypes.js'

// The same small, deterministic value envelope is used for persistence and reads.
// Missing is distinct from explicit null; withheld never contains partial content.
export function evidenceValue(input: unknown): EvidenceValue {
  if (input === undefined) return { state: 'missing' }
  const safe = (value: unknown, depth: number): value is EvidenceJson => {
    if (value === null || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value === 'string') return value.length <= 512 && !/[\p{C}]/u.test(value)
    if (!value || typeof value !== 'object' || depth >= 3) return false
    if (Array.isArray(value)) return value.length <= 20 && value.every(v => safe(v, depth + 1))
    if (Object.getPrototypeOf(value) !== Object.prototype) return false
    const entries = Object.entries(value)
    return entries.length <= 20 && entries.every(([key, v]) => key.length <= 64 &&
      !/(password|secret|token|authorization|credential|api[_-]?key|cookie)/i.test(key) && safe(v, depth + 1))
  }
  if (!safe(input, 0)) return { state: 'withheld' }
  const stable = JSON.stringify(input, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
  if (stable.length > 512) return { state: 'withheld' }
  return { state: 'recorded', value: JSON.parse(stable) as EvidenceJson }
}
function costEvidence(cost: PrivateCost | undefined): EvidenceValue {
  if (!cost) return { state: 'missing' }
  const date = new Date(cost.effectiveAt)
  if (!Number.isFinite(date.getTime())) return { state: 'withheld' }
  return evidenceValue({ amount: cost.amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
    currency: cost.currency, unit: cost.unit, taxBasis: cost.taxBasis, effectiveAt: date.toISOString() })
}
export function captureReviewEvidence(entry: PlanEntry, product: CanonicalProduct): ReviewEvidence {
  const candidate = entry.candidate!
  const fields: ReviewEvidence['fields'] = []
  for (const key of [...entry.ordinaryChanges, ...entry.lifecycleChanges]) {
    fields.push({ field: `fields.${key}`, oldValue: evidenceValue(product.fields[key as keyof typeof product.fields]),
      newValue: evidenceValue(candidate.fields[key as keyof typeof candidate.fields]) })
  }
  if (entry.costChange) fields.push({ field: 'cost', oldValue: costEvidence(product.cost), newValue: costEvidence(candidate.cost) })
  for (const key of entry.assetChanges) {
    // Asset locations stay private; preserve a truthful indicator, not a URL.
    fields.push({ field: `asset.${key}`,
      oldValue: key === 'sourceUrl' ? { state: 'withheld' } : evidenceValue(product.asset?.[key as keyof typeof product.asset]),
      newValue: key === 'sourceUrl' ? { state: 'withheld' } : evidenceValue(candidate.asset?.[key as keyof typeof candidate.asset]) })
  }
  return { version: 1, fields }
}

const fieldLabels: Record<string, string> = {
  category: 'Category', supplierDescription: 'Supplier description', supplierSku: 'Supplier SKU', catalogScope: 'Catalog scope', variantKey: 'Variant',
  subcategory: 'Subcategory', displayDescription: 'Display description', collectionName: 'Collection', colour: 'Colour', finish: 'Finish', material: 'Material',
  purchaseUnit: 'Purchase unit', widthMm: 'Width (mm)', depthMm: 'Depth (mm)', rebateWidthMm: 'Rebate width (mm)', rebateDepthMm: 'Rebate depth (mm)',
  sheetWidthMm: 'Sheet width (mm)', sheetHeightMm: 'Sheet height (mm)', matThicknessMm: 'Mat thickness (mm)', glazingThicknessMm: 'Glazing thickness (mm)',
  glazingUvPercent: 'Glazing UV (%)', lifecycle: 'Lifecycle', availability: 'Availability',
}
const assetLabels: Record<string, string> = { rightsStatus: 'Asset rights', sourceUrl: 'Asset source URL', attribution: 'Asset attribution', permittedUses: 'Asset permitted uses', sourceUpdatedAt: 'Asset updated at' }
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const decode = (v: unknown): EvidenceValue => object(v) && v.state === 'recorded' && Object.hasOwn(v, 'value') ? evidenceValue(v.value)
  : object(v) && v.state === 'withheld' ? { state: 'withheld' } : { state: 'missing' }
const display = (v: EvidenceValue): string => v.state === 'missing' ? 'Not persisted in this frozen plan'
  : v.state === 'withheld' ? 'Withheld (unsafe or oversized value)'
    : v.value === null ? 'null' : typeof v.value === 'string' ? v.value : JSON.stringify(v.value)
const equal = (a: EvidenceValue, b: EvidenceValue) => a.state === 'recorded' && b.state === 'recorded' && JSON.stringify(a.value) === JSON.stringify(b.value)
const tuple = (v: EvidenceValue): PrivateCost | undefined => {
  if (v.state !== 'recorded' || !object(v.value)) return
  const c = v.value
  if (typeof c.amount !== 'string' || c.amount.length > 32 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(c.amount)
    || typeof c.currency !== 'string' || !/^[A-Z]{3}$/.test(c.currency) || typeof c.unit !== 'string' || !c.unit || c.unit.length > 128
    || !['exclusive', 'inclusive', 'exempt', 'unknown'].includes(String(c.taxBasis))
    || typeof c.effectiveAt !== 'string' || !Number.isFinite(Date.parse(c.effectiveAt))) return
  return c as PrivateCost
}
function costDisplay(c: PrivateCost): string {
  const digits = new Intl.NumberFormat('en-GB', { style: 'currency', currency: c.currency }).resolvedOptions().minimumFractionDigits ?? 2
  const [whole, fraction = ''] = c.amount.split('.')
  const padded = fraction.padEnd(digits, '0')
  return `${whole}${padded ? `.${padded}` : ''} ${c.currency}/${c.unit}`
}
export function readReviewEvidence(row: Record<string, any>): ReviewFieldChange[] {
  if (row.proposed_action !== 'update') return []
  const result: ReviewFieldChange[] = []
  const add = (field: string, label: string, oldValue: EvidenceValue, newValue: EvidenceValue) => {
    if (!equal(oldValue, newValue)) result.push({ field, label, oldValue: display(oldValue), newValue: display(newValue), previousPersisted: oldValue.state === 'recorded' })
  }
  const cost = (oldValue: EvidenceValue, newValue: EvidenceValue) => {
    const oldCost = tuple(oldValue), newCost = tuple(newValue)
    if (!oldCost || !newCost || oldCost.amount !== newCost.amount || oldCost.currency !== newCost.currency || oldCost.unit !== newCost.unit) {
      add('cost', 'Supplier cost', oldCost ? evidenceValue(costDisplay(oldCost)) : oldValue.state === 'recorded' ? { state: 'withheld' } : oldValue,
        newCost ? evidenceValue(costDisplay(newCost)) : newValue.state === 'recorded' ? { state: 'withheld' } : newValue)
    }
    add('cost.effectiveAt', 'Cost effective at', oldCost ? evidenceValue(oldCost.effectiveAt) : { state: 'missing' }, newCost ? evidenceValue(newCost.effectiveAt) : { state: 'missing' })
    add('cost.taxBasis', 'Cost tax basis', oldCost ? evidenceValue(oldCost.taxBasis) : { state: 'missing' }, newCost ? evidenceValue(newCost.taxBasis) : { state: 'missing' })
  }
  const evidence = row.proposed_diff?.reviewEvidence
  if (evidence?.version === 1 && Array.isArray(evidence.fields)) {
    const seen = new Set<string>()
    for (const change of evidence.fields.slice(0, 32)) {
      if (!object(change) || typeof change.field !== 'string' || seen.has(change.field)) continue
      seen.add(change.field)
      const oldValue = decode(change.oldValue), newValue = decode(change.newValue)
      if (change.field === 'cost') cost(oldValue, newValue)
      else {
        const [group, key, extra] = change.field.split('.')
        const labels = group === 'fields' ? fieldLabels : group === 'asset' ? assetLabels : null
        if (extra || !labels || !Object.hasOwn(labels, key)) continue
        add(change.field, labels[key], key === 'sourceUrl' ? { state: 'withheld' } : oldValue, key === 'sourceUrl' ? { state: 'withheld' } : newValue)
      }
    }
  } else {
    // Legacy rows have only proposed values. Never query canonical products to
    // manufacture a before value, or regenerate the frozen planning decision.
    for (const [group, keys, labels] of [
      ['fields', [...(Array.isArray(row.proposed_diff?.ordinaryChanges) ? row.proposed_diff.ordinaryChanges : []), ...(Array.isArray(row.proposed_diff?.lifecycleChanges) ? row.proposed_diff.lifecycleChanges : [])], fieldLabels],
      ['asset', Array.isArray(row.proposed_diff?.assetChanges) ? row.proposed_diff.assetChanges : [], assetLabels],
    ] as const) for (const key of keys.slice(0, 20)) {
      if (typeof key === 'string' && Object.hasOwn(labels, key)) add(`${group}.${key}`, labels[key], { state: 'missing' }, key === 'sourceUrl' ? { state: 'withheld' } : evidenceValue(row.proposed_product?.[group]?.[key]))
    }
    if (row.proposed_diff?.costChange === true) cost({ state: 'missing' }, evidenceValue(row.proposed_product?.cost))
  }
  // 21 ordinary + 2 lifecycle + 5 asset + 3 cost display fields. Existing
  // per-category 20-item bounds and 50-row pagination remain unchanged.
  return result.slice(0, 32)
}
