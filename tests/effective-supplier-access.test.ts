import { describe, expect, it, vi } from 'vitest'
import { fetchSafeSupplierRows } from '../src/lib/effectiveSupplierAccess'

const company = '00000000-0000-0000-0000-000000000001'
const supplier = '00000000-0000-0000-0000-000000000002'
const product = '00000000-0000-0000-0000-000000000003'

describe('safe supplier discovery access', () => {
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
