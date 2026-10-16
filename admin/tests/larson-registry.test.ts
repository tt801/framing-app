import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { checkingCapability, registeredFeed, wessexFeedSource } from '../server/platform/supplierFeeds/feedAdapters.js'
import { aggregateFeed, readFeedDetail } from '../server/platform/supplierFeeds/operations.js'

const source = { id: '11111111-1111-4111-8111-111111111111', supplier_id: '22222222-2222-4222-8222-222222222222',
  source_key: 'larson-juhl-uk-public-mouldings', scope_key: 'uk-public-mouldings-category', allows_authoritative_snapshots: false,
  supplier: { id: '22222222-2222-4222-8222-222222222222', name: 'Larson-Juhl UK', slug: 'larson-juhl-uk', status: 'draft' } }
beforeEach(() => {
  vi.stubEnv('SUPPLIER_FEED_AUTOMATION_ENABLED', 'true')
  vi.stubEnv('SUPPLIER_FEED_EXPECTED_PROJECT_REF', 'zminmylvmtyglkujxxyk')
  vi.stubEnv('SUPABASE_URL', 'https://zminmylvmtyglkujxxyk.supabase.co')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No live acquisition permitted') }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('resolves exact persisted Larson identity without invented database UUIDs and enables only manual capability', () => {
  const registered = registeredFeed(source.id, source)
  expect(registered).toMatchObject({ source: { supplierId: source.supplier_id, feedSourceId: source.id, scopeKey: source.scope_key,
    allowsAuthoritativeSnapshots: false }, adapter: { id: 'larson-juhl-uk-public-catalogue', mode: 'dry_run', allowsAuthoritative: false,
    allowsMissing: false, sourceUrl: 'https://larsonjuhl.co.uk/mouldings/' }, liveChecking: true, schedule: null })
  expect(aggregateFeed(source, [], [], 0)).toMatchObject({ checking: { canCheckNow: true, schedule: null }, overdue: false })
  expect(registeredFeed(source.id)).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

it.each([
  { source_key: 'wrong' }, { scope_key: 'mouldings' }, { allows_authoritative_snapshots: true },
  { supplier: { ...source.supplier, name: 'Other' } }, { supplier: { ...source.supplier, slug: 'other' } },
  { supplier: { ...source.supplier, id: '33333333-3333-4333-8333-333333333333' } }, { supplier: undefined },
])('rejects mismatched or incomplete persisted identity %j', override => {
  const mismatched = { ...source, ...override }
  expect(registeredFeed(source.id, mismatched)).toBeNull()
  expect(checkingCapability(mismatched)).toMatchObject({ canCheckNow: false, schedule: null })
})

it('keeps the automation and exact Sandbox guards and requires the queried source ID to match', () => {
  expect(registeredFeed('33333333-3333-4333-8333-333333333333', source)).toBeNull()
  for (const [key, value] of [['SUPPLIER_FEED_AUTOMATION_ENABLED', 'false'], ['SUPPLIER_FEED_EXPECTED_PROJECT_REF', 'other'], ['SUPABASE_URL', 'https://other.supabase.co']]) {
    const original = process.env[key]
    vi.stubEnv(key, value)
    expect(checkingCapability(source).canCheckNow).toBe(false)
    vi.stubEnv(key, original)
  }
})

it('preserves Wessex authority matching and leaves International unregistered', () => {
  const wessex = { ...source, id: wessexFeedSource.feedSourceId, supplier_id: wessexFeedSource.supplierId,
    scope_key: wessexFeedSource.scopeKey, allows_authoritative_snapshots: true }
  expect(checkingCapability(wessex)).toMatchObject({ canCheckNow: true, schedule: null })
  expect(checkingCapability({ ...wessex, allows_authoritative_snapshots: false }).canCheckNow).toBe(false)
  expect(registeredFeed(wessex.id)?.adapter.mode).toBe('apply_requested')
  expect(registeredFeed(source.id, { ...source, source_key: 'international-moulding-historical' })).toBeNull()
})

it('reads supplier slug through the existing Admin detail projection before exposing Check Now', async () => {
  const selections: string[] = []
  const db = { from: (table: string) => {
    const query = { select: (columns: string) => { if (table === 'supplier_feed_sources') selections.push(columns); return query },
      eq: () => query, in: () => query, order: () => query, limit: () => query,
      then: (resolve: (result: { data: typeof source[]; count: number; error: null }) => unknown) =>
        Promise.resolve({ data: table === 'supplier_feed_sources' ? [source] : [], count: 0, error: null }).then(resolve) }
    return query
  } }
  const result = await readFeedDetail(db, source.id)
  expect(selections).toEqual([expect.stringContaining('slug')])
  expect(result.feed.checking).toMatchObject({ canCheckNow: true, schedule: null })
  expect(fetch).not.toHaveBeenCalled()
})
