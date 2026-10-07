import { describe, expect, it } from 'vitest'
import { priceSellingDocument, toVisualiserQuote } from '@/lib/pricing'

const draft = () => ({
  items: [{ id: 'a', description: 'Mounting', qty: 2, unitPrice: 100 }, { id: 'b', description: 'Glass', qty: 1, unitPrice: 25.005 }],
  currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 20, taxLabel: 'VAT',
})

describe('manual selling documents', () => {
  it('keeps entered selling prices without a catalogue multiplier and reconciles rounded lines', () => {
    const result = priceSellingDocument(draft())
    expect(result.version).toBe(1)
    expect(result.items.map(item => item.lineTotal)).toEqual([200, 25.01])
    expect(result.subtotal).toBe(225.01)
    expect(result.tax).toBe(45)
    expect(result.total).toBe(270.01)
    expect(result.items.every(item => !('rawAmount' in item))).toBe(true)
    expect(toVisualiserQuote(result).items.reduce((sum, item) => sum + item.total, 0)).toBe(result.subtotal)
  })
  it('recalculates after item removal and retains the saved rate despite later settings changes', () => {
    const initial = priceSellingDocument(draft())
    const updated = priceSellingDocument({ ...draft(), items: draft().items.slice(1), taxRatePct: initial.taxRate * 100 })
    expect(updated.total).toBe(30.01)
    expect(initial.total).toBe(270.01)
    expect(initial.taxRate).toBe(0.2)
  })
  it('uses currency minor units and rejects negative quantities or prices', () => {
    const jpy = priceSellingDocument({ ...draft(), currencyCode: 'JPY', items: [{ description: 'Art', qty: 2, unitPrice: 100.5 }] })
    expect(jpy.subtotal).toBe(202)
    expect(() => priceSellingDocument({ ...draft(), items: [{ description: 'Art', qty: -1, unitPrice: 1 }] })).toThrow()
  })
})
