import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { orchestrateFeedCheckAndPlan, type Block2eStore } from '../server/platform/supplierFeeds/block2eOrchestrator.js'
import { createLionAdapter } from '../server/platform/supplierFeeds/feedAdapters.js'
import { deriveRunControl } from '../server/platform/supplierFeeds/control.js'
import { generatedLionCsv } from './helpers/lionFixture.js'

const source = { supplierId: 'supplier', feedSourceId: 'source', scopeKey: 'uk-mouldings-lengths', allowsAuthoritativeSnapshots: false }
const sha = 'a'.repeat(64)
afterEach(() => vi.unstubAllGlobals())

function memoryStore() {
  const staged: Record<string, unknown>[] = []
  const store = {
    ensureFeedSource: vi.fn(async () => {}), getLatestSuccessfulChecksum: vi.fn(async () => null),
    findRunByLogicalKey: vi.fn(async () => null), createRun: vi.fn(async () => 'actual-run'),
    beginStaging: vi.fn(async () => {}), stageRow: vi.fn(async () => { throw new Error('Use batch staging') }),
    stageRows: vi.fn(async (_runId: string, rows: Record<string, unknown>[]) => {
      staged.push(...rows); return rows.map(() => randomUUID())
    }),
    verifyStagedPlan: vi.fn(async () => {}), freezePlan: vi.fn(async () => sha),
    readRun: vi.fn(async () => ({ id: 'actual-run', mode: 'dry_run', status: 'planned', adapterId: 'lion-uk-public-mouldings',
      authoritative: false, missingInferenceEnabled: false, planFingerprint: sha, sourceChecksum: null,
      planCounts: { create: 0, update: 0, unchanged: 0, reject: 0, review: 500, potential_missing: 0, cost_changes: 0 } })),
    listCanonicalProducts: vi.fn(async () => []), listSourceKeyAliases: vi.fn(async () => []),
    recordSourceCheck: vi.fn(async () => 'check'),
  } satisfies Block2eStore
  return { store, staged }
}

it('runs actual acquisition, normalization and batched planning with evidence, but no database or approval/apply capabilities', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(generatedLionCsv(), { headers: { 'content-type': 'text/csv' } })))
  const { store, staged } = memoryStore()
  const result = await orchestrateFeedCheckAndPlan(store, { source, adapter: createLionAdapter() })
  expect(result).toMatchObject({ outcome: 'planned', runStatus: 'planned', planCounts: { review: 500, cost_changes: 0, potential_missing: 0 } })
  expect(store.createRun).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dry_run', authoritative: false,
    validationSafeForMissing: false, missingInferenceEnabled: false, adapterId: 'lion-uk-public-mouldings' }))
  expect(staged).toHaveLength(500)
  for (const row of staged) {
    expect(row.proposed_action).toBe('review')
    expect(row.proposed_product).toMatchObject({ runId: 'actual-run' })
    expect(row.proposed_product).not.toHaveProperty('cost')
    expect(row.proposed_diff).toMatchObject({ costChange: false, lifecycleChanges: [], sourceEvidence: {
      costQualified: false, dimensionsQualified: false, lifecycleQualified: false, assetRightsStatus: 'unknown',
      acquisition: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }, generation: { timezone: null },
    } })
  }
  expect(store.stageRow).not.toHaveBeenCalled()
  expect(store.freezePlan).toHaveBeenCalledOnce()
  expect(store.recordSourceCheck).toHaveBeenCalledWith(expect.objectContaining({ status: 'changed', publishedUpdateDate: null }))
  const progress = { total: 500, version2: 500, pending: 500, applied: 0, skipped: 0, failed: 0, conflict: 0 }
  for (const status of ['planned', 'awaiting_approval', 'approved', 'applying', 'partially_applied']) {
    expect(deriveRunControl({ mode: 'dry_run', status, persistence_version: 2 }, progress)).toMatchObject({
      canApprove: false, canApply: false, canContinue: false, reasonCodes: ['dry_run'],
    })
  }
})

it.each(['cost', 'authority', 'missing', 'validation', 'mode'])('fails closed on injected %s capability before creating a run', async poison => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(generatedLionCsv(), { headers: { 'content-type': 'text/csv' } })))
  const actual = createLionAdapter(), { store } = memoryStore()
  const adapter = { ...actual, acquire: async (input: Parameters<typeof actual.acquire>[0]) => {
    const release = await actual.acquire(input)
    if (poison === 'cost') release.normalized.planningRows[0].result.value!.cost = { amount: '1', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-16T00:00:00Z' }
    if (poison === 'authority') release.normalized.context.authoritative = true
    if (poison === 'missing') release.normalized.context.missingInferenceEnabled = true
    if (poison === 'validation') release.normalized.context.validationSafeForMissing = true
    if (poison === 'mode') release.normalized.context.mode = 'apply_requested'
    return release
  } }
  expect(await orchestrateFeedCheckAndPlan(store, { source, adapter })).toMatchObject({ outcome: 'check_error', status: 'validation_error' })
  expect(store.createRun).not.toHaveBeenCalled(); expect(store.stageRows).not.toHaveBeenCalled()
})

it('keeps malformed/colliding CSV out of planning entirely', async () => {
  const bytes = generatedLionCsv().toString().replace('L012,', 'l001,')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'text/csv' } })))
  const { store } = memoryStore()
  expect(await orchestrateFeedCheckAndPlan(store, { source, adapter: createLionAdapter() })).toMatchObject({
    outcome: 'check_error', status: 'validation_error',
  })
  expect(store.createRun).not.toHaveBeenCalled(); expect(store.stageRows).not.toHaveBeenCalled()
})
