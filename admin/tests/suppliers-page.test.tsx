// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Suppliers from '../src/pages/Suppliers.js'

const api = vi.hoisted(() => ({ listSuppliers: vi.fn(), listSupplierProducts: vi.fn(), createSupplier: vi.fn(), updateSupplier: vi.fn(), createSupplierProduct: vi.fn(), updateSupplierProduct: vi.fn() }))
vi.mock('../src/lib/api', () => api)
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Platform Admin supplier page', () => {
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
