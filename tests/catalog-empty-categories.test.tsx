import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useCatalog, type Catalog } from '@/lib/store'
import Admin from '@/pages/Admin'
import VisualizerApp from '@/VisualizerApp'

const state = vi.hoisted(() => ({ catalog: null as Partial<Catalog> | null, revision: 1,
  writes: [] as Catalog[], quotes: [] as unknown[], jobs: [] as unknown[], invoices: [] as unknown[] }))
const settings = { currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 0 }
const customers = [{ id: 'customer', firstName: 'Test', lastName: 'Customer' }]
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const q = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === 'company_settings' ? { settings }
        : state.catalog === null ? null : { catalog: structuredClone(state.catalog), revision: state.revision }, error: null }),
      insert: (row: { catalog: Catalog }) => { state.catalog = structuredClone(row.catalog); state.writes.push(structuredClone(row.catalog)); return q },
      single: async () => ({ data: { catalog: structuredClone(state.catalog), revision: state.revision }, error: null }),
    }
    return q
  },
  rpc: async (name: string, args: { p_catalog: Catalog; p_revision: number }) => {
    if (name !== 'update_company_catalog') throw new Error(`Unexpected RPC ${name}`)
    if (args.p_revision !== state.revision) return { data: null, error: { code: '40001', message: 'Revision conflict' } }
    state.catalog = structuredClone(args.p_catalog); state.revision++
    state.writes.push(structuredClone(args.p_catalog))
    return { data: { catalog: structuredClone(state.catalog), revision: state.revision }, error: null }
  },
} }))
vi.mock('@/lib/customers', async original => ({ ...await original<typeof import('@/lib/customers')>(), useCustomers: () => ({ customers }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ add: vi.fn(async (value: unknown) => { state.quotes.push(value); return { ok: true } }) }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ add: vi.fn(async (value: unknown) => { state.jobs.push(value); return { ok: true } }) }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ addInvoice: vi.fn(async (value: unknown) => { state.invoices.push(value); return { ok: true } }) }) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
const effectiveCatalogue = { selectionIssue: () => null, supplierProducts: [] }
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => effectiveCatalogue }))
vi.mock('@/components/RoomMockup', () => ({ default: () => null }))
vi.mock('@/components/PresetControls', () => ({ default: () => null }))
const access = { companyAccountId: 'company-a', userId: 'owner-a', readOnly: false, hasFullAccess: true } as BillingAccess
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access}>{children}</BillingAccessProvider>
function seed(): Catalog {
  return { frames: [{ id: 'custom-frame', name: 'Only frame', pricePerMeter: 10, faceWidthCm: 2 }],
    mats: [{ id: 'mat0', name: 'No mat', pricePerSqM: 0 }, { id: 'custom-mat', name: 'Only mat', pricePerSqM: 5 }],
    glazing: [{ id: 'custom-glass', name: 'Only glass', pricePerSqM: 8 }],
    printingMaterials: [{ id: 'custom-print', name: 'Only print', pricePerSqM: 20 }],
    backers: [{ id: 'custom-backer', name: 'Only backer', pricePerSqM: 15 }],
    settings: { ...settings, unit: 'metric', themeColor: '#fff', labourBase: 10, marginMultiplier: 1.25, printingPerSqM: 20 },
    stock: { frames: [{ profileId: 'custom-frame', metersAvailable: 10 }], sheets: [], rolls: [] } }
}
beforeEach(() => {
  localStorage.clear(); state.catalog = seed(); state.revision = 1; state.writes = []
  state.quotes = []; state.jobs = []; state.invoices = []
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('removes the last frame through Admin, persists the empty category and blocks new priced designs after reload', async () => {
  const stock = structuredClone(state.catalog!.stock)
  const view = render(<Admin />, { wrapper: Wrapper })
  await screen.findByRole('button', { name: 'Save settings' })
  fireEvent.click(screen.getByRole('button', { name: 'Frames' }))
  const row = (await screen.findByDisplayValue('Only frame')).closest('tr')!
  fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(state.writes).toHaveLength(1))
  expect(state.writes[0].frames).toEqual([])
  expect(state.catalog!.stock).toEqual(stock)
  await waitFor(() => expect(screen.queryByText(/Saving catalogue/)).toBeNull())
  view.unmount()
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.loading).toBe(false))
  expect(reader.result.current.catalog.frames).toEqual([])
  reader.unmount()
  render(<VisualizerApp />, { wrapper: Wrapper })
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/select an available frame/i))
  expect(screen.queryByRole('option', { name: /Black Classic|Oak 30mm/ })).toBeNull()
  fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'customer' } })
  for (const name of ['Add to Quotes', 'Add to Jobs', 'Add to Invoices', 'Create Quote + Invoice + Job'])
    fireEvent.click(screen.getByRole('button', { name }))
  expect(state.quotes).toEqual([]); expect(state.jobs).toEqual([]); expect(state.invoices).toEqual([])
})

it.each(['mats', 'glazing', 'printingMaterials', 'backers'] as const)(
  'keeps an explicitly emptied %s category through persistence and remount', async key => {
    const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(reader.result.current.loading).toBe(false))
    const untouched = structuredClone(reader.result.current.catalog.frames)
    await act(async () => {
      const result = await reader.result.current.setCatalog(previous => ({ ...previous, [key]: [] }))
      expect(result.ok).toBe(true)
    })
    const expected = key === 'mats' ? [{ id: 'mat0', name: 'No mat', pricePerSqM: 0, color: 'transparent' }] : []
    expect(state.writes[0][key]).toEqual(expected)
    expect(state.writes[0].frames).toEqual(untouched)
    reader.unmount()
    const reloaded = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(reloaded.result.current.loading).toBe(false))
    expect(reloaded.result.current.catalog[key]).toEqual(expected)
  },
)

it('loads empty categories without seeding products or writing on read', async () => {
  state.catalog = { frames: [], mats: [], glazing: [], printingMaterials: [], backers: [], settings: seed().settings }
  const original = structuredClone(state.catalog)
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.loading).toBe(false))
  for (const key of ['frames', 'glazing', 'printingMaterials', 'backers'] as const)
    expect(reader.result.current.catalog[key]).toEqual([])
  expect(reader.result.current.catalog.mats.map(mat => mat.id)).toEqual(['mat0'])
  expect(state.catalog).toEqual(original)
  expect(state.writes).toEqual([])
})

it('retains legacy defaults for absent categories and preserves populated products and cost metadata', async () => {
  state.catalog = { frames: [{ ...seed().frames[0], costPerMeter: 99, markupPct: 33 }], settings: seed().settings }
  const original = structuredClone(state.catalog.frames)
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.loading).toBe(false))
  expect(reader.result.current.catalog.frames).toEqual(original)
  expect(reader.result.current.catalog.mats.map(mat => mat.id)).toEqual(['mat0', 'mat1', 'mat2', 'mat3'])
  expect(reader.result.current.catalog.glazing.map(glass => glass.id)).toEqual(['gl1', 'gl2'])
  expect(reader.result.current.catalog.printingMaterials?.map(paper => paper.id)).toEqual(['pm1', 'pm2'])
  expect(state.writes).toEqual([])
})

it('keeps a company with no catalogue row empty', async () => {
  state.catalog = null
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.loading).toBe(false))
  for (const key of ['frames', 'mats', 'glazing', 'printingMaterials', 'backers'] as const)
    expect(reader.result.current.catalog[key]).toEqual([])
  expect(state.writes).toEqual([])
})

it('preserves explicit empty categories through JSON import without changing settings or stock', async () => {
  const catalog = { ...seed(), frames: [], mats: [], glazing: [], printingMaterials: [], backers: [] }
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.loading).toBe(false))
  await act(async () => { await reader.result.current.importJSON({ text: async () => JSON.stringify(catalog) } as File) })
  await waitFor(() => expect(state.writes).toHaveLength(1))
  for (const key of ['frames', 'glazing', 'printingMaterials', 'backers'] as const)
    expect(state.writes[0][key]).toEqual([])
  expect(state.writes[0].mats.map(mat => mat.id)).toEqual(['mat0'])
  expect(state.writes[0].settings).toMatchObject(catalog.settings)
  expect(state.writes[0].stock).toEqual(catalog.stock)
  reader.unmount()
  const reloaded = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reloaded.result.current.loading).toBe(false))
  expect(reloaded.result.current.catalog.frames).toEqual([])
  expect(reloaded.result.current.catalog.glazing).toEqual([])
})

