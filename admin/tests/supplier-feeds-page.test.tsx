// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import SupplierFeeds from '../src/pages/SupplierFeeds.js'
import { aggregateFeed, mapRun, mapCheck, mapReviewRow } from '../server/platform/supplierFeeds/operations.js'

vi.mock('@/lib/supabase', () => ({ getAccessToken: async () => 'operator-test-token' }))
const feedId = '11111111-1111-4111-8111-111111111111'
const runId = '22222222-2222-4222-8222-222222222222'
const source = { id: feedId, source_key: 'wessex-mouldings-xls', scope_key: 'mouldings', supplier_id: 'supplier', allows_authoritative_snapshots: true, supplier: { id: 'supplier', name: 'Wessex Mouldings', status: 'draft' } }
const rawRun = { id: runId, created_at: '2026-10-12T15:50:07Z', status: 'applied', mode: 'apply_requested', source_checksum: 'a'.repeat(64), plan_fingerprint: 'b'.repeat(64), completed_at: '2026-10-12T17:24:12Z', plan_counts: { create: 1194, update: 0, unchanged: 0, review: 0, reject: 0, potential_missing: 0, cost_changes: 0 } }
const feed = aggregateFeed(source, [], [rawRun], 1194)
const checks = [mapCheck({ id: 'synthetic', checked_at: '2026-10-13T10:00:00Z', status: 'fetch_error', source_url: 'https://verification.invalid/artifact', error_summary: 'Synthetic verification only' })]
function mockFetch(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    '/api/platform/supplier-feeds?offset=0': { feeds: [feed], offset: 0, hasMore: false },
    [`/api/platform/supplier-feeds?feedId=${feedId}`]: { feed, checks, runs: [mapRun(rawRun)], checksLimited: false, runsLimited: false, syntheticChecks: 1, syntheticRuns: 1 },
    [`/api/platform/supplier-feeds?feedId=${feedId}&runId=${runId}&offset=0`]: { run: mapRun(rawRun), offset: 0, hasMore: false, rows: [{ id: 'row', row_number: 1, source_product_key: 'WX1', description: 'Frame 1', proposed_action: 'create', validation_status: 'valid', ordinaryChanges: [], lifecycleChanges: [], assetChanges: [], costChange: false, errors: [], warnings: [] }] },
    ...overrides,
  }
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') throw new Error('Mutation forbidden')
    if (!(url in responses)) throw new Error(`Unexpected read: ${url}`)
    const value = responses[url]
    return { ok: !(value instanceof Error), status: value instanceof Error ? 403 : 200, text: async () => JSON.stringify(value instanceof Error ? { error: value.message } : value) }
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Supplier Feeds read-only operations UI', () => {
  it.each([true, false])('renders persisted cost evidence (new format=%s) without inventing legacy old values', async recorded => {
    const oldCost = { amount: '10', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-13T14:00:00Z' }
    const newCost = { ...oldCost, amount: '10.01', effectiveAt: '2026-10-13T15:00:00Z' }
    const review = mapReviewRow({ id: 'cost-row', proposed_action: 'update', apply_state: 'pending', validation_status: 'valid',
      proposed_product: { fields: { supplierDescription: 'UAT frame' }, cost: newCost }, proposed_diff: { costChange: true,
        ...(recorded ? { reviewEvidence: { version: 1, fields: [
          { field: 'cost', oldValue: { state: 'recorded', value: oldCost }, newValue: { state: 'recorded', value: newCost } },
          { field: 'fields.supplierDescription', oldValue: { state: 'recorded', value: 'Old frame' }, newValue: { state: 'recorded', value: 'New frame' } },
        ] } } : {}) }, currentCanonical: { wholesale_cost: 999 } })
    mockFetch({ [`/api/platform/supplier-feeds?feedId=${feedId}&runId=${runId}&offset=0`]: { run: mapRun({ ...rawRun, status: 'awaiting_approval', plan_counts: { ...rawRun.plan_counts, create: 0, update: 1, cost_changes: 1 } }), rows: [review], offset: 0, hasMore: false } })
    render(<SupplierFeeds />)
    fireEvent.click(await screen.findByRole('button', { name: 'wessex-mouldings-xls' }))
    fireEvent.click(await screen.findByRole('button', { name: `View run ${runId}` }))
    if (recorded) {
      expect(await screen.findByText('10.00 GBP/metre → 10.01 GBP/metre')).toBeTruthy()
      expect(screen.getByText('2026-10-13T14:00:00Z → 2026-10-13T15:00:00Z')).toBeTruthy()
      expect(screen.getByText('Old frame → New frame')).toBeTruthy()
    } else {
      expect(await screen.findByText('Proposed Supplier cost')).toBeTruthy()
      expect(screen.getByText('10.01 GBP/metre')).toBeTruthy()
      expect(screen.getAllByText('Previous value: Not persisted in this frozen plan').length).toBeGreaterThan(0)
      expect(screen.queryByText(/10\.00 GBP\/metre/)).toBeNull()
    }
    expect(screen.queryByText(/999/)).toBeNull()
  })
  it('navigates feed → history → real run → persisted plan using authorized GETs only', async () => {
    const fetch = mockFetch()
    render(<SupplierFeeds />)
    expect(screen.getByRole('status').textContent).toContain('Loading')
    fireEvent.click(await screen.findByRole('button', { name: 'wessex-mouldings-xls' }))
    expect(await screen.findByRole('heading', { name: 'Check History' })).toBeTruthy()
    expect(screen.getByText('Synthetic verification — excluded from operational summaries')).toBeTruthy()
    expect(screen.getAllByText('Never checked').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: `View run ${runId}` }))
    const plan = await screen.findByRole('region', { name: 'Change Plan' })
    expect(within(plan).getByText('1194')).toBeTruthy()
    for (const label of ['Create', 'Update', 'Unchanged', 'Review', 'Reject', 'Potential Missing', 'Cost Changes']) expect(within(plan).getByText(label)).toBeTruthy()
    expect(await screen.findByText('WX1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /approve|apply|retry|delete|edit|check now|fetch now|plan now/i })).toBeNull()
    expect(fetch.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true)
    expect(fetch.mock.calls.every(([, init]) => (init.headers as Record<string, string>).Authorization === 'Bearer operator-test-token')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Back to feeds' }))
    expect(await screen.findByRole('button', { name: 'wessex-mouldings-xls' })).toBeTruthy()
  })
  it('renders empty feed state', async () => {
    mockFetch({ '/api/platform/supplier-feeds?offset=0': { feeds: [], offset: 0, hasMore: false } })
    render(<SupplierFeeds />)
    expect(await screen.findByText('No configured supplier feeds.')).toBeTruthy()
  })
  it('renders an authorization/error state without displaying stale data', async () => {
    mockFetch({ '/api/platform/supplier-feeds?offset=0': new Error('You do not have platform admin access') })
    render(<SupplierFeeds />)
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have platform admin access')
    expect(screen.queryByText('Wessex Mouldings')).toBeNull()
  })
  it('renders empty check, run and missing release states', async () => {
    mockFetch({ [`/api/platform/supplier-feeds?feedId=${feedId}`]: { feed: { ...feed, latestRun: null, latestRelease: null }, checks: [], runs: [], syntheticChecks: 0, syntheticRuns: 0 } })
    render(<SupplierFeeds />)
    fireEvent.click(await screen.findByRole('button', { name: 'wessex-mouldings-xls' }))
    expect(await screen.findByText('No checks recorded.')).toBeTruthy()
    expect(screen.getByText('No operational Block2E runs recorded.')).toBeTruthy()
    expect(screen.getByText('No successful release evidence.')).toBeTruthy()
  })
  it('surfaces feed and run read errors', async () => {
    mockFetch({ [`/api/platform/supplier-feeds?feedId=${feedId}`]: new Error('Unable to load supplier feed operations') })
    render(<SupplierFeeds />)
    fireEvent.click(await screen.findByRole('button', { name: 'wessex-mouldings-xls' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Unable to load')
    cleanup()
    mockFetch({ [`/api/platform/supplier-feeds?feedId=${feedId}&runId=${runId}&offset=0`]: new Error('Run not found') })
    render(<SupplierFeeds />)
    fireEvent.click(await screen.findByRole('button', { name: 'wessex-mouldings-xls' }))
    fireEvent.click(await screen.findByRole('button', { name: `View run ${runId}` }))
    expect((await screen.findByRole('alert')).textContent).toBe('Run not found')
  })
  it('paginates feeds and review rows through reads', async () => {
    const fetch = mockFetch({ '/api/platform/supplier-feeds?offset=0': { feeds: [feed], offset: 0, hasMore: true }, '/api/platform/supplier-feeds?offset=25': { feeds: [], offset: 25, hasMore: false }, [`/api/platform/supplier-feeds?feedId=${feedId}&runId=${runId}&offset=0`]: { run: mapRun(rawRun), rows: [], offset: 0, hasMore: true }, [`/api/platform/supplier-feeds?feedId=${feedId}&runId=${runId}&offset=50`]: { run: mapRun(rawRun), rows: [], offset: 50, hasMore: false } })
    render(<SupplierFeeds />)
    fireEvent.click(await screen.findByRole('button', { name: 'Next feeds' }))
    expect(await screen.findByText('No configured supplier feeds.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous feeds' }))
    fireEvent.click(await screen.findByRole('button', { name: 'wessex-mouldings-xls' }))
    fireEvent.click(await screen.findByRole('button', { name: `View run ${runId}` }))
    fireEvent.click(await screen.findByRole('button', { name: 'Next rows' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/platform/supplier-feeds?feedId=${feedId}&runId=${runId}&offset=50`, expect.any(Object)))
    expect(await screen.findByText('No staged rows on this page.')).toBeTruthy()
  })
})
