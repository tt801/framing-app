import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); mocks.createClient.mockReset() })

describe('admin browser credentials and API origin', () => {
  it('constructs browser auth only with public configuration, never the service-role key', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.invalid')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-test-key')
    vi.resetModules()
    await import('../src/lib/supabase')
    expect(mocks.createClient).toHaveBeenCalledWith('https://example.invalid', 'public-test-key')
    expect(JSON.stringify(mocks.createClient.mock.calls)).not.toContain('private-test-key')
  })

  it('uses same-origin platform API URLs with no API base configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    vi.stubEnv('VITE_PLATFORM_API_BASE', '')
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"companies":[]}' })
    vi.stubGlobal('fetch', fetch)
    vi.resetModules()
    const { getPlatformCompanies } = await import('../src/lib/api')
    await getPlatformCompanies()
    expect(fetch).toHaveBeenCalledWith('/api/platform/companies', expect.any(Object))
  })
})
