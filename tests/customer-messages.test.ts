import { expect, it } from 'vitest'
import { accountUpdateDraft, documentDraft, jobReadyDraft, mailtoDraft, whatsAppDraft } from '@/lib/customerMessages'
const settings = { companyName: 'Oak & Linen', companyEmail: 'studio@example.invalid', companyAddress: '24 Example Lane', currencyCode: 'USD' }
const invoice = { id: 'i1', number: 'INV-SAVED', currencyCode: 'GBP', total: 120, subtotal: 100, tax: 20, payments: [{ amount: 30 }], status: 'Sent' }
it('uses saved document reference, currency and payment evidence without attachment claims', () => {
  const draft = documentDraft('invoice', invoice, 'Jamie 50% & Co', settings)
  expect(draft.subject).toContain('INV-SAVED')
  expect(draft.body).toContain('Invoice total: £120.00')
  expect(draft.body).toContain('Recorded payments: £30.00')
  expect(draft.body).toContain('Balance remaining: £90.00')
  expect(draft.body).toContain('Oak & Linen')
  expect(draft.body).not.toMatch(/attached|FramersApp/)
  const url = new URL(mailtoDraft('jamie+test@example.invalid', draft))
  expect(url.searchParams.get('body')).toBe(draft.body)
  expect(new URL(whatsAppDraft('+44 (7000) 123456', draft.body)).searchParams.get('text')).toBe(draft.body)
})
it('preserves saved quote snapshot and never includes private notes', () => {
  const draft = documentDraft('quote', { number: 'Q-FULL', total: 12, internalNotes: 'PRIVATE', pricingSnapshot: { version: 1, currencyCode: 'GBP', total: 12, items: [] } }, 'Jamie', settings)
  expect(draft.body).toContain('Quote total: £12.00')
  expect(draft.body).not.toContain('PRIVATE')
})
it('does not infer legacy paid amounts from status and omits unknown totals', () => {
  const paid = documentDraft('invoice', { ...invoice, status: 'Paid', payments: [] }, 'Jamie', settings)
  expect(paid.body).toContain('Payment details are not recorded')
  expect(paid.body).not.toContain('Balance remaining')
  expect(documentDraft('quote', { number: 'Q-UNKNOWN' }, '', settings).body).not.toContain('$0.00')
})
it('does not present a void invoice as money still payable', () => {
  const draft = documentDraft('invoice', { ...invoice, status: 'Void' }, 'Jamie', settings)
  expect(draft.body).toContain('Recorded status: Void')
  expect(draft.body).not.toContain('Balance remaining')
})
it('uses the configured job template with full reference and neutral saved job value', () => {
  const draft = jobReadyDraft({ id: 'opaque-id', refNo: 'JOB-1234567890', currency: { code: 'GBP' }, total: 120 }, 'Jamie', {
    ...settings, jobReadyMessageTemplate: 'Hello {{customerName}},\nCollect {{jobId}} from {{companyName}}.\n{{companyAddressLine1}}\n{{companyAddressLine2}}',
  })
  expect(draft.subject).toContain('JOB-1234567890')
  expect(draft.body).toContain('Hello Jamie,\nCollect JOB-1234567890 from Oak & Linen.')
  expect(draft.body).toContain('24 Example Lane')
  expect(draft.body).toContain('Job value: £120.00')
  expect(draft.body).not.toMatch(/Total due|Outstanding|{{/)
})
it('uses a sensible job fallback and does not invent a zero job value', () => {
  const draft = jobReadyDraft({ id: 'full-legacy-id', details: { costs: { total: 70 }, settings: { currencyCode: 'GBP' } } }, '', settings)
  expect(draft.body).toContain('ready for collection')
  expect(draft.body).toContain('Job value: £70.00')
  expect(draft.subject).toContain('full-legacy-id')
  expect(jobReadyDraft({ refNo: 'JOB-EMPTY' }, '', settings).body).not.toContain('Job value')
})
it('does not combine different invoice currencies or include drafts/voids in account updates', () => {
  const draft = accountUpdateDraft('Jamie', [invoice, { ...invoice, id: 'usd', currencyCode: 'USD', total: 50, payments: [] },
    { ...invoice, status: 'Void', total: 999 }, { ...invoice, status: 'Draft', total: 888 }], settings)
  expect(draft.body).toContain('GBP: £90.00')
  expect(draft.body).toContain('USD: US$50.00')
  expect(draft.body).not.toMatch(/999|888/)
})
it('does not invent a settled account when a paid legacy invoice has no payment entries', () => {
  const draft = accountUpdateDraft('Jamie', [{ ...invoice, status: 'Paid', payments: [] }], settings)
  expect(draft.body).toContain('payment details need confirmation')
  expect(draft.body).not.toContain('outstanding balance of')
})
