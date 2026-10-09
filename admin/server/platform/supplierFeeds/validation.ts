import { dimensionNames, type Candidate, type FeedIssue, type ProductFields, type PrivateCost, type SourceAsset, type ValidationResult } from './contracts.js'

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\p{C}]/u.test(value)
const enums = {
  category: ['frame', 'mat', 'glazing', 'printing', 'backer', 'other'],
  lifecycle: ['active', 'discontinued', 'superseded'],
  availability: ['unknown', 'available', 'limited', 'unavailable'],
  taxBasis: ['exclusive', 'inclusive', 'exempt', 'unknown'],
  rightsStatus: ['unknown', 'permitted', 'restricted', 'prohibited'],
} as const
function instant(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const wall = new Date(Date.UTC(year, month - 1, day))
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() + 1 !== month || wall.getUTCDate() !== day) return
  return date.toISOString()
}
function decimal(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 32 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return
  const [whole, fraction] = value.split('.')
  const trimmed = fraction?.replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}
export function validateCandidate(input: unknown): ValidationResult {
  const errors: FeedIssue[] = []
  const warnings: FeedIssue[] = []
  const fail = (field: string, code = 'invalid') => errors.push({ code, field, message: `Invalid ${field}` })
  if (!record(input)) return { errors: [{ code: 'invalid_candidate', message: 'Candidate must be an object' }], warnings }
  for (const key of Object.keys(input)) if (!['supplierId','runId','sourceId','adapter','scopeId','item','sourceProductKey','sourceProductKeyOrigin','fields','cost','asset'].includes(key)) fail(key, 'unknown_field')
  for (const key of ['supplierId','runId','sourceId','scopeId'] as const) if (!text(input[key], 256)) fail(key)
  if (!record(input.adapter) || !text(input.adapter.id, 128) || !text(input.adapter.version, 128)) fail('adapter')
  if (!record(input.item) || !text(input.item.key, 256) ||
    (input.item.rowNumber !== undefined && (!Number.isSafeInteger(input.item.rowNumber) || (input.item.rowNumber as number) < 1)) ||
    (input.item.path !== undefined && !text(input.item.path, 1024))) fail('item')
  if (!text(input.sourceProductKey, 256)) fail('sourceProductKey', 'unsafe_identity')
  if (input.sourceProductKeyOrigin !== 'supplier_provided' && input.sourceProductKeyOrigin !== 'adapter_derived') fail('sourceProductKeyOrigin', 'unsafe_identity')

  const fields = input.fields
  if (!record(fields)) fail('fields')
  const normalizedFields: Record<string, unknown> = {}
  if (record(fields)) {
    const allowed = ['category','supplierDescription','lifecycle','availability','supplierSku','catalogScope','variantKey','subcategory','displayDescription','collectionName','colour','finish','material','purchaseUnit',...dimensionNames]
    for (const key of Object.keys(fields)) if (!allowed.includes(key)) fail(`fields.${key}`, 'unknown_field')
    for (const key of ['category','lifecycle','availability'] as const) {
      if (!(enums[key] as readonly unknown[]).includes(fields[key])) fail(`fields.${key}`)
      else normalizedFields[key] = fields[key]
    }
    if (!text(fields.supplierDescription)) fail('fields.supplierDescription')
    else normalizedFields.supplierDescription = fields.supplierDescription
    for (const key of ['supplierSku','subcategory','displayDescription','collectionName','colour','finish','material','purchaseUnit'] as const) {
      if (!(key in fields)) continue
      if (fields[key] !== null && !text(fields[key])) fail(`fields.${key}`)
      else normalizedFields[key] = fields[key]
    }
    if ('catalogScope' in fields) {
      if (!text(fields.catalogScope, 256)) fail('fields.catalogScope')
      else normalizedFields.catalogScope = fields.catalogScope
    }
    if ('variantKey' in fields) {
      if (typeof fields.variantKey !== 'string' || fields.variantKey.length > 256 || fields.variantKey !== fields.variantKey.trim() || /[\p{C}]/u.test(fields.variantKey)) fail('fields.variantKey')
      else normalizedFields.variantKey = fields.variantKey
    }
    for (const key of dimensionNames) {
      if (!(key in fields)) continue
      const value = fields[key]
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key === 'glazingUvPercent' && value > 100))) fail(`fields.${key}`)
      else normalizedFields[key] = value
    }
  }

  let cost: PrivateCost | undefined
  if ('cost' in input) {
    const raw = input.cost
    if (!record(raw)) fail('cost', 'incomplete_cost')
    else {
      for (const key of Object.keys(raw)) if (!['amount','currency','unit','taxBasis','effectiveAt'].includes(key)) fail(`cost.${key}`, 'unknown_field')
      const amount = decimal(raw.amount)
      const effectiveAt = instant(raw.effectiveAt)
      if (amount === undefined) fail('cost.amount', 'incomplete_cost')
      if (typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency)) fail('cost.currency', 'incomplete_cost')
      if (!text(raw.unit, 128)) fail('cost.unit', 'incomplete_cost')
      if (!(enums.taxBasis as readonly unknown[]).includes(raw.taxBasis)) fail('cost.taxBasis', 'incomplete_cost')
      if (!effectiveAt) fail('cost.effectiveAt', 'incomplete_cost')
      if (amount !== undefined && effectiveAt && typeof raw.currency === 'string' && typeof raw.unit === 'string')
        cost = { amount, currency: raw.currency, unit: raw.unit, taxBasis: raw.taxBasis as PrivateCost['taxBasis'], effectiveAt }
    }
  }
  let asset: SourceAsset | undefined
  if ('asset' in input) {
    const raw = input.asset
    if (!record(raw)) fail('asset')
    else {
      for (const key of Object.keys(raw)) if (!['sourceUrl','attribution','rightsStatus','permittedUses','sourceUpdatedAt'].includes(key)) fail(`asset.${key}`, 'unknown_field')
      if (!(enums.rightsStatus as readonly unknown[]).includes(raw.rightsStatus)) fail('asset.rightsStatus')
      if ('sourceUrl' in raw && raw.sourceUrl !== null) {
        try {
          const url = new URL(raw.sourceUrl as string)
          if (typeof raw.sourceUrl !== 'string' || raw.sourceUrl.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('asset.sourceUrl')
        } catch { fail('asset.sourceUrl') }
      }
      if ('attribution' in raw && raw.attribution !== null && !text(raw.attribution)) fail('asset.attribution')
      if ('permittedUses' in raw && (!Array.isArray(raw.permittedUses) || raw.permittedUses.length > 20 || raw.permittedUses.some(v => !text(v, 128)))) fail('asset.permittedUses')
      const sourceUpdatedAt = raw.sourceUpdatedAt == null ? raw.sourceUpdatedAt : instant(raw.sourceUpdatedAt)
      if ('sourceUpdatedAt' in raw && raw.sourceUpdatedAt !== null && !sourceUpdatedAt) fail('asset.sourceUpdatedAt')
      asset = {
        rightsStatus: raw.rightsStatus as SourceAsset['rightsStatus'],
        ...('sourceUrl' in raw ? { sourceUrl: raw.sourceUrl as string | null } : {}),
        ...('attribution' in raw ? { attribution: raw.attribution as string | null } : {}),
        ...('permittedUses' in raw ? { permittedUses: raw.permittedUses as string[] } : {}),
        ...('sourceUpdatedAt' in raw ? { sourceUpdatedAt: sourceUpdatedAt as string | null } : {}),
      }
      if (raw.sourceUrl) warnings.push({ code: 'asset_private', field: 'asset.sourceUrl', message: 'Source asset is private and not approved for customer display' })
    }
  }
  if (errors.length) return { errors, warnings }
  const item = input.item as Record<string, unknown>
  return { errors, warnings, value: {
    supplierId: input.supplierId as string, runId: input.runId as string, sourceId: input.sourceId as string,
    adapter: { id: (input.adapter as Record<string,string>).id, version: (input.adapter as Record<string,string>).version },
    scopeId: input.scopeId as string, item: { key: item.key as string,
      ...(item.rowNumber !== undefined ? { rowNumber: item.rowNumber as number } : {}),
      ...(item.path !== undefined ? { path: item.path as string } : {}) },
    sourceProductKey: input.sourceProductKey as string,
    sourceProductKeyOrigin: input.sourceProductKeyOrigin as Candidate['sourceProductKeyOrigin'],
    fields: normalizedFields as ProductFields,
    ...(cost ? { cost } : {}), ...(asset ? { asset } : {}),
  } }
}
