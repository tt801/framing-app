import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { checkingCapability, createLionAdapter, registeredFeed, createWessexAdapter, createInternationalAdapter, createLarsonJuhlAdapter } from '../server/platform/supplierFeeds/feedAdapters.js'
import { aggregateFeed, readFeedDetail } from '../server/platform/supplierFeeds/operations.js'
import { generatedLionCsv } from './helpers/lionFixture.js'

const source = { id: '11111111-1111-4111-8111-111111111111', supplier_id: '22222222-2222-4222-8222-222222222222',
  source_key: 'lion-uk-public-mouldings', scope_key: 'uk-mouldings-lengths', allows_authoritative_snapshots: false,
  supplier: { id: '22222222-2222-4222-8222-222222222222', name: 'LION', slug: 'lion', status: 'draft' } }
beforeEach(() => {
  vi.stubEnv('SUPPLIER_FEED_AUTOMATION_ENABLED', 'true')
  vi.stubEnv('SUPPLIER_FEED_EXPECTED_PROJECT_REF', 'zminmylvmtyglkujxxyk')
  vi.stubEnv('SUPABASE_URL', 'https://zminmylvmtyglkujxxyk.supabase.co')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network permitted') }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('resolves only exact persisted LION identity with manual-only dry-run policy and no UUID constants', () => {
  expect(registeredFeed(source.id, source)).toMatchObject({ source: { supplierId: source.supplier_id, feedSourceId: source.id,
    scopeKey: source.scope_key, allowsAuthoritativeSnapshots: false }, adapter: { id: 'lion-uk-public-mouldings', mode: 'dry_run', allowsAuthoritative: false,
    allowsMissing: false }, liveChecking: true, schedule: null })
  expect(registeredFeed(source.id)).toBeNull()
  expect(aggregateFeed(source, [], [], 0)).toMatchObject({ checking: { canCheckNow: true, schedule: null }, overdue: false })
  expect(fetch).not.toHaveBeenCalled()
})

it.each([{ source_key: 'other' }, { scope_key: 'mouldings' }, { allows_authoritative_snapshots: true },
  { supplier: { ...source.supplier, name: 'Lion' } }, { supplier: { ...source.supplier, slug: 'other' } },
  { supplier: { ...source.supplier, id: source.id } }, { supplier: undefined }, { supplier_id: 'not-uuid' }])('rejects persisted identity mismatch %j', override => {
  const altered = { ...source, ...override }
  expect(registeredFeed(source.id, altered)).toBeNull()
  expect(checkingCapability(altered)).toMatchObject({ canCheckNow: false, schedule: null })
})

it('retains environment, project and queried-ID guards and existing supplier policies', () => {
  expect(registeredFeed(source.supplier_id, source)).toBeNull()
  for (const [key, value] of [['SUPPLIER_FEED_AUTOMATION_ENABLED', 'false'], ['SUPPLIER_FEED_EXPECTED_PROJECT_REF', 'other'], ['SUPABASE_URL', 'https://other.supabase.co']]) {
    const old = process.env[key]; vi.stubEnv(key, value)
    expect(checkingCapability(source).canCheckNow).toBe(false); vi.stubEnv(key, old)
  }
  expect(createWessexAdapter()).toMatchObject({ mode: 'apply_requested', allowsAuthoritative: true, allowsMissing: true, releaseNamespace: 'wessex' })
  expect(createInternationalAdapter()).toMatchObject({ mode: 'dry_run', releaseNamespace: 'international-moulding-historical' })
  expect(createLarsonJuhlAdapter()).toMatchObject({ mode: 'dry_run', releaseNamespace: 'larson-juhl-uk-public-catalogue' })
})

it('uses LION acquisition again for actual run normalization and rejects authority/scope overrides', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(generatedLionCsv(), { headers: { 'content-type': 'text/csv' } })))
  const adapter = createLionAdapter(), identity = { supplierId: source.supplier_id, feedSourceId: source.id, scopeKey: source.scope_key, allowsAuthoritativeSnapshots: false }
  const release = await adapter.acquire({ source: identity, previousSha256: null, timeoutMs: 1000, now: () => new Date() })
  expect(release.normalizeForRun('actual').context).toMatchObject({ runId: 'actual', mode: 'dry_run', authoritative: false, missingInferenceEnabled: false })
  expect(release.sourceEvidenceByRow?.size).toBe(500)
  expect(release.artifact.acquisition.sourceUrl).toContain('estlite_lionmouldings.csv')
  await expect(adapter.acquire({ source: { ...identity, allowsAuthoritativeSnapshots: true }, previousSha256: null, timeoutMs: 1000, now: () => new Date() })).rejects.toThrow()
  await expect(adapter.acquire({ source: { ...identity, scopeKey: 'other' }, previousSha256: null, timeoutMs: 1000, now: () => new Date() })).rejects.toThrow()
})

it('exposes capability through the real Admin detail projection with a mocked read-only store', async () => {
  const selections: string[] = []
  const db = { from: (table: string) => {
    const query = { select: (columns: string) => { if (table === 'supplier_feed_sources') selections.push(columns); return query },
      eq: () => query, in: () => query, order: () => query, limit: () => query,
      then: (resolve: (result: { data: typeof source[]; count: number; error: null }) => unknown) =>
        Promise.resolve({ data: table === 'supplier_feed_sources' ? [source] : [], count: 0, error: null }).then(resolve) }
    return query
  } }
  expect((await readFeedDetail(db, source.id)).feed.checking).toMatchObject({ canCheckNow: true, schedule: null })
  expect(selections).toEqual([expect.stringContaining('slug')]); expect(fetch).not.toHaveBeenCalled()
})
