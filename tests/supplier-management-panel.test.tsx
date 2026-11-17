import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import SupplierManagementPanel from '@/components/SupplierManagementPanel'
import Admin from '@/pages/Admin'

const mock = vi.hoisted(() => ({ client: { rpc: vi.fn() }, available: true, catalogWrite: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ get supabase() { return mock.available ? mock.client : null } }))
vi.mock('@/lib/store', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/store')>(),
  useCatalog: () => ({ catalog: { settings: {} }, loading: false, settingsLoading: false, saveSettings: mock.catalogWrite }),
}))
vi.mock('@/lib/catalogEditor', () => ({ useCatalogEditor: () => ({
  catalog: { settings: {} }, update: mock.catalogWrite, retry: mock.catalogWrite,
  error: 'Unrelated catalogue error', pending: false, saving: false,
}) }))

const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const user = '33333333-3333-4333-8333-333333333333'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const supplier = (supplierId = id, name = 'Alpha', status = 'active') => ({ kind: 'central', id: supplierId, name, status, countries: ['GB'] })
const row = (supplierId = id, name = 'Alpha', enabled = false, revision = 7, status = 'active') => ({
  companyAccountId: company, supplier: supplier(supplierId, name, status), enabled, revision,
  canEnable: status === 'active', availability: !enabled ? 'disabled' : status === 'active' ? 'available' : `supplier-${status}`,
})
const ok = (data: unknown) => ({ data, error: null })
const denied = () => ({ data: null, error: { code: '42501', message: 'PRIVATE' } })
const access = (overrides: Partial<BillingAccess> = {}): BillingAccess => ({
  companyAccountId: company, userId: user, companyName: 'Company', readOnly: false,
  hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '', ...overrides,
})
const tree = (overrides: Partial<BillingAccess> = {}, admin = false) => <BillingAccessProvider value={access(overrides)}>
  {admin ? <Admin /> : <SupplierManagementPanel />}
</BillingAccessProvider>
let countryCode: string | null
let countryRevision: number | null
let selections: ReturnType<typeof row>[]
let directory: ReturnType<typeof supplier>[]
async function respond(name: string, args: Record<string, unknown>) {
  const scoped = args.p_company_account_id
  if (name === 'company_operating_country') return ok({ companyAccountId: scoped, countryCode, revision: countryRevision })
  if (name === 'company_central_suppliers') {
    const start = Number(args.p_offset), limit = Number(args.p_limit)
    return ok(selections.slice(start, start + limit).map(value => ({ ...value, companyAccountId: scoped })))
  }
  if (name === 'subscriber_supplier_directory') return ok(directory.slice(Number(args.p_offset), Number(args.p_offset) + Number(args.p_limit)))
  if (name === 'set_company_operating_country') {
    if (countryCode !== args.p_country_code) countryRevision = countryRevision === null ? 1 : countryRevision + 1
    countryCode = args.p_country_code as string | null
    return ok({ companyAccountId: scoped, countryCode, revision: countryRevision })
  }
  if (name === 'set_company_central_suppliers') {
    const command = (args.p_commands as Array<{ supplier: { id: string }; enabled: boolean }>)[0]
    const previous = selections.find(value => value.supplier.id === command.supplier.id)
    const item = previous?.supplier ?? directory.find(value => value.id === command.supplier.id)!
    const next = row(item.id, item.name, command.enabled, previous ? previous.revision + Number(previous.enabled !== command.enabled) : 1, item.status)
    selections = [...selections.filter(value => value.supplier.id !== item.id), next]
    return ok([{ ...next, companyAccountId: scoped }])
  }
  throw new Error('Unexpected mocked RPC')
}
function deferred() {
  let resolve!: (value: ReturnType<typeof ok>) => void
  const promise = new Promise<ReturnType<typeof ok>>(done => { resolve = done })
  return { promise, resolve }
}
const area = (name: string) => within(screen.getByRole('region', { name }))
const save = () => screen.getByRole('button', { name: 'Save operating country' }) as HTMLButtonElement
const writes = () => mock.client.rpc.mock.calls.filter(([name]) => String(name).startsWith('set_company_'))
async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: 'Reload and review' }).hasAttribute('disabled')).toBe(false)) }
function search(value: string) {
  fireEvent.change(screen.getByLabelText('Search suppliers'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Search directory' }))
}
beforeEach(() => {
  mock.available = true; mock.client.rpc.mockReset(); mock.catalogWrite.mockReset()
  countryCode = 'GB'; countryRevision = 1; selections = [row()]
  directory = [supplier(), supplier(otherId, 'Beta')]
  mock.client.rpc.mockImplementation(respond)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Admin entry and read gates', () => {
  it('mounts Suppliers only on entry, isolated from catalogue save/error UI', async () => {
    render(tree({}, true))
    expect(mock.client.rpc).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Suppliers' }))
    await ready()
    expect(screen.getByRole('heading', { name: 'Operating country' })).toBeTruthy()
    expect(screen.queryByText(/Unrelated catalogue error/)).toBeNull()
    expect(mock.catalogWrite).not.toHaveBeenCalled()
    expect(writes()).toHaveLength(0)
  })
  it.each([{ companyAccountId: null }, { userId: null }])('makes no calls without scope %j', overrides => {
    render(tree(overrides))
    expect(screen.getByText(/signed-in user and company are required/i)).toBeTruthy()
    expect(mock.client.rpc).not.toHaveBeenCalled()
  })
  it('makes no calls without the authenticated client', () => {
    mock.available = false
    render(tree())
    expect(screen.getByText(/client is unavailable/i)).toBeTruthy()
    expect(mock.client.rpc).not.toHaveBeenCalled()
  })
  it('uses management RPC denial, hides management data and never shows raw errors', async () => {
    mock.client.rpc.mockResolvedValue(denied())
    render(tree())
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('access denied')
    expect(screen.queryByText('PRIVATE')).toBeNull()
    expect(screen.queryByLabelText('Operating country')).toBeNull()
    expect(writes()).toHaveLength(0)
  })
  it('allows read-only inspection but disables every write', async () => {
    render(tree({ readOnly: true }))
    await ready()
    expect(save().disabled).toBe(true)
    expect((area('Supplier directory').getByRole('button', { name: 'Enable Beta' }) as HTMLButtonElement).disabled).toBe(true)
    expect(writes()).toHaveLength(0)
  })
})

describe('country, browsing and relationship coverage', () => {
  it.each([false, true])('preserves an unsaved country after changing supplier enabled=%s until explicit reload', async enabled => {
    selections = [row(id, 'Alpha', enabled)]
    render(tree())
    await ready()
    fireEvent.change(screen.getByLabelText('Operating country'), { target: { value: 'US' } })
    fireEvent.click(area('Existing supplier selections').getByRole('button', { name: `${enabled ? 'Disable' : 'Enable'} Alpha` }))
    await ready()
    expect((screen.getByLabelText('Operating country') as HTMLSelectElement).value).toBe('US')
    expect(screen.getByText('Saved country: United Kingdom (GB)')).toBeTruthy()
    expect(save().disabled).toBe(false)
    expect(writes()).toHaveLength(1)
    expect(writes()[0][0]).toBe('set_company_central_suppliers')
    expect(mock.client.rpc.mock.calls.filter(([name]) => name === 'set_company_operating_country')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Reload and review' }))
    await ready()
    expect((screen.getByLabelText('Operating country') as HTMLSelectElement).value).toBe('GB')
    expect(save().disabled).toBe(true)
    expect(writes()).toHaveLength(1)
  })
  it('synchronizes the country draft to the successful post-country-save refresh', async () => {
    let saved = false
    mock.client.rpc.mockImplementation(async (name, args) => {
      // Another authorized writer can change the country between save and refresh.
      if (saved && name === 'company_operating_country') return ok({ companyAccountId: company, countryCode: 'CA', revision: 3 })
      const result = await respond(name, args)
      if (name === 'set_company_operating_country') saved = true
      return result
    })
    render(tree())
    await ready()
    fireEvent.change(screen.getByLabelText('Operating country'), { target: { value: 'US' } })
    fireEvent.click(save())
    await ready()
    expect((screen.getByLabelText('Operating country') as HTMLSelectElement).value).toBe('CA')
    expect(screen.getByText('Saved country: Canada (CA)')).toBeTruthy()
    expect(save().disabled).toBe(true)
    expect(writes()).toHaveLength(1)
    expect(writes()[0][1]).toEqual({ p_company_account_id: company, p_country_code: 'US', p_expected_revision: 1 })
  })
  it.each([{ companyAccountId: otherCompany }, { userId: otherCompany }])('discards an unsaved country when scope changes to %j', async next => {
    const view = render(tree())
    await ready()
    fireEvent.change(screen.getByLabelText('Operating country'), { target: { value: 'US' } })
    view.rerender(tree(next))
    expect(screen.queryByLabelText('Operating country')).toBeNull()
    await ready()
    expect((screen.getByLabelText('Operating country') as HTMLSelectElement).value).toBe('GB')
    expect(save().disabled).toBe(true)
    expect(writes()).toHaveLength(0)
  })
  it('requires explicit save/clear and uses the saved revision and country for recommendations', async () => {
    countryCode = null; countryRevision = null
    render(tree())
    await ready()
    expect(screen.getByText(/Recommendations require a saved operating country/)).toBeTruthy()
    expect((screen.getByRole('option', { name: 'Recommended' }) as HTMLOptionElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Operating country'), { target: { value: 'GB' } })
    expect(writes()).toHaveLength(0)
    expect((screen.getByRole('option', { name: 'Recommended' }) as HTMLOptionElement).disabled).toBe(true)
    fireEvent.click(save())
    await ready()
    expect(mock.client.rpc).toHaveBeenCalledWith('set_company_operating_country', {
      p_company_account_id: company, p_country_code: 'GB', p_expected_revision: null,
    })
    fireEvent.change(screen.getByLabelText('Supplier directory view'), { target: { value: 'recommended' } })
    await ready()
    expect(mock.client.rpc).toHaveBeenCalledWith('subscriber_supplier_directory', expect.objectContaining({ p_mode: 'recommended' }))
    fireEvent.change(screen.getByLabelText('Operating country'), { target: { value: '' } })
    expect(writes()).toHaveLength(1)
    fireEvent.click(save())
    await ready()
    expect(writes()).toHaveLength(2)
    expect(writes()[1][1]).toEqual({ p_company_account_id: company, p_country_code: null, p_expected_revision: 1 })
    expect(screen.getByText('Saved country: Not set')).toBeTruthy()
  })
  it('searches explicitly and sends directory pagination without writing', async () => {
    directory = Array.from({ length: 21 }, (_, index) => supplier(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, `Supplier ${index}`))
    render(tree())
    await ready()
    fireEvent.change(screen.getByLabelText('Search suppliers'), { target: { value: 'Oak' } })
    expect(mock.client.rpc.mock.calls.some(([, args]) => args.p_search === 'Oak')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Search directory' }))
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Next directory page' }))
    await ready()
    expect(mock.client.rpc).toHaveBeenCalledWith('subscriber_supplier_directory', {
      p_company_account_id: company, p_mode: 'international', p_search: 'Oak', p_limit: 20, p_offset: 20,
    })
    expect(writes()).toHaveLength(0)
  })
  it('paginates selections while retaining disabled and unavailable relationships', async () => {
    selections = Array.from({ length: 21 }, (_, index) => row(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, `Existing ${index}`, false, 7, 'paused'))
    render(tree())
    await ready()
    expect(area('Existing supplier selections').getByText('Existing 0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next selections page' }))
    expect(area('Existing supplier selections').getByText('Existing 20')).toBeTruthy()
    expect((area('Existing supplier selections').getByRole('button', { name: 'Enable Existing 20' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('finds an existing relationship beyond the first RPC page instead of sending null', async () => {
    selections = Array.from({ length: 100 }, (_, index) => row(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, `Existing ${index}`))
    selections.push(row(otherId, 'Beta', false, 19))
    render(tree())
    await ready()
    fireEvent.click(area('Supplier directory').getByRole('button', { name: 'Enable Beta' }))
    await ready()
    expect(writes()[0][1]).toEqual({ p_company_account_id: company, p_commands: [{
      action: 'set-enabled', companyAccountId: company, supplier: { kind: 'central', id: otherId }, enabled: true, expectedRevision: 19,
    }] })
  })
  it('uses null only after complete selection coverage establishes no stored relationship', async () => {
    render(tree())
    await ready()
    fireEvent.click(area('Supplier directory').getByRole('button', { name: 'Enable Beta' }))
    await ready()
    expect((writes()[0][1].p_commands as Array<{ expectedRevision: unknown }>)[0].expectedRevision).toBeNull()
  })
  it('blocks absent-target actions when the RPC pagination ceiling prevents complete coverage', async () => {
    mock.client.rpc.mockImplementation(async (name, args) => name === 'company_central_suppliers'
      ? ok(Array.from({ length: 100 }, (_, index) => row(`aaaaaaaa-aaaa-4aaa-8aaa-${String(Number(args.p_offset) + index).padStart(12, '0')}`, `Existing ${Number(args.p_offset) + index}`)))
      : respond(name, args))
    render(tree())
    await ready()
    expect(screen.getByText(/Cannot establish absence beyond the selection pagination limit/)).toBeTruthy()
    expect((area('Supplier directory').getByRole('button', { name: 'Enable Beta' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mock.client.rpc).toHaveBeenCalledWith('company_central_suppliers', { p_company_account_id: company, p_limit: 100, p_offset: 10000 })
    expect(writes()).toHaveLength(0)
  })
  it('permits disabling a retained retired supplier, but never enables it', async () => {
    selections = [row(id, 'Retired supplier', true, 8, 'retired')]
    render(tree())
    await ready()
    fireEvent.click(area('Existing supplier selections').getByRole('button', { name: 'Disable Retired supplier' }))
    await ready()
    expect((writes()[0][1].p_commands as Array<{ expectedRevision: number }>)[0].expectedRevision).toBe(8)
    expect((area('Existing supplier selections').getByRole('button', { name: 'Enable Retired supplier' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('write recovery and async isolation', () => {
  it.each(['40001', '42501'])('blocks further actions after %s until explicit reload/review', async code => {
    const original = respond
    mock.client.rpc.mockImplementation(async (name, args) => name.startsWith('set_company_') ? { data: null, error: { code, message: 'PRIVATE' } } : original(name, args))
    render(tree())
    await ready()
    fireEvent.click(area('Supplier directory').getByRole('button', { name: 'Enable Beta' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toMatch(code === '40001' ? /changed.*Reload/ : /access denied/)
    expect(writes()).toHaveLength(1)
    expect(screen.queryByText('PRIVATE')).toBeNull()
    if (code === '40001') {
      expect((area('Supplier directory').getByRole('button', { name: 'Enable Beta' }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Reload and review' }))
      await ready()
      expect(writes()).toHaveLength(1)
    }
  })
  it.each(['transport', 'malformed'])('requires reload after an uncertain %s write without retries', async failure => {
    mock.client.rpc.mockImplementation(async (name, args) => {
      if (name === 'set_company_operating_country') {
        if (failure === 'transport') throw new Error('PRIVATE')
        return ok({ invalid: 'PRIVATE' })
      }
      return respond(name, args)
    })
    render(tree())
    await ready()
    fireEvent.change(screen.getByLabelText('Operating country'), { target: { value: 'US' } })
    fireEvent.click(save())
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('Write outcome unknown')
    expect(save().disabled).toBe(true)
    expect(writes()).toHaveLength(1)
  })
  it('reports confirmed writes separately from failed post-write refresh', async () => {
    let confirmed = false
    mock.client.rpc.mockImplementation(async (name, args) => {
      if (name === 'company_operating_country' && confirmed) throw new Error('PRIVATE')
      const result = await respond(name, args)
      if (name === 'set_company_operating_country') confirmed = true
      return result
    })
    render(tree())
    await ready()
    fireEvent.change(screen.getByLabelText('Operating country'), { target: { value: 'US' } })
    fireEvent.click(save())
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('Change confirmed, but refresh failed')
    expect(screen.getByText('Change confirmed.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    expect(writes()).toHaveLength(1)
  })
  it('prevents duplicate submissions with a synchronous in-flight guard', async () => {
    const pending = deferred()
    mock.client.rpc.mockImplementation((name, args) => name === 'set_company_central_suppliers' ? pending.promise : respond(name, args))
    render(tree())
    await ready()
    const button = area('Supplier directory').getByRole('button', { name: 'Enable Beta' })
    fireEvent.click(button); fireEvent.click(button)
    expect(writes()).toHaveLength(1)
    await act(async () => pending.resolve(ok([{ ...row(otherId, 'Beta', true, 1) }])))
  })
  it.each([{ companyAccountId: otherCompany }, { userId: otherCompany }])('hides old scope and discards its pending response on %j', async next => {
    const pending = deferred()
    const view = render(tree())
    await ready()
    let held = false
    mock.client.rpc.mockImplementation((name, args) => {
      if (name === 'company_operating_country' && !held) { held = true; return pending.promise }
      return respond(name, args)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reload and review' }))
    view.rerender(tree(next))
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enable Beta' })).toBeNull()
    await ready()
    const count = mock.client.rpc.mock.calls.length
    await act(async () => pending.resolve(ok({ companyAccountId: company, countryCode: 'US', revision: 99 })))
    expect(mock.client.rpc).toHaveBeenCalledTimes(count)
    expect((screen.getByLabelText('Operating country') as HTMLSelectElement).value).toBe('GB')
  })
  it('does not refresh or publish confirmation after a write resolves following unmount', async () => {
    const pending = deferred()
    mock.client.rpc.mockImplementation((name, args) => name === 'set_company_central_suppliers' ? pending.promise : respond(name, args))
    const view = render(tree())
    await ready()
    fireEvent.click(area('Supplier directory').getByRole('button', { name: 'Enable Beta' }))
    view.unmount()
    const count = mock.client.rpc.mock.calls.length
    await act(async () => pending.resolve(ok([row(otherId, 'Beta', true, 1)])))
    expect(mock.client.rpc).toHaveBeenCalledTimes(count)
  })
  it('keeps a newer scope actionable when an old write resolves later', async () => {
    const pending = deferred()
    mock.client.rpc.mockImplementation((name, args) => name === 'set_company_central_suppliers' ? pending.promise : respond(name, args))
    const view = render(tree())
    await ready()
    fireEvent.click(area('Supplier directory').getByRole('button', { name: 'Enable Beta' }))
    view.rerender(tree({ companyAccountId: otherCompany }))
    await ready()
    const count = mock.client.rpc.mock.calls.length
    await act(async () => pending.resolve(ok([row(otherId, 'Beta', true, 1)])))
    expect(mock.client.rpc).toHaveBeenCalledTimes(count)
    expect(screen.queryByText('Change confirmed.')).toBeNull()
    expect((area('Supplier directory').getByRole('button', { name: 'Enable Beta' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('discards older search responses and performs no refresh after unmount', async () => {
    const pending = deferred()
    mock.client.rpc.mockImplementation((name, args) => name === 'subscriber_supplier_directory' && args.p_search === 'old' ? pending.promise : respond(name, args))
    const view = render(tree())
    await ready()
    search('old'); search('new')
    await ready()
    await act(async () => pending.resolve(ok([supplier(otherId, 'Obsolete supplier')])))
    expect(screen.queryByText('Obsolete supplier')).toBeNull()
    view.unmount()
    expect(writes()).toHaveLength(0)
  })
})
