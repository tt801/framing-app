import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import VisualizerApp from '@/VisualizerApp'
import { toPng } from 'html-to-image'
import * as exporters from '@/lib/exporters'
import type { Catalog } from '@/lib/store'
import type { VisualizerDesign } from '@/lib/visualizerScene'

type Opening = { id: string; shape: 'rect' | 'oval' | 'circle'; xCm: number; yCm: number; widthCm: number; heightCm: number; imageUrl?: string }
type Design = { visualizerDesign: VisualizerDesign; art: { widthCm: number; heightCm: number; imageUrl: string }; mats: { mode: string; openings: Opening[]; selectedMat1: string; mat1BorderCm: number } }
const state = vi.hoisted(() => ({ catalog: null as Catalog | null, current: null as Design | null, preset: {} as Record<string, unknown>, jobs: [] as unknown[], quotes: [] as unknown[], room: null as Record<string, unknown> | null }))
const customers = [{ id: 'stage-b-customer', firstName: 'Test', lastName: 'Customer', email: 'test@example.test' }]
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: state.catalog }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [], add: async (payload: unknown) => { state.quotes.push(payload); return { ok: true, quote: payload } } }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ add: async (payload: unknown) => { state.jobs.push(payload); return { ok: true, job: payload } } }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({}) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers }), validateCustomer: () => [] }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ readOnly: false }) }))
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => ({ supplierProducts: [], selectionIssue: () => null }) }))
vi.mock('@/components/RoomMockup', () => ({ default: (props: Record<string, unknown>) => { state.room = props; return null } }))
vi.mock('html-to-image', () => ({ toPng: vi.fn(async () => '') }))
vi.mock('@/components/PresetControls', () => ({ default: ({ currentState, onApply }: { currentState: Design; onApply: (p: { state: Record<string, unknown> }) => void }) => {
  state.current = currentState
  return <button onClick={() => onApply({ state: state.preset })}>Apply fixture</button>
} }))
beforeEach(() => {
  state.preset = {}; state.current = null; state.jobs = []; state.quotes = []
  state.catalog = { frames: [{ id: 'f', name: 'Frame', faceWidthCm: 2, pricePerMeter: 10 }],
    mats: [{ id: 'mat0', name: 'None', pricePerSqM: 0 }, { id: 'm', name: 'Green mat', color: '#00cc66', pricePerSqM: 5 }],
    glazing: [{ id: 'g', name: 'Glass', pricePerSqM: 8 }], settings: { currencyCode: 'GBP', marginMultiplier: 1.25, labourBase: 10, taxRatePct: 20 } } as Catalog
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
// Earlier fixtures represent the old independently editable controls. Explicitly retain that state.
const apply = () => { const mats = state.preset.mats as { locks?: boolean[] } | undefined; if (mats && !mats.locks) mats.locks = [false, false, false]; fireEvent.click(screen.getByText('Apply fixture')) }
const switchMode = (mode: 'basic' | 'pro') => {
  const select = screen.getByRole('option', { name: 'Pro (multi-opening)' }).parentElement!
  fireEvent.change(select, { target: { value: mode } })
}
const openingElement = (index = 0) => screen.getAllByTitle('Drag to move. Use handles to resize.')[index]
const handles = () => screen.queryAllByTitle(/^Drag to resize/)
const fixtureOpenings = (): Opening[] => [
  { id: 'a', shape: 'rect', xCm: 5, yCm: 5, widthCm: 10, heightCm: 12, imageUrl: 'data:image/png;base64,IMAGE_A' },
  { id: 'b', shape: 'oval', xCm: 20, yCm: 5, widthCm: 12, heightCm: 16, imageUrl: 'data:image/png;base64,IMAGE_B' },
  { id: 'c', shape: 'circle', xCm: 5, yCm: 20, widthCm: 8, heightCm: 8, imageUrl: '' },
]


it('provides locked defaults, unit-aware controls and positional deletion through the UI', () => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', color: '#0000ff', pricePerSqM: 6 }, { id: 'm3', name: 'Red', color: '#ff0000', pricePerSqM: 7 })
  render(<VisualizerApp />)
  fireEvent.change(screen.getByLabelText('Mat 1 material'), { target: { value: 'm' } })
  fireEvent.click(screen.getByText('+ Add second mat'))
  fireEvent.change(screen.getByLabelText('Mat 2 material'), { target: { value: 'm2' } })
  fireEvent.click(screen.getByText('+ Add third mat'))
  fireEvent.change(screen.getByLabelText('Mat 3 material'), { target: { value: 'm3' } })
  expect((screen.getByLabelText('Mat 2 Left (mm)') as HTMLInputElement).value).toBe('20')
  fireEvent.change(screen.getByLabelText('Mat 1 Left (cm)'), { target: { value: '6' } })
  expect((screen.getByLabelText('Mat 1 Top (cm)') as HTMLInputElement).value).toBe('6')
  fireEvent.click(screen.getByRole('button', { name: 'Unlock Mat 2 borders' }))
  fireEvent.change(screen.getByLabelText('Mat 2 Left (mm)'), { target: { value: '40' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lock Mat 2 borders' }))
  expect((screen.getByLabelText('Mat 2 Top (mm)') as HTMLInputElement).value).toBe('20')
  fireEvent.click(screen.getByRole('button', { name: 'Remove Mat 2' }))
  expect((screen.getByLabelText('Mat 2 material') as HTMLSelectElement).value).toBe('m3')
  expect((screen.getByLabelText('Mat 2 Left (mm)') as HTMLInputElement).value).toBe('40')
  fireEvent.change(screen.getByLabelText('Mat 3 material'), { target: { value: 'm2' } })
  expect((screen.getByLabelText('Mat 3 Left (mm)') as HTMLInputElement).value).toBe('10')
})
it('retains both artwork models and all opening images in Basic document snapshots', async () => {
  render(<VisualizerApp />)
  state.preset = { art: { imageUrl: 'data:basic-original' }, mats: { mode: 'pro', selectedMat1: 'm', openings: fixtureOpenings() } }; apply()
  switchMode('basic')
  expect(screen.getByAltText('artwork').getAttribute('src')).toBe('data:basic-original')
  fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'stage-b-customer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to Jobs' }))
  await waitFor(() => expect(state.jobs).toHaveLength(1))
  const job = state.jobs[0] as { details: { mats: { openings: Opening[] }; visualizerDesign: { basic: { imageUrl: string }; pro: { openings: Opening[] } } } }
  expect(job.details.mats.openings).toEqual(fixtureOpenings())
  expect(job.details.visualizerDesign.pro.openings).toEqual(fixtureOpenings())
  expect(job.details.visualizerDesign.basic.imageUrl).toBe('data:basic-original')
  switchMode('pro'); expect(state.current!.mats.openings).toEqual(fixtureOpenings())
})

it('expands a pilot shared cut-out when an opening is dragged beyond the initial layout', () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { selectedMat1: 'm', layoutModel: 'shared-group-v1', mode: 'pro', openings: [{ id: 'one', shape: 'rect', xCm: 5, yCm: 5, widthCm: 10, heightCm: 10, imageUrl: 'data:a' }] } }; apply()
  fireEvent.mouseDown(openingElement(), { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 10000, clientY: 0 })
  fireEvent.mouseUp(window)
  expect(state.current!.mats.openings[0].xCm).toBeGreaterThan(45)
  expect(Number(screen.getByTestId('mat-layers').getAttribute('viewBox')!.split(' ')[2])).toBeGreaterThan(50)
})

it('supports precise opening spacing without changing the other images or mat measurements', () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { selectedMat1: 'm', layoutModel: 'shared-group-v1', mode: 'pro', openings: fixtureOpenings() } }; apply()
  fireEvent.change(screen.getByLabelText('Opening 2 X (cm)'), { target: { value: '75' } })
  expect(state.current!.mats.openings[1].xCm).toBe(75)
  expect(state.current!.mats.openings[0]).toEqual(fixtureOpenings()[0])
})

it('retains independent Basic artwork size and Pro layout size through edits and switching', () => {
  render(<VisualizerApp />)
  switchMode('pro')
  fireEvent.change(screen.getByLabelText('Width (cm)'), { target: { value: '60' } }); fireEvent.blur(screen.getByLabelText('Width (cm)'))
  switchMode('basic')
  expect(screen.getByLabelText('Width (cm)').getAttribute('value')).toBe('40.0')
  fireEvent.change(screen.getByLabelText('Width (cm)'), { target: { value: '45' } }); fireEvent.blur(screen.getByLabelText('Width (cm)'))
  switchMode('pro')
  expect(screen.getByLabelText('Width (cm)').getAttribute('value')).toBe('60.0')
  expect(state.current!.visualizerDesign.basic.widthCm).toBe(45)
  expect(state.current!.visualizerDesign.pro.layout?.widthCm).toBe(60)
  state.preset = structuredClone(state.current) as unknown as Record<string, unknown>; apply()
  expect(state.current!.visualizerDesign.pro.layout?.widthCm).toBe(60)
})

it('refuses to export ambiguous legacy geometry as though it were a valid design', () => {
  const exported = vi.spyOn(exporters, 'exportNodeAsPng').mockResolvedValue()
  render(<VisualizerApp />)
  state.preset = { mats: { geometryVersion: 2, selectedMat1: 'm', selectedMat2: 'm2', borders: [5,5,5].map(n => ({ top: n, bottom: n, left: n, right: n })) } }; apply()
  fireEvent.click(screen.getByRole('button', { name: 'Export image ▾' })); fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
  expect(exported).not.toHaveBeenCalled()
})
it('updates four physical borders immediately and keeps the input mounted on hover', () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, mats: { selectedMat1: 'm', mode: 'pro', openings: fixtureOpenings() } }; apply()
  const input = screen.getByLabelText('Mat 1 Left (cm)') as HTMLInputElement
  input.focus()
  fireEvent.change(input, { target: { value: '9' } })
  expect((state.current!.mats as unknown as { borders: { left: number }[] }).borders[0].left).toBe(9)
  const before = structuredClone(state.current!.mats.openings)
  fireEvent.mouseEnter(openingElement())
  expect(screen.getByLabelText('Mat 1 Left (cm)')).toBe(input)
  expect(document.activeElement).toBe(input)
  expect(input.value).toBe('9')
  expect(state.current!.mats.openings).toEqual(before)
})

it.each(['basic', 'pro'] as const)('renders asymmetric layers in %s using the same board geometry', mode => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, mats: { selectedMat1: 'm', mode, openings: [{ id: 'one', shape: 'rect', xCm: 5, yCm: 5, widthCm: 40, heightCm: 30, imageUrl: 'data:main' }] } }; apply()
  fireEvent.change(screen.getByLabelText('Mat 1 Left (cm)'), { target: { value: '9' } })
  const board = screen.getByTestId('mat-layers')
  expect(board.getAttribute('viewBox')).toBe('0 0 54 40')
  const image = screen.getByAltText('artwork')
  expect(image.parentElement!.getAttribute('data-opening-x')).toBe('9')
  expect(state.current!.mats.openings[0].xCm).toBe(5)
})
it.each(['rect', 'oval', 'circle'] as const)('keeps %s handles throughout dragging, delays 2.5 seconds and fades when idle', shape => {
  vi.useFakeTimers()
  try {
    render(<VisualizerApp />)
    state.preset = { art: { imageUrl: 'data:main' }, mats: { mode: 'pro', openings: [{ id: 'one', shape, xCm: 5, yCm: 5, widthCm: 10, heightCm: 10 }] } }; apply()
    fireEvent.mouseEnter(openingElement())
    fireEvent.mouseDown(screen.getByTitle('Drag to resize (SE)'), { clientX: 100, clientY: 100 })
    fireEvent.mouseLeave(openingElement())
    act(() => vi.advanceTimersByTime(5000))
    expect(handles()).toHaveLength(8)
    expect(handles()[0].style.opacity).not.toBe('0')
    fireEvent.mouseUp(window)
    const stableHandle = handles()[0]
    act(() => vi.advanceTimersByTime(2499))
    expect(handles()[0].style.opacity).not.toBe('0')
    act(() => vi.advanceTimersByTime(1))
    expect(handles()[0]).toBe(stableHandle)
    expect(handles()[0].style.opacity).toBe('0')
    expect(handles()[0].style.pointerEvents).toBe('none')
    act(() => vi.advanceTimersByTime(200))
    expect(handles()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /^Opening 1/ }))
    expect(handles()).toHaveLength(8)
    for (const h of handles()) {
      expect(h.getAttribute('data-html2canvas-ignore')).toBe('true')
      expect(vi.mocked(toPng).mock.calls.at(-1)![1]!.filter!(h)).toBe(false)
    }
    act(() => vi.advanceTimersByTime(2700))
    expect(handles()).toHaveLength(0)
    fireEvent.mouseEnter(openingElement())
    expect(handles()).toHaveLength(8)
  } finally { vi.useRealTimers() }
})
it('grows Pro board dimensions to contain the declared multi-opening layout without changing saved openings', () => {
  render(<VisualizerApp />)
  const openings = [{ id: 'wide', shape: 'rect', xCm: 5, yCm: 5, widthCm: 60, heightCm: 30, imageUrl: 'data:wide' }]
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { selectedMat1: 'm', mode: 'pro', openings } }; apply()
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 70 40')
  expect(state.current!.mats.openings).toEqual(openings)
})
it('saves asymmetric distances, frame dimensions and unmodified opening images into Quote and Job specifications', async () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, mats: { selectedMat1: 'm', mode: 'pro', openings: fixtureOpenings() } }; apply()
  fireEvent.change(screen.getByLabelText('Mat 1 Left (cm)'), { target: { value: '9' } })
  fireEvent.change(screen.getByLabelText('Mat 1 Bottom (cm)'), { target: { value: '8' } })
  fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'stage-b-customer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add to Jobs' }))
  await waitFor(() => expect(state.quotes).toHaveLength(1))
  await waitFor(() => expect(state.jobs).toHaveLength(1))
  type Saved = { details: { mats: { mat1: { borders: unknown }; openings: Opening[] }; dims: { visible: unknown; external: unknown } }; pricingSnapshot: unknown }
  const job = state.jobs[0] as Saved
  const quote = state.quotes[0] as { jobSpecification: Saved; pricingSnapshot: unknown }
  expect(job.details.mats.mat1.borders).toEqual({ top: 5, bottom: 8, left: 9, right: 5 })
  expect(job.details.mats.openings).toEqual(fixtureOpenings())
  expect(job.details.dims.visible).toEqual({ widthCm: 54, heightCm: 43 })
  expect(job.details.dims.external).toEqual({ widthCm: 58, heightCm: 47 })
  expect(quote.jobSpecification.details).toEqual(job.details)
  expect(quote.pricingSnapshot).toEqual(job.pricingSnapshot)
  const saved = structuredClone(state.current!)
  state.preset = saved; apply()
  expect(state.current).toEqual(saved)
})

it.each(['basic', 'pro'] as const)('retains incremental reveals after editing then enabling mats in %s', mode => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', color: '#0000ff', pricePerSqM: 6 }, { id: 'm3', name: 'Red', color: '#ff0000', pricePerSqM: 7 })
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { selectedMat1: 'm', mode, openings: fixtureOpenings() } }; apply()
  fireEvent.change(screen.getByLabelText('Mat 1 Left (cm)'), { target: { value: '9' } })
  fireEvent.click(screen.getByText('+ Add second mat'))
  const selectMat = (name: string, value: string) => fireEvent.change(screen.getAllByRole('option', { name })[1].parentElement!, { target: { value } })
  selectMat('Blue', 'm2')
  fireEvent.click(screen.getByText('+ Add third mat'))
  // Material options occur in every mat select; target the third slot directly.
  const selects = screen.getAllByRole('option', { name: 'Red' }).map(o => o.parentElement!)
  fireEvent.change(selects[2], { target: { value: 'm3' } })
  expect((screen.getByLabelText('Mat 2 Left (mm)') as HTMLInputElement).value).toBe('20')
  expect((screen.getByLabelText('Mat 3 Left (mm)') as HTMLInputElement).value).toBe('10')
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 60 46')
  expect(screen.getByTestId('mat-layers').querySelectorAll('[data-mat-layer]')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: 'Unlock Mat 2 borders' }))
  fireEvent.change(screen.getByLabelText('Mat 2 Right (mm)'), { target: { value: '40' } })
  fireEvent.change(selects[1], { target: { value: 'mat0' } })
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 60 44')
  fireEvent.change(selects[1], { target: { value: 'm2' } })
  expect((screen.getByLabelText('Mat 2 Right (mm)') as HTMLInputElement).value).toBe('40')
  const saved = structuredClone(state.current!)
  expect((saved.mats as unknown as { geometryVersion: number }).geometryVersion).toBe(3)
  state.preset = saved; apply()
  expect(state.current).toEqual(saved)
  expect(state.current!.mats.openings).toEqual(fixtureOpenings())
})
it('converts valid version 2 presets without moving or resizing their openings', () => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', color: '#0000ff', pricePerSqM: 6 })
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { geometryVersion: 2, selectedMat1: 'm', selectedMat2: 'm2',
    borders: [5, 7, 7].map(n => ({ top: n, bottom: n, left: n, right: n })), mode: 'pro', proOrigin: { x: 7, y: 7 }, openings: fixtureOpenings() } }; apply()
  expect((screen.getByLabelText('Mat 2 Left (mm)') as HTMLInputElement).value).toBe('20')
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 54 44')
  expect(state.current!.mats.openings).toEqual(fixtureOpenings())
})
it('blocks commercial creation for ambiguous historical geometry instead of repairing it', () => {
  render(<VisualizerApp />)
  state.preset = { mats: { selectedMat1: 'm', geometryVersion: 2, borders: [{ left: 5 }], mode: 'pro', openings: fixtureOpenings() } }; apply()
  expect(screen.getAllByText(/saved mat geometry needs review/i).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Add to Jobs' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  expect(state.jobs).toHaveLength(0)
  expect(state.quotes).toHaveLength(0)
})

it('renders nested reveal apertures for multiple mats without summing physical distances twice', () => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue mat', color: '#0000ff', pricePerSqM: 6 })
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, mats: { selectedMat1: 'm', selectedMat2: 'm2', mat1BorderCm: 5, mat2BorderCm: 2, mode: 'basic' } }; apply()
  expect((screen.getByLabelText('Mat 2 Left (mm)') as HTMLInputElement).value).toBe('20')
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 54 44')
  const masks = screen.getByTestId('mat-layers').querySelectorAll('mask')
  expect(masks).toHaveLength(2)
  expect(masks[0].querySelectorAll('rect')[1].getAttribute('x')).toBe('7')
  expect(masks[1].querySelectorAll('rect')[1].getAttribute('x')).toBe('5')
  fireEvent.change(screen.getByLabelText('Mat 2 Left (mm)'), { target: { value: '40' } })
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 56 44')
  switchMode('pro')
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 56 44')
  expect(screen.getAllByAltText('artwork')).toHaveLength(1)
})
it('constrains movement to the layout rather than consuming asymmetric borders', () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { selectedMat1: 'm', mode: 'pro', openings: [{ id: 'one', shape: 'rect', xCm: 5, yCm: 5, widthCm: 10, heightCm: 10 }] } }; apply()
  fireEvent.change(screen.getByLabelText('Mat 1 Left (cm)'), { target: { value: '9' } })
  fireEvent.mouseDown(openingElement(), { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 10000, clientY: 0 })
  fireEvent.mouseUp(window)
  expect(state.current!.mats.openings[0].xCm).toBe(35)
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 54 40')
})
it('maps Pro overlays into the composite frame coordinates for the room preview', () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, frame: { faceWidthCm: 2 }, mats: { selectedMat1: 'm', mode: 'pro', openings: fixtureOpenings() } }; apply()
  fireEvent.change(screen.getByLabelText('Mat 1 Left (cm)'), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: 'Room preview' }))
  expect(state.room!.artSizeCm).toEqual({ widthCm: 58, heightCm: 44 })
  expect((state.room!.openings as Opening[])[0]).toMatchObject({ xCm: 11, yCm: 7 })
  const roomOpenings = structuredClone(state.room!.openings as Opening[])
  roomOpenings[0].xCm += 1
  act(() => (state.room!.onOpeningsChange as (openings: Opening[]) => void)(roomOpenings))
  expect(state.current!.mats.openings[0].xCm).toBe(6)
  expect(state.current!.mats.openings[0].imageUrl).toBe(fixtureOpenings()[0].imageUrl)
})
