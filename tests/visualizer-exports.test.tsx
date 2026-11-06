import React from 'react'
import { flushSync } from 'react-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import VisualizerApp from '@/VisualizerApp'
import ToastContainer from '@/components/ToastContainer'
import { useToast } from '@/lib/toast'

const state = vi.hoisted(() => ({ company: 'a', user: 'u', png: vi.fn(), jpg: vi.fn(), pdf: vi.fn() }))
const refs = vi.hoisted(() => [] as Array<{ current: unknown }>)
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useRef: (value: unknown) => { const ref = actual.useRef(value); refs.push(ref); return ref } }
})
vi.mock('@/lib/exporters', () => ({ exportNodeAsPng: state.png, exportNodeAsJpeg: state.jpg, exportNodeAsPdf: state.pdf }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: {
  frames: [{ id: 'f', name: 'Frame', faceWidthCm: 2, pricePerMeter: 10 }], mats: [],
  glazing: [{ id: 'g', name: 'Glass', pricePerSqM: 8 }], printingMaterials: [],
  settings: { currencyCode: 'GBP', marginMultiplier: 1.25, labourBase: 120, taxRatePct: 15 },
} }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [], add: vi.fn() }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ add: vi.fn() }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ addInvoice: vi.fn() }) }))
const customers = [
  { id: 'c1', firstName: 'First', lastName: 'Customer' }, { id: 'c2', firstName: 'Second', lastName: 'Customer' },
]
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers, add: vi.fn(), update: vi.fn() }) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ companyAccountId: state.company, userId: state.user, readOnly: false }) }))
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => ({ supplierProducts: [], selectionIssue: () => null }) }))
vi.mock('@/components/RoomMockup', () => ({ default: () => <canvas data-testid="room-canvas" /> }))
vi.mock('@/components/PresetControls', () => ({ default: () => null }))
const view = () => <><VisualizerApp /><ToastContainer /></>
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const start = (format = 'PNG') => { flushSync(() => click(/Export image/)); click(format) }
const deferred = () => { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const messages = () => useToast.getState().toasts
beforeEach(() => {
  vi.resetAllMocks(); refs.length = 0; state.company = 'a'; state.user = 'u'
  state.png.mockResolvedValue(undefined); state.jpg.mockResolvedValue(undefined); state.pdf.mockResolvedValue(undefined)
  window.location.hash = '#/app'
})
afterEach(() => {
  cleanup(); for (const toast of messages()) useToast.getState().remove(toast.id)
  vi.restoreAllMocks(); window.location.hash = ''
})
it.each(['PNG', 'JPG', 'PDF'] as const)('awaits %s and reports download requested through the real toast', async format => {
  const operation = deferred(); const exporter = state[format.toLowerCase() as 'png' | 'jpg' | 'pdf']; exporter.mockReturnValue(operation.promise)
  render(view()); start(format)
  expect(messages()).toEqual([])
  await act(async () => operation.resolve())
  expect(screen.getByRole('status').textContent).toContain(`${format} download requested. Check your browser's downloads.`)
  expect(messages()[0].type).toBe('success')
  expect(exporter).toHaveBeenCalledTimes(1)
  expect(exporter.mock.calls[0]).toHaveLength(1)
  expect(exporter.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement)
  expect(state.png.mock.calls.length + state.jpg.mock.calls.length + state.pdf.mock.calls.length).toBe(1)
})

it.each(['PNG', 'JPG', 'PDF'] as const)('handles %s rejected promises and releases the shared lock', async format => {
  state[format.toLowerCase() as 'png' | 'jpg' | 'pdf'].mockRejectedValueOnce(new Error('Failed'))
  render(view()); await act(async () => start(format))
  expect(screen.getByRole('alert').textContent).toContain("Check your browser's downloads before retrying")
  expect(messages()[0].message).toContain('preview and its images have loaded')
  expect(messages()[0].type).toBe('error'); expect(messages()[0].duration).toBe(0)
  await act(async () => start('PDF'))
  expect(messages().at(-1)?.type).toBe('success')
})
it('handles synchronous exporter exceptions without false success', async () => {
  state.png.mockImplementationOnce(() => { throw new Error('SecurityError') })
  render(view()); await act(async () => start())
  expect(messages()).toHaveLength(1); expect(messages()[0].type).toBe('error')
  await act(async () => start('JPG'))
  expect(messages().at(-1)?.message).toContain('JPG download requested.')
})
it('prevents overlapping formats synchronously and exposes pending state until completion', async () => {
  const operation = deferred(); state.png.mockReturnValueOnce(operation.promise)
  render(view()); click(/Export image/)
  const png = screen.getByRole('button', { name: 'PNG' }); const jpg = screen.getByRole('button', { name: 'JPG' }); const pdf = screen.getByRole('button', { name: 'PDF' })
  act(() => { png.click(); jpg.click(); pdf.click(); png.click() })
  expect(state.png).toHaveBeenCalledTimes(1); expect(state.jpg).not.toHaveBeenCalled(); expect(state.pdf).not.toHaveBeenCalled()
  const pending = screen.getByRole('button', { name: 'Preparing export…' }) as HTMLButtonElement
  expect(pending.disabled).toBe(true); expect(pending.getAttribute('aria-busy')).toBe('true')
  expect(screen.queryByRole('button', { name: 'PNG' })).toBeNull()
  await act(async () => operation.resolve())
  expect((screen.getByRole('button', { name: /Export image/ }) as HTMLButtonElement).disabled).toBe(false)
  await act(async () => start('JPG')); expect(state.jpg).toHaveBeenCalledTimes(1)
})
it('reports a missing preview without invoking an exporter', async () => {
  render(view())
  const preview = refs.find(ref => ref.current instanceof HTMLDivElement && ref.current.className.includes('overflow-hidden shadow-inner'))
  expect(preview).toBeTruthy(); preview!.current = null
  await act(async () => start())
  expect(screen.getByRole('alert').textContent).toContain('preview is not ready')
  expect(state.png).not.toHaveBeenCalled()
})
for (const outcome of ['success', 'failure']) {
  it.each(['company', 'user', 'customer', 'switch-back', 'unmount', 'route'])(`suppresses stale ${outcome} after %s`, async change => {
    const operation = deferred(); state.png.mockReturnValueOnce(operation.promise)
    const rendered = render(view()); start()
    if (change === 'company') { state.company = 'b'; rendered.rerender(view()) }
    if (change === 'user') { state.user = 'other'; rendered.rerender(view()) }
    if (change === 'customer') fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'c1' } })
    if (change === 'switch-back') {
      state.company = 'b'; rendered.rerender(view()); state.company = 'a'; rendered.rerender(view())
    }
    if (change === 'unmount') rendered.unmount()
    if (change === 'route') window.location.hash = '#/quotes'
    await act(async () => { if (outcome === 'success') operation.resolve(); else operation.reject(new Error('Late failure')) })
    expect(messages()).toEqual([])
    if (!['route', 'unmount'].includes(change)) {
      await act(async () => start('JPG')); expect(messages().at(-1)?.type).toBe('success')
    }
  })
}
it.each(['PNG', 'JPG', 'PDF'])('exports the same framed DOM from Build and Room for %s', async format => {
  const rendered = render(view()); await act(async () => start(format))
  const exporter = state[format.toLowerCase() as 'png' | 'jpg' | 'pdf']; const node = exporter.mock.calls[0][0]
  click('Room preview'); expect(screen.getByTestId('room-canvas')).toBeTruthy()
  await act(async () => start(format))
  expect(exporter.mock.calls[1][0]).toBe(node)
  expect(node.tagName).toBe('DIV'); expect(node.closest('[class*="-left-"]')).toBeTruthy()
  rendered.unmount()
})
