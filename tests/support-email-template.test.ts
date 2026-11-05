import { afterEach, expect, it, vi } from 'vitest'
import { renderSupportEmail } from '../api/lib/emailTemplates'
import { sendSupportEmail } from '../api/lib/notifications'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('renders equivalent escaped HTML and plain text without an inbound-reply promise', () => {
  const email = renderSupportEmail({ heading: 'New support ticket', reference: 'SUP-123', subject: 'Mount <advice>',
    context: ['Category: technical', 'Requester: synthetic@example.invalid'], message: '<img src=x onerror=alert(1)> & original\nSecond line',
    ticketUrl: 'https://preview.example.invalid/#/support?view=tickets' })
  expect(email.text).toContain('Ticket: SUP-123')
  expect(email.text).toContain('Mount <advice>')
  expect(email.text).toContain('Second line')
  expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; original')
  expect(email.html).not.toContain('<img src=x')
  expect(email.html).toContain('max-width:600px')
  expect(email.html).toContain('View support tickets')
  expect(email.text).toContain('Sign in')
  expect(email.text).toContain('Replies to this email do not update your ticket')
  expect(renderSupportEmail({ heading: 'Internal comment', reference: 'SUP-1', subject: 'Test', message: 'Body', ticketUrl: 'javascript:alert(1)' }).html).not.toContain('href=')
})
it('preserves configured sender and sends individually without disclosing other recipients', async () => {
  vi.stubEnv('RESEND_API_KEY', 'synthetic-test-only'); vi.stubEnv('SUPPORT_FROM_EMAIL', 'FramersApp Support <support@example.invalid>')
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'synthetic' }) }))
  vi.stubGlobal('fetch', fetch)
  await sendSupportEmail({ to: ['support@example.invalid', 'customer@example.invalid', 'support@example.invalid'], subject: 'SUP-123', text: 'Text', html: '<p>Text</p>' })
  expect(fetch).toHaveBeenCalledTimes(2)
  const payloads = fetch.mock.calls.map(call => JSON.parse((call as unknown as [string, RequestInit])[1].body as string))
  expect(payloads.map(p => p.to)).toEqual([['support@example.invalid'], ['customer@example.invalid']])
  expect(payloads[0]).toMatchObject({ from: 'FramersApp Support <support@example.invalid>', text: 'Text', html: '<p>Text</p>' })
})
it('does not contact the provider without credentials', async () => {
  vi.stubEnv('RESEND_API_KEY', ''); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await sendSupportEmail({ to: 'synthetic@example.invalid', subject: 'Test', text: 'Test' })).toEqual({ skipped: true })
  expect(fetch).not.toHaveBeenCalled()
})
it('reports provider failure without exposing provider response content', async () => {
  vi.stubEnv('RESEND_API_KEY', 'synthetic-test-only'); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => 'private provider detail' })))
  await expect(sendSupportEmail({ to: 'synthetic@example.invalid', subject: 'Test', text: 'Test' })).rejects.toThrow('Support email could not be submitted')
})
