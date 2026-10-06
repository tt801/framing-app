import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), sendSupportEmail: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }) }))
vi.mock('../api/lib/notifications.js', () => ({ getSupportNotificationRecipients: () => [], sendSupportEmail: mocks.sendSupportEmail }))
import tickets from '../api/support/tickets'
import comments from '../api/support/ticket-comments'

const companyA = '11111111-1111-4111-8111-111111111111'
const companyB = '22222222-2222-4222-8222-222222222222'
const ticketA = '33333333-3333-4333-8333-333333333333'
const ticketB = '44444444-4444-4444-8444-444444444444'
type Row = Record<string, unknown>
function setupDb(userId = 'user-a', members: Row[] = []) {
  const rows: Record<string, Row[]> = {
    company_accounts: [{ id: companyA, owner_user_id: 'user-a' }, { id: companyB, owner_user_id: 'user-b' }],
    company_members: members,
    support_tickets: [
      { id: ticketA, company_account_id: companyA, ticket_number: 'SUP-A', subject: 'My ticket', message: 'Help me', status: 'open' },
      { id: ticketB, company_account_id: companyB, ticket_number: 'SUP-B', subject: 'Other company', message: 'Private', status: 'open' },
    ],
    support_ticket_comments: [
      { id: 'public-admin', ticket_id: ticketA, visibility: 'customer', body: 'Admin reply', author_name: 'Support team', author_user_id: 'admin' },
      { id: 'private-admin', ticket_id: ticketA, visibility: 'internal', body: 'Private investigation', author_name: 'Support team' },
      { id: 'foreign-reply', ticket_id: ticketB, visibility: 'customer', body: 'Other company reply' },
    ],
  }
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email: `${userId}@example.invalid`, user_metadata: { full_name: 'Customer' } } }, error: null })
  mocks.from.mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = []
    let inserted: Row | null = null
    const matching = () => rows[table].filter(row => filters.every(([key, value]) => row[key] === value))
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      insert: (row: Row) => { inserted = row; return q },
      single: async () => {
        const record = { id: `created-${table}`, ...inserted }
        rows[table].push(record)
        return { data: record, error: null }
      },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: matching(), error: null }).then(resolve),
    }
    return q
  })
  return rows
}

function request(method: string, token?: string, body?: object, query: Record<string, string> = {}) {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body, query } as unknown as VercelRequest
}
function response() {
  const result: { status?: number; body: { ticket: Row; tickets: Row[]; comments: Row[] } } = { body: { ticket: {}, tickets: [], comments: [] } }
  const res = {
    status: vi.fn((code: number) => { result.status = code; return res }),
    json: vi.fn((body: unknown) => { result.body = body as typeof result.body; return res }),
    end: vi.fn(),
  } as unknown as VercelResponse
  return { res, result }
}

beforeEach(() => {
  mocks.getUser.mockReset()
  mocks.from.mockReset()
  mocks.sendSupportEmail.mockReset().mockResolvedValue(undefined)
})

describe('customer support API', () => {
  it('rejects an unauthenticated ticket creation before any database write', async () => {
    const { res, result } = response()
    await tickets(request('POST', undefined, { subject: 'Help', message: 'Cannot sign in' }), res)
    expect(result.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects an expired bearer token for ticket access', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') })
    const { res, result } = response()
    await tickets(request('GET', 'expired-token'), res)
    expect(result.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects comment operations when active company access is absent', async () => {
    setupDb('stranger')
    for (const method of ['GET', 'POST']) {
      const { res, result } = response()
      await comments(request(method, 'valid-token', { ticketId: ticketA, body: 'Hello' }, { ticketId: ticketA }), res)
      expect(result.status).toBe(403)
    }
    expect(mocks.from).not.toHaveBeenCalledWith('support_ticket_comments')
  })

  it('rejects an unauthenticated comment read', async () => {
    const { res, result } = response()
    await comments(request('GET', undefined, undefined, { ticketId: '11111111-1111-4111-8111-111111111111' }), res)
    expect(result.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('creates a ticket for the authenticated owner without trusting forged identity or priority', async () => {
    const rows = setupDb()
    const { res, result } = response()
    await tickets(request('POST', 'valid-token', {
      subject: ' Login issue ', message: ' Please help ', category: 'account',
      company_account_id: companyB, requester_user_id: 'user-b', requesterEmail: 'impostor@example.invalid',
      priority: 'urgent', source: 'forged',
    }), res)
    expect(result.status).toBe(200)
    expect(result.body.ticket.ticket_number).toMatch(/^SUP-/)
    expect(rows.support_tickets.at(-1)).toMatchObject({
      company_account_id: companyA, requester_user_id: 'user-a', requester_email: 'user-a@example.invalid',
      subject: 'Login issue', message: 'Please help', category: 'account', priority: 'normal', source: 'customer_app',
    })
    expect(mocks.getUser).toHaveBeenCalledWith('valid-token')
  })

  it('rejects valid users without an owned company or active membership', async () => {
    setupDb('stranger', [{ company_account_id: companyA, user_id: 'stranger', status: 'inactive' }])
    const { res, result } = response()
    await tickets(request('POST', 'valid-token', { subject: 'Help', message: 'Cannot sign in' }), res)
    expect(result.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalledWith('support_tickets')
  })

  it('allows an active member and lists only their company tickets', async () => {
    setupDb('member-a', [{ company_account_id: companyA, user_id: 'member-a', status: 'active' }])
    const { res, result } = response()
    await tickets(request('GET', 'valid-token'), res)
    expect(result.status).toBe(200)
    expect(result.body.tickets.map((t: Row) => t.id)).toEqual([ticketA])
  })

  it('retrieves own-company ticket detail but not another company ticket', async () => {
    setupDb()
    const own = response()
    await tickets(request('GET', 'valid-token', undefined, { ticketId: ticketA }), own.res)
    expect(own.result.body.ticket.id).toBe(ticketA)
    const foreign = response()
    await tickets(request('GET', 'valid-token', undefined, { ticketId: ticketB }), foreign.res)
    expect(foreign.result.status).toBe(404)
  })

  it('returns Admin public replies but never internal notes', async () => {
    setupDb()
    const { res, result } = response()
    await comments(request('GET', 'valid-token', undefined, { ticketId: ticketA }), res)
    expect(result.status).toBe(200)
    expect(result.body.comments.map((c: Row) => c.body)).toEqual(['Admin reply'])
  })

  it('rejects cross-company comment reads and replies', async () => {
    setupDb()
    for (const method of ['GET', 'POST']) {
      const { res, result } = response()
      await comments(request(method, 'valid-token', { ticketId: ticketB, body: 'Intrusion' }, { ticketId: ticketB }), res)
      expect(result.status).toBe(404)
    }
  })

  it('writes customer replies with verified identity and forced customer visibility', async () => {
    const rows = setupDb()
    const { res, result } = response()
    await comments(request('POST', 'valid-token', { ticketId: ticketA, body: ' More details ', visibility: 'internal', author_user_id: 'admin', company_account_id: companyB }), res)
    expect(result.status).toBe(200)
    expect(rows.support_ticket_comments.at(-1)).toMatchObject({
      ticket_id: ticketA, company_account_id: companyA, author_user_id: 'user-a',
      author_email: 'user-a@example.invalid', visibility: 'customer', body: 'More details',
    })
  })
})
