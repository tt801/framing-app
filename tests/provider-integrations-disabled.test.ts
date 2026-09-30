import { describe, expect, it, vi } from 'vitest'
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn(() => { throw new Error('Supabase client must not be created') }) }))
vi.mock('@supabase/supabase-js', () => ({ createClient }))
import sendCampaign from '@/../api/automations/send-campaign'
import sendReview from '@/../api/automations/send-review-request'
import sendFollowup from '@/../api/automations/send-quote-followup'
import subscribe from '@/../api/mailchimp/subscribe'

const unavailable = { success: false, error: 'External provider integrations are not available for the initial release' }
const handlers = [
  ['campaign', sendCampaign],
  ['review request', sendReview],
  ['quote follow-up', sendFollowup],
  ['Mailchimp subscribe', subscribe],
] as const

function response() {
  const out: { status?: number; body?: unknown } = {}
  return { out, res: {
    status(code: number) { out.status = code; return this },
    json(body: unknown) { out.body = body; return this },
  } }
}

describe('initial-release provider endpoint boundary', () => {
  for (const [name, handler] of handlers) {
    const invoke = handler as unknown as (req: unknown, res: unknown) => Promise<unknown>
    it(`${name} POST is unavailable without database or provider access`, async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('provider fetch must not run') })
      const previousUrl = process.env.SUPABASE_URL
      const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      try {
        const { out, res } = response()
        await invoke({ method: 'POST', headers: {}, body: { channel: 'email', message: 'test', email: 'test@example.com', audienceId: 'audience' } }, res)
        expect(out).toEqual({ status: 501, body: unavailable })
        expect(createClient).not.toHaveBeenCalled()
        expect(fetchSpy).not.toHaveBeenCalled()
      } finally {
        if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl
        if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey
        fetchSpy.mockRestore()
      }
    })
    it(`${name} unsupported method remains 405`, async () => {
      const { out, res } = response()
      await invoke({ method: 'GET', headers: {} }, res)
      expect(out.status).toBe(405)
    })
  }
})
