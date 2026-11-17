import React from 'react'
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Admin from '@/pages/Admin'
import VisualizerApp from '@/VisualizerApp'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useCatalog, type Catalog } from '@/lib/store'
import { useQuotes } from '@/lib/quotes'
import { priceVisualiser, type toVisualiserQuote } from '@/lib/pricing'
import { useToast } from '@/lib/toast'

const memory = vi.hoisted(() => ({
  company: 'new-material-company', revision: 1, catalog: null as Catalog | null,
  settings: { currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 20, taxLabel: 'VAT',
    marginMultiplier: 1.25, labourBase: 10 },
  quotes: [] as Array<{ id: string; company_account_id: string; customer_id: string; payload: ReturnType<typeof toVisualiserQuote> }>,
  catalogReads: 0, quoteReads: 0, catalogWrites: 0,
}))

// Replace the external transport, not catalogue/company/customer/quote hooks or pricing.
// Unsupported tables, missing company scopes and unexpected writes fail closed.
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    if (!['company_settings', 'company_catalog', 'customers', 'quotes'].includes(table))
      throw new Error(`Unexpected table: ${table}`)
    let company: string | undefined
    let inserted: (typeof memory.quotes)[number] | undefined
    const scoped = () => { if (company !== memory.company) throw new Error(`Missing/wrong company scope for ${table}`) }
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {
        if (key !== 'company_account_id') throw new Error(`Unexpected filter: ${key}`)
        company = value; return query
      },
      maybeSingle: async () => {
        scoped()
        if (table === 'company_settings') return { data: structuredClone({ settings: memory.settings }), error: null }
        if (table !== 'company_catalog') throw new Error(`Unexpected scalar read: ${table}`)
        memory.catalogReads++
        return { data: structuredClone({ catalog: memory.catalog, revision: memory.revision }), error: null }
      },
      order: async () => {
        scoped()
        if (table === 'quotes') {
          memory.quoteReads++
          return { data: structuredClone(memory.quotes.filter(row => row.company_account_id === company)), error: null }
        }
        if (table !== 'customers') throw new Error(`Unexpected list read: ${table}`)
        return { data: [{ id: 'customer', first_name: 'Local', last_name: 'Customer', email: 'local@example.invalid',
          phone: null, company_name: null, notes: null }], error: null }
      },
      insert: (row: (typeof memory.quotes)[number]) => {
        if (table !== 'quotes' || row.company_account_id !== memory.company || row.customer_id !== 'customer')
          throw new Error('Unexpected or unscoped insert')
        inserted = structuredClone(row)
        memory.quotes.push(structuredClone(row))
        return query
      },
      single: async () => {
        if (!inserted) throw new Error('Unexpected insert readback')
        return { data: structuredClone(inserted), error: null }
      },
    }
    return query
  },
  rpc: async (name: string, args: { p_company_account_id: string; p_catalog: Catalog; p_revision: number }) => {
    if (name !== 'update_company_catalog' || args.p_company_account_id !== memory.company)
      throw new Error(`Unexpected/unscoped RPC: ${name}`)
    if (args.p_revision !== memory.revision) return { data: null, error: { code: '40001', message: 'Revision conflict' } }
    memory.catalog = structuredClone(args.p_catalog); memory.revision++; memory.catalogWrites++
    return { data: structuredClone({ catalog: memory.catalog, revision: memory.revision }), error: null }
  },
} }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({}) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({}) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
const supplierCatalogue = { supplierProducts: [], selectionIssue: () => null }
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => supplierCatalogue }))
vi.mock('@/components/RoomMockup', () => ({ default: () => null }))
vi.mock('@/components/PresetControls', () => ({ default: () => null }))

const access: BillingAccess = { companyAccountId: memory.company, userId: 'local-owner', companyName: 'Local Frames',
  readOnly: false, hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '' }
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access}>{children}</BillingAccessProvider>
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.location.hash = ''
  memory.revision = 1; memory.catalogReads = 0; memory.quoteReads = 0; memory.catalogWrites = 0; memory.quotes = []
  memory.catalog = {
    frames: [{ id: 'frame', name: 'Existing frame', pricePerMeter: 10, faceWidthCm: 2 }],
    mats: [{ id: 'mat0', name: 'No mat', pricePerSqM: 0 }],
    glazing: [{ id: 'old-glass', name: 'Existing glass', pricePerSqM: 8 }], printingMaterials: [], backers: [],
    settings: { ...memory.settings, unit: 'metric', themeColor: '#fff', printingPerSqM: 10 },
  }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in this regression') }))
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => { throw new Error('XHR forbidden in this regression') })
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); window.location.hash = ''
  for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id)
})

it('creates glazing in Admin, reloads its rate, selects it in the Visualiser and persists the £39.60 quote', async () => {
  const admin = render(<Admin />, { wrapper: Wrapper })
  await screen.findByRole('button', { name: 'Save settings' })
  fireEvent.click(screen.getByRole('button', { name: 'Glazing' }))
  await screen.findByDisplayValue('Existing glass')
  fireEvent.click(screen.getByRole('button', { name: 'Add glazing' }))
  const name = screen.getByDisplayValue('New glazing')
  const row = within(name.closest('tr')!)
  fireEvent.change(name, { target: { value: 'New conservation glass' } })
  fireEvent.change(row.getByLabelText('Base material rate'), { target: { value: '20' } })
  expect(row.getByText(/Effective selling rate.*25/)).toBeTruthy()
  await waitFor(() => expect(memory.catalog!.glazing.find(product => product.name === 'New conservation glass'))
    .toMatchObject({ pricePerSqM: 20 }))
  await waitFor(() => expect(screen.queryByText(/Saving catalogue/)).toBeNull())
  const savedGlazing = structuredClone(memory.catalog!.glazing.find(product => product.name === 'New conservation glass')!)
  expect(savedGlazing.id).toEqual(expect.any(String))
  expect(savedGlazing.id).not.toBe('old-glass')
  expect(savedGlazing.id).not.toBe('')
  expect(savedGlazing).not.toHaveProperty('costPerSqm')
  expect(memory.catalog!.glazing).toHaveLength(2)
  admin.unmount()

  const previousReads = memory.catalogReads
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.loading || reader.result.current.settingsLoading).toBe(false))
  expect(memory.catalogReads).toBeGreaterThan(previousReads)
  expect(reader.result.current.catalog.glazing.find(product => product.id === savedGlazing.id)).toEqual(savedGlazing)
  // Confirm the fixture against the real engine, independently of displayed/saved UI values.
  const catalog = reader.result.current.catalog
  const expected = priceVisualiser({ artWcm: 40, artHcm: 30, borderCm: 0, frame: catalog.frames[0], mats: [],
    glazing: savedGlazing, print: null, backer: null, labourBase: catalog.settings.labourBase,
    marginMultiplier: catalog.settings.marginMultiplier, taxRatePct: catalog.settings.taxRatePct,
    taxLabel: catalog.settings.taxLabel, currencyCode: catalog.settings.currencyCode, currencySymbol: catalog.settings.currencySymbol })
  expect(expected).toMatchObject({ subtotal: 33, tax: 6.6, total: 39.6, taxRate: 0.2, marginMultiplier: 1.25 })
  expect(expected.items.find(line => line.key === 'glazing')).toMatchObject({ productId: savedGlazing.id,
    qty: 0.12, unit: 'm²', materialQuantity: 0.12, materialUnit: 'm²', unitPrice: 25, lineTotal: 3 })
  reader.unmount()

  const visualiser = render(<VisualizerApp />, { wrapper: Wrapper })
  await screen.findByRole('option', { name: /New conservation glass/ })
  // Loading effects can replace the panel DOM; query the live dropdown after they settle.
  await waitFor(() => expect(screen.getByRole('option', { name: /New conservation glass/ }).closest('select')!.value).toBe('old-glass'))
  const option = screen.getByRole('option', { name: /New conservation glass/ })
  fireEvent.change(option.closest('select')!, { target: { value: savedGlazing.id } })
  expect(screen.getByRole('option', { name: /New conservation glass/ }).closest('select')!.value).toBe(savedGlazing.id)
  expect(option.textContent).toMatch(/selling £25\.00\/m²/)
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(await screen.findByText('£39.60')).toBeTruthy()
  const customerOption = await screen.findByRole('option', { name: /Local Customer/ })
  fireEvent.change(customerOption.closest('select')!, { target: { value: 'customer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  await waitFor(() => expect(memory.quotes).toHaveLength(1))
  const persisted = structuredClone(memory.quotes[0])
  expect(persisted).toMatchObject({ company_account_id: memory.company, customer_id: 'customer',
    payload: { customerId: 'customer', status: 'Draft', subtotal: 33, tax: 6.6, total: 39.6, currencyCode: 'GBP' } })
  expect(persisted.payload.pricingSnapshot).toEqual(expected)
  expect(persisted.payload.items.find((item: { productId?: string }) => item.productId === savedGlazing.id))
    .toMatchObject({ productId: savedGlazing.id, qty: 0.12, unit: 'm²', unitPrice: 25, total: 3 })
  visualiser.unmount()

  const previousQuoteReads = memory.quoteReads, previousWrites = memory.catalogWrites
  const reopened = renderHook(() => useQuotes(), { wrapper: Wrapper })
  await waitFor(() => expect(reopened.result.current.loading).toBe(false))
  expect(reopened.result.current.error).toBeNull()
  expect(memory.quoteReads).toBeGreaterThan(previousQuoteReads)
  expect(reopened.result.current.quotes).toHaveLength(1)
  const quote = reopened.result.current.quotes[0]
  expect(quote).toMatchObject({ id: persisted.id, customerId: 'customer', subtotal: 33, tax: 6.6, total: 39.6 })
  expect(quote.pricingSnapshot).toEqual(expected)
  expect(quote.items.find(item => 'productId' in item && item.productId === savedGlazing.id))
    .toMatchObject({ productId: savedGlazing.id, qty: 0.12, unit: 'm²', unitPrice: 25, total: 3 })
  expect(memory.quotes).toEqual([persisted])
  expect(memory.catalogWrites).toBe(previousWrites)
  expect(fetch).not.toHaveBeenCalled()
  expect(XMLHttpRequest.prototype.open).not.toHaveBeenCalled()
})
