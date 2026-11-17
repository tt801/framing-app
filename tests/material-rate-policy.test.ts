import { describe, expect, it } from 'vitest'
import { materialRateIssue, pricingSettingsIssue } from '@/lib/materialPricing'

describe('new-design material pricing policy', () => {
  it.each(['Frame', 'Mat', 'Glazing', 'Printing', 'Backing'])('%s never promotes purchase costs or markup to a base selling rate', category => {
    const product = { id: category, name: category, costPerSqm: 100, markupPercent: 50 }
    expect(materialRateIssue(product, undefined, category)).toMatch(/base material rate/i)
    expect(materialRateIssue({ ...product, allowZeroPrice: true }, undefined, category)).toMatch(/base material rate/i)
    expect(materialRateIssue(product, 0, category)).toBeNull()
    expect(materialRateIssue({ ...product, allowZeroPrice: true }, 0, category)).toBeNull()
    expect(materialRateIssue(product, 20, category)).toBeNull()
  })
  it.each([null, undefined, '', '20', NaN, Infinity, -1])('rejects absent or invalid rate %s', rate => {
    expect(materialRateIssue({ name: 'Board' }, rate, 'Backing')).toBeTruthy()
  })
  it('rejects missing selections and supplier products even when a positive rate is injected', () => {
    expect(materialRateIssue(undefined, 20, 'Backing')).toMatch(/select/i)
    expect(materialRateIssue({ id: 'supplier:00000000-0000-0000-0000-000000000003', name: 'Supplier' }, 20, 'Backing')).toMatch(/supplier/i)
  })
  it('requires a positive multiplier and finite nonnegative labour without treating blanks as zero', () => {
    expect(pricingSettingsIssue({ marginMultiplier: 1.25, labourBase: 0 })).toBeNull()
    for (const marginMultiplier of [0, -1, NaN, Infinity, undefined, ''])
      expect(pricingSettingsIssue({ marginMultiplier, labourBase: 10 })).toBeTruthy()
    for (const labourBase of [-1, NaN, Infinity, undefined, ''])
      expect(pricingSettingsIssue({ marginMultiplier: 1.25, labourBase })).toBeTruthy()
  })
})
