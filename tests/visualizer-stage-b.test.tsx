import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import VisualizerApp from '@/VisualizerApp'
import { toPng } from 'html-to-image'
import * as exporters from '@/lib/exporters'
import type { Catalog } from '@/lib/store'
import { createMatSlots } from '@/lib/visualizerMats'
import { independentFixture } from './helpers/visualizerWorkspaceFixture'
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
const apply = () => { const mats = state.preset.mats as { locks?: boolean[] } | undefined; if (mats && !mats.locks) mats.locks = [false, false, false]; if (mats && (mats as { layoutModel?: string }).layoutModel === 'single-board-v1' && !state.preset.visualizerDesign) state.preset = independentFixture(state.preset); fireEvent.click(screen.getByText('Apply fixture')) }
const switchMode = (mode: 'basic' | 'pro') => {
  const select = screen.getByRole('option', { name: 'Pro (multi-opening)' }).parentElement!
  fireEvent.change(select, { target: { value: mode } })
}
const openingElement = (index = 0) => screen.getAllByTitle('Drag to move. Use handles to resize.')[index]
const mat1Input = (side: string) => screen.getByLabelText(`${state.current!.mats.mode === 'pro' ? 'Pro mat' : 'Mat 1'} ${side} (cm)`)
const handles = () => screen.queryAllByTitle(/^Drag to resize/)
const fixtureOpenings = (): Opening[] => [
  { id: 'a', shape: 'rect', xCm: 5, yCm: 5, widthCm: 10, heightCm: 12, imageUrl: 'data:image/png;base64,IMAGE_A' },
  { id: 'b', shape: 'oval', xCm: 20, yCm: 5, widthCm: 12, heightCm: 16, imageUrl: 'data:image/png;base64,IMAGE_B' },
  { id: 'c', shape: 'circle', xCm: 5, yCm: 20, widthCm: 8, heightCm: 8, imageUrl: '' },
]


it('never falls back to Basic artwork in Pro Room or restores a cleared Room capture', async () => {
  const finishes: ((value: string) => void)[] = []
  vi.mocked(toPng).mockImplementation(() => new Promise<string>(resolve => finishes.push(resolve)))
  render(<VisualizerApp />)
  fireEvent.change(document.getElementById('artUpload')!, { target: { files: [new File(['basic'], 'basic.png', { type: 'image/png' })] } })
  await waitFor(() => expect(finishes.length).toBeGreaterThan(0))
  switchMode('pro'); fireEvent.click(screen.getByRole('button', { name: 'Room preview' }))
  expect(state.room!.artworkUrl).toBe('')
  await act(async () => { finishes.splice(0).forEach(finish => finish('data:old-basic-capture')); await Promise.resolve() })
  expect(state.room!.artworkUrl).toBe('')
  switchMode('basic'); fireEvent.click(screen.getByRole('button', { name: 'Clear Basic' }))
  await act(async () => { finishes.splice(0).forEach(finish => finish('data:cleared-capture')); await Promise.resolve() })
  expect(state.room!.artworkUrl).toBe('')
  expect(state.current!.visualizerDesign.basic.imageUrl).toBe('')
})
it('routes delayed Basic uploads only to Basic and invalidates them on Clear Basic', () => {
  const readers: FileReader[] = []
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function(this: FileReader) { readers.push(this) })
  render(<VisualizerApp />)
  const start = () => fireEvent.change(document.getElementById('artUpload')!, { target: { files: [new File(['pending'], 'pending.png', { type: 'image/png' })] } })
  const finish = (n: number) => act(() => { Object.defineProperty(readers[n], 'result', { value: 'data:late-basic' }); readers[n].dispatchEvent(new ProgressEvent('load')) })
  start(); switchMode('pro'); finish(0)
  expect(state.current!.visualizerDesign.basic.imageUrl).toBe('data:late-basic')
  expect(state.current!.visualizerDesign.pro.openings).toEqual([])
  expect(state.current!.art.imageUrl).toBe('')
  switchMode('basic'); start(); fireEvent.click(screen.getByRole('button', { name: 'Clear Basic' })); finish(1)
  expect(state.current!.visualizerDesign.basic.imageUrl).toBe('')
})
it('invalidates a pending opening upload when Pro is cleared and the same design is reloaded', () => {
  const readers: FileReader[] = []
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function(this: FileReader) { readers.push(this) })
  render(<VisualizerApp />); switchMode('pro'); fireEvent.click(screen.getByRole('button', { name: '+ Rectangle' }))
  const before = structuredClone(state.current)
  fireEvent.click(screen.getByText('Select image for this opening'))
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['pending'], 'pending.png', { type: 'image/png' })] } })
  fireEvent.click(screen.getByRole('button', { name: 'Clear Pro' }))
  state.preset = before as unknown as Record<string, unknown>; apply()
  act(() => { Object.defineProperty(readers[0], 'result', { value: 'data:late-pro' }); readers[0].dispatchEvent(new ProgressEvent('load')) })
  expect(state.current!.visualizerDesign.pro.openings[0].imageUrl).toBe('')
})
it('keeps independent workspaces through first entry, switching, Clear and save/reload', async () => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', color: '#0000ff', pricePerSqM: 6 })
  render(<VisualizerApp />)
  fireEvent.change(screen.getByLabelText('Mat 1 material'), { target: { value: 'm' } })
  fireEvent.change(document.getElementById('artUpload')!, { target: { files: [new File(['basic'], 'basic.png', { type: 'image/png' })] } })
  await waitFor(() => expect(state.current!.art.imageUrl).toMatch(/^data:/))
  const basic = structuredClone(state.current!.visualizerDesign.basic)
  switchMode('pro')
  expect(state.current!.art.imageUrl).toBe('')
  expect(state.current!.mats.openings).toEqual([])
  expect(screen.queryByLabelText('Mat 1 material')).toBeNull()
  expect(document.getElementById('artUpload')).toBeNull()
  expect((screen.getByLabelText('Pro mat material') as HTMLSelectElement).value).toBe('mat0')
  fireEvent.change(screen.getByLabelText('Pro mat material'), { target: { value: 'm2' } })
  fireEvent.click(screen.getByRole('button', { name: '+ Rectangle' }))
  const pro = structuredClone(state.current!.visualizerDesign.pro)
  switchMode('basic'); expect(state.current!.visualizerDesign.basic).toEqual(basic)
  fireEvent.click(screen.getByRole('button', { name: 'Clear Basic' }))
  expect(state.current!.visualizerDesign.basic.imageUrl).toBe('')
  expect(state.current!.visualizerDesign.basic.mats!.every(s => s.materialId === 'mat0')).toBe(true)
  expect(state.current!.visualizerDesign.pro).toEqual(pro)
  switchMode('pro'); expect(state.current!.visualizerDesign.pro).toEqual(pro)
  state.preset = structuredClone(state.current) as unknown as Record<string, unknown>; apply()
  expect(state.current!.visualizerDesign.pro).toEqual(pro)
  fireEvent.click(screen.getByRole('button', { name: 'Clear Pro' }))
  expect(state.current!.visualizerDesign.pro.openings).toEqual([])
  expect(state.current!.visualizerDesign.pro.mat!.materialId).toBe('mat0')
  expect(state.current!.visualizerDesign.basic.imageUrl).toBe('')
})
it.each(['shared-group-v1', 'single-board-v1', 'legacy-individual-v1'])('keeps historical %s Pro read-only until explicit adoption', async layoutModel => {
  const exported = vi.spyOn(exporters, 'exportNodeAsPng').mockResolvedValue()
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', color: '#0000ff', pricePerSqM: 6 })
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { mode: 'pro', layoutModel, locks: [true, true, true], selectedMat1: 'm', selectedMat2: 'm2', proOrigin: { x: 5, y: 5 }, openings: fixtureOpenings() },
    visualizerDesign: { version: 1, mode: 'pro', layoutModel, basic: { widthCm: 40, heightCm: 30, imageUrl: '' },
      pro: { origin: { x: 5, y: 5 }, openings: fixtureOpenings() }, mats: createMatSlots(['m', 'm2']) } };
  const originalPreset = structuredClone(state.preset); apply()
  const retained = structuredClone(state.current!.visualizerDesign)
  expect(screen.queryByLabelText('Mat 2 material')).toBeNull()
  expect(screen.getByLabelText('Pro mat material').matches(':disabled')).toBe(true)
  fireEvent.mouseDown(openingElement(), { clientX: 0, clientY: 0 }); fireEvent.mouseMove(window, { clientX: 100, clientY: 0 }); fireEvent.mouseUp(window)
  expect(state.current!.mats.openings).toEqual(retained.pro.openings)
  fireEvent.mouseEnter(openingElement())
  expect(handles()).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Export image ▾' })); fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
  expect(exported).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Review and adopt single-board layout' }))
  expect(state.current!.visualizerDesign.layoutModel).toBe('single-board-v1')
  expect(state.current!.visualizerDesign.basic.mats).toEqual(retained.basic.mats)
  expect(state.current!.visualizerDesign.pro.legacy).toBeUndefined()
  expect(state.preset).toEqual(originalPreset)
  expect(state.current!.mats.openings).toEqual(retained.pro.openings)
  fireEvent.click(screen.getByRole('button', { name: 'Export image ▾' })); fireEvent.click(screen.getByRole('button', { name: 'PNG' }))
  await waitFor(() => expect(exported).toHaveBeenCalledTimes(1))
})
it.each(['rect', 'oval', 'circle'] as const)('centres the rendered %s opening on either axis without moving other artwork', shape => {
  render(<VisualizerApp />)
  const openings = fixtureOpenings(), index = openings.findIndex(o => o.shape === shape), original = openings[index]
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { mode: 'pro', layoutModel: 'single-board-v1', selectedMat1: 'm', proOrigin: { x: 5, y: 5 }, openings } }; apply()
  fireEvent.click(screen.getByRole('button', { name: `Centre opening ${index + 1} horizontally` }))
  expect(state.current!.mats.openings[index]).toMatchObject({ xCm: 5 + (40 - original.widthCm) / 2, yCm: original.yCm })
  fireEvent.click(screen.getByRole('button', { name: `Centre opening ${index + 1} vertically` }))
  expect(state.current!.mats.openings[index].yCm).toBe(5 + (30 - original.heightCm) / 2)
  const positioned = openingElement(index).querySelector<HTMLElement>('[data-opening-x]')!
  expect(Number(positioned.dataset.openingX)).toBe(state.current!.mats.openings[index].xCm)
  fireEvent.click(screen.getByRole('button', { name: `Centre opening ${index + 1}` }))
  expect(state.current!.mats.openings.filter(o => o.id !== original.id)).toEqual(openings.filter(o => o.id !== original.id))
  expect(state.current!.mats.openings[index].imageUrl).toBe(original.imageUrl)
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 50 40')
})
it.each(['', 'data:assigned'])('never seeds an existing Pro aperture from Basic (%s)', imageUrl => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:original' }, mats: { mode: 'basic', layoutModel: 'single-board-v1', selectedMat1: 'm', openings: [{ ...fixtureOpenings()[0], imageUrl }] } }; apply()
  switchMode('pro')
  expect(state.current!.mats.openings).toHaveLength(1)
  expect(state.current!.mats.openings[0].imageUrl).toBe(imageUrl)
  if (imageUrl) expect(screen.getByAltText('artwork').getAttribute('src')).toBe(imageUrl)
  else expect(screen.queryByAltText('artwork')).toBeNull()
})
it('renders Basic cut-edge bevels but never insets artwork in the single-board Pro apertures', () => {
  render(<VisualizerApp />)
  fireEvent.change(screen.getByLabelText('Mat 1 material'), { target: { value: 'm' } })
  expect(screen.getByTestId('mat-layers').querySelectorAll('[data-mat-bevel]')).toHaveLength(1)
  switchMode('pro')
  for (const shape of ['Rectangle', 'Oval', 'Circle']) fireEvent.click(screen.getByRole('button', { name: '+ ' + shape }))
  for (const opening of screen.getAllByTitle('Drag to move. Use handles to resize.')) {
    const artwork = opening.querySelector<HTMLElement>('[data-opening-x]')!
    expect(artwork.style.inset).toBe('0')
    expect(opening.children).toHaveLength(1)
  }
})
it('clears only the Pro board without promoting or deleting retained Basic mats', () => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', pricePerSqM: 6 }, { id: 'm3', name: 'Red', pricePerSqM: 7 })
  render(<VisualizerApp />)
  state.preset = { mats: { layoutModel: 'single-board-v1', mode: 'basic', selectedMat1: 'm', selectedMat2: 'm2', selectedMat3: 'm3' } }; apply()
  const retained = structuredClone(state.current!.visualizerDesign.mats)
  switchMode('pro'); fireEvent.change(screen.getByLabelText('Pro mat material'), { target: { value: 'm' } }); fireEvent.click(screen.getByRole('button', { name: 'Remove Pro mat' }))
  expect(state.current!.visualizerDesign.mats[0].materialId).toBe('mat0')
  expect(state.current!.visualizerDesign.basic.mats!.slice(1)).toEqual(retained.slice(1))
  expect(screen.getByTestId('mat-layers').querySelectorAll('[data-mat-layer]')).toHaveLength(0)
  switchMode('basic')
  expect(state.current!.visualizerDesign.basic.mats!.slice(1)).toEqual(retained.slice(1))
})
it('uses one catalogue board in Pro pricing, geometry and saved mirrors while retaining Basic decorative slots', async () => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', color: '#0000ff', pricePerSqM: 6 }, { id: 'm3', name: 'Red', color: '#ff0000', pricePerSqM: 7 })
  render(<VisualizerApp />)
  for (const [index, id] of ['m', 'm2', 'm3'].entries()) {
    if (index) fireEvent.click(screen.getByText(index === 1 ? '+ Add second mat' : '+ Add third mat'))
    fireEvent.change(screen.getByLabelText(`Mat ${index + 1} material`), { target: { value: id } })
  }
  const retained = structuredClone(state.current!.visualizerDesign.mats)
  switchMode('pro')
  expect(screen.queryByLabelText('Mat 2 material')).toBeNull()
  expect(screen.queryByLabelText('Mat 3 material')).toBeNull()
  fireEvent.change(screen.getByLabelText('Pro mat material'), { target: { value: 'm' } })
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 50 40')
  expect(screen.getByTestId('mat-layers').querySelectorAll('[data-mat-layer]')).toHaveLength(1)
  fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'stage-b-customer' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to Jobs' }))
  await waitFor(() => expect(state.jobs).toHaveLength(1))
  const job = state.jobs[0] as { details: { mats: { hasMat2: boolean }; visualizerDesign: VisualizerDesign }; pricingSnapshot: { items: { key: string }[] } }
  expect(job.details.mats.hasMat2).toBe(false)
  expect(job.pricingSnapshot.items.filter(item => /^mat\d/.test(item.key))).toHaveLength(1)
  expect(job.details.visualizerDesign.basic.mats).toEqual(retained)
  state.preset = structuredClone(state.current) as unknown as Record<string, unknown>; apply()
  switchMode('basic')
  expect(state.current!.visualizerDesign.mats).toEqual(retained)
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 56 46')
})
it('provides locked defaults, unit-aware controls and positional deletion through the UI', () => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', color: '#0000ff', pricePerSqM: 6 }, { id: 'm3', name: 'Red', color: '#ff0000', pricePerSqM: 7 })
  render(<VisualizerApp />)
  fireEvent.change(screen.getByLabelText('Mat 1 material'), { target: { value: 'm' } })
  fireEvent.click(screen.getByText('+ Add second mat'))
  fireEvent.change(screen.getByLabelText('Mat 2 material'), { target: { value: 'm2' } })
  fireEvent.click(screen.getByText('+ Add third mat'))
  fireEvent.change(screen.getByLabelText('Mat 3 material'), { target: { value: 'm3' } })
  expect((screen.getByLabelText('Mat 2 Left (mm)') as HTMLInputElement).value).toBe('20')
  fireEvent.change(mat1Input('Left'), { target: { value: '6' } })
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

it('expands a single-board cut-out when an opening is dragged beyond the initial layout', () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { selectedMat1: 'm', layoutModel: 'single-board-v1', mode: 'pro', openings: [{ id: 'one', shape: 'rect', xCm: 5, yCm: 5, widthCm: 10, heightCm: 10, imageUrl: 'data:a' }] } }; apply()
  fireEvent.mouseDown(openingElement(), { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 10000, clientY: 0 })
  fireEvent.mouseUp(window)
  expect(state.current!.mats.openings[0].xCm).toBeGreaterThan(45)
  expect(Number(screen.getByTestId('mat-layers').getAttribute('viewBox')!.split(' ')[2])).toBeGreaterThan(50)
})

it('supports precise opening spacing without changing the other images or mat measurements', () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { selectedMat1: 'm', layoutModel: 'single-board-v1', mode: 'pro', openings: fixtureOpenings() } }; apply()
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
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, mats: { layoutModel: 'single-board-v1', selectedMat1: 'm', mode: 'pro', openings: fixtureOpenings() } }; apply()
  const input = mat1Input('Left') as HTMLInputElement
  input.focus()
  fireEvent.change(input, { target: { value: '9' } })
  expect((state.current!.mats as unknown as { borders: { left: number }[] }).borders[0].left).toBe(9)
  const before = structuredClone(state.current!.mats.openings)
  fireEvent.mouseEnter(openingElement())
  expect(mat1Input('Left')).toBe(input)
  expect(document.activeElement).toBe(input)
  expect(input.value).toBe('9')
  expect(state.current!.mats.openings).toEqual(before)
})

it.each(['basic', 'pro'] as const)('renders asymmetric layers in %s using the same board geometry', mode => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, mats: { layoutModel: 'single-board-v1', selectedMat1: 'm', mode, openings: [{ id: 'one', shape: 'rect', xCm: 5, yCm: 5, widthCm: 40, heightCm: 30, imageUrl: 'data:main' }] } }; apply()
  fireEvent.change(mat1Input('Left'), { target: { value: '9' } })
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
    state.preset = { art: { imageUrl: 'data:main' }, mats: { layoutModel: 'single-board-v1', mode: 'pro', openings: [{ id: 'one', shape, xCm: 5, yCm: 5, widthCm: 10, heightCm: 10 }] } }; apply()
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
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { layoutModel: 'single-board-v1', selectedMat1: 'm', mode: 'pro', openings } }; apply()
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 70 40')
  expect(state.current!.mats.openings).toEqual(openings)
})
it('saves asymmetric distances, frame dimensions and unmodified opening images into Quote and Job specifications', async () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, mats: { layoutModel: 'single-board-v1', selectedMat1: 'm', mode: 'pro', openings: fixtureOpenings() } }; apply()
  fireEvent.change(mat1Input('Left'), { target: { value: '9' } })
  fireEvent.change(mat1Input('Bottom'), { target: { value: '8' } })
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

it.each(['basic'] as const)('retains incremental reveals after editing then enabling mats in %s', mode => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', color: '#0000ff', pricePerSqM: 6 }, { id: 'm3', name: 'Red', color: '#ff0000', pricePerSqM: 7 })
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { layoutModel: 'single-board-v1', selectedMat1: 'm', mode, openings: fixtureOpenings() } }; apply()
  fireEvent.change(mat1Input('Left'), { target: { value: '9' } })
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
it('preserves valid version 2 geometry as reviewed legacy Pro without moving its openings', () => {
  state.catalog!.mats!.push({ id: 'm2', name: 'Blue', color: '#0000ff', pricePerSqM: 6 })
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { geometryVersion: 2, selectedMat1: 'm', selectedMat2: 'm2',
    borders: [5, 7, 7].map(n => ({ top: n, bottom: n, left: n, right: n })), mode: 'pro', proOrigin: { x: 7, y: 7 }, openings: fixtureOpenings() } }; apply()
  expect(state.current!.visualizerDesign.pro.legacy!.mats[1].borders.left).toBe(2)
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
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 40 30')
  expect(screen.queryByAltText('artwork')).toBeNull()
  switchMode('basic')
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe('0 0 56 44')
  expect(screen.getByAltText('artwork').getAttribute('src')).toBe('data:main')
})
it('expands the single board on movement without consuming asymmetric borders', () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30 }, mats: { layoutModel: 'single-board-v1', selectedMat1: 'm', mode: 'pro', openings: [{ id: 'one', shape: 'rect', xCm: 5, yCm: 5, widthCm: 10, heightCm: 10 }] } }; apply()
  fireEvent.change(mat1Input('Left'), { target: { value: '9' } })
  fireEvent.mouseDown(openingElement(), { clientX: 0, clientY: 0 })
  fireEvent.mouseMove(window, { clientX: 10000, clientY: 0 })
  fireEvent.mouseUp(window)
  const x = state.current!.mats.openings[0].xCm
  expect(x).toBeGreaterThan(45)
  expect(screen.getByTestId('mat-layers').getAttribute('viewBox')).toBe(`0 0 ${x + 19} 40`)
})
it('maps Pro overlays into the composite frame coordinates for the room preview', () => {
  render(<VisualizerApp />)
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, frame: { faceWidthCm: 2 }, mats: { layoutModel: 'single-board-v1', selectedMat1: 'm', mode: 'pro', openings: fixtureOpenings() } }; apply()
  fireEvent.change(mat1Input('Left'), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: 'Room preview' }))
  expect(state.room!.artSizeCm).toEqual({ widthCm: 58, heightCm: 44 })
  expect((state.room!.openings as Opening[])[0]).toMatchObject({ xCm: 11, yCm: 7 })
  const roomOpenings = structuredClone(state.room!.openings as Opening[])
  roomOpenings[0].xCm += 1
  act(() => (state.room!.onOpeningsChange as (openings: Opening[]) => void)(roomOpenings))
  expect(state.current!.mats.openings[0].xCm).toBe(6)
  expect(state.current!.mats.openings[0].imageUrl).toBe(fixtureOpenings()[0].imageUrl)
})
