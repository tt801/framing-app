// Explicit server-side allowlists: service-role writes must never accept arbitrary JSON columns.
const supplierCreate = ['name', 'slug', 'status', 'countries', 'asset_rights_status'] as const
const supplierUpdate = ['name', 'status', 'countries', 'asset_rights_status'] as const
const identity = ['catalog_scope', 'source_product_key', 'supplier_sku', 'variant_key'] as const
const textFields = ['subcategory', 'display_description', 'collection_name', 'colour', 'finish', 'material', 'purchase_unit', 'mat_core', 'mat_quality', 'glazing_material', 'glazing_reflection', 'source_attribution'] as const
const dimensions = ['width_mm', 'depth_mm', 'rebate_width_mm', 'rebate_depth_mm', 'sheet_width_mm', 'sheet_height_mm', 'mat_thickness_mm', 'glazing_thickness_mm', 'glazing_uv_percent'] as const
const costs = ['wholesale_cost', 'cost_currency', 'cost_unit', 'cost_tax_basis', 'cost_effective_at'] as const
const productCreate = [...identity, 'category', 'supplier_description', 'availability', 'lifecycle', ...textFields, ...dimensions, ...costs] as const
const productUpdate = ['category', 'supplier_description', 'availability', 'lifecycle', ...textFields, ...dimensions, ...costs] as const

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Fields must be an object')
  const fields = value as Record<string, unknown>
  if (!Object.keys(fields).length) throw new Error('Fields cannot be empty')
  for (const key of Object.keys(fields)) if (!allowed.includes(key)) throw new Error(`Field ${key} is not editable`)
  return fields
}
function text(value: unknown, field: string, required = false): string | null {
  if (value === null && !required) return null
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > 2000) throw new Error(`Invalid ${field}`)
  return value.trim()
}
function enumValue(value: unknown, field: string, choices: readonly string[]) {
  if (typeof value !== 'string' || !choices.includes(value)) throw new Error(`Invalid ${field}`)
  return value
}
function required(fields: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) if (!(key in fields)) throw new Error(`Missing ${key}`)
}
function numeric(value: unknown, field: string, max = Infinity) {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`Invalid ${field}`)
  return value
}
function date(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid cost_effective_at')
  return new Date(value).toISOString()
}

export function validateSupplier(value: unknown, create: boolean): Record<string, unknown> {
  const fields = object(value, create ? supplierCreate : supplierUpdate)
  if (create) required(fields, supplierCreate)
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'name') out[key] = text(value, key, true)
    else if (key === 'slug') {
      if (typeof value !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) throw new Error('Invalid supplier slug. Lowercase letters and numbers only; use single hyphens between words (e.g. larson-juhl).')
      out[key] = value
    } else if (key === 'status') out[key] = enumValue(value, key, ['draft', 'active', 'paused', 'retired'])
    else if (key === 'asset_rights_status') out[key] = enumValue(value, key, ['unknown', 'permitted', 'restricted', 'prohibited'])
    else if (key === 'countries') {
      if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || !/^[A-Z]{2}$/.test(v)) || new Set(value).size !== value.length) throw new Error('Invalid countries')
      out[key] = value
    }
  }
  return out
}

export function validateProduct(value: unknown, create: boolean): Record<string, unknown> {
  const fields = object(value, create ? productCreate : productUpdate)
  if (create) {
    required(fields, ['catalog_scope', 'source_product_key', 'supplier_sku', 'variant_key', 'category', 'supplier_description', 'availability', 'lifecycle'])
    if (![fields.source_product_key, fields.supplier_sku].some(value => typeof value === 'string' && value.trim())) throw new Error('Source key or supplier SKU is required')
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'catalog_scope' || key === 'supplier_description') out[key] = text(value, key, true)
    else if (key === 'variant_key') {
      if (typeof value !== 'string' || value !== value.trim() || value.length > 2000) throw new Error('Invalid variant_key')
      out[key] = value
    } else if (key === 'source_product_key' || key === 'supplier_sku') out[key] = text(value, key)
    else if (key === 'category') out[key] = enumValue(value, key, ['frame', 'mat', 'glazing', 'printing', 'backer', 'other'])
    else if (key === 'availability') out[key] = enumValue(value, key, ['unknown', 'available', 'limited', 'unavailable'])
    else if (key === 'lifecycle') out[key] = enumValue(value, key, ['active', 'discontinued', 'superseded'])
    else if ((textFields as readonly string[]).includes(key)) out[key] = text(value, key)
    else if ((dimensions as readonly string[]).includes(key)) out[key] = numeric(value, key, key === 'glazing_uv_percent' ? 100 : Infinity)
  }
  if (costs.some(key => key in fields)) {
    required(fields, costs) // Apply cost state atomically; no partial or orphaned wholesale metadata.
    const amount = numeric(fields.wholesale_cost, 'wholesale_cost')
    if (amount !== null) {
      if (typeof fields.cost_currency !== 'string' || !/^[A-Z]{3}$/.test(fields.cost_currency)) throw new Error('Invalid cost_currency')
      out.cost_currency = fields.cost_currency
      out.cost_unit = text(fields.cost_unit, 'cost_unit', true)
      out.cost_tax_basis = enumValue(fields.cost_tax_basis, 'cost_tax_basis', ['exclusive', 'inclusive', 'exempt', 'unknown'])
      out.cost_effective_at = date(fields.cost_effective_at)
      if (!out.cost_effective_at) throw new Error('Cost effective date is required')
    } else {
      if (costs.some(key => fields[key] !== null)) throw new Error('Cost metadata requires wholesale cost')
      for (const key of costs) out[key] = null
    }
    out.wholesale_cost = amount
  }
  return out
}
