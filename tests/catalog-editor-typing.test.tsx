import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import Admin from '@/pages/Admin'
import Stock from '@/pages/Stock'
import { useCatalog, type Catalog } from '@/lib/store'

const state = vi.hoisted(() => ({
  rows: new Map<string, { catalog: Catalog; revision: number }>(),
  pauseReads: false, reads: [] as Array<() => void>,
  calls: [] as Array<{ company: string; revision: number; catalog: Catalog; finish: (error?: string) => void }>,
}))
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let company = ''
    const q = { select: () => q, eq: (_key: string, value: string) => { company = value; return q },
      maybeSingle: async () => {
        if (table === 'company_catalog' && state.pauseReads) await new Promise<void>(resolve => state.reads.push(resolve))
        return { data: table === 'company_settings'
          ? { settings: { currencyCode: 'GBP', currencySymbol: '£' } }
          : structuredClone(state.rows.get(company)), error: null }
      },
    }
    return q
  },
  rpc: (name: string, args: { p_company_account_id: string; p_catalog: Catalog; p_revision: number }) => {
    if (name !== 'update_company_catalog') throw new Error(`Unexpected RPC ${name}`)
    return new Promise(resolve => state.calls.push({ company: args.p_company_account_id, revision: args.p_revision,
      catalog: structuredClone(args.p_catalog), finish: (error?: string) => {
        const row = state.rows.get(args.p_company_account_id)!
        if (error || row.revision !== args.p_revision) return resolve({ data: null, error: { message: error || 'Catalog changed or no longer exists' } })
        row.catalog = structuredClone(args.p_catalog); row.revision++
        resolve({ data: structuredClone(row), error: null })
      },
    }))
  },
} }))
let company = 'company-a'
const access = (): BillingAccess => ({ companyAccountId: company, userId: 'owner', companyName: company, readOnly: false,
  hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '' })
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access()}>{children}</BillingAccessProvider>
const seed = () => ({ frames: [{ id: 'f', name: 'Oak profile 0', code: 'F0', pricePerMeter: 12, faceWidthCm: 2, color: '#fff' }],
  mats: [{ id: 'mat0', name: 'No mat', pricePerSqM: 0 }, { id: 'm', name: 'Conservation board 0', pricePerSqM: 18, color: '#fff' }],
  glazing: [{ id: 'g', name: 'Clear glass 0', pricePerSqM: 20, kind: 'Glass' }],
  printingMaterials: [], backers: [], settings: { currencyCode: 'GBP', currencySymbol: '£' }, stock: { frames: [], sheets: [], rolls: [] },
}) as unknown as Catalog
beforeEach(() => { company = 'company-a'; state.calls = []; state.pauseReads = false; state.reads = []; state.rows.clear(); localStorage.clear();
  for (const id of ['company-a', 'company-b']) state.rows.set(id, { catalog: seed(), revision: 1 })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function open(tab = 'Frames', name = 'Oak profile 0') {
  const view = render(<Admin />, { wrapper: Wrapper })
  await screen.findByRole('button', { name: 'Save settings' })
  fireEvent.click(screen.getByRole('button', { name: tab }))
  return { view, input: await screen.findByDisplayValue(name) as HTMLInputElement }
}
const text = 'Az7-Qx9_Mn2!'
async function finish(index: number, error?: string) { await act(async () => state.calls[index].finish(error)) }
async function settled() { await waitFor(() => expect(screen.queryByText(/Saving catalogue/)).toBeNull()) }
it.each([['Frames', 'Oak profile 0'], ['Frames', 'F0'], ['Frames', '#fff'],
  ['Mats', 'Conservation board 0'], ['Mats', '#fff'], ['Glazing', 'Clear glass 0'], ['Glazing', 'Glass']])(
  '%s immediately displays every character while persistence is pending', async (tab, name) => {
    const { input } = await open(tab, name)
    input.focus()
    for (let i = 1; i <= text.length; i++) {
      fireEvent.change(input, { target: { value: text.slice(0, i) } })
      expect(input.value).toBe(text.slice(0, i))
      expect(document.activeElement).toBe(input)
      expect(input.selectionStart).toBe(i)
    }
    await waitFor(() => expect(state.calls).toHaveLength(1))
    expect(state.calls[0].revision).toBe(1)
    await act(async () => state.calls[0].finish())
    await waitFor(() => expect(screen.queryByText(/Saving catalogue/)).toBeNull())
    expect(input.value).toBe(text)
  },
)

it.each([150, 500])('serializes edits made during a %ims save and reloads the final value', async latency => {
  const { view, input } = await open()
  input.focus()
  fireEvent.change(input, { target: { value: 'First snapshot' } })
  await waitFor(() => expect(state.calls).toHaveLength(1))
  for (let i = 1; i <= text.length; i++) fireEvent.change(input, { target: { value: text.slice(0, i) } })
  expect(state.calls).toHaveLength(1)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, latency)); state.calls[0].finish() })
  expect(input.value).toBe(text)
  expect(document.activeElement).toBe(input)
  expect(input.selectionStart).toBe(text.length)
  await waitFor(() => expect(state.calls).toHaveLength(2))
  expect(state.calls.map(call => call.revision)).toEqual([1, 2])
  expect(state.calls[1].catalog.frames[0].name).toBe(text)
  await finish(1); await settled()
  expect(state.rows.get(company)!.catalog.frames[0].name).toBe(text)
  view.unmount()
  expect((await open('Frames', text)).input.value).toBe(text)
})

it.each(['failure', 'conflict'])('retains newer edits after %s and retries against the current revision', async mode => {
  const { input } = await open()
  fireEvent.change(input, { target: { value: 'First snapshot' } })
  await waitFor(() => expect(state.calls).toHaveLength(1))
  fireEvent.change(input, { target: { value: text } })
  const row = state.rows.get(company)!
  if (mode === 'conflict') { row.revision++; (row.catalog.frames[0] as any).code = 'REMOTE-CODE' }
  await finish(0, mode === 'failure' ? 'Network unavailable' : undefined)
  expect((await screen.findByRole('alert')).textContent).toContain('not saved')
  expect(input.value).toBe(text)
  fireEvent.change(input, { target: { value: text + '-latest' } })
  fireEvent.click(screen.getByRole('button', { name: 'Retry catalogue save' }))
  await waitFor(() => expect(state.calls).toHaveLength(2))
  expect(input.value).toBe(text + '-latest')
  expect(state.calls[1].revision).toBe(mode === 'conflict' ? 2 : 1)
  await finish(1); await settled()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(row.catalog.frames[0].name).toBe(text + '-latest')
  if (mode === 'conflict') expect((row.catalog.frames[0] as any).code).toBe('REMOTE-CODE')
})

it('does not overwrite another writer changing the same field on retry', async () => {
  const { input } = await open()
  fireEvent.change(input, { target: { value: text } })
  await waitFor(() => expect(state.calls).toHaveLength(1))
  const row = state.rows.get(company)!; row.revision++; row.catalog.frames[0].name = 'Remote edit'
  await finish(0)
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Retry catalogue save' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('changed elsewhere in a product'))
  expect(input.value).toBe(text)
  expect(state.calls).toHaveLength(1)
  expect(row.catalog.frames[0].name).toBe('Remote edit')
})

it('isolates Company B from the draft and late acknowledgement of Company A', async () => {
  state.rows.get('company-b')!.catalog.frames[0].name = 'B oak'
  const { view, input } = await open()
  fireEvent.change(input, { target: { value: 'A draft' } })
  await waitFor(() => expect(state.calls).toHaveLength(1))
  company = 'company-b'; view.rerender(<Admin />)
  const b = await screen.findByDisplayValue('B oak') as HTMLInputElement
  fireEvent.change(b, { target: { value: 'B draft' } })
  await finish(0)
  expect(b.value).toBe('B draft')
  await waitFor(() => expect(state.calls).toHaveLength(2))
  expect(state.calls[1].company).toBe('company-b')
  expect(state.calls[1].revision).toBe(1)
  await finish(1); await settled()
  expect(b.value).toBe('B draft')
  expect(state.rows.get('company-b')!.catalog.frames[0].name).toBe('B draft')
})

it('cancels an unsent old-workspace draft, including when returning to that company', async () => {
  const { view, input } = await open()
  fireEvent.change(input, { target: { value: 'Unsent A draft' } })
  company = 'company-b'; view.rerender(<Admin />)
  await screen.findByDisplayValue('Oak profile 0')
  company = 'company-a'; view.rerender(<Admin />)
  await screen.findByDisplayValue('Oak profile 0')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
  expect(screen.queryByDisplayValue('Unsent A draft')).toBeNull()
  expect(state.calls).toHaveLength(0)
})

it.each([['Frames', 'Oak profile 0', 'Add frame', 'New frame', 'Remove'],
  ['Mats', 'Conservation board 0', 'Add mat', 'New mat', 'Remove'],
  ['Glazing', 'Clear glass 0', 'Add glazing', 'New glazing', 'Delete']])(
  '%s preserves numeric coercion, add, edit and delete with coalesced saves', async (tab, name, add, added, remove) => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { input } = await open(tab, name)
    const row = input.closest('tr')!
    fireEvent.change(row.querySelector('input[type=number]')!, { target: { value: '' } })
    expect((row.querySelector('input[type=number]') as HTMLInputElement).value).toBe('0')
    fireEvent.click(screen.getByRole('button', { name: add }))
    const fresh = screen.getByDisplayValue(added) as HTMLInputElement
    fireEvent.change(fresh, { target: { value: text } })
    expect(fresh.value).toBe(text)
    fireEvent.click([...fresh.closest('tr')!.querySelectorAll('button')].find(b => b.textContent === remove)!)
    expect(screen.queryByDisplayValue(text)).toBeNull()
    await waitFor(() => expect(state.calls).toHaveLength(1))
    await finish(0); await settled()
    const key = tab.toLowerCase() as 'frames' | 'mats' | 'glazing'
    const saved = state.rows.get(company)!.catalog[key].find((product: { name: string }) => product.name === name)!
    expect(tab === 'Frames' ? (saved as any).pricePerMeter : (saved as any).pricePerSqM).toBe(0)
    vi.restoreAllMocks()
  },
)

it('keeps the mid-string caret while inserting MID7 into Oak profile 0', async () => {
  const { input } = await open()
  input.focus(); input.setSelectionRange(2, 2)
  for (let i = 1; i <= 4; i++) {
    const value = 'Oa' + 'MID7'.slice(0, i) + 'k profile 0'
    fireEvent.change(input, { target: { value, selectionStart: 2 + i, selectionEnd: 2 + i } })
    expect(input.value).toBe(value)
    expect(input.selectionStart).toBe(2 + i)
    expect(document.activeElement).toBe(input)
  }
  await waitFor(() => expect(state.calls).toHaveLength(1))
  await finish(0); await settled()
  expect(state.rows.get(company)!.catalog.frames[0].name).toBe('OaMID7k profile 0')
  expect(input.selectionStart).toBe(6)
})

it('retains edits across catalogue tabs during an older save', async () => {
  const { input } = await open()
  fireEvent.change(input, { target: { value: text } })
  await waitFor(() => expect(state.calls).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'Mats' }))
  fireEvent.change(screen.getByDisplayValue('Conservation board 0'), { target: { value: 'Latest mat' } })
  fireEvent.click(screen.getByRole('button', { name: 'Glazing' }))
  fireEvent.change(screen.getByDisplayValue('Clear glass 0'), { target: { value: 'Latest glazing' } })
  await finish(0)
  expect(screen.getByDisplayValue('Latest glazing')).toBeTruthy()
  await waitFor(() => expect(state.calls).toHaveLength(2))
  await finish(1); await settled()
  const saved = state.rows.get(company)!.catalog
  expect(saved.frames[0].name).toBe(text)
  expect(saved.mats[1].name).toBe('Latest mat')
  expect(saved.glazing[0].name).toBe('Latest glazing')
})

it('preserves the existing catalogue JSON file import, persistence and export path', async () => {
  const { result } = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  const imported = seed(); imported.frames[0].name = 'Imported catalogue frame'
  const file = { text: async () => JSON.stringify(imported) } as File
  await act(async () => result.current.importJSON(file))
  expect(state.calls).toHaveLength(1)
  await finish(0)
  expect(result.current.catalog.frames[0].name).toBe('Imported catalogue frame')
  let exported: Blob | undefined
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { exported = blob; return 'blob:local-test' }
    static revokeObjectURL() {}
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  act(() => result.current.exportJSON())
  const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(exported!) })
  expect(JSON.parse(text).frames[0].name).toBe('Imported catalogue frame')
})

it('preserves genuine Stock CSV file import/export through the unchanged persistence path', async () => {
  state.rows.get(company)!.catalog.stock = {
    frames: [{ profileId: 'f', metersAvailable: 4, minThreshold: 1 }],
    sheets: [{ id: 'm-stock', sku: 'm', type: 'mat', widthCm: 100, heightCm: 70, qty: 2 },
      { id: 'g-stock', sku: 'g', type: 'glazing', widthCm: 100, heightCm: 70, qty: 2 }],
    rolls: [{ materialId: 'pm1', widthCm: 100, metersRemaining: 2 }],
  }
  vi.spyOn(window, 'alert').mockImplementation(() => {}) // Existing CSV UX, not editor save messages.
  const view = render(<Stock />, { wrapper: Wrapper })
  await screen.findByDisplayValue('4')
  const csv = 'type,profileId,metersAvailable,sheetType,sku,widthCm,heightCm,qty,materialId,metersRemaining,minThreshold\nframe,f,12,,,,,,,,2'
  fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File([csv], 'stock.csv', { type: 'text/csv' })] } })
  await waitFor(() => expect(state.calls).toHaveLength(1))
  await finish(0)
  expect(state.rows.get(company)!.catalog.stock.frames[0]).toMatchObject({ profileId: 'f', metersAvailable: 12, minThreshold: 2 })
  let exported: Blob | undefined
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { exported = blob; return 'blob:local-csv' }
    static revokeObjectURL() {}
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
  const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(exported!) })
  expect(text).toContain('frame,f,12,')
  expect(text).toContain('minThreshold')
})

it('coalesces a single save under the application StrictMode wrapper', async () => {
  render(<React.StrictMode><Admin /></React.StrictMode>, { wrapper: Wrapper })
  await screen.findByRole('button', { name: 'Save settings' })
  fireEvent.click(screen.getByRole('button', { name: 'Frames' }))
  const input = await screen.findByDisplayValue('Oak profile 0') as HTMLInputElement
  fireEvent.change(input, { target: { value: text } })
  expect(input.value).toBe(text)
  await waitFor(() => expect(state.calls).toHaveLength(1))
  await finish(0); await settled()
  expect(input.value).toBe(text)
  expect(state.rows.get(company)!.catalog.frames[0].name).toBe(text)
})

it('keeps typing responsive while retry is reloading the current revision', async () => {
  const { input } = await open()
  fireEvent.change(input, { target: { value: 'First draft' } })
  await waitFor(() => expect(state.calls).toHaveLength(1))
  await finish(0, 'Network unavailable')
  await screen.findByRole('alert')
  state.pauseReads = true
  fireEvent.click(screen.getByRole('button', { name: 'Retry catalogue save' }))
  fireEvent.change(input, { target: { value: text } })
  expect(input.value).toBe(text)
  expect(state.calls).toHaveLength(1)
  await act(async () => { state.pauseReads = false; state.reads.splice(0).forEach(resolve => resolve()) })
  await waitFor(() => expect(state.calls).toHaveLength(2))
  expect(state.calls[1].catalog.frames[0].name).toBe(text)
  await finish(1); await settled()
  expect(input.value).toBe(text)
})

it.each([['Frames', 'Add frame', 'New frame', 'Remove'], ['Mats', 'Add mat', 'New mat', 'Remove'],
  ['Glazing', 'Add glazing', 'New glazing', 'Delete']])('%s persists a newly added typed row and its later deletion', async (tab, add, initial, remove) => {
  const name = tab === 'Frames' ? 'Oak profile 0' : tab === 'Mats' ? 'Conservation board 0' : 'Clear glass 0'
  const { view } = await open(tab, name)
  fireEvent.click(screen.getByRole('button', { name: add }))
  const input = screen.getByDisplayValue(initial) as HTMLInputElement
  input.focus()
  for (let i = 1; i <= text.length; i++) fireEvent.change(input, { target: { value: text.slice(0, i) } })
  expect(input.value).toBe(text)
  expect(document.activeElement).toBe(input)
  await waitFor(() => expect(state.calls).toHaveLength(1))
  await finish(0); await settled()
  view.unmount()
  const reopened = await open(tab, text)
  expect(reopened.input.value).toBe(text)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click([...reopened.input.closest('tr')!.querySelectorAll('button')].find(button => button.textContent === remove)!)
  await waitFor(() => expect(state.calls).toHaveLength(2))
  expect(state.calls[1].revision).toBe(2)
  await finish(1); await settled()
  expect(screen.queryByDisplayValue(text)).toBeNull()
  const key = tab.toLowerCase() as 'frames' | 'mats' | 'glazing'
  expect(state.rows.get(company)!.catalog[key].some((row: { name: string }) => row.name === text)).toBe(false)
})
