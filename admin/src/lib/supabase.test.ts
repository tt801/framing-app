// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: {} })) }))

afterEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.resetModules()
})

describe('Admin recovery callback detection', () => {
  it('captures a recovery callback before Supabase clears its URL, surviving a refresh until explicitly cleared', async () => {
    window.history.replaceState(null, '', '/#type=recovery&access_token=test-token')
    vi.resetModules()
    const first = await import('./supabase')
    expect(first.isRecoveryCallback).toBe(true)

    window.history.replaceState(null, '', '/')
    vi.resetModules()
    const refreshed = await import('./supabase')
    expect(refreshed.isRecoveryCallback).toBe(true)

    refreshed.clearRecoveryCallback()
    vi.resetModules()
    const afterSignOut = await import('./supabase')
    expect(afterSignOut.isRecoveryCallback).toBe(false)
  })
})
