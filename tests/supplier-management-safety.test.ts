import { describe, expect, it } from 'vitest'
import { parseSubscriberSupplier, parseSupplierSelection, projectSubscriberSupplierName,
  parseCompanyOperatingCountry } from '../src/lib/supplierManagement'

const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const central = { kind: 'central', id, name: 'Supplier', status: 'active', countries: ['GB'] }

describe('bounded subscriber display-name projection', () => {
  it.each([
    [' Original name ', 'Original name'], ['A\nB\u0000C\u007fD', 'A B C D'],
    ['A\u0085B\u009fC', 'A B C'],
    ['\u0000\n\u00a0', 'Unnamed supplier'], ['x'.repeat(201), 'x'.repeat(200)],
    ['😀'.repeat(101), '😀'.repeat(100)], ['x'.repeat(199) + '😀tail', 'x'.repeat(199)],
    ['\ud800A\udfff', '\ufffdA\ufffd'], ['\ufeff Name\u2000', 'Name'],
  ])('projects %j without modifying the source', (raw, expected) => {
    const result = projectSubscriberSupplierName(raw)
    expect(result).toBe(expected)
    expect(result.length).toBeLessThanOrEqual(200)
    expect(parseSubscriberSupplier({ ...central, name: result }, company).name).toBe(result)
    expect(projectSubscriberSupplierName(result)).toBe(result)
  })
  it('retains draft identity while marking configured enablement unavailable', () => {
    expect(parseSupplierSelection({ companyAccountId: company, supplier: { ...central, status: 'draft' }, enabled: true, revision: 1 }, company))
      .toMatchObject({ supplier: { id, status: 'draft' }, availability: 'supplier-draft', canEnable: false })
  })
  it('does not treat an unconfigured draft as a browseable supplier selection', () => {
    expect(() => parseSupplierSelection({ companyAccountId: company, supplier: { ...central, status: 'draft' },
      enabled: false, revision: null }, company)).toThrow()
  })
  it.each(['\ud800', '\udfff'])('rejects a malformed surrogate in an already projected name', name => {
    expect(() => parseSubscriberSupplier({ ...central, name }, company)).toThrow()
  })
})

describe('explicit operating-country RPC response contract', () => {
  it.each([null, 'GB'])('accepts an explicit country %s', countryCode => {
    const raw = { companyAccountId: company, countryCode, revision: 1 }
    expect(parseCompanyOperatingCountry(Object.freeze(raw), company)).toEqual(raw)
    expect(Object.isFrozen(parseCompanyOperatingCountry(raw, company))).toBe(true)
  })
  it('accepts only null country for an unconfigured record', () => {
    expect(parseCompanyOperatingCountry({ companyAccountId: company, countryCode: null, revision: null }, company).revision).toBeNull()
    expect(() => parseCompanyOperatingCountry({ companyAccountId: company, countryCode: 'GB', revision: null }, company)).toThrow()
  })
  it.each([
    { companyAccountId: otherCompany }, { countryCode: 'gb' }, { countryCode: 'South Africa' },
    { countryCode: undefined }, { revision: '1' }, { revision: 0 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { private: 'metadata' },
  ])('rejects invalid/foreign response %j', overrides => {
    expect(() => parseCompanyOperatingCountry({ companyAccountId: company, countryCode: 'GB', revision: 1, ...overrides }, company)).toThrow()
  })
})
