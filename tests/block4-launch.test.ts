import { describe, expect, it, vi, beforeEach } from 'vitest'
import quickbooks from '@/../api/integrations/quickbooks'
import xero from '@/../api/integrations/xero'
import scheduled from '@/../api/automations/scheduled-check'
import room from '@/../api/api/generate-room'

vi.mock('@/../api/lib/auth.js', () => ({ requireActiveTrialUserId: vi.fn(async () => 'user-a') }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { microsoft_client_id: 'id', microsoft_client_secret: 'secret', outlook_from_email: 'from@test.local' }, error: null }) }) }) }) }) }))
import sendCampaign from '@/../api/automations/send-campaign'
process.env.SUPABASE_URL = 'http://local'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'

const response = () => { const out: any = {}; return { out, status(code: number) { out.status = code; return this }, json(body: any) { out.body = body; return this } } as any }

describe('Block 4 launch safety', () => {
  beforeEach(() => { process.env.CRON_SECRET = 'cron-test' })

  it('does not report accounting sync or scheduled automation success', async () => {
    const qb = response(); await quickbooks({ method: 'POST', query: { integrationAction: 'sync' }, body: { invoices: [{}] } } as any, qb)
    const xe = response(); await xero({ method: 'POST', query: { integrationAction: 'sync' }, body: { invoices: [{}] } } as any, xe)
    const cron = response(); await scheduled({ method: 'GET', headers: { authorization: 'Bearer cron-test' } } as any, cron)
    expect(qb.out.status).toBe(501); expect(qb.out.body.ok).toBe(false)
    expect(xe.out.status).toBe(501); expect(xe.out.body.ok).toBe(false)
    expect(cron.out.status).toBe(501); expect(cron.out.body.success).toBe(false)
  })

  it('returns a non-success response for the unfinished remote room route', async () => {
    const result = await room(new Request('http://local/api/api/generate-room', { method: 'POST', body: '{}' }))
    expect(result.status).toBe(501)
    expect(await result.json()).toMatchObject({ error: 'AI room generation is not available yet' })
  })

  it('rejects manual Outlook delivery without contacting a provider', async () => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider)
    const result = response()
    await sendCampaign({ method: 'POST', headers: {}, body: { channel: 'email', messageTemplate: 'Normalized body', campaignName: 'Manual', recipientEmails: ['a@test.local'] } } as any, result)
    expect(result.out).toMatchObject({ status: 501, body: { success: false, error: 'External provider integrations are not available for the initial release' } })
    expect(provider).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
