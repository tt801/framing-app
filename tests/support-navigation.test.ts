import { describe, expect, it } from 'vitest'
import { loginDestination, signInForSupport } from '../src/lib/supportNavigation'
import { readFileSync } from 'node:fs'

describe('support sign-in navigation', () => {
  it('sends unauthenticated support visitors to sign-in and back to support afterward', () => {
    expect(signInForSupport()).toBe('#/login?next=support')
    expect(loginDestination('#/login?next=support')).toBe('#/support')
    expect(loginDestination('#/login?next=https://example.invalid')).toBe('#/dashboard')
    expect(loginDestination('#/login')).toBe('#/dashboard')
  })

  it('public Contact Support links never request automatic ticket creation', () => {
    for (const path of ['../src/pages/WebsiteLanding.tsx', '../src/pages/BillingSuccess.tsx']) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      expect(source).toMatch(/href\s*[:=]\s*["']#\/support["']/)
      expect(source).not.toContain('auto=1')
    }
  })
})
