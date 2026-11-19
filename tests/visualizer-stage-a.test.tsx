import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import VisualizerApp from '@/VisualizerApp'
import { toPng } from 'html-to-image'
import type { Catalog } from '@/lib/store'

type Opening = { id: string; shape: 'rect' | 'oval' | 'circle'; xCm: number; yCm: number; widthCm: number; heightCm: number; imageUrl?: string }
type Design = { art: { widthCm: number; heightCm: number; imageUrl: string }; mats: { layoutModel: 'single-board-v1', mode: string; openings: Opening[]; selectedMat1: string; mat1BorderCm: number } }
const state = vi.hoisted(() => ({ catalog: null as Catalog | null, current: null as Design | null, preset: {} as Record<string, unknown> }))
const customers: never[] = []
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: state.catalog }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [] }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({}) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({}) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers }), validateCustomer: () => [] }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ readOnly: false }) }))
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => ({ supplierProducts: [], selectionIssue: () => null }) }))
vi.mock('@/components/RoomMockup', () => ({ default: () => null }))
vi.mock('html-to-image', () => ({ toPng: vi.fn(async () => '') }))
vi.mock('@/components/PresetControls', () => ({ default: ({ currentState, onApply }: { currentState: Design; onApply: (p: { state: Record<string, unknown> }) => void }) => {
  state.current = currentState
  return <button onClick={() => onApply({ state: state.preset })}>Apply fixture</button>
} }))
beforeEach(() => {
  state.preset = {}; state.current = null
  state.catalog = { frames: [{ id: 'f', name: 'Frame', faceWidthCm: 2, pricePerMeter: 10 }],
    mats: [{ id: 'mat0', name: 'None', pricePerSqM: 0 }, { id: 'm', name: 'Green mat', color: '#00cc66', pricePerSqM: 5 }],
    glazing: [{ id: 'g', name: 'Glass', pricePerSqM: 8 }], settings: { currencyCode: 'GBP', marginMultiplier: 1.25, labourBase: 10, taxRatePct: 20 } } as Catalog
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const apply = () => fireEvent.click(screen.getByText('Apply fixture'))
const switchMode = (mode: 'basic' | 'pro') => {
  const select = screen.getByRole('option', { name: 'Pro (multi-opening)' }).parentElement!
  fireEvent.change(select, { target: { value: mode } })
}
const upload = async () => {
  const file = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>'], 'art.svg', { type: 'image/svg+xml' })
  fireEvent.change(document.getElementById('artUpload')!, { target: { files: [file] } })
  await waitFor(() => expect(state.current!.art.imageUrl).toMatch(/^data:image\/svg\+xml;base64,/))
  return state.current!.art.imageUrl
}
const openingElement = (index = 0) => screen.getAllByTitle('Drag to move. Use handles to resize.')[index]
const handles = () => screen.queryAllByTitle(/^Drag to resize/)
const fixtureOpenings = (): Opening[] => [
  { id: 'a', shape: 'rect', xCm: 5, yCm: 5, widthCm: 10, heightCm: 12, imageUrl: 'data:image/png;base64,IMAGE_A' },
  { id: 'b', shape: 'oval', xCm: 20, yCm: 5, widthCm: 12, heightCm: 16, imageUrl: 'data:image/png;base64,IMAGE_B' },
  { id: 'c', shape: 'circle', xCm: 5, yCm: 20, widthCm: 8, heightCm: 8, imageUrl: '' },
]


it.each(['rect', 'oval', 'circle'] as const)('keeps selected %s handles after pointer leave and excludes them from customer captures', shape => {
  render(<VisualizerApp />)
  const openings = fixtureOpenings()
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, mats: { layoutModel: 'single-board-v1', selectedMat1: 'm', mode: 'pro', openings } }
  apply()
  const index = openings.findIndex(o => o.shape === shape)
  fireEvent.mouseEnter(openingElement(index))
  expect(handles()).toHaveLength(8)
  fireEvent.mouseDown(openingElement(index), { clientX: 100, clientY: 100 })
  fireEvent.mouseUp(window)
  fireEvent.mouseLeave(openingElement(index))
  expect(handles()).toHaveLength(8)
  for (const handle of handles()) {
    expect(handle.parentElement).toBe(openingElement(index))
    expect(handle.getAttribute('data-html2canvas-ignore')).toBe('true')
  }
  const options = vi.mocked(toPng).mock.calls.at(-1)![1]!
  expect(options.filter!(handles()[0])).toBe(false)
  expect(options.filter!(screen.getAllByAltText('artwork')[0])).toBe(true)
  expect(state.current!.mats.openings).toEqual(openings)
})

it('switches handle selection without hover and removes handles with a deleted opening', () => {
  render(<VisualizerApp />)
  state.preset = { mats: { layoutModel: 'single-board-v1', mode: 'pro', openings: fixtureOpenings() } }; apply()
  fireEvent.mouseDown(openingElement(0)); fireEvent.mouseUp(window)
  expect(handles()).toHaveLength(8)
  fireEvent.mouseDown(openingElement(1)); fireEvent.mouseUp(window)
  expect(handles()).toHaveLength(8)
  expect(handles().every(handle => handle.parentElement === openingElement(1))).toBe(true)
  fireEvent.click(screen.getAllByTitle('Delete')[1])
  expect(handles()).toHaveLength(0)
})


it.each([false, true])('assigns a late Basic upload after switching to Pro (existing empty aperture: %s)', existing => {
  const readers: FileReader[] = []
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) { readers.push(this) })
  render(<VisualizerApp />)
  if (existing) { state.preset = { mats: { layoutModel: 'single-board-v1', mode: 'basic', openings: [{ ...fixtureOpenings()[0], imageUrl: '' }] } }; apply() }
  fireEvent.change(document.getElementById('artUpload')!, { target: { files: [new File(['image'], 'art.png', { type: 'image/png' })] } })
  switchMode('pro')
  Object.defineProperty(readers[0], 'result', { value: 'data:image/png;base64,DEFERRED' })
  act(() => readers[0].dispatchEvent(new ProgressEvent('load')))
  expect(screen.getByAltText('artwork').getAttribute('src')).toBe('data:image/png;base64,DEFERRED')
})

it('preserves populated and empty opening images through main uploads, mat changes and Basic/Pro round trips', async () => {
  render(<VisualizerApp />)
  const openings = fixtureOpenings()
  state.preset = { art: { widthCm: 40, heightCm: 30, imageUrl: 'data:main' }, mats: { layoutModel: 'single-board-v1', mode: 'basic', openings } }; apply()
  switchMode('pro')
  expect(state.current!.mats.openings).toEqual(openings)
  await upload()
  fireEvent.change(screen.getByRole('option', { name: 'Green mat' }).parentElement!, { target: { value: 'm' } })
  switchMode('basic'); switchMode('pro')
  expect(state.current!.mats.openings).toEqual(openings)
  expect(screen.getAllByAltText('artwork').map(image => image.getAttribute('src'))).toEqual(openings.slice(0, 2).map(o => o.imageUrl))
  expect(screen.getByText('Select image for this opening')).toBeTruthy()
  const snapshot = structuredClone(state.current!)
  state.preset = snapshot; apply()
  expect(state.current).toEqual(snapshot)
})

it.each(['rect', 'oval', 'circle'] as const)('still resizes a selected %s without changing other openings or images', shape => {
  render(<VisualizerApp />)
  const openings = fixtureOpenings()
  state.preset = { mats: { layoutModel: 'single-board-v1', mode: 'pro', openings } }; apply()
  const index = openings.findIndex(o => o.shape === shape)
  fireEvent.mouseDown(openingElement(index)); fireEvent.mouseUp(window)
  fireEvent.mouseDown(screen.getByTitle('Drag to resize (SE)'), { clientX: 100, clientY: 100 })
  fireEvent.mouseMove(window, { clientX: 110, clientY: 110 })
  fireEvent.mouseUp(window)
  const resized = state.current!.mats.openings[index]
  expect(resized.widthCm).toBeGreaterThan(openings[index].widthCm)
  expect(resized.heightCm).toBeGreaterThan(openings[index].heightCm)
  expect(resized.imageUrl).toBe(openings[index].imageUrl)
  expect(resized.shape).toBe(shape)
  if (shape === 'circle') expect(resized.widthCm).toBe(resized.heightCm)
  expect(state.current!.mats.openings.filter(o => o.id !== resized.id)).toEqual(openings.filter(o => o.id !== resized.id))
})


it('does not recreate an explicitly deleted final opening on an ordinary rerender', async () => {
  render(<VisualizerApp />)
  await upload(); switchMode('pro')
  fireEvent.click(screen.getByTitle('Delete'))
  expect(state.current!.mats.openings).toEqual([])
  fireEvent.change(screen.getByRole('option', { name: 'Green mat' }).parentElement!, { target: { value: 'm' } })
  expect(state.current!.mats.openings).toEqual([])
})

it('only changes the explicitly chosen opening image with the per-opening picker', async () => {
  render(<VisualizerApp />)
  const openings = fixtureOpenings()
  state.preset = { mats: { layoutModel: 'single-board-v1', mode: 'pro', openings } }; apply()
  fireEvent.click(screen.getByText('Select image for this opening'))
  const input = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=file]')).find(el => el.id !== 'artUpload')!
  fireEvent.change(input, { target: { files: [new File(['selected image'], 'chosen.png', { type: 'image/png' })] } })
  await waitFor(() => expect(state.current!.mats.openings[2].imageUrl).toMatch(/^data:image\/png;base64,/))
  expect(state.current!.mats.openings.slice(0, 2)).toEqual(openings.slice(0, 2))
})

it('initializes an empty Pro layout when artwork is uploaded after entering Pro', async () => {
  render(<VisualizerApp />)
  switchMode('pro')
  const imageUrl = await upload()
  expect(screen.getByAltText('artwork').getAttribute('src')).toBe(imageUrl)
  expect(state.current!.mats.openings).toHaveLength(1)
})

it('keeps uploaded Basic artwork visible through the mat on entering Pro without changing dimensions or totals', async () => {
  render(<VisualizerApp />)
  const imageUrl = await upload()
  const select = screen.getByRole('option', { name: 'Green mat' }).parentElement!
  fireEvent.change(select, { target: { value: 'm' } })
  expect(screen.getByAltText('artwork').getAttribute('src')).toBe(imageUrl)
  const subtotal = screen.getByText('Subtotal').nextElementSibling!.textContent
  switchMode('pro')
  expect(screen.getByAltText('artwork').getAttribute('src')).toBe(imageUrl)
  expect(state.current!.mats.openings).toHaveLength(1)
  expect(state.current!.mats.openings[0]).toMatchObject({ shape: 'rect', xCm: 5, yCm: 5, widthCm: 40, heightCm: 30, imageUrl })
  expect(screen.getByText('Subtotal').nextElementSibling!.textContent).toBe(subtotal)
  const saved = structuredClone(state.current!.mats.openings)
  switchMode('basic'); switchMode('pro')
  expect(state.current!.mats.openings).toEqual(saved)
  expect(state.current!.art).toMatchObject({ widthCm: 40, heightCm: 30, imageUrl })
})
