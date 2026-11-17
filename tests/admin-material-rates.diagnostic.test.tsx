import React from 'react'
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useCatalog, type Catalog } from '@/lib/store'
import Admin from '@/pages/Admin'
import VisualizerApp from '@/VisualizerApp'
import type { Quote } from '@/lib/quotes'
import type { CommercialSnapshot } from '@/lib/pricing'

type CapturedQuote = Partial<Quote> & { pricingSnapshot: CommercialSnapshot }
type PresetProps = { onApply: (preset: { state: Record<string, unknown> }) => void }

vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed', toggleLayoutMode: vi.fn() }) }))

const state = vi.hoisted(() => ({ catalog: null as Catalog | null, settings: { currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 0 } as Record<string, unknown>, quotes: [] as CapturedQuote[], settingsWrites: 0 }))
const customers = [{ id: 'c', firstName: 'Test', lastName: 'Customer', email: 'test@example.invalid' }]
vi.mock('@/lib/customers', async original => ({ ...await original<typeof import('@/lib/customers')>(), useCustomers: () => ({ customers }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ add: async (quote: CapturedQuote) => { state.quotes.push(structuredClone(quote)); return { ok: true, quote: { ...quote, id: 'q' } } } }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ create: vi.fn() }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ add: vi.fn() }) }))
vi.mock('@/lib/invoiceNavigation', () => ({ useInvoiceNavigation: () => ({ navigateToInvoice: vi.fn() }) }))
const effectiveCatalogue = { selectionIssue: () => null, supplierProducts: [] }
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => effectiveCatalogue }))
vi.mock('@/components/PresetControls', () => ({ default: ({ onApply }: PresetProps) => <button onClick={() => onApply({ state: {
  customerId: 'c', art: { w: 40, h: 30 }, frame: { id: 'x' }, mats: { hasMat1: true, hasMat2: false, hasMat3: false,
    selectedMat1: 'x', selectedMat2: 'mat0', selectedMat3: 'mat0', mat1BorderCm: 5 },
  glazing: { id: 'x' }, printing: { includePrint: true, printMaterialId: 'x' }, backer: { includeBacker: true, materialId: 'x' },
} })}>Use configured materials</button> }))
vi.mock('@/lib/pdf/invoicePdf', () => ({ exportInvoicePDF: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let saved: Record<string, unknown>
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === 'company_settings' ? { settings: state.settings } : { catalog: structuredClone(state.catalog), revision: 1 }, error: null }),
      upsert: (row: Record<string, unknown>) => { state.settingsWrites++; saved = row; return query },
      single: async () => { state.settings = saved.settings as typeof state.settings; return { data: { settings: state.settings }, error: null } },
    }
    return query
  },
  rpc: async (name: string, args: { p_catalog: Catalog }) => {
    if (name !== 'update_company_catalog') throw new Error(`Unexpected RPC ${name}`)
    state.catalog = structuredClone(args.p_catalog)
    return { data: { catalog: state.catalog, revision: 2 }, error: null }
  },
} }))
const access = { companyAccountId: 'company-a', userId: 'owner-a', readOnly: false, hasFullAccess: true } as BillingAccess
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access}>{children}</BillingAccessProvider>
beforeEach(() => {
  localStorage.clear()
  state.quotes = []
  state.settingsWrites = 0
  state.settings = { currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 0 }
  const item = { id: 'x', name: 'Configured', pricePerSqM: 8, pricePerMeter: 8, faceWidthCm: 2, costPerSqm: 99, markupPct: 33, markupPercent: 44 }
  state.catalog = { frames: [{ ...item }], mats: [{ ...item }], glazing: [{ ...item }], printingMaterials: [{ ...item }], backers: [{ ...item }],
    settings: { unit: 'metric', themeColor: '#fff', marginMultiplier: 1.25, labourBase: 10, printingPerSqM: 12, foamBackerPerSqM: 15, currencyCode: 'GBP', currencySymbol: '£' } } as Catalog
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([
  ['Frames', 'frames', 'pricePerMeter'], ['Mats', 'mats', 'pricePerSqM'], ['Glazing', 'glazing', 'pricePerSqM'],
  ['Printing', 'printingMaterials', 'pricePerSqM'], ['Backer boards', 'backers', 'pricePerSqM'],
] as const)('%s saves the canonical base rate, reloads it and preserves cost/markup metadata', async (tab, key, field) => {
  const view = render(<Admin />, { wrapper: Wrapper })
  await screen.findByRole('heading', { name: 'Settings' })
  fireEvent.click(screen.getByRole('button', { name: tab }))
  const row = (await screen.findByDisplayValue('Configured')).closest('tr')!
  expect(within(row).queryByText('Markup %')).toBeNull()
  expect(screen.queryByText('Markup %')).toBeNull()
  fireEvent.change(within(row).getByLabelText('Base material rate'), { target: { value: '20' } })
  expect(within(row).getByText(/Effective selling rate.*25/)).toBeTruthy()
  await waitFor(() => expect(state.catalog![key].find(item => item.id === 'x')[field]).toBe(20))
  expect(state.catalog![key].find(item => item.id === 'x')).toMatchObject({ costPerSqm: 99, markupPct: 33, markupPercent: 44 })
  view.unmount()
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.catalog[key].find(item => item.id === 'x')?.[field]).toBe(20))
  reader.unmount()
  vi.stubGlobal('alert', vi.fn())
  render(<VisualizerApp />, { wrapper: Wrapper })
  fireEvent.click(screen.getByRole('button', { name: 'Use configured materials' }))
  fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'c' } })
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  await waitFor(() => expect(state.quotes).toHaveLength(1))
  const lineKey = { frames: 'frame', mats: 'mat1', glazing: 'glazing', printingMaterials: 'print', backers: 'backer' }[key]
  const expectedQuantity = key === 'frames' ? 1.8 : key === 'printingMaterials' ? 0.12 : 0.2
  expect(state.quotes[0].pricingSnapshot.items.find(item => item.key === lineKey)).toMatchObject({
    productId: 'x', qty: expectedQuantity, unitPrice: 25, lineTotal: expectedQuantity * 25,
  })
})

it('accepts explicit R0 and never populates a missing base rate from cost', async () => {
  state.catalog!.printingMaterials[0].pricePerSqM = undefined
  render(<Admin />, { wrapper: Wrapper })
  await screen.findByRole('heading', { name: 'Settings' })
  fireEvent.click(screen.getByRole('button', { name: 'Printing' }))
  const row = (await screen.findByDisplayValue('Configured')).closest('tr')!
  expect((within(row).getByLabelText('Base material rate') as HTMLInputElement).value).toBe('')
  expect(within(row).getByText(/configure a valid base material rate/)).toBeTruthy()
  fireEvent.change(within(row).getByLabelText('Base material rate'), { target: { value: '0' } })
  expect(within(row).queryByRole('alert')).toBeNull()
  await waitFor(() => expect(state.catalog!.printingMaterials[0]).toMatchObject({ pricePerSqM: 0, costPerSqm: 99 }))
})

it('exposes and persists the effective multiplier, labour and fallback settings without accepting a zero multiplier', async () => {
  const view = render(<Admin />, { wrapper: Wrapper })
  await screen.findByLabelText('Global selling multiplier')
  expect((screen.getByLabelText('Global selling multiplier') as HTMLInputElement).value).toBe('1.25')
  fireEvent.change(screen.getByLabelText('Global selling multiplier'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  expect(state.settings.marginMultiplier).toBeUndefined()
  fireEvent.change(screen.getByLabelText('Global selling multiplier'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Labour base rate per design'), { target: { value: '30' } })
  fireEvent.change(screen.getByLabelText('Legacy foam backing base rate / m²'), { target: { value: '17' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(state.settings).toMatchObject({ marginMultiplier: 2, labourBase: 30, foamBackerPerSqM: 17 }))
  view.unmount()
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.catalog.settings).toMatchObject({ marginMultiplier: 2, labourBase: 30, foamBackerPerSqM: 17 }))
})

it('does not silently restore an older fallback when its displayed rate is cleared', async () => {
  render(<Admin />, { wrapper: Wrapper })
  await screen.findByLabelText('Fallback printing base rate / m²')
  fireEvent.change(screen.getByLabelText('Fallback printing base rate / m²'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  expect(state.settingsWrites).toBe(0)
  // An explicit zero is valid, including when entered as 0.00.
  fireEvent.change(screen.getByLabelText('Fallback printing base rate / m²'), { target: { value: '0.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(state.settings).toMatchObject({ printingPerSqM: 0 }))
})
