import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { batchStagingLimits, packStagingRows, postgresJsonBytes, verifyStagedCounts } from '../server/platform/supplierFeeds/batchStaging'
import { createSupabaseBlock2eStore } from '../server/platform/supplierFeeds/block2eOrchestrator'

const runId = randomUUID()
const row = (i: number) => ({ row_number: i, row_kind: 'source_item', proposed_action: 'reject',
  item_fingerprint: i.toString(16).padStart(64, '0'), action_fingerprint: (i + 1000).toString(16).padStart(64, '0'),
  validation_status: 'invalid', validation_errors: [{ code: 'fixture', message: 'synthetic' }], validation_warnings: [] })

function transport(input = [row(1), row(2)]) {
  const ids = input.map(() => randomUUID())
  const nullable = ['source_record_key', 'source_path', 'source_product_key', 'source_product_key_origin', 'raw_record',
    'proposed_product', 'proposed_diff', 'matched_product_id', 'expected_product_revision', 'expected_product_updated_at',
    'applied_at', 'failure_code', 'failure_detail', 'result_product_id', 'result_product_revision']
  let records: any[] = input.map((r, i) => ({ ...Object.fromEntries(nullable.map(k => [k, null])), ...r, id: ids[i],
    feed_run_id: runId, row_persistence_version: 2, apply_state: 'pending', outcome_codes: [] }))
  let count = records.length
  const queries: any[] = []
  const rpc = vi.fn(async () => ({ data: ids, error: null }))
  const from = vi.fn(() => {
    const q: any = { filters: [], select: vi.fn().mockReturnThis(), eq: vi.fn(function(this: any, ...a: any[]) { this.filters.push(a); return this }),
      in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      then(resolve: any) { resolve({ data: [...records].reverse(), count, error: null }) } }
    queries.push(q); return q
  })
  return { store: createSupabaseBlock2eStore(() => ({ from, rpc })), rpc, ids, queries,
    mutate: (fn: (r: any[]) => any[]) => { records = fn(records) }, setCount: (n: number) => { count = n } }
}

describe('bounded staging packing', () => {
  it('defaults to 50 ordered rows, producing 24 ordinary batches for 1194 rows', () => {
    const rows = Array.from({ length: 1194 }, (_, i) => row(i + 1)), batches = packStagingRows(rows)
    expect(batches).toHaveLength(24); expect(batches.flat()).toEqual(rows)
    expect(batches.slice(0, -1).every(b => b.length === 50)).toBe(true)
    expect(batchStagingLimits).toEqual({ defaultRows: 50, maxRows: 100, targetBytes: 131072, maxBytes: 262144 })
  })
  it.each([0, -1, 1.5, 101, NaN, Infinity])('rejects invalid override %s', size => expect(() => packStagingRows([row(1)], size)).toThrow())
  it('uses byte boundaries as well as count, without changing evidence', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ ...row(i + 1), proposed_diff: { note: '界'.repeat(10000) } }))
    const batches = packStagingRows(rows, 100)
    expect(batches.length).toBeGreaterThan(1); expect(batches.flat()).toEqual(rows)
    expect(batches.every(b => postgresJsonBytes(b) <= batchStagingLimits.targetBytes)).toBe(true)
  })
  it('allows an unsplit row above the target but below the absolute limit', () => {
    const big = { ...row(1), proposed_diff: { note: 'x'.repeat(150000) } }
    expect(packStagingRows([big, row(2)])).toEqual([[big], [row(2)]])
  })
  it('rejects any oversized row before returning batches', () => {
    expect(() => packStagingRows([row(1), { ...row(2), proposed_diff: { note: '界'.repeat(100000) } }])).toThrow()
  })
  it('accounts for JSONB whitespace, Unicode, escaping and exponent expansion', () => {
    expect(postgresJsonBytes([{ a: '界', b: [true, null, 1e21, 1e-7], c: '\\"\n' }])).toBeGreaterThan(Buffer.byteLength(JSON.stringify([{ a: '界', b: [true, null, 1e21, 1e-7], c: '\\"\n' }])))
  })
})

describe('batch store checkpoint verification', () => {
  it('uses only batch RPC and bounds readback to run and returned IDs; tolerates database ordering', async () => {
    const f = transport(), input = [row(1), row(2)]
    expect(await f.store.stageRows(runId, input)).toEqual(f.ids)
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('block2e_stage_rows', { p_run_id: runId, p_rows: input })
    expect(f.queries[0].eq).toHaveBeenCalledWith('feed_run_id', runId)
    expect(f.queries[0].in).toHaveBeenCalledWith('id', f.ids)
    expect(f.queries[0].limit).toHaveBeenCalledWith(3)
  })
  it.each([null, 'not-an-array', [], ['invalid', 'invalid']])('rejects invalid RPC result %j without retry', async data => {
    const f = transport(); f.rpc.mockResolvedValueOnce({ data: data as any, error: null })
    await expect(f.store.stageRows(runId, [row(1), row(2)])).rejects.toThrow(/recovery required/)
    expect(f.rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects duplicate UUIDs', async () => {
    const f = transport(); f.rpc.mockResolvedValueOnce({ data: [f.ids[0], f.ids[0]], error: null })
    await expect(f.store.stageRows(runId, [row(1), row(2)])).rejects.toThrow()
  })
  it('rejects swapped returned UUID order', async () => {
    const f = transport(); f.rpc.mockResolvedValueOnce({ data: [...f.ids].reverse(), error: null })
    await expect(f.store.stageRows(runId, [row(1), row(2)])).rejects.toThrow()
  })
  it.each(['feed_run_id', 'action_fingerprint', 'row_number', 'row_kind', 'source_record_key', 'source_path', 'source_product_key', 'source_product_key_origin',
    'item_fingerprint', 'proposed_product', 'proposed_action', 'proposed_diff', 'validation_status', 'validation_errors', 'validation_warnings', 'matched_product_id',
    'expected_product_revision', 'expected_product_updated_at', 'row_persistence_version', 'apply_state', 'applied_at', 'failure_code', 'failure_detail', 'raw_record',
    'outcome_codes', 'result_product_id', 'result_product_revision'])('rejects mismatched persisted %s', async key => {
    const f = transport(); f.mutate(records => records.map((r, i) => i ? r : { ...r, [key]: 'corrupt' }))
    await expect(f.store.stageRows(runId, [row(1), row(2)])).rejects.toThrow()
  })
  it('rejects truncated and excess checkpoint cardinality', async () => {
    const f = transport(); f.mutate(records => records.slice(0, 1))
    await expect(f.store.stageRows(runId, [row(1), row(2)])).rejects.toThrow()
    const g = transport(); g.setCount(3)
    await expect(g.store.stageRows(runId, [row(1), row(2)])).rejects.toThrow()
  })
  it('does not replay a lost response after commit', async () => {
    const f = transport(); f.rpc.mockRejectedValueOnce(new Error('lost response'))
    await expect(f.store.stageRows(runId, [row(1), row(2)])).rejects.toThrow(/recovery required/)
    expect(f.rpc).toHaveBeenCalledTimes(1); expect(f.queries).toHaveLength(0)
  })
  it('fails oversized direct calls before any submission', async () => {
    const f = transport()
    await expect(f.store.stageRows(runId, [{ ...row(1), proposed_diff: { note: '界'.repeat(90000) } }])).rejects.toThrow(/payload limit/)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('verifies exact whole-run action counts, including UPDATE cost changes', () => {
    const saved = [{ ...row(1), id: randomUUID(), row_persistence_version: 2, apply_state: 'pending', proposed_action: 'update', proposed_diff: { costChange: true } }]
    const counts = { create: 0, update: 1, unchanged: 0, reject: 0, review: 0, potential_missing: 0, cost_changes: 1 }
    expect(() => verifyStagedCounts(saved, counts)).not.toThrow()
    expect(() => verifyStagedCounts(saved, { ...counts, update: 2 })).toThrow()
    expect(() => verifyStagedCounts(saved, { ...counts, cost_changes: 0 })).toThrow()
    expect(() => verifyStagedCounts([...saved, ...saved], { ...counts, update: 2 })).toThrow()
  })
})
