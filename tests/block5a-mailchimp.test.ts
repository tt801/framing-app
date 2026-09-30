import { describe, expect, it, vi } from 'vitest'

vi.mock('@/../api/lib/auth.js', () => ({ requireCompanyWriteAccess: vi.fn(async () => ({ userId: 'user-a', companyAccountId: 'company-a', role: 'owner' })) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { mailchimp_api_key: 'key', mailchimp_server: 'us1' }, error: null }) }) }) }) }) }))
process.env.SUPABASE_URL = 'http://local'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
import sendCampaign from '@/../api/automations/send-campaign'

describe('Block 5A Mailchimp launch guard', () => {
  it('rejects direct Mailchimp sends before provider access', async () => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider)
    const out: any = {}; const res: any = { status(code: number) { out.status = code; return this }, json(body: any) { out.body = body; return this } }
    await sendCampaign({ method: 'POST', headers: {}, body: { channel: 'mailchimp', message: 'hello', recipientEmails: ['a@test.local'] } } as any, res)
    expect(out.status).toBe(501); expect(out.body).toEqual({ success: false, error: 'External provider integrations are not available for the initial release' }); expect(provider).not.toHaveBeenCalled()
  })
})
