import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import VisualizerApp from '@/VisualizerApp'
import { useToast } from '@/lib/toast'

const state = vi.hoisted(() => ({ catalog: {} as any, preset: {} as any,
  customers: [{ id: 'customer', firstName: 'Pilot', lastName: 'Test', email: 'pilot@example.test' }],
  loading: false, settingsLoading: false, error: null as string | null, settingsError: null as string | null,
  quote: vi.fn(), job: vi.fn(), invoice: vi.fn(), customer: vi.fn(),
}))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: state.catalog, loading: state.loading,
  settingsLoading: state.settingsLoading, error: state.error, settingsError: state.settingsError }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [], add: state.quote }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ add: state.job }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ addInvoice: state.invoice }) }))
vi.mock('@/lib/customers', async original => ({ ...await original<typeof import('@/lib/customers')>(),
  useCustomers: () => ({ customers: state.customers, add: state.customer }) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ readOnly: false }) }))
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => ({ supplierProducts: [], selectionIssue: () => null }) }))
vi.mock('@/components/RoomMockup', () => ({ default: () => null }))
vi.mock('@/components/PresetControls', () => ({ default: ({ onApply }: { onApply: (value: unknown) => void }) =>
  <button onClick={() => onApply({ state: state.preset })}>Load pilot preset</button> }))

beforeEach(() => {
  localStorage.clear()
  state.catalog = { frames: [{ id: 'f', name: 'Frame', pricePerMeter: 10, faceWidthCm: 2 }],
    mats: [{ id: 'm', name: 'Mat', pricePerSqM: 5 }], glazing: [{ id: 'g', name: 'Glass', pricePerSqM: 8 }],
    printingMaterials: [{ id: 'p', name: 'Pilot paper', pricePerSqM: 25 }],
    settings: { currencyCode: 'ZAR', currencySymbol: 'R', marginMultiplier: 1.25, labourBase: 10,
      printingPerSqM: 50, foamBackerPerSqM: 12, taxRatePct: 15 } }
  state.preset = { frame: { id: 'f' }, glazing: { id: 'g' }, printing: { includePrint: true, printMaterialId: 'p' } }
  state.loading = false; state.settingsLoading = false; state.error = null; state.settingsError = null
  state.quote.mockReset().mockImplementation(async payload => ({ ok: true, quote: { ...payload, id: 'q' } }))
  state.job.mockReset().mockImplementation(async payload => ({ ok: true, job: { ...payload, id: 'j' } }))
  state.invoice.mockReset().mockImplementation(async payload => ({ ok: true, invoice: { ...payload, id: 'i' } }))
  state.customer.mockReset()
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External transport forbidden') }))
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.location.hash = ''
  for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id)
})
function open() {
  render(<VisualizerApp />)
  fireEvent.click(screen.getByRole('button', { name: 'Load pilot preset' }))
  fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'customer' } })
}
async function assertBlocked() {
  expect(screen.getByRole('alert').textContent).toMatch(/rate|material|loading|load|pricing|settings|supplier/i)
  for (const name of ['Add to Quotes', 'Add to Jobs', 'Add to Invoices', 'Create Quote + Invoice + Job']) {
    fireEvent.click(screen.getByRole('button', { name }))
  }
  await waitFor(() => expect(state.quote).not.toHaveBeenCalled())
  expect(state.job).not.toHaveBeenCalled(); expect(state.invoice).not.toHaveBeenCalled(); expect(state.customer).not.toHaveBeenCalled()
}
it.each([undefined, null, '', '25', -1, NaN, Infinity])('blocks selected printing rate %s without using the valid fallback', async rate => {
  state.catalog.printingMaterials[0].pricePerSqM = rate
  open(); await assertBlocked()
})
it.each(['frame', 'glazing', 'mat1', 'mat2', 'mat3', 'print'])('blocks unavailable saved %s selection without substituting another product', async category => {
  if (category === 'frame') state.preset.frame.id = 'gone'
  if (category === 'glazing') state.preset.glazing.id = 'gone'
  if (category.startsWith('mat')) state.preset.mats = { [`selectedMat${category.slice(-1)}`]: 'gone', hasMat2: true, hasMat3: true }
  if (category === 'print') state.preset.printing.printMaterialId = 'gone'
  open(); await assertBlocked()
})
it.each(['frame', 'glazing', 'printing'])('allows recovery from an unavailable %s when only one valid product exists', async category => {
  if (category === 'frame') state.preset.frame.id = 'gone'
  if (category === 'glazing') state.preset.glazing.id = 'gone'
  if (category === 'printing') state.preset.printing.printMaterialId = 'gone'
  open(); await assertBlocked()
  const option = screen.getByRole('option', { name: new RegExp(`Unavailable ${category}`, 'i') })
  fireEvent.change(option.parentElement!, { target: { value: category === 'frame' ? 'f' : category === 'glazing' ? 'g' : 'p' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  await waitFor(() => expect(state.quote).toHaveBeenCalledTimes(1))
})
it.each(['frames', 'glazing', 'mats'].flatMap(category => [undefined, null, '', '5', -1, NaN, Infinity].map(rate => [category, rate] as const)))('blocks invalid rates in included %s: %s', async (category, rate) => {
  state.catalog[category][0][category === 'frames' ? 'pricePerMeter' : 'pricePerSqM'] = rate
  if (category === 'mats') state.preset.mats = { selectedMat1: 'm' }
  open(); await assertBlocked()
})
it.each(['loading', 'settingsLoading', 'error', 'settingsError'] as const)('blocks before writes when %s is set', async key => {
  if (key === 'loading' || key === 'settingsLoading') state[key] = true
  else state[key] = 'Simulated read failure'
  open(); await assertBlocked()
})
it.each(['fallback', 'foam'])('does not invent a zero for missing %s rate', async category => {
  if (category === 'fallback') { state.preset.printing.printMaterialId = ''; delete state.catalog.settings.printingPerSqM }
  else { state.preset.backer = { includeBacker: true }; delete state.catalog.settings.foamBackerPerSqM }
  open(); await assertBlocked()
})
it('carries the configured positive printing charge unchanged through every direct creation action', async () => {
  open()
  for (const [name, expectedCalls] of [['Add to Quotes', 1], ['Add to Jobs', 2], ['Add to Invoices', 3], ['Create Quote + Invoice + Job', 6]] as const) {
    fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => expect(state.quote.mock.calls.length + state.job.mock.calls.length + state.invoice.mock.calls.length).toBe(expectedCalls))
  }
  await waitFor(() => expect(state.invoice).toHaveBeenCalledTimes(2))
  expect(state.quote).toHaveBeenCalledTimes(2); expect(state.job).toHaveBeenCalledTimes(2)
  const snapshot = state.quote.mock.calls[0][0].pricingSnapshot
  expect(snapshot.items.find((line: any) => line.key === 'print')).toMatchObject({ productId: 'p', materialQuantity: 0.12, rawAmount: 3, qty: 0.12, unit: 'm²', lineTotal: 3.75 })
  for (const payload of [...state.quote.mock.calls, ...state.job.mock.calls, ...state.invoice.mock.calls].map(call => call[0])) expect(payload.pricingSnapshot).toEqual(snapshot)
})
it('accepts explicit R0 material rates and applies the existing multiplier once to remaining charges', async () => {
  state.catalog.printingMaterials[0].pricePerSqM = 0
  state.catalog.frames[0].pricePerMeter = 0
  state.catalog.glazing[0].pricePerSqM = 0
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Create Quote + Invoice + Job' }))
  await waitFor(() => expect(state.invoice).toHaveBeenCalledTimes(1))
  expect(state.quote.mock.calls[0][0].pricingSnapshot).toMatchObject({ version: 1, subtotal: 12.5, tax: 1.88, total: 14.38 })
  expect(state.quote.mock.calls[0][0].pricingSnapshot.items.find((line: any) => line.key === 'print')).toMatchObject({ qty: 0.12, unit: 'm²', rawAmount: 0, lineTotal: 0 })
})
it('accepts an explicit zero fallback when printing is enabled', async () => {
  state.catalog.printingMaterials = []; delete state.catalog.settings.foamBackerPerSqM
  state.catalog.settings.printingPerSqM = 0; state.preset.printing.printMaterialId = ''
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  await waitFor(() => expect(state.quote).toHaveBeenCalledTimes(1))
  expect(state.quote.mock.calls[0][0].pricingSnapshot.items.find((line: any) => line.key === 'print').lineTotal).toBe(0)
})
it('ignores disabled optional material rates', async () => {
  state.catalog.printingMaterials = []; delete state.catalog.settings.printingPerSqM; delete state.catalog.settings.foamBackerPerSqM
  state.preset.printing = { includePrint: false }
  open(); fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  await waitFor(() => expect(state.quote).toHaveBeenCalledTimes(1))
  expect(state.quote.mock.calls[0][0].pricingSnapshot.items.map((line: any) => line.key)).not.toContain('print')
})
it('retains legacy foam with an explicitly configured zero rate', async () => {
  state.catalog.settings.foamBackerPerSqM = 0; state.preset.backer = { includeBacker: true }
  open(); fireEvent.click(screen.getByRole('button', { name: 'Add to Jobs' }))
  await waitFor(() => expect(state.job).toHaveBeenCalledTimes(1))
  expect(state.job.mock.calls[0][0].pricingSnapshot.items.find((line: any) => line.key === 'backer')).toMatchObject({ unit: 'm²', qty: 0.12, lineTotal: 0 })
})
it.each(['fallback', 'foam'].flatMap(category => [null, '', '5', -1, NaN, Infinity].map(rate => [category, rate] as const)))('rejects invalid %s rate %s', async (category, rate) => {
  if (category === 'fallback') { state.preset.printing.printMaterialId = ''; state.catalog.settings.printingPerSqM = rate }
  else { state.preset.backer = { includeBacker: true }; state.catalog.settings.foamBackerPerSqM = rate }
  open(); await assertBlocked()
})
it('rejects supplier printing even if a discovery hook returns no warning', async () => {
  state.catalog.printingMaterials[0].id = 'supplier:p'; state.preset.printing.printMaterialId = 'supplier:p'
  open(); await assertBlocked()
})
it.each(['labourBase', 'marginMultiplier'].flatMap(key => [undefined, null, '', '1', -1, NaN, Infinity].map(value => [key, value] as const)))('rejects invalid pricing setting %s: %s', async (key, value) => {
  state.catalog.settings[key] = value
  open(); await assertBlocked()
})
it('recovers from a rejected design only after loading valid data', async () => {
  state.preset.art = { widthCm: -1, heightCm: 30 }
  open(); await assertBlocked()
  state.preset.art = { widthCm: 40, heightCm: 30 }
  fireEvent.click(screen.getByRole('button', { name: 'Load pilot preset' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  await waitFor(() => expect(state.quote).toHaveBeenCalledTimes(1))
})
it('renders a validation error instead of crashing on invalid dimensions', async () => {
  state.preset.art = { widthCm: -1, heightCm: 30 }
  open(); await assertBlocked()
})
