import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  readOnly: false,
  migrate: vi.fn(), count: vi.fn(() => 2), write: vi.fn(),
  quotes: [{ id: 'q1', customerId: 'c1', items: [], subtotal: 0, total: 0, status: 'Draft' }],
  jobs: [{ id: 'j1', refNo: 1001, createdAt: '2026-09-01', status: 'new', customer: {}, artwork: {}, frame: {}, checklist: [] }],
  invoices: [{ id: 'i1', number: 'INV-1', createdAt: '2026-09-01', items: [], subtotal: 0, total: 0, payments: [] }],
  customers: [{ id: 'c1', firstName: 'Saved', lastName: 'Customer', email: 'saved@example.invalid' }],
  events: [{ id: 'e1', title: 'Saved event', type: 'appointment', start: '2026-09-15T09:00:00.000Z' }],
  presets: [{ id: 'p1', name: 'Saved preset', state: {}, createdAt: 1, revision: 1 }],
  campaigns: [{ id: 'm1', revision: 1, payload: { name: 'Saved campaign', targetAudience: 'all', channel: 'email', enabled: false } }],
  catalog: { settings: { companyName: 'Current company', currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 0 }, frames: [], mats: [], glazing: [], printingMaterials: [], backers: [] },
}))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: state.quotes, add: state.write, update: state.write, remove: state.write, getLegacyLocalQuoteCount: state.count, importLegacyLocalQuotes: state.migrate }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ jobs: state.jobs, companyAccountId: 'company-a', readOnly: state.readOnly, createIntake: state.write, updateDetails: state.write, getLegacyLocalJobCount: state.count, importLegacyLocalJobs: state.migrate }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ invoices: state.invoices, addInvoice: state.write, updateInvoice: state.write, addPayment: state.write, getLegacyLocalInvoiceCount: state.count, importLegacyLocalInvoices: state.migrate }) }))
vi.mock('@/lib/customers', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/customers')>(), useCustomers: () => ({ customers: state.customers, add: state.write, update: state.write, remove: state.write, getLegacyLocalCustomerCount: state.count, importLegacyLocalCustomers: state.migrate }) }))
vi.mock('@/lib/calendar', () => ({ useCalendar: () => ({ events: state.events, addEvent: state.write, updateEvent: state.write, deleteEvent: state.write, getLegacyCalendarEventCount: state.count, importLegacy: state.migrate }) }))
vi.mock('@/lib/presets', () => ({ useCompanyPresets: () => ({ presets: state.presets, save: state.write, remove: state.write, legacyCount: 2, importLegacy: state.migrate }) }))
vi.mock('@/lib/marketingData', () => ({ useCompanyMarketingData: () => ({ campaigns: state.campaigns, templates: [], records: [], submissionLogs: [], save: state.write, update: state.write, remove: state.write, recordSubmission: state.write, legacyCount: 2, importLegacy: state.migrate }) }))
vi.mock('@/lib/store', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/store')>(), useCatalog: () => ({ catalog: state.catalog, setCatalog: state.write, saveSettings: state.write, legacyCatalogPreview: { frameCount: 2 }, legacySettingsPreview: { company: { companyName: 'Legacy company' }, catalogSettings: {}, conflicts: [] }, importLegacyCatalog: state.migrate, importLegacySettings: state.migrate }) }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ companyAccountId: 'company-a', companyName: 'Current company', readOnly: state.readOnly }) }))
vi.mock('@/lib/supabase', () => ({ supabase: null, getAccessToken: vi.fn() }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ add: vi.fn() }) }))
vi.mock('@/lib/history', () => ({ useHistory: () => ({ add: vi.fn(), canUndo: () => false, undo: vi.fn() }) }))
vi.mock('react-big-calendar', () => ({ Calendar: ({ events }: any) => <div>{events.map((event: any) => <div key={event.id}>{event.title}</div>)}</div>, Views: { WEEK: 'week', MONTH: 'month', DAY: 'day' }, dateFnsLocalizer: () => ({}) }))
vi.mock('react-big-calendar/lib/addons/dragAndDrop', () => ({ default: (Component: any) => Component }))

import Quotes from '@/pages/Quotes'
import Jobs from '@/pages/Jobs'
import Invoices from '@/pages/Invoices'
import Customers from '@/pages/Customers'
import Calendar from '@/pages/Calendar'
import PresetControls from '@/components/PresetControls'
import Marketing from '@/pages/Marketing'
import Admin from '@/pages/Admin'
import Stock from '@/pages/Stock'

const legacy = {
  quotes_v1: '[{"id":"legacy-quote","items":[]}]',
  jobs_v1: '[{"id":"legacy-job","refNo":42}]',
  invoices_v1: '[{"id":"legacy-invoice","number":"OLD-1"}]',
  customers_v1: '[{"id":"legacy-customer","firstName":"Legacy"}]',
  frameit_calendar_events_v1: '[{"id":"legacy-event","title":"Legacy"}]',
  frameit_presets_v1_c1: '[{"id":"legacy-preset","name":"Legacy","state":{}}]',
  'marketing.campaigns.v1': '[{"id":"legacy-campaign"}]',
  'marketing.templates.v1': '[{"id":"legacy-template"}]',
  'marketing.template.sends.v1': '[{"id":"legacy-send"}]',
  'frameit.company': '{"companyName":"Legacy company"}',
  framing_app_catalog_v1: '{"frames":[{"id":"legacy-frame"}],"settings":{"companyName":"Legacy company"}}',
}
const persisted = () => JSON.stringify([state.quotes, state.jobs, state.invoices, state.customers, state.events, state.presets, state.campaigns, state.catalog])
const presetProps = { companyName: 'Current company', customerKey: 'c1', hasSavedCustomer: true, ensureCustomerId: vi.fn(), currentState: {}, onApply: vi.fn() }
const pages = [
  ['Quotes', () => <Quotes />], ['Jobs', () => <Jobs />], ['Invoices', () => <Invoices />],
  ['Customers', () => <Customers />], ['Calendar', () => <Calendar />],
  ['Presets', () => <PresetControls {...presetProps} />], ['Marketing', () => <Marketing />], ['Admin', () => <Admin />],
] as const

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  for (const [key, value] of Object.entries(legacy)) localStorage.setItem(key, value)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  window.location.hash = ''
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

it.each(pages)('%s has no browser migration entrypoint with legacy data, including after remount', (name, page) => {
  const before = persisted()
  for (const readOnly of [false, true]) {
    state.readOnly = readOnly
    const view = render(page())
    if (name === 'Customers') {
      fireEvent.click(screen.getByRole('button', { name: /^import customers$/i }))
      expect(screen.getByRole('button', { name: 'Import CSV' })).toBeTruthy()
    }
    if (name === 'Presets') fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    if (name === 'Admin') {
      fireEvent.click(screen.getByRole('button', { name: 'Company' }))
      expect(screen.getByRole('button', { name: 'Save company settings' })).toBeTruthy()
      expect(screen.queryByText('Legacy browser settings found.')).toBeNull()
    }
    expect(screen.queryAllByRole('button', { name: /import (saved|legacy)|import preview/i })).toHaveLength(0)
    expect(screen.queryAllByRole('link', { name: /import (saved|legacy)|import preview/i })).toHaveLength(0)
    expect(state.migrate).not.toHaveBeenCalled()
    expect(state.count).not.toHaveBeenCalled()
    expect(state.write).not.toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
    expect(persisted()).toBe(before)
    for (const [key, value] of Object.entries(legacy)) expect(localStorage.getItem(key), key).toBe(value)
    view.unmount()
  }
})

it('has no alternate migration controls or invocations in customer page/component source', () => {
  const sources = import.meta.glob<string>('../src/{pages,components}/**/*.tsx', { query: '?raw', import: 'default', eager: true })
  expect(Object.keys(sources).length).toBeGreaterThan(8)
  for (const [path, source] of Object.entries(sources)) {
    expect(source, path).not.toMatch(/Import saved (quotes|jobs|invoices|browser customers)|Import legacy (events|presets|marketing data|catalog)|Import preview/)
    expect(source, path).not.toMatch(/importLegacyLocal\w*\s*\(|\.importLegacy\s*\(|handleImportLegacy|importLegacyJobs|importLegacyInvoices|importPresets/)
  }
})

it('keeps the genuine Stock CSV import control connected to its file picker', () => {
  const view = render(<Stock />)
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
  expect(input.accept).toBe('.csv,text/csv')
  const click = vi.spyOn(input, 'click')
  fireEvent.click(screen.getByRole('button', { name: /Import CSV/ }))
  expect(click).toHaveBeenCalledOnce()
  expect(state.migrate).not.toHaveBeenCalled()
})
