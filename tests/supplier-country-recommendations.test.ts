import { describe, expect, it } from 'vitest'
import { COUNTRY_CODES, countryDisplayName, isCountryCode, normalizeCountryCode, resolveOperatingCountry,
  normalizeSupplierCoverage, supplierCountryRecommendation, matchesSupplierCountryBrowse } from '../src/lib/countries'

describe('country identity', () => {
  it('validates the explicit ISO list, not arbitrary region identifiers', () => {
    expect(COUNTRY_CODES).toHaveLength(249)
    expect(new Set(COUNTRY_CODES).size).toBe(249)
    for (const code of COUNTRY_CODES) expect(isCountryCode(code)).toBe(true)
    for (const value of ['ZZ', 'UK', 'EU', 'XK', 'AN', 'SU', 'gb', '', null, {}, 44]) expect(isCountryCode(value)).toBe(false)
    expect(countryDisplayName('GB')).toBe('United Kingdom')
    expect(countryDisplayName('ZZ')).toBeNull()
  })
  it('never supplies an operating country for missing or unconfirmed legacy text', () => {
    expect(resolveOperatingCountry(null)).toEqual({ status: 'missing', code: null, suggestion: null })
    expect(resolveOperatingCountry('United Kingdom')).toEqual({ status: 'confirmation-required', code: null, suggestion: 'GB' })
    expect(resolveOperatingCountry('South Africa')).toEqual({ status: 'confirmation-required', code: null, suggestion: 'ZA' })
    expect(resolveOperatingCountry(' gb ')).toEqual({ status: 'valid', code: 'GB', suggestion: null })
  })
})

describe('recommendations are not permissions', () => {
  it.each([undefined, null, '', ' ', {}, [], 5, true])('handles missing/malformed operating country %j without a default', value => {
    const result = resolveOperatingCountry(value)
    expect(result.code).toBeNull()
    expect(result.suggestion).toBeNull()
  })
  it.each(['ZZ', 'EU', 'AN', 'SU', 'XK', 'AUS', 'GB,US', 'London, United Kingdom', 'GBP', 'constructor', '__proto__'])('does not guess from %s', value => {
    expect(resolveOperatingCountry(value)).toEqual({ status: 'invalid', code: null, suggestion: null })
    expect(normalizeCountryCode(value)).toBeNull()
  })
  it.each([['UK', 'GB'], ['USA', 'US'], [' australia ', 'AU']])('requires confirmation of %s', (value, code) => {
    expect(resolveOperatingCountry(value)).toEqual({ status: 'confirmation-required', code: null, suggestion: code })
  })
  it('normalizes coverage without mutating it; partial invalid coverage is unspecified', () => {
    const coverage = Object.freeze(['US', 'GB', 'US'])
    expect(normalizeSupplierCoverage(coverage)).toEqual(['GB', 'US'])
    expect(coverage).toEqual(['US', 'GB', 'US'])
    for (const input of [[], null, {}, 'GB', ['ZZ'], ['GB', 'ZZ'], ['gb'], [null], new Array(2), Array(250).fill('GB')]) expect(normalizeSupplierCoverage(input)).toBeNull()
  })
  it('matches a confirmed country but keeps international and unspecified suppliers browseable', () => {
    expect(supplierCountryRecommendation('GB', ['GB'])).toBe('recommended')
    expect(supplierCountryRecommendation('GB', ['US'])).toBe('international')
    expect(supplierCountryRecommendation('GB', [])).toBe('unspecified')
    expect(supplierCountryRecommendation(null, ['GB'])).toBe('country-required')
    expect(supplierCountryRecommendation('United Kingdom', ['GB'])).toBe('country-required')
    for (const country of ['GB', 'US', null, 'ZZ']) for (const coverage of [['GB'], ['US'], [], ['ZZ']]) {
      expect(matchesSupplierCountryBrowse(country, coverage, 'international')).toBe(true)
    }
    expect(matchesSupplierCountryBrowse('GB', ['US'], 'recommended')).toBe(false)
    expect(matchesSupplierCountryBrowse('GB', ['GB'], 'recommended')).toBe(true)
  })
  it('changing operating country does not mutate configured selections', () => {
    const selected = Object.freeze({ supplierId: 'supplier-identity', enabled: true })
    expect(supplierCountryRecommendation('GB', ['GB'])).toBe('recommended')
    expect(supplierCountryRecommendation('US', ['GB'])).toBe('international')
    expect(selected.enabled).toBe(true)
  })
})
