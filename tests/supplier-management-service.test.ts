import { describe, expect, it, vi } from 'vitest'
import { createSupplierManagementService, SupplierManagementServiceError } from '../src/lib/supplierManagementService'
import type { SupplierManagementRpc } from '../src/lib/supplierManagementService'

const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const supplier = (supplierId = id) => ({ kind: 'central', id: supplierId, name: 'Supplier', status: 'active', countries: ['GB'] })
const selection = (supplierId = id, enabled = false, revision: number | null = 1) => ({
  companyAccountId: company, supplier: supplier(supplierId), enabled, revision,
  availability: enabled ? 'available' : 'disabled', canEnable: true,
})
const command = (supplierId = id, enabled = true, expectedRevision: number | null = 1) => ({
  action: 'set-enabled', companyAccountId: company, supplier: { kind: 'central', id: supplierId }, enabled, expectedRevision,
})
const country = (countryCode: string | null = 'GB', revision: number | null = 1) => ({ companyAccountId: company, countryCode, revision })
function setup(data: unknown = [], error: unknown = null) {
  const rpc = vi.fn<SupplierManagementRpc>().mockResolvedValue({ data, error })
  return { rpc, service: createSupplierManagementService(rpc) }
}
async function fails(promise: Promise<unknown>, kind: string, writeOutcome: string) {
  const error = await promise.catch((value: unknown) => value)
  expect(error).toBeInstanceOf(SupplierManagementServiceError)
  expect(error).toMatchObject({ kind, writeOutcome })
  expect((error as Error).message).not.toContain('PRIVATE')
}

describe('injected SC-V2.2 RPC service', () => {
  it('requests the directory with explicit SQL defaults and safe projections', async () => {
    const { rpc, service } = setup([{ ...supplier(), wholesale_cost: 42 }])
    const rows = await service.directory(company)
    expect(rows).toEqual([supplier()])
    expect(Object.isFrozen(rows)).toBe(true)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('subscriber_supplier_directory', {
      p_company_account_id: company, p_mode: 'international', p_search: '', p_limit: 50, p_offset: 0,
    })
  })
  it('preserves Unicode search text and explicit recommended pagination', async () => {
    const { rpc, service } = setup()
    const search = '😀'.repeat(100)
    await service.directory(company, { mode: 'recommended', search, limit: 100, offset: 10000 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('subscriber_supplier_directory', {
      p_company_account_id: company, p_mode: 'recommended', p_search: search, p_limit: 100, p_offset: 10000,
    })
  })
  it('lists stored company selections with exact pagination parameters', async () => {
    const { rpc, service } = setup([selection()])
    expect(await service.selections(company, { limit: 1, offset: 2 })).toEqual([selection()])
    expect(rpc).toHaveBeenCalledExactlyOnceWith('company_central_suppliers', {
      p_company_account_id: company, p_limit: 1, p_offset: 2,
    })
  })
  it('validates a batch by ID rather than response or current-selection order', async () => {
    const { rpc, service } = setup([selection(otherId, true, 2), selection(id, true, 2)])
    const commands = [command(), command(otherId)]
    const rows = await service.setSelections(company, commands, [selection(otherId), selection()])
    expect(rows.map(row => row.supplier.id)).toEqual([otherId, id])
    expect(rpc).toHaveBeenCalledExactlyOnceWith('set_company_central_suppliers', {
      p_company_account_id: company, p_commands: commands,
    })
  })
  it.each([true, false])('preserves absence for initial enabled=%s', async enabled => {
    const { rpc, service } = setup([selection(id, enabled, enabled ? 1 : null)])
    await service.setSelections(company, [command(id, enabled, null)], [selection(id, false, null)])
    expect(rpc.mock.calls[0][1]).toEqual({ p_company_account_id: company, p_commands: [command(id, enabled, null)] })
  })
  it('retains a configured draft and permits disabling without granting enablement', async () => {
    const before = { ...selection(id, true), supplier: { ...supplier(), status: 'draft' }, availability: 'supplier-draft', canEnable: false }
    const after = { ...before, enabled: false, revision: 2, availability: 'disabled' }
    const { service } = setup([after])
    expect(await service.setSelections(company, [command(id, false)], [before])).toEqual([after])
  })
  it('accepts an existing relationship no-op without increasing its revision', async () => {
    const { service } = setup([selection()])
    expect(await service.setSelections(company, [command(id, false)], [selection()])).toEqual([selection()])
  })
  it('reads the scalar country envelope, including no stored row', async () => {
    const { rpc, service } = setup(country(null, null))
    expect(await service.operatingCountry(company)).toEqual(country(null, null))
    expect(rpc).toHaveBeenCalledExactlyOnceWith('company_operating_country', { p_company_account_id: company })
  })
  it.each([['GB', null, 1], [null, null, null], ['GB', 3, 3], [null, 3, 4]] as const)(
    'sets country %s with expected revision %s', async (code, expected, revision) => {
      const { rpc, service } = setup(country(code, revision))
      expect(await service.setOperatingCountry(company, code, expected)).toEqual(country(code, revision))
      expect(rpc).toHaveBeenCalledExactlyOnceWith('set_company_operating_country', {
        p_company_account_id: company, p_country_code: code, p_expected_revision: expected,
      })
    })
  it('accepts 100 distinct commands and detaches the wire payload', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`)
    const { rpc, service } = setup(ids.map(value => selection(value, true, 2)))
    const commands = ids.map(value => command(value))
    await service.setSelections(company, commands, ids.map(value => selection(value)))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1].p_commands).not.toBe(commands)
  })
})

describe('preflight validation never invokes the transport', () => {
  it.each([undefined, null, '', 'bad', '00000000-0000-0000-0000-000000000000'])('requires explicit valid scope %j', async scope => {
    const { rpc, service } = setup()
    await fails(service.operatingCountry(scope), 'invalid-request', 'not-attempted')
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([null, { mode: 'worldwide' }, { mode: null }, { search: null }, { search: 'x'.repeat(101) },
    { search: '\u0000' }, { search: '\ud800' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 },
    { offset: -1 }, { offset: 10001 }, { offset: NaN }, { countryCode: 'GB' }, { limit: undefined }])(
    'rejects invalid directory options %j', async options => {
      const { rpc, service } = setup()
      await fails(service.directory(company, options), 'invalid-request', 'not-attempted')
      expect(rpc).not.toHaveBeenCalled()
    })
  it('rejects directory-only options on the selections endpoint', async () => {
    const { rpc, service } = setup()
    await fails(service.selections(company, { mode: 'international' }), 'invalid-request', 'not-attempted')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects oversized injected fields instead of forwarding them into JSONB', async () => {
    const { rpc, service } = setup()
    await fails(service.setSelections(company, [{ ...command(), metadata: 'x'.repeat(65537) }], [selection()]), 'invalid-request', 'not-attempted')
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([undefined, 'gb', '', 'South Africa', 'ZZ', 1])('rejects noncanonical country %j', async code => {
    const { rpc, service } = setup()
    await fails(service.setOperatingCountry(company, code, null), 'invalid-request', 'not-attempted')
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([undefined, '1', 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid expected revision %j', async revision => {
    const { rpc, service } = setup()
    await fails(service.setOperatingCountry(company, 'GB', revision), 'invalid-request', 'not-attempted')
    await fails(service.setSelections(company, [{ ...command(), expectedRevision: revision }], [selection()]), 'invalid-request', 'not-attempted')
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([[], Array(101).fill(command()), [command(), command(id.toUpperCase())],
    [{ ...command(), companyAccountId: otherCompany }], [{ ...command(), expectedRevision: null }],
    [{ ...command(), expectedRevision: 2 }], [{ ...command(), private: 'PRIVATE' }],
    [{ ...command(), supplier: { kind: 'private', id } }], [command(otherId)]].map(commands => ({ commands })))('rejects invalid batch %j', async ({ commands }) => {
    const { rpc, service } = setup()
    await fails(service.setSelections(company, commands, [selection()]), 'invalid-request', 'not-attempted')
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([
    [{ ...selection(), companyAccountId: otherCompany }], [selection(), selection()], [],
    [{ ...selection(), supplier: { kind: 'private', id, companyAccountId: company, name: 'PRIVATE', status: 'active', countryCode: 'GB' } }],
    [{ ...selection(), supplier: { ...supplier(), status: 'retired' }, canEnable: true }],
  ].map(current => ({ current })))('rejects invalid current selections %j', async ({ current }) => {
    const { rpc, service } = setup()
    await fails(service.setSelections(company, [command()], current), 'invalid-request', 'not-attempted')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects accessors without executing them', async () => {
    const getter = vi.fn(() => 'PRIVATE')
    const options = Object.defineProperty({}, 'search', { enumerable: true, get: getter })
    const { rpc, service } = setup()
    await fails(service.directory(company, options), 'invalid-request', 'not-attempted')
    expect(getter).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('response integrity and safe failure semantics', () => {
  it.each([null, {}, [null], [supplier(), supplier()], [{ ...supplier(), status: 'paused' }],
    [{ ...supplier(), companyAccountId: otherCompany }],
    [{ kind: 'private', id, companyAccountId: company, name: 'PRIVATE', status: 'active', countryCode: 'GB' }]].map(data => ({ data })))(
    'rejects malformed directory response %j', async ({ data }) => {
      const { service } = setup(data)
      await fails(service.directory(company), 'malformed-response', 'not-applicable')
    })
  it.each([[{ ...selection(), companyAccountId: otherCompany }], [selection(id, false, null)],
    [{ ...selection(), canEnable: false }], [{ ...selection(), availability: 'available' }],
    [{ ...selection(), supplier: { kind: 'private', id, companyAccountId: company, name: 'PRIVATE', status: 'active', countryCode: 'GB' } }]].map(data => ({ data })))(
    'rejects malformed selection response %j', async ({ data }) => {
      const { service } = setup(data)
      await fails(service.selections(company), 'malformed-response', 'not-applicable')
    })
  it.each([[], [selection(id, true, 2), selection(id, true, 2)], [selection(otherId, true, 2)],
    [selection(id, false, 2)], [selection(id, true, 1)], [{ ...selection(id, true, 2), companyAccountId: otherCompany }],
    [selection(id, true, 2), selection(otherId, true, 2)],
    [{ ...selection(id, true, 2), supplier: { kind: 'private', id, companyAccountId: company, name: 'PRIVATE', status: 'active', countryCode: 'GB' } }]].map(data => ({ data })))(
    'does not confirm a write with invalid batch integrity %j', async ({ data }) => {
      const { rpc, service } = setup(data)
      await fails(service.setSelections(company, [command()], [selection()]), 'malformed-response', 'unknown')
      expect(rpc).toHaveBeenCalledTimes(1)
    })
  it.each([[country()], { ...country(), companyAccountId: otherCompany }, country('gb'), country(null, '1' as unknown as number), { ...country(), private: 'PRIVATE' }].map(data => ({ data })))(
    'rejects malformed country responses %j', async ({ data }) => {
      const { service } = setup(data)
      await fails(service.operatingCountry(company), 'malformed-response', 'not-applicable')
    })
  it.each([country('US', 2), country('GB', 9), country('GB', 1)])('does not confirm a contradictory country write %j', async data => {
    const { rpc, service } = setup(data)
    await fails(service.setOperatingCountry(company, 'GB', 3), 'malformed-response', 'unknown')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each([['40001', 'conflict'], ['42501', 'denied'], ['22023', 'invalid-request'], ['XX000', 'failure']])(
    'maps SQLSTATE %s without leaking provider details or retrying', async (code, kind) => {
      const { rpc, service } = setup(null, { code, message: 'PRIVATE', details: 'PRIVATE', hint: 'PRIVATE' })
      await fails(service.setOperatingCountry(company, 'GB', null), kind, code === 'XX000' ? 'unknown' : 'rejected')
      expect(rpc).toHaveBeenCalledTimes(1)
    })
  it('never replaces a null revision with a wildcard or retries a database conflict', async () => {
    const { rpc, service } = setup(null, { code: '40001' })
    await fails(service.setSelections(company, [command(id, true, null)], [selection(id, false, null)]), 'conflict', 'rejected')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('set_company_central_suppliers', {
      p_company_account_id: company, p_commands: [command(id, true, null)],
    })
  })
  it('does not infer authorization from canEnable', async () => {
    const { rpc, service } = setup(null, { code: '42501' })
    await fails(service.setSelections(company, [command()], [selection()]), 'denied', 'rejected')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('distinguishes thrown read and write transport failures without claiming rollback', async () => {
    const { rpc, service } = setup()
    rpc.mockRejectedValue(new Error('PRIVATE'))
    await fails(service.operatingCountry(company), 'transport', 'not-applicable')
    await fails(service.setOperatingCountry(company, 'GB', null), 'transport', 'unknown')
    await fails(service.setSelections(company, [command()], [selection()]), 'transport', 'unknown')
    expect(rpc).toHaveBeenCalledTimes(3)
  })
  it('rejects an invalid envelope without claiming the write failed atomically', async () => {
    const { rpc, service } = setup()
    rpc.mockResolvedValue({ data: country(), error: { code: '40001' } })
    await fails(service.setOperatingCountry(company, 'GB', null), 'malformed-response', 'unknown')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
