import { isCountryCode } from './countries'
import { parseCompanyOperatingCountry, parseSubscriberSupplier, parseSupplierCommand, parseSupplierSelection } from './supplierManagement'
import type { CentralSupplier, CompanySupplierSelection, SupplierEnabledCommand } from './supplierManagement'

export type SupplierManagementRpcName = 'subscriber_supplier_directory' | 'company_central_suppliers'
  | 'set_company_central_suppliers' | 'company_operating_country' | 'set_company_operating_country'
/** Inject transport only: this module never constructs a client or authorizes a user. */
export type SupplierManagementRpc = (name: SupplierManagementRpcName, parameters: Readonly<Record<string, unknown>>) =>
  PromiseLike<{ data: unknown; error: unknown }>
export type SupplierManagementFailure = 'invalid-request' | 'conflict' | 'denied' | 'malformed-response' | 'transport' | 'failure'
export type WriteOutcome = 'not-applicable' | 'not-attempted' | 'rejected' | 'unknown'
const messages: Record<SupplierManagementFailure, string> = {
  'invalid-request': 'Invalid supplier management request.',
  conflict: 'Supplier settings changed. Reload and review before submitting again.',
  denied: 'Supplier management access denied.',
  'malformed-response': 'Invalid supplier management response.',
  transport: 'Supplier management transport failed.',
  failure: 'Supplier management request failed.',
}
export class SupplierManagementServiceError extends Error {
  readonly kind: SupplierManagementFailure
  readonly writeOutcome: WriteOutcome
  constructor(kind: SupplierManagementFailure, writeOutcome: WriteOutcome) {
    super(messages[kind] + (writeOutcome === 'unknown' ? ' Write outcome unknown; reload before deciding whether to retry.' : ''))
    this.name = 'SupplierManagementServiceError'
    this.kind = kind
    this.writeOutcome = writeOutcome
  }
}

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid contract')
}
function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value))
  const prototype = Object.getPrototypeOf(value)
  assert(prototype === Object.prototype || prototype === null)
  assert(Object.getOwnPropertySymbols(value).length === 0)
  const result: Record<string, unknown> = Object.create(null)
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    assert('value' in descriptor)
    result[key] = descriptor.value
  }
  return result
}
function uuid(value: unknown): string {
  assert(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
  return value.toLowerCase()
}
function revision(value: unknown): number | null {
  if (value === null) return null
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1)
  return value
}
function input<T>(parse: () => T): T {
  try { return parse() } catch { throw new SupplierManagementServiceError('invalid-request', 'not-attempted') }
}
function options(value: unknown, directory: boolean) {
  const source = record(value)
  assert(Object.keys(source).every(key => (directory ? ['mode', 'search', 'limit', 'offset'] : ['limit', 'offset']).includes(key)))
  const get = (key: string, fallback: unknown) => Object.hasOwn(source, key) ? source[key] : fallback
  const limit = get('limit', 50), offset = get('offset', 0)
  assert(typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 100)
  assert(typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 && offset <= 10000)
  const mode = get('mode', 'international'), search = get('search', '')
  assert(mode === 'international' || mode === 'recommended')
  assert(typeof search === 'string' && [...search].length <= 100)
  assert([...search].every(character => character !== '\u0000' && !/^[\ud800-\udfff]$/.test(character)))
  return { limit, offset, mode, search }
}
function central(value: unknown, company: string): CentralSupplier {
  const source = record(value)
  if (Object.hasOwn(source, 'companyAccountId')) assert(uuid(source.companyAccountId) === company)
  const supplier = parseSubscriberSupplier(source, company)
  assert(supplier.kind === 'central')
  return supplier
}
type CentralSelection = CompanySupplierSelection & { readonly supplier: CentralSupplier }
function selection(value: unknown, company: string, response = false): CentralSelection {
  const source = record(value), parsed = parseSupplierSelection(source, company)
  const supplier = central(source.supplier, company)
  if (response) assert(source.canEnable === parsed.canEnable && source.availability === parsed.availability)
  return Object.freeze({ ...parsed, supplier })
}
function rows<T>(value: unknown, limit: number, parse: (row: unknown) => T, id: (row: T) => string): readonly T[] {
  assert(Array.isArray(value) && value.length <= limit)
  const parsed = Array.from(value, parse)
  assert(new Set(parsed.map(id)).size === parsed.length)
  return Object.freeze(parsed)
}

export function createSupplierManagementService(rpc: SupplierManagementRpc) {
  input(() => assert(typeof rpc === 'function'))
  async function call<T>(name: SupplierManagementRpcName, parameters: Record<string, unknown>, write: boolean, parse: (data: unknown) => T): Promise<T> {
    const uncertain = write ? 'unknown' : 'not-applicable'
    let result: unknown
    try { result = await rpc(name, parameters) }
    catch { throw new SupplierManagementServiceError('transport', uncertain) }
    try {
      const envelope = record(result)
      assert(Object.hasOwn(envelope, 'data') && Object.hasOwn(envelope, 'error'))
      if (envelope.error !== null) {
        assert(envelope.data === null)
        const code = record(envelope.error).code
        const kind = code === '40001' ? 'conflict' : code === '42501' ? 'denied' : code === '22023' ? 'invalid-request' : 'failure'
        throw new SupplierManagementServiceError(kind, write && kind !== 'failure' ? 'rejected' : uncertain)
      }
      return parse(envelope.data)
    } catch (error) {
      if (error instanceof SupplierManagementServiceError) throw error
      throw new SupplierManagementServiceError('malformed-response', uncertain)
    }
  }
  return Object.freeze({
    async directory(companyAccountId: unknown, directoryOptions: unknown = {}) {
      const { company, page } = input(() => ({ company: uuid(companyAccountId), page: options(directoryOptions, true) }))
      return call('subscriber_supplier_directory', {
        p_company_account_id: company, p_mode: page.mode, p_search: page.search, p_limit: page.limit, p_offset: page.offset,
      }, false, data => rows(data, page.limit, value => {
        const supplier = central(value, company)
        assert(supplier.status === 'active')
        return supplier
      }, supplier => supplier.id))
    },
    async selections(companyAccountId: unknown, pagination: unknown = {}) {
      const { company, page } = input(() => ({ company: uuid(companyAccountId), page: options(pagination, false) }))
      return call('company_central_suppliers', { p_company_account_id: company, p_limit: page.limit, p_offset: page.offset }, false,
        data => rows(data, page.limit, value => {
          const parsed = selection(value, company, true)
          assert(parsed.revision !== null)
          return parsed
        }, parsed => parsed.supplier.id))
    },
    async setSelections(companyAccountId: unknown, commands: unknown, currentSelections: unknown) {
      const { company, wire, current } = input(() => {
        const company = uuid(companyAccountId)
        assert(Array.isArray(commands) && commands.length >= 1 && commands.length <= 100 && Array.isArray(currentSelections))
        const current = new Map<string, CentralSelection>()
        for (const value of currentSelections) {
          const parsed = selection(value, company)
          assert(!current.has(parsed.supplier.id))
          current.set(parsed.supplier.id, parsed)
        }
        const seen = new Set<string>()
        const wire = Array.from(commands, value => {
          const source = record(value), target = uuid(record(source.supplier).id)
          const parsed = parseSupplierCommand(source, current.get(target))
          assert(parsed.companyAccountId === company && parsed.supplier.kind === 'central' && !seen.has(target))
          seen.add(target)
          return parsed
        })
        // All strings/fields are bounded after projection. This conservative JSONB
        // upper bound includes container/JEntry, numeric and alignment overhead;
        // PostgreSQL remains authoritative for its 65536-byte pg_column_size limit.
        assert(new TextEncoder().encode(JSON.stringify(wire)).byteLength + wire.length * 256 + 8 <= 65536)
        return { company, wire: Object.freeze(wire), current }
      })
      const requested = new Map<string, SupplierEnabledCommand>(wire.map(command => [command.supplier.id, command]))
      return call('set_company_central_suppliers', { p_company_account_id: company, p_commands: wire }, true, data => {
        const parsed = rows(data, wire.length, value => selection(value, company, true), value => value.supplier.id)
        assert(parsed.length === requested.size)
        for (const row of parsed) {
          const command = requested.get(row.supplier.id), before = current.get(row.supplier.id)
          assert(command && before && row.enabled === command.enabled)
          const expected = before.revision === null ? (command.enabled ? 1 : null)
            : before.revision + (before.enabled === command.enabled ? 0 : 1)
          assert(row.revision === expected)
        }
        return parsed
      })
    },
    async operatingCountry(companyAccountId: unknown) {
      const company = input(() => uuid(companyAccountId))
      return call('company_operating_country', { p_company_account_id: company }, false,
        data => parseCompanyOperatingCountry(data, company))
    },
    async setOperatingCountry(companyAccountId: unknown, countryCode: unknown, expectedRevision: unknown) {
      const { company, code, expected } = input(() => {
        const company = uuid(companyAccountId), expected = revision(expectedRevision)
        assert(countryCode === null || isCountryCode(countryCode))
        return { company, code: countryCode, expected }
      })
      return call('set_company_operating_country', {
        p_company_account_id: company, p_country_code: code, p_expected_revision: expected,
      }, true, data => {
        const parsed = parseCompanyOperatingCountry(data, company)
        assert(parsed.countryCode === code)
        assert(expected === null ? parsed.revision === (code === null ? null : 1)
          : parsed.revision === expected || parsed.revision === expected + 1)
        return parsed
      })
    },
  })
}
