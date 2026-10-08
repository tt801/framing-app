import { describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { validateSupplier, validateProduct } from '../server/platform/supplierValidation.js'
import { createHandler as suppliersHandler } from '../server/platform/suppliers.js'
import { createHandler as productsHandler } from '../server/platform/supplier-products.js'

const supplierId = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'
const supplier = { name: ' Example ', slug: 'example', status: 'draft', countries: ['GB'], asset_rights_status: 'unknown' }
const product = { catalog_scope: 'default', source_product_key: 'source-1', supplier_sku: 'SKU-1', variant_key: '', category: 'frame', supplier_description: 'Frame', availability: 'unknown', lifecycle: 'active', wholesale_cost: null, cost_currency: null, cost_unit: null, cost_tax_basis: null, cost_effective_at: null }
function req(method: string, body: unknown = undefined, query: Record<string, string> = {}) {
  return { method, body, query, headers: {} } as VercelRequest
}
function response() {
  const result: { status?: number; body?: any } = {}
  const res = { status: vi.fn((n: number) => { result.status = n; return res }), json: vi.fn((v: unknown) => { result.body = v; return res }), end: vi.fn() } as unknown as VercelResponse
  return { res, result }
}
function deps(authorized = true) {
  const from = vi.fn()
  const rpc = vi.fn()
  const requirePlatformAdmin = vi.fn().mockImplementation(async () => { if (!authorized) throw new Error('You do not have platform admin access'); return { id: '33333333-3333-4333-8333-333333333333' } })
  const platformAdminError = (e: unknown) => ({ status: 403, message: String(e) })
  return { from, rpc, requirePlatformAdmin, platformAdminError, getSupabaseAdmin: () => ({ from, rpc }) } as any
}

describe('Block 2D server contract', () => {
  it('validates supplier fields and rejects identity or source metadata injection', () => {
    expect(validateSupplier(supplier, true)).toMatchObject({ name: 'Example', countries: ['GB'] })
    for (const fields of [{ ...supplier, id: supplierId }, { ...supplier, source_metadata: { secret: 1 } }, { ...supplier, slug: 'Bad Slug' }, { ...supplier, status: 'live' }, { ...supplier, countries: ['GB', ''] }]) {
      expect(() => validateSupplier(fields, true)).toThrow()
    }
    expect(validateSupplier({ name: 'Only name' }, false)).toEqual({ name: 'Only name' })
    expect(() => validateSupplier({ slug: 'changed' }, false)).toThrow()
  })

  it('validates lifecycle, availability, immutable reconciliation identifiers and wholesale completeness', () => {
    expect(validateProduct({ ...product, wholesale_cost: 0, cost_currency: 'GBP', cost_unit: 'metre', cost_tax_basis: 'exclusive', cost_effective_at: '2026-10-08T00:00:00Z' }, true)).toMatchObject({ wholesale_cost: 0 })
    for (const fields of [
      { ...product, id: productId }, { ...product, supplier_id: supplierId },
      { ...product, lifecycle: 'deleted' }, { ...product, availability: 'in_stock' },
      { ...product, wholesale_cost: 2 }, { ...product, wholesale_cost: -1 },
      { ...product, wholesale_cost: 2, cost_currency: 'gbp', cost_unit: 'each', cost_tax_basis: 'exclusive', cost_effective_at: '2026-10-08T00:00:00Z' },
      { ...product, source_image_url: 'https://example.invalid/image' },
    ]) expect(() => validateProduct(fields, true)).toThrow()
    expect(validateProduct({ category: 'frame' }, false)).toEqual({ category: 'frame' })
    expect(() => validateProduct({ supplier_sku: 'changed' }, false)).toThrow()
  })

  it('requires a manual product to have a source key or supplier SKU for reconciliation', () => {
    expect(() => validateProduct({ ...product, source_product_key: null, supplier_sku: null }, true)).toThrow()
    expect(() => validateProduct({ ...product, source_product_key: '  ', supplier_sku: null }, true)).toThrow()
    expect(validateProduct({ ...product, source_product_key: null, supplier_sku: 'sku-1' }, true)).toMatchObject({ supplier_sku: 'sku-1' })
  })

  it.each([['suppliers', suppliersHandler], ['products', productsHandler]])('denies unauthorized %s before database access', async (_, create) => {
    const d = deps(false); const { res, result } = response()
    await create(d)(req('POST', { fields: supplier, supplierId }), res)
    expect(result.status).toBe(403)
    expect(d.from).not.toHaveBeenCalled()
  })

  it.each([['suppliers', suppliersHandler], ['products', productsHandler]])('has no DELETE path for %s', async (_, create) => {
    const d = deps(); const { res, result } = response()
    await create(d)(req('DELETE'), res)
    expect(result.status).toBe(405)
    expect(d.from).not.toHaveBeenCalled()
  })

  it('creates a supplier with only validated fields', async () => {
    const d = deps(); const single = vi.fn().mockResolvedValue({ data: { id: supplierId, ...supplier }, error: null })
    const insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }))
    d.from.mockReturnValue({ insert })
    const { res, result } = response()
    await suppliersHandler(d)(req('POST', { fields: supplier }), res)
    expect(result.status).toBe(201)
    expect(insert).toHaveBeenCalledWith({ ...supplier, name: 'Example' })
  })

  it('rejects malformed supplier updates before making privileged writes', async () => {
    const d = deps(); const { res, result } = response()
    await suppliersHandler(d)(req('PATCH', { id: supplierId, fields: { ...supplier, id: productId } }), res)
    expect(result.status).toBe(400)
    expect(d.from).not.toHaveBeenCalled()
  })

  it('creates an initially costed product without a separate cost event', async () => {
    const d = deps(); const single = vi.fn().mockResolvedValue({ data: { id: productId }, error: null })
    const insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }))
    d.from.mockReturnValue({ insert })
    const { res, result } = response()
    const initial = { ...product, wholesale_cost: 10, cost_currency: 'GBP', cost_unit: 'metre', cost_tax_basis: 'exclusive', cost_effective_at: '2026-10-08T00:00:00Z' }
    await productsHandler(d)(req('POST', { supplierId, fields: initial }), res)
    expect(result.status).toBe(201)
    expect(insert).toHaveBeenCalledWith({ ...initial, cost_effective_at: '2026-10-08T00:00:00.000Z', supplier_id: supplierId })
    expect(d.rpc).not.toHaveBeenCalled()
    expect(d.from).not.toHaveBeenCalledWith('supplier_product_cost_events')
  })

  it('uses one atomic database RPC for product changes, including the cost tuple', async () => {
    const d = deps(); d.rpc.mockResolvedValue({ data: productId, error: null })
    const single = vi.fn().mockResolvedValue({ data: { id: productId }, error: null })
    d.from.mockReturnValue({ select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })) })
    const { res, result } = response()
    const fields = { display_description: 'Updated', wholesale_cost: 11, cost_currency: 'GBP', cost_unit: 'metre', cost_tax_basis: 'exclusive', cost_effective_at: '2026-10-09T00:00:00Z' }
    await productsHandler(d)(req('PATCH', { supplierId, id: productId, expectedUpdatedAt: '2026-10-08T00:00:00Z', fields }), res)
    expect(result.status).toBe(200)
    expect(d.rpc).toHaveBeenCalledWith('block2d_update_supplier_product', expect.objectContaining({ p_supplier_id: supplierId, p_product_id: productId, p_expected_updated_at: '2026-10-08T00:00:00Z', p_actor_user_id: '33333333-3333-4333-8333-333333333333', p_fields: { ...fields, cost_effective_at: '2026-10-09T00:00:00.000Z' } }))
    expect(d.from).not.toHaveBeenCalledWith('supplier_product_cost_events')
    expect(d.from.mock.results.every((r: any) => !r.value?.update)).toBe(true)
  })

  it('fails closed when the migration/RPC is not installed', async () => {
    const d = deps(); d.rpc.mockResolvedValue({ data: null, error: new Error('function does not exist') })
    const { res, result } = response()
    await productsHandler(d)(req('PATCH', { supplierId, id: productId, expectedUpdatedAt: '2026-10-08T00:00:00Z', fields: { lifecycle: 'superseded' } }), res)
    expect(result.status).not.toBe(200)
    expect(d.from).not.toHaveBeenCalled()
  })

  it('rejects missing optimistic version so a retry cannot overwrite intervening changes', async () => {
    const d = deps(); const { res, result } = response()
    await productsHandler(d)(req('PATCH', { supplierId, id: productId, fields: { lifecycle: 'superseded' } }), res)
    expect(result.status).toBe(400)
    expect(d.rpc).not.toHaveBeenCalled()
  })

  it('returns a conflict for a stale version without retrying the write', async () => {
    const d = deps(); d.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'Product version changed' } })
    const { res, result } = response()
    await productsHandler(d)(req('PATCH', { supplierId, id: productId, expectedUpdatedAt: '2026-10-08T00:00:00Z', fields: { availability: 'available' } }), res)
    expect(result.status).toBe(409)
    expect(d.rpc).toHaveBeenCalledTimes(1)
    expect(d.from).not.toHaveBeenCalled()
  })

  it('never writes or returns private costs via the customer-facing projection', async () => {
    const d = deps(); const order = vi.fn().mockResolvedValue({ data: [{ id: productId, wholesale_cost: 12, cost_currency: 'GBP' }], error: null })
    d.from.mockReturnValue({ select: vi.fn(() => ({ eq: vi.fn(() => ({ order })) })) })
    const { res, result } = response()
    await productsHandler(d)(req('GET', undefined, { supplierId }), res)
    expect(result.status).toBe(200)
    expect(d.from).toHaveBeenCalledWith('supplier_products')
    expect(JSON.stringify(result.body)).toContain('wholesale_cost')
    expect(d.from).not.toHaveBeenCalledWith('effective_company_supplier_products')
  })
})
