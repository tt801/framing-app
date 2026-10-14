import { describe, expect, it, vi } from 'vitest'
import { createSupabaseBlock2eStore } from '../server/platform/supplierFeeds/block2eOrchestrator.js'

function database(tables: Record<string, any[]>, cap = 73, missingCount = false) {
  return { rpc: vi.fn(() => { throw new Error('Mutation forbidden') }), from(table: string) {
    let data = tables[table] ?? [], start = 0, end = Infinity, head = false
    const q: any = { select: (_: string, options?: any) => { head = options?.head; return q },
      eq: (key: string, value: any) => { data = data.filter(row => row[key] === value); return q },
      in: (key: string, values: any[]) => { data = data.filter(row => values.includes(row[key])); return q },
      order: (key: string, opts?: any) => { data = [...data].sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (opts?.ascending === false ? -1 : 1)); return q },
      range: (a: number, b: number) => { start = a; end = b; return q },
      then: (resolve: any) => resolve({ data: head ? null : data.slice(start, Math.min(end + 1, start + cap)), count: missingCount ? null : data.length, error: null }) }
    return q
  } }
}
const source = 'source', supplier = 'supplier'
describe('complete operational planning store reads', () => {
  it('excludes synthetic checks and synthetic-linked runs without losing older legitimate success', async () => {
    const checks = Array.from({ length: 1100 }, (_, i) => ({ id: String(i).padStart(5, '0'), feed_source_id: source, status: 'unchanged', checked_at: `2026-11-${i}`, sha256: 'b'.repeat(64), source_url: 'https://fixture.invalid/check' }))
    checks.push({ id: 'z', feed_source_id: source, status: 'unchanged', checked_at: '2026-01-01', sha256: 'a'.repeat(64), source_url: 'https://www.wessexpictures.com/res/WessexMouldings.xls' })
    checks.push({ ...checks[0], id: 'linked', source_url: 'https://www.wessexpictures.com/res/WessexMouldings.xls', linked_run: { adapter_id: 'synthetic-test' } } as any)
    const db = database({ supplier_feed_source_checks: checks })
    expect(await createSupabaseBlock2eStore(() => db).getLatestSuccessfulChecksum(source)).toBe('a'.repeat(64))
    expect(db.rpc).not.toHaveBeenCalled()
  })
  it('reads all products and aliases beyond both request size and REST cap', async () => {
    const products = Array.from({ length: 1194 }, (_, i) => ({ id: String(i).padStart(5, '0'), supplier_id: supplier, product_revision: 1 }))
    const aliases = products.map(p => ({ ...p, supplier_product_id: p.id, alias_kind: 'supplier_sku', alias_value: p.id }))
    const store = createSupabaseBlock2eStore(() => database({ supplier_products: products, supplier_product_aliases: aliases }))
    expect(await store.listCanonicalProducts(supplier)).toHaveLength(1194)
    expect(await store.listSourceKeyAliases(supplier)).toHaveLength(1194)
  })
  it('fails closed when exact completeness count is absent', async () => {
    const store = createSupabaseBlock2eStore(() => database({}, 73, true))
    await expect(store.listCanonicalProducts(supplier)).rejects.toThrow('complete')
  })
  it('reconciles historical source/scope/SHA and excludes synthetic-linked runs', async () => {
    const run = { id: 'historical', supplier_id: supplier, feed_source_id: source, scope_key: 'mouldings', persistence_version: 2, source_checksum: 'a'.repeat(64), status: 'applied', plan_fingerprint: 'c'.repeat(64), logical_run_key: 'old-import', checks: [] }
    const store = createSupabaseBlock2eStore(() => database({ supplier_feed_runs: [run, { ...run, id: 'synthetic' }], supplier_feed_source_checks: [{ id: 'check', feed_source_id: source, feed_run_id: 'synthetic', source_url: 'https://fixture.invalid/check' }] }))
    expect(await store.findReleaseByChecksum!({ supplierId: supplier, feedSourceId: source, scopeKey: 'mouldings' }, run.source_checksum)).toMatchObject({ id: 'historical', status: 'applied' })
  })
  it('fails closed on repeated IDs or count changes during pagination', async () => {
    const duplicate = { id: 'same', supplier_id: supplier }
    await expect(createSupabaseBlock2eStore(() => database({ supplier_products: [duplicate, duplicate] }, 1)).listCanonicalProducts(supplier)).rejects.toThrow('complete')
    let requests = 0
    const changing = { from: () => {
      const q: any = { select: () => q, eq: () => q, order: () => q, range: () => q,
        then: (resolve: any) => resolve({ data: [{ id: String(++requests), supplier_id: supplier }], count: requests === 1 ? 2 : 3 }) }
      return q
    }, rpc: vi.fn() }
    await expect(createSupabaseBlock2eStore(() => changing).listCanonicalProducts(supplier)).rejects.toThrow('complete')
  })
  it('excludes success linked to a run with synthetic error evidence', async () => {
    const checks = [
      { id: '1', feed_source_id: source, status: 'changed', checked_at: '2026-10-14', sha256: 'b'.repeat(64), feed_run_id: 'run' },
      { id: '2', feed_source_id: source, status: 'validation_error', checked_at: '2026-10-15', sha256: null, source_url: 'https://fixture.invalid', feed_run_id: 'run' },
      { id: '3', feed_source_id: source, status: 'unchanged', checked_at: '2026-10-10', sha256: 'a'.repeat(64) },
    ]
    expect(await createSupabaseBlock2eStore(() => database({ supplier_feed_source_checks: checks })).getLatestSuccessfulChecksum(source)).toBe('a'.repeat(64))
  })
})
