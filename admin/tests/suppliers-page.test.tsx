// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Suppliers from '../src/pages/Suppliers.js'

const api = vi.hoisted(() => ({ listSuppliers: vi.fn(), listSupplierProducts: vi.fn(), createSupplier: vi.fn(), updateSupplier: vi.fn(), createSupplierProduct: vi.fn(), updateSupplierProduct: vi.fn() }))
vi.mock('../src/lib/api', () => api)
afterEach(() => { cleanup(); vi.clearAllMocks() })

const supplier = { id: 's1', name: 'Acme', slug: 'acme', status: 'active', countries: [], asset_rights_status: 'unknown' }
const product = { id: 'p1', supplier_id: 's1', supplier_sku: 'FTS-001', source_product_key: 'TEST-FRAME-001', catalog_scope: 'default', variant_key: '', category: 'frame', supplier_description: 'Wood', lifecycle: 'active', availability: 'available', wholesale_cost: 4.50, cost_currency: 'GBP', cost_unit: 'metre', cost_tax_basis: 'exclusive', cost_effective_at: '2026-10-09T08:41:00Z', updated_at: '2026-10-09T09:00:00Z' }
async function openProduct() {
  api.listSuppliers.mockResolvedValue({ suppliers: [supplier] })
  api.listSupplierProducts.mockResolvedValue({ products: [product] })
  api.updateSupplierProduct.mockResolvedValue({ product })
  render(<Suppliers />)
  fireEvent.click(await screen.findByRole('button', { name: /Acme/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit metadata' }))
}

describe('Platform Admin supplier page', () => {
  it('shows local effective time and preserves its instant on wholesale-only update in UTC+02', async () => {
    const previousTZ = process.env.TZ
    process.env.TZ = 'Etc/GMT-2'
    try {
      await openProduct()
      expect((screen.getByLabelText('Cost effective date') as HTMLInputElement).value).toBe('2026-10-09T10:41')
      fireEvent.change(screen.getByLabelText('Wholesale cost'), { target: { value: '5.25' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
      await waitFor(() => expect(api.updateSupplierProduct).toHaveBeenCalled())
      const fields = api.updateSupplierProduct.mock.calls[0][3]
      expect(fields.wholesale_cost).toBe(5.25)
      expect(fields.cost_effective_at).toBe('2026-10-09T08:41:00Z')
    } finally { process.env.TZ = previousTZ }
  })

  it('converts a deliberate local effective-time edit into the correct UTC instant', async () => {
    const previousTZ = process.env.TZ
    process.env.TZ = 'Etc/GMT-2'
    try {
      await openProduct()
      fireEvent.change(screen.getByLabelText('Cost effective date'), { target: { value: '2026-10-10T11:15' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
      await waitFor(() => expect(api.updateSupplierProduct).toHaveBeenCalled())
      expect(api.updateSupplierProduct.mock.calls[0][3].cost_effective_at).toBe('2026-10-10T09:15:00.000Z')
    } finally { process.env.TZ = previousTZ }
  })

  it('does not submit an unchanged effective date or other metadata on a cost-only edit', async () => {
    await openProduct()
    fireEvent.change(screen.getByLabelText('Wholesale cost'), { target: { value: '5.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
    await waitFor(() => expect(api.updateSupplierProduct).toHaveBeenCalled())
    const fields = api.updateSupplierProduct.mock.calls[0][3]
    expect(fields).not.toHaveProperty('category')
    expect(fields).not.toHaveProperty('width_mm')
    expect(fields.cost_effective_at).toBe('2026-10-09T08:41:00Z')
    expect(fields.wholesale_cost).toBe(5.25)
  })
  it('does not PATCH an unedited product', async () => {
    await openProduct()
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save product' })).toBeNull())
    expect(api.updateSupplierProduct).not.toHaveBeenCalled()
  })
  it('lists suppliers and opens their private products without activating asset images', async () => {
    api.listSuppliers.mockResolvedValue({ suppliers: [{ id: 's1', name: 'Acme', slug: 'acme', status: 'active', countries: ['GB'], asset_rights_status: 'unknown' }] })
    api.listSupplierProducts.mockResolvedValue({ products: [{ id: 'p1', supplier_id: 's1', supplier_sku: 'SKU-01', source_product_key: 'feed-1', catalog_scope: 'default', variant_key: '', category: 'frame', supplier_description: 'Wood', lifecycle: 'active', availability: 'limited', wholesale_cost: 12, cost_currency: 'GBP', cost_unit: 'metre', cost_tax_basis: 'exclusive', cost_effective_at: '2026-10-08T00:00:00Z', source_image_url: 'https://example.invalid/image', image_rights_status: 'unknown', asset_status: 'unreviewed' }] })
    render(<Suppliers />)
    await screen.findByRole('button', { name: /Acme/ })
    fireEvent.click(screen.getByRole('button', { name: /Acme/ }))
    await waitFor(() => expect(document.body.textContent).toContain('SKU-01'))
    expect(document.body.textContent).toContain('feed-1')
    expect(document.body.textContent).toContain('12 GBP')
    expect(document.querySelector('img')).toBeNull()
    expect(document.body.textContent).toContain('Private')
  })

  it('auto-generates a conventional slug and permits a manual override', async () => {
    api.listSuppliers.mockResolvedValue({ suppliers: [] })
    api.createSupplier.mockResolvedValue({ supplier: { id: 's1' } })
    render(<Suppliers />)
    fireEvent.click(await screen.findByRole('button', { name: 'New supplier' }))
    fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'FramersApp Test Supplier' } })
    expect((screen.getByLabelText('Supplier slug') as HTMLInputElement).value).toBe('framersapp-test-supplier')
    expect(screen.getByText(/Lowercase letters and numbers only/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Supplier slug'), { target: { value: 'custom-supplier' } })
    fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Changed Name' } })
    expect((screen.getByLabelText('Supplier slug') as HTMLInputElement).value).toBe('custom-supplier')
    fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }))
    await waitFor(() => expect(api.createSupplier).toHaveBeenCalledWith(expect.objectContaining({ slug: 'custom-supplier', name: 'Changed Name' })))
  })
  it('shows only relevant blank dimensions but keeps existing values editable', async () => {
    await openProduct()
    expect(screen.getByLabelText('Width (mm)')).toBeTruthy()
    expect(screen.queryByLabelText('Glazing thickness (mm)')).toBeNull()
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'glazing' } })
    expect(screen.getByLabelText('Glazing thickness (mm)')).toBeTruthy()
    expect(screen.queryByLabelText('Rebate width (mm)')).toBeNull()
  })
  it('rejects invalid slugs with an actionable error', async () => {
    const { validateSupplier } = await import('../server/platform/supplierValidation.js')
    expect(() => validateSupplier({ name: 'Example', slug: 'Bad Slug', status: 'draft', countries: [], asset_rights_status: 'unknown' }, true)).toThrow(/Lowercase letters and numbers only/)
  })
  it('creates a supplier through the admin API', async () => {
    api.listSuppliers.mockResolvedValue({ suppliers: [] })
    api.createSupplier.mockResolvedValue({ supplier: { id: 's1' } })
    render(<Suppliers />)
    await screen.findByText('No suppliers yet.')
    fireEvent.click(screen.getByRole('button', { name: 'New supplier' }))
    fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText('Supplier slug'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Countries (ISO 2-letter codes, comma-separated)'), { target: { value: 'GB,US' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }))
    await waitFor(() => expect(api.createSupplier).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme', slug: 'acme', countries: ['GB', 'US'] })))
  })

  it('creates a private-cost product with source identity', async () => {
    api.listSuppliers.mockResolvedValue({ suppliers: [{ id: 's1', name: 'Acme', slug: 'acme', status: 'active', countries: [], asset_rights_status: 'unknown' }] })
    api.listSupplierProducts.mockResolvedValue({ products: [] })
    api.createSupplierProduct.mockResolvedValue({ product: { id: 'p1' } })
    render(<Suppliers />)
    fireEvent.click(await screen.findByRole('button', { name: /Acme/ }))
    fireEvent.click(screen.getByRole('button', { name: 'New product' }))
    fireEvent.change(screen.getByLabelText('Supplier SKU'), { target: { value: 'SKU-01' } })
    fireEvent.change(screen.getByLabelText('Supplier description'), { target: { value: 'Frame' } })
    fireEvent.change(screen.getByLabelText('Wholesale cost'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Currency (ISO 3-letter code)'), { target: { value: 'GBP' } })
    fireEvent.change(screen.getByLabelText('Cost unit'), { target: { value: 'metre' } })
    fireEvent.change(screen.getByLabelText('Cost tax basis'), { target: { value: 'exclusive' } })
    fireEvent.change(screen.getByLabelText('Cost effective date'), { target: { value: '2026-10-08T12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))
    await waitFor(() => expect(api.createSupplierProduct).toHaveBeenCalledWith('s1', expect.objectContaining({ supplier_sku: 'SKU-01', wholesale_cost: 10, cost_currency: 'GBP', cost_unit: 'metre', cost_tax_basis: 'exclusive' })))
  })
})
