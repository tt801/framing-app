import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import appSource from '../src/App.tsx?raw'
import adminSource from '../src/pages/Admin.tsx?raw'
import billingSource from '../src/pages/Billing.tsx?raw'
import landingSource from '../src/pages/WebsiteLanding.tsx?raw'
import marketingSource from '../src/pages/Marketing.tsx?raw'

const { calls } = vi.hoisted(() => ({ calls: { fetch: vi.fn(), record: vi.fn(), save: vi.fn() } }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [] }) }))
vi.mock('@/lib/customers', () => ({ useCustomers: () => ({ customers: [] }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: [] }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: vi.fn() }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false, undo: vi.fn() }) }))
vi.mock('@/lib/supabase', () => ({ getAccessToken: vi.fn(async () => 'token') }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ companyAccountId: 'company-a', companyName: 'Company A' }) }))
vi.mock('@/lib/marketingData', () => ({ useCompanyMarketingData: () => ({
  campaigns: [{ id: 'old', revision: 1, payload: { name: 'Old campaign', description: '', targetAudience: 'all', channel: 'email', messageTemplate: 'Hi', enabled: true } }],
  templates: [], records: [], submissionLogs: [], templateSends: [], loading: false,
  save: calls.save, update: vi.fn(), remove: vi.fn(), recordSubmission: calls.record,
  importLegacy: vi.fn(), legacyCount: vi.fn(() => 0),
}) }))
import MarketingPage from '@/pages/Marketing'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
})

describe('initial-release UI does not expose credential management', () => {
  it('does not claim live provider automation or delivered marketing messages', () => {
    for (const claim of ['Active Automations', '8 sent this month', '14 sent this month', 'Recover quiet quotes automatically', 'Replace manual follow-ups with triggers', 'Quote reminders via WhatsApp', 'Seasonal promotions on schedule', 'Track opens, clicks, and re-bookings']) {
      expect(landingSource).not.toContain(claim)
    }
    for (const claim of ['Track which customers received which templates and when.', 'Template Send History', 'No template sends yet', '✓ Sent', 'Showing latest 20 of {templateSends.length} sends']) {
      expect(marketingSource.includes(claim), claim).toBe(false)
    }
  })
  it('does not mount API Settings from a direct hash route or Admin', () => {
    expect(appSource).not.toContain('import("./pages/APISettings")')
    expect(appSource).not.toContain('<APISettingsPage')
    expect(adminSource).not.toContain('<APISettingsPage')
  })
  it('does not link to API Settings from Billing', () => {
    expect(billingSource).not.toContain('#/api-settings')
  })
  it('keeps Marketing drafting and copying but disables sends despite legacy settings', () => {
    localStorage.setItem('marketing.automation.settings.v1', JSON.stringify({ enabled: true, channel: 'email' }))
    calls.fetch.mockClear(); calls.record.mockClear()
    vi.stubGlobal('fetch', calls.fetch)
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<MarketingPage />)
    expect(screen.getByText('Old campaign')).toBeTruthy()
    expect(screen.getByRole('button', { name: /add campaign/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /export lapsed customers csv/i })).toBeTruthy()
    expect(screen.getByText(/Communication templates library/)).toBeTruthy()
    expect(screen.getAllByText('Copy').length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('button', { name: /send now|send email|send whatsapp|test review|test follow-up/i })).toHaveLength(0)
    expect(screen.queryByRole('checkbox', { name: /enabled|automation/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /add campaign/i }))
    expect(screen.getByText('Campaign Name *')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Copy')[0])
    expect(writeText).toHaveBeenCalled()
    expect(calls.fetch).not.toHaveBeenCalled()
    expect(calls.record).not.toHaveBeenCalled()
    localStorage.removeItem('marketing.automation.settings.v1')
  })
})
