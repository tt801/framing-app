import { describe, expect, it } from 'vitest'
import { parseSubscriberSupplier, parseSupplierSelection, parseSupplierCommand, parseSupplierProductReference } from '../src/lib/supplierManagement'

const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const supplierId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const central = { kind: 'central', id: supplierId, name: ' Central supplier ', status: 'active', countries: ['GB'] }
const privateSupplier = { kind: 'private', id: supplierId, companyAccountId: company, name: ' My supplier ', status: 'active', countryCode: 'GB' }

describe('subscriber supplier projections', () => {
  it('projects only explicitly safe central fields from hostile transport', () => {
    const input = Object.freeze({ ...central, wholesale_cost: 4, pricePerMeter: 5, cached_asset_key: 'private',
      source_image_url: 'private', source_metadata: { secret: 'private' }, feed: {}, account_reference: 'private',
      companyAccountId: otherCompany, image_permitted_uses: { browser: true } })
    expect(parseSubscriberSupplier(input, company)).toEqual({ ...central, name: 'Central supplier' })
    expect(input.name).toBe(' Central supplier ')
  })
  it('keeps central and company-private identities separate and scoped', () => {
    expect(parseSubscriberSupplier(privateSupplier, company)).toEqual({ ...privateSupplier, name: 'My supplier' })
    expect(() => parseSubscriberSupplier(privateSupplier, otherCompany)).toThrow()
    expect(() => parseSubscriberSupplier({ ...privateSupplier, companyAccountId: null }, company)).toThrow()
    expect(() => parseSubscriberSupplier({ ...central, kind: 'supplier' }, company)).toThrow()
  })
  it.each(['active', 'paused', 'retired', 'draft'])('retains identifiable central state %s', status => {
    expect(parseSubscriberSupplier({ ...central, status }, company).status).toBe(status)
  })
  it.each(['active', 'inactive'])('accepts private state %s', status => {
    expect(parseSubscriberSupplier({ ...privateSupplier, status }, company).status).toBe(status)
  })
  it.each(['inactive', null, true, {}, 'ACTIVE'])('rejects invalid subscriber central state %j', status => {
    expect(() => parseSubscriberSupplier({ ...central, status }, company)).toThrow()
  })
  it.each(['paused', 'retired', 'draft', null])('rejects invalid private state %j', status => {
    expect(() => parseSubscriberSupplier({ ...privateSupplier, status }, company)).toThrow()
  })
  it.each(['bad', 'supplier:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '', null, {}, 123])('rejects malformed company/product-shaped supplier identities %j', id => {
    expect(() => parseSubscriberSupplier({ ...central, id }, company)).toThrow()
    expect(() => parseSubscriberSupplier(central, id)).toThrow()
  })
  it('keeps configured enablement separate from central availability', () => {
    expect(parseSupplierSelection({ companyAccountId: company, supplier: { ...central, status: 'paused' }, enabled: true, revision: 2 }, company))
      .toMatchObject({ enabled: true, availability: 'supplier-paused', canEnable: false })
    expect(parseSupplierSelection({ companyAccountId: company, supplier: central, enabled: false, revision: 1 }, company))
      .toMatchObject({ enabled: false, availability: 'disabled', canEnable: true })
  })
})

const selection = (supplier: unknown = central, enabled = false) => ({ companyAccountId: company, supplier, enabled, revision: 1 })
const command = (enabled: boolean) => ({ action: 'set-enabled', companyAccountId: company,
  supplier: { kind: 'central', id: supplierId }, enabled, expectedRevision: 1 })

describe('desired-state commands are not writes or rights grants', () => {
  it.each([true, false])('accepts explicit desired enabled=%s without changing the input', enabled => {
    const input = Object.freeze(command(enabled))
    expect(parseSupplierCommand(input, selection())).toEqual(input)
    expect(selection().enabled).toBe(false)
  })
  it.each(['paused', 'retired', 'draft'])('cannot enable %s central suppliers but can disable retained selections', status => {
    const retained = selection({ ...central, status }, true)
    expect(() => parseSupplierCommand(command(true), retained)).toThrow()
    expect(parseSupplierCommand(command(false), retained).enabled).toBe(false)
  })
  it('supports company-private reactivation without confusing the central identity', () => {
    const input = { ...command(true), supplier: { kind: 'private', id: supplierId } }
    expect(parseSupplierCommand(input, selection({ ...privateSupplier, status: 'inactive' })).enabled).toBe(true)
    expect(() => parseSupplierCommand(command(true), selection(privateSupplier))).toThrow()
  })
  it.each([
    { action: 'delete' }, { action: 'toggle' }, { action: 'edit-central' }, { enabled: 'true' },
    { companyAccountId: otherCompany }, { expectedRevision: 0 }, { expectedRevision: 1.5 },
    { expectedRevision: 2 }, { price: 5 }, { asset: 'private' }, { status: 'active' },
    { supplier: { kind: 'central', id: supplierId, name: 'Edit central' } },
  ])('rejects unsafe/malformed command %j', overrides => {
    expect(() => parseSupplierCommand({ ...command(true), ...overrides }, selection())).toThrow()
  })
  it('accepts an unsaved central relationship only with a null expected revision', () => {
    const pending = { ...selection(), revision: null }
    expect(parseSupplierCommand({ ...command(true), expectedRevision: null }, pending).expectedRevision).toBeNull()
    expect(() => parseSupplierCommand(command(true), pending)).toThrow()
  })
  it('does not accept stale availability flags as authority', () => {
    expect(() => parseSupplierCommand(command(true), { ...selection({ ...central, status: 'retired' }), canEnable: true, availability: 'available' })).toThrow()
  })
})

describe('strict boundary validation', () => {
  it('validates company/supplier/product UUID references without exposing products or assets', () => {
    const reference = { companyAccountId: company, supplierId, supplierProductId: otherCompany }
    expect(parseSupplierProductReference({ ...reference, wholesale_cost: 1, texture_key: 'private' }, company)).toEqual(reference)
    for (const key of ['companyAccountId', 'supplierId', 'supplierProductId']) {
      for (const value of ['supplier:' + supplierId, 'bad', '00000000-0000-0000-0000-000000000000', null, {}, []]) {
        expect(() => parseSupplierProductReference({ ...reference, [key]: value }, company)).toThrow()
      }
    }
    expect(() => parseSupplierProductReference(reference, otherCompany)).toThrow()
  })
  it.each([null, [], true, 'supplier', new Date()])('rejects non-record supplier %j', value => {
    expect(() => parseSubscriberSupplier(value, company)).toThrow()
  })
  it('rejects getters without executing them and drops private supplier metadata', () => {
    let read = false
    const hostile = { ...central, get wholesale_cost() { read = true; return 10 } }
    expect(() => parseSubscriberSupplier(hostile, company)).toThrow()
    expect(read).toBe(false)
    const input = Object.freeze({ ...privateSupplier, contactEmail: 'private', wholesale_cost: 2, asset: { key: 'private' } })
    expect(parseSubscriberSupplier(input, company)).toEqual({ ...privateSupplier, name: 'My supplier' })
  })
  it.each(['', ' ', 'x'.repeat(201), 'name\nvalue', {}, 5])('rejects malformed display name %j', name => {
    expect(() => parseSubscriberSupplier({ ...central, name }, company)).toThrow()
  })
  it.each([NaN, Infinity, -1, 0, 1.5, '1', undefined, Number.MAX_SAFE_INTEGER + 1])('rejects invalid selection revision %j', revision => {
    expect(() => parseSupplierSelection({ ...selection(), revision }, company)).toThrow()
  })
  it('validates boolean enablement, company scope and private country codes', () => {
    expect(() => parseSupplierSelection({ ...selection(), enabled: 'true' }, company)).toThrow()
    expect(() => parseSupplierSelection(selection(), otherCompany)).toThrow()
    expect(() => parseSubscriberSupplier({ ...privateSupplier, countryCode: 'ZZ' }, company)).toThrow()
    expect(parseSubscriberSupplier({ ...privateSupplier, countryCode: null }, company)).toMatchObject({ countryCode: null })
    expect(parseSupplierSelection(selection(privateSupplier, true), company).availability).toBe('available')
    expect(parseSupplierSelection(selection({ ...privateSupplier, status: 'inactive' }, true), company).availability).toBe('supplier-inactive')
  })
  it('rejects symbol-bearing commands and inherited record fields', () => {
    expect(() => parseSupplierCommand({ ...command(true), [Symbol('edit')]: true }, selection())).toThrow()
    expect(() => parseSubscriberSupplier(Object.create(central), company)).toThrow()
    const empty = Object.create(null)
    expect(() => parseSubscriberSupplier(empty, company)).toThrow()
  })
  it('returns detached frozen safe values and canonical UUID casing', () => {
    const coverage = ['GB']
    const input = { ...central, id: supplierId.toUpperCase(), countries: coverage }
    const parsed = parseSubscriberSupplier(input, company)
    coverage.push('US')
    expect(parsed.id).toBe(supplierId)
    expect(Object.isFrozen(parsed)).toBe(true)
    if (parsed.kind !== 'central') throw new Error('Expected central supplier')
    expect(parsed.countries).toEqual(['GB'])
    expect(Object.isFrozen(parsed.countries)).toBe(true)
    const result = parseSupplierCommand(command(true), selection())
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.supplier)).toBe(true)
  })
  it('permits null revision only for a disabled, not-yet-configured central selection', () => {
    expect(() => parseSupplierSelection({ ...selection(central, true), revision: null }, company)).toThrow()
    expect(() => parseSupplierSelection({ ...selection(privateSupplier), revision: null }, company)).toThrow()
  })
})
