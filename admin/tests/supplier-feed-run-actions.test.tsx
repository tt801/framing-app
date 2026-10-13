// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RunActions } from '../src/pages/SupplierFeedRunActions.js'
import SupplierFeeds from '../src/pages/SupplierFeeds.js'
import { deriveRunControl } from '../server/platform/supplierFeeds/control.js'
import { mapRun, aggregateFeed } from '../server/platform/supplierFeeds/operations.js'
import type { RunDetail } from '../src/lib/supplierFeedTypes.js'

vi.mock('@/lib/supabase', () => ({ getAccessToken: async () => 'operator-test-token' }))
const raw: any = { id: '22222222-2222-4222-8222-222222222222', supplier_id: 'supplier', feed_source_id: 'feed', scope_key: 'mouldings', persistence_version: 2,
  status: 'awaiting_approval', mode: 'apply_requested', adapter_id: 'wessex-wpp4-mouldings', adapter_version: '2', planner_version: 'planner-1',
  logical_run_key: 'real-release', artifact_ref: '/artifact/file.xls', source_checksum: 'a'.repeat(64), plan_fingerprint: 'b'.repeat(64),
  policy_snapshot: {}, anomaly_flags: ['creates'], plan_counts: { create: 1, update: 0, unchanged: 0, review: 0, reject: 0, potential_missing: 0, cost_changes: 0 },
  row_count: 1, acquisition_complete: true, parsing_complete: true, apply_disposition: 'retryable' }
const progress = { total: 1, version2: 1, pending: 1, applied: 0, skipped: 0, failed: 0, conflict: 0 }
function detail(overrides: any = {}, counters: any = {}): RunDetail {
  const run = { ...raw, ...overrides }
  return { run: mapRun(run), control: deriveRunControl(run, { ...progress, ...counters }), rows: [], offset: 0, hasMore: false }
}
const approved = { status: 'approved', approved_by: 'actor', approved_at: '2026-10-13', approved_plan_fingerprint: raw.plan_fingerprint, acknowledged_anomalies: ['creates'] }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('controlled run actions UI', () => {
  it('identifies approval in progress and prevents repeated confirmation', async () => {
    let resolve!: (value: any) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r })))
    render(<RunActions supplierFeed="Wessex" detail={detail()} onChange={vi.fn()} refresh={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }))
    expect((await screen.findByRole('status')).textContent).toBe('Recording approval...')
    expect((screen.getByRole('button', { name: 'Approve plan' }) as HTMLButtonElement).disabled).toBe(true)
    resolve({ ok: true, text: async () => JSON.stringify({ detail: detail(approved), outcome: 'approved', processed: 0 }) })
    await screen.findByText('Approval recorded. Canonical changes have not been applied.')
  })
  it('does not claim approval success for an inconsistent authoritative response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ detail: detail(), outcome: 'approved', processed: 0 }) })))
    render(<RunActions supplierFeed="Wessex" detail={detail()} onChange={vi.fn()} refresh={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }))
    expect((await screen.findByRole('alert')).textContent).toContain('not confirmed')
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull()
  })
  it('does not claim changes are unapplied if another operator has already applied the approved run', async () => {
    const applied = detail({ ...approved, status: 'applied' }, { applied: 1, pending: 0 })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ detail: applied, outcome: 'approved', processed: 0 }) })))
    render(<RunActions supplierFeed="Wessex" detail={detail()} onChange={vi.fn()} refresh={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }))
    await screen.findByText('Approval recorded. Current persisted run state: applied.')
    expect(screen.queryByText('Approval recorded. Canonical changes have not been applied.')).toBeNull()
  })
  it('extends the existing feed/run detail view with server-authorized controls', async () => {
    const feed = aggregateFeed({ id: 'feed', supplier_id: 'supplier', source_key: 'wessex', scope_key: 'mouldings', supplier: { id: 'supplier', name: 'Wessex', status: 'draft' } }, [], [raw], 0)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, text: async () => JSON.stringify(url.includes('runId=') ? detail() : url.includes('feedId=') ? { feed, checks: [], runs: [mapRun(raw)], syntheticChecks: 0, syntheticRuns: 0 } : { feeds: [feed] }) })))
    render(<SupplierFeeds />)
    fireEvent.click(await screen.findByRole('button', { name: 'wessex' }))
    fireEvent.click(await screen.findByRole('button', { name: `View run ${raw.id}` }))
    expect(await screen.findByRole('button', { name: 'Approve plan' })).toBeTruthy()
  })
  it.each([
    [detail({ mode: 'dry_run' }), null],
    [detail({ adapter_id: 'phase5b-synthetic-verification' }), null],
    [detail({ ...approved, status: 'applied' }, { pending: 0, applied: 1 }), null],
    [detail({ ...approved, status: 'applying' }), 'Continue apply'],
    [detail({ ...approved, status: 'partially_applied' }), 'Continue apply'],
    [detail({ ...approved, status: 'partially_applied', apply_disposition: 'replan_required' }, { pending: 0, conflict: 1 }), null],
    [detail({ ...approved, status: 'partially_applied' }, { pending: 0, failed: 1 }), 'Continue apply'],
  ])('uses eligibility for applying/partial/applied/synthetic states %#', (d, button) => {
    render(<RunActions supplierFeed="Wessex" detail={d as RunDetail} onChange={vi.fn()} refresh={vi.fn()} />)
    expect(screen.getByRole('heading', { name: (d as RunDetail).control.state })).toBeTruthy()
    const controls = screen.queryAllByRole('button', { name: /^(Approve plan|Apply approved plan|Continue apply)$/ })
    expect(controls.map(b => b.textContent)).toEqual(button ? [button] : [])
  })
  it('cancels without mutations and hides mutation controls after an uncertain error', async () => {
    const fetch = vi.fn(async () => { throw new Error('Network failed') })
    vi.stubGlobal('fetch', fetch)
    const refresh = vi.fn()
    render(<RunActions supplierFeed="Wessex" detail={detail()} onChange={vi.fn()} refresh={refresh} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Network failed')
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull()
    expect(screen.queryByText('Approval recorded. Canonical changes have not been applied.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh run' }))
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('shows partial conflict evidence without claiming success or exposing continuation', async () => {
    const conflict = detail({ ...approved, status: 'partially_applied', apply_disposition: 'replan_required' }, { pending: 0, conflict: 1 })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ detail: conflict, outcome: 'attention', processed: 1 }) })))
    const onChange = vi.fn()
    const view = render(<RunActions supplierFeed="Wessex" detail={detail(approved)} onChange={onChange} refresh={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply approved plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm application' }))
    expect((await screen.findByRole('alert')).textContent).toContain('attention required')
    expect(onChange).toHaveBeenCalledWith(conflict)
    view.rerender(<RunActions supplierFeed="Wessex" detail={conflict} onChange={onChange} refresh={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Continue apply' })).toBeNull()
    expect(screen.getByText('Conflicts / stale')).toBeTruthy()
  })
  it('requires distinct approval and apply confirmations, and uses authoritative response state', async () => {
    const onChange = vi.fn()
    const fetch = vi.fn(async (_url, init) => ({ ok: true, text: async () => JSON.stringify({ detail: JSON.parse(init.body).action === 'approve' ? detail(approved) : detail({ ...approved, status: 'applied' }, { pending: 0, applied: 1 }), processed: 1, outcome: JSON.parse(init.body).action === 'approve' ? 'approved' : 'applied' }) }))
    vi.stubGlobal('fetch', fetch)
    const props = { supplierFeed: 'Wessex / mouldings', onChange, refresh: vi.fn() }
    const view = render(<RunActions {...props} detail={detail()} />)
    expect(screen.queryByRole('button', { name: 'Apply approved plan' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    const confirm = screen.getByRole('dialog')
    expect(confirm.textContent).toContain('Wessex / mouldings')
    expect(confirm.textContent).toContain(raw.id)
    expect(confirm.textContent).toContain('Create: 1')
    expect(confirm.textContent).toContain('creates')
    expect(confirm.textContent).toContain('does NOT apply')
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm approval' }))
    await screen.findByText('Approval recorded. Canonical changes have not been applied.')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ run: expect.objectContaining({ status: 'approved' }) }))
    view.rerender(<RunActions {...props} detail={detail(approved)} />)
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Apply approved plan' }))
    const apply = screen.getByRole('dialog')
    expect(apply.textContent).toContain('canonical supplier data')
    expect(apply.textContent).toContain('supplier-cost history')
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(within(apply).getByRole('button', { name: 'Confirm application' }))
    await screen.findByText('Application completed according to the persisted run state.')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
