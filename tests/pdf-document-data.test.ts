import { expect, it } from 'vitest'
import { pdfCommercial, pdfCustomer, pdfDate, pdfSettings } from '@/lib/pdf/pdfDocumentData'

it('normalizes seller aliases without dropping legacy address fields', () => {
  expect(pdfSettings({ companyAddress1: 'Legacy address 1', companyAddress2: 'Legacy address 2' }).address).toBe('Legacy address 1\nLegacy address 2')
})
it('uses saved snapshot line totals rather than multiplying displayed units again', () => {
  const values = pdfCommercial({ pricingSnapshot: { version: 1, currencyCode: 'GBP', taxRate: 0.2, taxLabel: 'VAT',
    items: [{ description: 'Saved allocation', qty: 3, unitPrice: 3.33, lineTotal: 10 }], subtotal: 10, tax: 2, total: 12 } },
    { currencyCode: 'USD', taxRatePct: 99 })
  expect(values.items[0].amount).toBe(10)
  expect(values.total).toBe(12)
  expect(values.taxTitle).toBe('VAT (20.00%)')
  expect(values.currency).toBe('GBP')
})
it.each([{ currencyCode: 'JPY', total: 100, payment: 30, balance: 70 }, { currencyCode: 'BHD', total: 1.234, payment: 0.111, balance: 1.123 }])('honours minor units for $currencyCode', value => {
  const financial = pdfCommercial({ ...value, subtotal: value.total, tax: 0, payments: [{ amount: value.payment }] })
  expect(financial.balance).toBe(value.balance)
})
it('does not mix partial saved customer fields with current CRM or override intentional blanks', () => {
  expect(pdfCustomer({ customerSnapshot: { firstName: 'Saved' }, customerEmail: '', customerPhone: '' },
    { firstName: 'Current', lastName: 'CRM', email: 'new@example.invalid', phone: '123' })).toEqual(['Saved'])
})
it('formats date-only fields without timezone rollover and omits invalid dates', () => {
  expect(pdfDate('2026-01-02')).toBe('02 Jan 2026')
  expect(pdfDate('not-a-date')).toBe('')
})
