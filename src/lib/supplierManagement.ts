import { isCountryCode, normalizeSupplierCoverage } from './countries'
import type { CountryCode } from './countries'

/** Subscriber-safe projections, not central editing, product pricing or asset-use grants. */
export type CentralSupplier = {
  readonly kind: 'central'; readonly id: string; readonly name: string
  readonly status: 'active' | 'paused' | 'retired'; readonly countries: readonly CountryCode[] | null
}
export type PrivateSupplier = {
  readonly kind: 'private'; readonly id: string; readonly companyAccountId: string
  readonly name: string; readonly status: 'active' | 'inactive'; readonly countryCode: CountryCode | null
}
export type SubscriberSupplier = CentralSupplier | PrivateSupplier
export type SupplierAvailability = 'available' | 'disabled' | 'supplier-paused' | 'supplier-retired' | 'supplier-inactive'
export type CompanySupplierSelection = {
  readonly companyAccountId: string; readonly supplier: SubscriberSupplier
  readonly enabled: boolean; readonly revision: number | null
  /** State eligibility only, never user authorization or product/asset rights. */
  readonly availability: SupplierAvailability; readonly canEnable: boolean
}

const invalid = (): never => { throw new Error('Invalid supplier management contract') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return invalid()
  if (Object.getOwnPropertySymbols(value).length) return invalid()
  const fields = Object.getOwnPropertyDescriptors(value)
  if (Object.values(fields).some(field => !('value' in field))) return invalid()
  const own: Record<string, unknown> = Object.create(null)
  for (const [key, field] of Object.entries(fields)) own[key] = field.value
  return own
}
const uuid = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return invalid()
  return value.toLowerCase()
}
const name = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 ||
    [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return invalid()
  return value.trim()
}
const revision = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return invalid()
  return value
}
/** Project allowlisted own fields; never spread transport data. No authorization is performed. */
export function parseSubscriberSupplier(value: unknown, companyAccountId: unknown): SubscriberSupplier {
  const company = uuid(companyAccountId), source = record(value)
  const id = uuid(source.id), displayName = name(source.name)
  if (source.kind === 'central') {
    if (!['active', 'paused', 'retired'].includes(source.status as string)) return invalid()
    return Object.freeze({ kind: 'central', id, name: displayName, status: source.status as CentralSupplier['status'],
      countries: normalizeSupplierCoverage(source.countries) })
  }
  if (source.kind !== 'private' || uuid(source.companyAccountId) !== company || !['active', 'inactive'].includes(source.status as string)) return invalid()
  if (source.countryCode != null && !isCountryCode(source.countryCode)) return invalid()
  return Object.freeze({ kind: 'private', id, companyAccountId: company, name: displayName,
    status: source.status as PrivateSupplier['status'], countryCode: source.countryCode as CountryCode ?? null })
}
export function parseSupplierSelection(value: unknown, companyAccountId: unknown): CompanySupplierSelection {
  const company = uuid(companyAccountId), source = record(value)
  if (uuid(source.companyAccountId) !== company || typeof source.enabled !== 'boolean') return invalid()
  const supplier = parseSubscriberSupplier(source.supplier, company)
  const canEnable = supplier.kind === 'private' || supplier.status === 'active'
  const availability: SupplierAvailability = !source.enabled ? 'disabled' : supplier.status === 'active' ? 'available'
    : supplier.status === 'paused' ? 'supplier-paused' : supplier.status === 'retired' ? 'supplier-retired' : 'supplier-inactive'
  if (source.revision === null && (supplier.kind !== 'central' || source.enabled)) return invalid()
  return Object.freeze({ companyAccountId: company, supplier, enabled: source.enabled,
    revision: source.revision === null ? null : revision(source.revision), availability, canEnable })
}

export type SupplierReference =
  | { readonly kind: 'central'; readonly id: string }
  | { readonly kind: 'private'; readonly id: string }
export type SupplierEnabledCommand = {
  readonly action: 'set-enabled'; readonly companyAccountId: string
  readonly supplier: SupplierReference; readonly enabled: boolean; readonly expectedRevision: number | null
}
function exactKeys(source: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(source).length !== keys.length || keys.some(key => !Object.hasOwn(source, key))) return invalid()
}
/** Pure desired-state validation. Future persistence MUST independently authorize and recheck state. */
export function parseSupplierCommand(value: unknown, currentSelection: unknown): SupplierEnabledCommand {
  const source = record(value)
  exactKeys(source, ['action', 'companyAccountId', 'supplier', 'enabled', 'expectedRevision'])
  if (source.action !== 'set-enabled' || typeof source.enabled !== 'boolean') return invalid()
  const companyAccountId = uuid(source.companyAccountId)
  const current = parseSupplierSelection(currentSelection, companyAccountId)
  const target = record(source.supplier)
  exactKeys(target, ['kind', 'id'])
  const id = uuid(target.id)
  if (target.kind !== current.supplier.kind || id !== current.supplier.id || (source.enabled && !current.canEnable)) return invalid()
  const expectedRevision = source.expectedRevision === null ? null : revision(source.expectedRevision)
  if (expectedRevision !== current.revision) return invalid()
  return Object.freeze({ action: 'set-enabled', companyAccountId,
    supplier: Object.freeze({ kind: current.supplier.kind, id }), enabled: source.enabled, expectedRevision })
}

/** Identity only, not evidence of company access to a central product. No product data is loaded. */
export type SupplierProductReference = {
  readonly companyAccountId: string; readonly supplierId: string; readonly supplierProductId: string
}
export function parseSupplierProductReference(value: unknown, companyAccountId: unknown): SupplierProductReference {
  const source = record(value), company = uuid(companyAccountId)
  if (uuid(source.companyAccountId) !== company) return invalid()
  return Object.freeze({ companyAccountId: company, supplierId: uuid(source.supplierId), supplierProductId: uuid(source.supplierProductId) })
}
