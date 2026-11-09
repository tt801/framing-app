import { describe, expect, it, vi } from 'vitest'
import { fetchSafeSupplierRows } from '../src/lib/effectiveSupplierAccess'

const company = '00000000-0000-0000-0000-000000000001'
const supplier = '00000000-0000-0000-0000-000000000002'
const product = '00000000-0000-0000-0000-000000000003'
const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  company_account_id: company, supplier_id: supplier, supplier_product_id: product,
  supplier_name: 'Supplier', supplier_enabled: true, supplier_status: 'active',
  category: 'frame', supplier_description: 'Frame', availability: 'available', lifecycle: 'active',
  ...overrides,
})

describe('safe supplier discovery access', () => {
  it('normalises optional appearance values without coercion or source mutation', async () => {
    const source = Object.freeze(row({ colour: ' #AbC ', finish: ' Satin ', material: 'Oak',
      width_mm: 22, depth_mm: 30, rebate_width_mm: 0, rebate_depth_mm: 12, supplier_sku: ' SKU ' }))
    const result = await fetchSafeSupplierRows(company, async () => ({ data: [source], error: null }))
    expect(result[0]).toMatchObject({ colour: '#AbC', finish: 'Satin', material: 'Oak',
      width_mm: 22, depth_mm: 30, rebate_width_mm: 0, rebate_depth_mm: 12, supplier_sku: 'SKU' })
    expect(source.colour).toBe(' #AbC ')
  })
  it.each([{}, [], true, 12, '', ' ', 'x'.repeat(2001)])('normalises malformed optional descriptions (%j)', async value => {
    const result = await fetchSafeSupplierRows(company, async () => ({ data: [row({ colour: value, finish: value, material: value })], error: null }))
    expect(result[0]).toMatchObject({ colour: null, finish: null, material: null })
  })
  it.each([undefined, null, -1, NaN, Infinity, -Infinity, '22', '', true, {}, []])('normalises malformed dimensions (%j)', async value => {
    const result = await fetchSafeSupplierRows(company, async () => ({ data: [row({ width_mm: value,
      depth_mm: value, rebate_width_mm: value, rebate_depth_mm: value })], error: null }))
    expect(result[0]).toMatchObject({ width_mm: null, depth_mm: null, rebate_width_mm: null, rebate_depth_mm: null })
  })
  it('withholds even injected allowlisted asset references', async () => {
    const result = await fetchSafeSupplierRows(company, async () => ({ data: [row({ source_image_url: 'https://example.invalid/private',
      cached_asset_key: 'private', thumbnail_key: 'private', texture_key: 'private' })], error: null }))
    expect(result[0]).toMatchObject({ source_image_url: null, cached_asset_key: null, thumbnail_key: null, texture_key: null })
  })
  it.each(['active_override', 'excluded_override'])('rejects malformed eligibility flag %s rather than granting eligibility', async key => {
    await expect(fetchSafeSupplierRows(company, async () => ({ data: [row({ [key]: 'false' })], error: null })))
      .rejects.toThrow(/invalid supplier projection/i)
  })
  it('requests only the authenticated company projection and discards unrecognized fields', async () => {
    const rpc = vi.fn(async () => ({ data: [{ company_account_id: company, supplier_id: supplier,
      supplier_product_id: product, supplier_name: 'A', supplier_enabled: true, supplier_status: 'active',
      category: 'frame', supplier_description: 'Frame', availability: 'available', lifecycle: 'active',
      wholesale_cost: 99, selling_price_override: 45, account_reference: 'PRIVATE',
      image_asset_key_override: 'unapproved-company-key', source_metadata: { secret: 'x' } }], error: null }))
    const result = await fetchSafeSupplierRows(company, rpc)
    expect(rpc).toHaveBeenCalledWith('effective_company_supplier_products', { p_company_account_id: company })
    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('wholesale_cost')
    expect(result[0]).not.toHaveProperty('selling_price_override')
    expect(result[0]).not.toHaveProperty('account_reference')
    expect(result[0]).not.toHaveProperty('image_asset_key_override')
    expect(result[0]).not.toHaveProperty('source_metadata')
  })
  it('rejects a projection row for another company instead of mixing tenants', async () => {
    const rpc = vi.fn(async () => ({ data: [{ company_account_id: 'another-company' }], error: null }))
    await expect(fetchSafeSupplierRows(company, rpc)).rejects.toThrow(/invalid supplier projection/i)
  })
})
