import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  quotes: [] as any[], invoices: [] as any[], jobs: [] as any[], scope: 'company-a',
  remove: vi.fn(), toast: vi.fn(), dismissToast: vi.fn(), pdf: vi.fn(), addInvoice: vi.fn(), link: vi.fn(),
}))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: state.quotes, remove: state.remove }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers: [] }) }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: { settings: { currencyCode: 'GBP' } } }) }))
vi.mock('@/lib/pdf/usePdfCompanySettings', () => ({ usePdfCompanySettings: (settings: unknown) => settings }))
vi.mock('@/lib/pdf/quotePdf', () => ({ exportQuotePDF: (...args: unknown[]) => state.pdf(...args) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: state.jobs, companyAccountId: state.scope, loading: false, linkInvoiceFromQuote: state.link }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => {
  const [invoices, setInvoices] = React.useState(state.invoices)
  return { invoices, addInvoice: async (payload: any) => {
    const result = await state.addInvoice(payload)
    if (result.ok) { state.invoices = [result.invoice]; setInvoices(state.invoices) }
    return result
  } }
} }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: state.toast, remove: state.dismissToast }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn() }) }))
import Quotes from '@/pages/Quotes'
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
const openDelete = () => fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
const confirmDelete = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete quote' }))

beforeEach(() => {
  vi.clearAllMocks(); state.scope = 'company-a'; state.invoices = []; state.jobs = []
  state.toast.mockReturnValue('partial-warning')
  state.quotes = [{ id: 'q1', number: 'Q-001', status: 'Accepted', customerId: 'c1', customerSnapshot: { firstName: 'Synthetic' }, items: [{ name: 'Frame', qty: 1, unitPrice: 100, total: 100 }], total: 100 }]
  state.remove.mockResolvedValue({ ok: true }); state.pdf.mockResolvedValue(undefined)
  state.addInvoice.mockResolvedValue({ ok: true, invoice: { id: 'i1', number: 'INV-001', quoteId: 'q1' } })
  state.link.mockResolvedValue({ ok: true, job: { id: 'j1', refNo: 1 } })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  window.location.hash = '#/quotes?id=q1'
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

it('opens a record-specific confirmation and never deletes on Cancel or Escape', () => {
  render(<Quotes />)
  openDelete()
  expect(screen.getByRole('dialog').textContent).toContain('Q-001')
  expect(state.remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  openDelete(); fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(state.remove).not.toHaveBeenCalled()
  expect(window.confirm).not.toHaveBeenCalled()
})

it('deletes exactly once and shows success only after confirmed completion', async () => {
  const request = deferred<{ ok: true }>(); state.remove.mockReturnValue(request.promise)
  render(<Quotes />); openDelete(); confirmDelete(); confirmDelete()
  expect(state.remove).toHaveBeenCalledExactlyOnceWith('q1')
  expect(state.toast).not.toHaveBeenCalled()
  await act(async () => request.resolve({ ok: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(state.toast).toHaveBeenCalledWith('Quote deleted', 'success')
})

it('retains a failed deletion inline and supports retry', async () => {
  state.remove.mockResolvedValueOnce({ ok: false, error: 'Quote changed. Reload before deleting.' })
  render(<Quotes />); openDelete(); confirmDelete()
  expect((await screen.findByRole('alert')).textContent).toContain('Quote changed')
  expect(state.toast).not.toHaveBeenCalled()
  confirmDelete(); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(state.remove).toHaveBeenCalledTimes(2)
})

it('reports PDF failures through error notifications instead of alert', async () => {
  state.pdf.mockRejectedValue(new Error('Synthetic export failure'))
  render(<Quotes />); fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('Could not generate quote PDF'), 'error'))
  expect(window.alert).not.toHaveBeenCalled()
})

it('reports invoice-creation exceptions without a browser alert or success', async () => {
  state.addInvoice.mockRejectedValue(new Error('Synthetic unavailable'))
  render(<Quotes />); fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }))
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('Could not create invoice'), 'error'))
  expect(window.alert).not.toHaveBeenCalled()
  expect(window.confirm).not.toHaveBeenCalled()
})

it.each(['result', 'exception'])('keeps a %s link failure as persistent partial success and retries only linking', async mode => {
  state.jobs = [{ id: 'j1', quoteId: 'q1', refNo: 1 }]
  if (mode === 'result') state.link.mockResolvedValueOnce({ ok: false, error: 'Job changed' })
  else state.link.mockRejectedValueOnce(new Error('Connection lost'))
  render(<Quotes />); fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }))
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('already saved'), 'warning', 0))
  expect(state.toast.mock.calls.some(call => call[1] === 'success')).toBe(false)
  expect(window.location.hash).toBe('#/quotes?id=q1')
  fireEvent.click(screen.getByRole('button', { name: 'Link Invoice to Job' }))
  await waitFor(() => expect(state.link).toHaveBeenCalledTimes(2))
  expect(state.addInvoice).toHaveBeenCalledTimes(1)
  expect(state.dismissToast).toHaveBeenCalledWith('partial-warning')
  expect(window.confirm).not.toHaveBeenCalled()
})

it('ignores a late deletion result after company changes, including switching back', async () => {
  const request = deferred<{ ok: true }>(); state.remove.mockReturnValue(request.promise)
  const view = render(<Quotes />); openDelete(); confirmDelete()
  state.scope = 'company-b'; view.rerender(<Quotes />)
  expect(screen.queryByRole('dialog')).toBeNull()
  state.scope = 'company-a'; view.rerender(<Quotes />)
  await act(async () => request.resolve({ ok: true }))
  expect(state.toast).not.toHaveBeenCalled()
})

it('suppresses late PDF errors after record selection changes', async () => {
  const request = deferred<void>(); state.pdf.mockReturnValue(request.promise)
  state.quotes.push({ ...state.quotes[0], id: 'q2', number: 'Q-002' })
  render(<Quotes />); fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  fireEvent.click(screen.getByRole('button', { name: /Q-002 Accepted/ }))
  await act(async () => request.reject(new Error('Late export failure')))
  expect(state.toast).not.toHaveBeenCalled()
})

it.each(['unmount', 'route', 'company', 'record'])('does not link or navigate after invoice save resolves following %s change', async mode => {
  const request = deferred<any>(); state.addInvoice.mockReturnValue(request.promise)
  state.jobs = [{ id: 'j1', quoteId: 'q1', refNo: 1 }]
  state.quotes.push({ ...state.quotes[0], id: 'q2', number: 'Q-002' })
  const view = render(<Quotes />)
  fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }))
  if (mode === 'unmount') view.unmount()
  if (mode === 'route') window.location.hash = '#/customers'
  if (mode === 'company') { state.scope = 'company-b'; view.rerender(<Quotes />) }
  if (mode === 'record') fireEvent.click(screen.getByRole('button', { name: /Q-002 Accepted/ }))
  await act(async () => request.resolve({ ok: true, invoice: { id: 'i1', number: 'INV-001', quoteId: 'q1' } }))
  expect(state.link).not.toHaveBeenCalled()
  expect(state.toast).not.toHaveBeenCalled()
  expect(window.location.hash).not.toContain('/invoices')
})

it('does not submit a second invoice while the first save is pending', async () => {
  const request = deferred<any>(); state.addInvoice.mockReturnValue(request.promise)
  render(<Quotes />)
  const button = screen.getByRole('button', { name: 'Create Invoice' })
  fireEvent.click(button); fireEvent.click(button)
  expect(state.addInvoice).toHaveBeenCalledTimes(1)
  await act(async () => request.resolve({ ok: false, error: 'Unavailable' }))
  expect(state.toast).toHaveBeenCalledWith('Unavailable', 'error')
})

it('does not announce a late link completion or redirect the newly selected quote', async () => {
  const request = deferred<any>(); state.link.mockReturnValue(request.promise)
  state.jobs = [{ id: 'j1', quoteId: 'q1', refNo: 1 }]
  state.quotes.push({ ...state.quotes[0], id: 'q2', number: 'Q-002' })
  render(<Quotes />); fireEvent.click(screen.getByRole('button', { name: 'Create Invoice' }))
  await waitFor(() => expect(state.link).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: /Q-002 Accepted/ }))
  await act(async () => request.resolve({ ok: true, job: { id: 'j1' } }))
  expect(state.toast).not.toHaveBeenCalled()
  expect(window.location.hash).not.toContain('/invoices')
})

it('reports deletion success even when the store removes the row before resolving', async () => {
  const request = deferred<any>(); state.remove.mockReturnValue(request.promise)
  const view = render(<Quotes />); openDelete(); confirmDelete()
  state.quotes = []; view.rerender(<Quotes />)
  await act(async () => request.resolve({ ok: true }))
  expect(state.toast).toHaveBeenCalledWith('Quote deleted', 'success')
})
