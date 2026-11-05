import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const state = vi.hoisted(() => ({ send: vi.fn(), ticketCompany: 'company-a', authenticated: true, fail: false }))
vi.mock('../api/lib/notifications.js', () => ({ getSupportNotificationRecipients: () => ['support@example.invalid', 'support@example.invalid'], sendSupportEmail: state.send }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: 'owner', email: 'owner@example.invalid' } : null } }) },
  from: (table: string) => {
    let columns = '*'; const filters: Record<string, unknown> = {}; let insert: Record<string, unknown> = {}
    const q = {
      select: (value: string) => { columns = value; return q },
      eq: (key: string, value: unknown) => { filters[key] = value; return q },
      insert: (value: Record<string, unknown>) => { insert = value; return q },
      maybeSingle: async () => {
        if (table === 'company_accounts') return { data: { id: 'company-a' } }
        const row = { id: 'ticket-a', company_account_id: state.ticketCompany, ticket_number: 'SUP-123', subject: 'Mount <advice>', requester_email: 'customer@example.invalid' }
        if (filters.company_account_id !== state.ticketCompany) return { data: null }
        return { data: Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, row[key as keyof typeof row]])) }
      },
      single: async () => ({ data: { id: 'comment-a', ...insert } }),
    }
    return q
  },
}) }))
import handler from '../api/admin/ticket-comments'

async function post(visibility: string) {
  const result = { status: 0 }; const res = { status: (value: number) => { result.status = value; return res }, json: vi.fn(), end: vi.fn() }
  await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: { ticketId: 'ticket-a', body: 'Keep <original> edges & mount.', visibility } } as VercelRequest, res as unknown as VercelResponse)
  return result
}
beforeEach(() => { state.ticketCompany = 'company-a'; state.authenticated = true; state.send.mockReset().mockResolvedValue({}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
describe('existing support comment notifications', () => {
  it('uses selected saved ticket fields and adds the requester only for a public comment', async () => {
    expect((await post('customer')).status).toBe(200)
    const email = state.send.mock.calls[0][0]
    expect(email.to).toEqual(['support@example.invalid', 'customer@example.invalid'])
    expect(email.subject).toContain('SUP-123: Mount <advice>')
    expect(email.text).toContain('Keep <original> edges & mount.')
    expect(email.html).toContain('Keep &lt;original&gt; edges &amp; mount.')
    expect(email.html).toContain('View support tickets')
    expect(email.subject).not.toContain('undefined')
  })
  it.each(['internal', 'unexpected'])('never includes requester for %s visibility', async visibility => {
    expect((await post(visibility)).status).toBe(200)
    expect(state.send.mock.calls[0][0].to).toEqual(['support@example.invalid'])
    expect(state.send.mock.calls[0][0].html).toContain('Internal support comment')
    expect(state.send.mock.calls[0][0].html).not.toContain('View support tickets')
  })
  it('does not notify on a cross-company ticket', async () => {
    state.ticketCompany = 'company-b'
    expect((await post('customer')).status).toBe(400)
    expect(state.send).not.toHaveBeenCalled()
  })
  it('preserves a saved comment when the notification fails', async () => {
    state.send.mockRejectedValue(new Error('Synthetic rejection'))
    expect((await post('customer')).status).toBe(200)
  })
})
