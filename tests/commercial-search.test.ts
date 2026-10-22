import { describe, expect, it } from 'vitest'
import { customerSearchFields, matchesCommercialSearch, normalizeSearchText, referenceSearchFields } from '@/lib/commercialSearch'

describe('commercial search normalization', () => {
  it('normalizes case and whitespace without stringifying absent/object/numeric values', () => {
    expect(normalizeSearchText('  UAT  H2\tCommercial\n')).toBe('uat h2 commercial')
    for (const value of [undefined, null, {}, ['name'], 2026, false]) expect(normalizeSearchText(value)).toBe('')
    expect(matchesCommercialSearch('   ', [])).toBe(true)
    expect(matchesCommercialSearch(' [object Object] ', [{}])).toBe(false)
    expect(matchesCommercialSearch('2026', [2026])).toBe(false)
  })

  it.each(['UAT', 'H2', 'Commercial', 'UAT H2', 'H2 Commercial', 'UAT H2 Commercial', '  uat   H2  commercial  '])('matches composed identity %s', query => {
    const customer = { firstName: 'UAT H2 ', lastName: ' Commercial', company: 'Workshop Ltd', email: 'saved@example.invalid' }
    expect(matchesCommercialSearch(query, customerSearchFields(customer))).toBe(true)
    expect(customer).toEqual({ firstName: 'UAT H2 ', lastName: ' Commercial', company: 'Workshop Ltd', email: 'saved@example.invalid' })
  })

  it('includes explicit identity aliases from saved and current representations only', () => {
    const fields = customerSearchFields({ firstName: 'Saved', lastName: 'Person', company: 'Saved business', email: 'old@example.invalid' },
      { firstName: 'Current', lastName: 'Person', companyName: 'Current business', primaryEmail: 'new@example.invalid', contactEmail: 'contact@example.invalid' }, 'Historical customer')
    for (const query of ['saved person', 'current person', 'saved business', 'current business', 'old@example.invalid', 'new@example.invalid', 'contact@example.invalid', 'historical customer']) {
      expect(matchesCommercialSearch(query, fields), query).toBe(true)
    }
    expect(customerSearchFields(null, [], { total: 98765, id: 'opaque-record', notes: 'private-notes' })).toEqual([])
  })

  it('does not combine unrelated fields into a searchable phrase', () => {
    expect(matchesCommercialSearch('oak clear', ['Oak', 'Clear'])).toBe(false)
    expect(matchesCommercialSearch('comm', ['Commercial'])).toBe(true)
  })
})

describe('human-readable reference aliases', () => {
  it.each([
    ['Q-3', ['Q-3', '3']], ['Q-002', ['Q-002', '002', '2']],
    ['Q-   002', ['Q- 002', 'Q-002', '002', '2']],
    ['INV-1000', ['inv-1000', '1000']], [1001, ['1001']], [1003, ['1003']],
    ['CUSTOM/00000000000000000002', ['custom/00000000000000000002', '2']],
  ])('searches reference %s without changing it', (reference, queries) => {
    const fields = referenceSearchFields(reference)
    for (const query of queries) expect(matchesCommercialSearch(query, fields), query).toBe(true)
  })

  it('does not extract digits from non-trailing numbers or arbitrary objects', () => {
    expect(referenceSearchFields({ number: 'INV-1000', total: 1000 })).toEqual([])
    expect(referenceSearchFields(undefined)).toEqual([])
    expect(referenceSearchFields(Number.NaN)).toEqual([])
    expect(matchesCommercialSearch('2', referenceSearchFields('Q-002-final'))).toBe(true) // ordinary reference substring
    expect(referenceSearchFields('Q-002-final')).not.toContain('002')
    expect(referenceSearchFields('Q-000')).toContain('0')
  })
})
