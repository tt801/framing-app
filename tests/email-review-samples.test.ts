import { expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { renderSupportEmail } from '../api/lib/emailTemplates'
import { accountUpdateDraft, documentDraft, jobReadyDraft } from '@/lib/customerMessages'

it('renders synthetic HTML/text examples without sending email', () => {
  const update = renderSupportEmail({ heading: 'Support ticket update', reference: 'SUP-SYNTHETIC-123', subject: 'Mounting advice',
    context: ['Visibility: customer', 'Author: FramersApp Support'], message: 'Thank you for the details. Please sign in to view the conversation and respond.',
    ticketUrl: 'https://example.invalid/#/support?view=tickets' })
  const opened = renderSupportEmail({ heading: 'New support ticket', reference: 'SUP-SYNTHETIC-124', subject: 'Quote export <question>',
    context: ['Category: technical', 'Requester: synthetic@example.invalid'], message: 'Please help with this synthetic export question.\nThe original text contains <markup> & symbols.' })
  const settings = { companyName: 'Oak & Linen Framing', companyEmail: 'studio@example.invalid', currencyCode: 'GBP', companyAddress: '24 Example Lane\nBristol',
    jobReadyMessageTemplate: 'Hello {{customerName}},\nYour order {{jobId}} is ready for collection from {{companyName}}.\n{{companyAddressLine1}}\n{{companyAddressLine2}}' }
  const invoice = { number: 'INV-SYNTHETIC-001', currencyCode: 'GBP', subtotal: 100, tax: 20, total: 120, status: 'Sent', payments: [{ amount: 30 }] }
  const drafts = {
    quote: documentDraft('quote', { ...invoice, number: 'Q-SYNTHETIC-001' }, 'Jamie Example', settings),
    invoice: documentDraft('invoice', invoice, 'Jamie Example', settings),
    'job-ready': jobReadyDraft({ refNo: 'JOB-SYNTHETIC-001', total: 120, currencyCode: 'GBP' }, 'Jamie Example', settings),
    'account-update': accountUpdateDraft('Jamie Example', [invoice], settings),
  }
  expect(update.html).toContain('SUP-SYNTHETIC-123')
  expect(opened.html).toContain('&lt;markup&gt; &amp; symbols.')
  const directory = process.env.FRAMERSAPP_EMAIL_REVIEW_DIR
  if (!directory) return
  if (!isAbsolute(directory) || resolve(directory) === process.cwd() || resolve(directory).startsWith(process.cwd() + sep)) throw new Error('Examples must be outside the repository')
  mkdirSync(directory, { recursive: true })
  for (const [name, email] of Object.entries({ 'support-update': update, 'support-new-ticket': opened })) {
    writeFileSync(join(directory, `${name}.html`), email.html)
    writeFileSync(join(directory, `${name}.txt`), email.text)
  }
  for (const [name, draft] of Object.entries(drafts)) writeFileSync(join(directory, `${name}-draft.txt`), `Subject: ${draft.subject}\n\n${draft.body}\n`)
})
