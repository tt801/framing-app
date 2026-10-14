import type { FeedPlan } from './contracts.js'

export const batchStagingLimits = { defaultRows: 50, maxRows: 100, targetBytes: 128 * 1024, maxBytes: 256 * 1024 } as const
export class StagingUnconfirmedError extends Error {
  constructor() { super('Staging checkpoint unconfirmed; recovery required. No automatic replay.'); this.name = 'StagingUnconfirmedError' }
}
export function validateBatchSize(size: number): void {
  if (!Number.isInteger(size) || size < 1 || size > batchStagingLimits.maxRows) throw new Error('Invalid staging batch size')
}

// PostgreSQL JSONB text adds separator whitespace and expands exponent notation.
// Measure UTF-8, not JS characters or compact JSON, before submitting any batch.
export function postgresJsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Staging evidence is not JSON')
  const measure = (part: any): number => {
    if (part === null) return 4
    if (Array.isArray(part)) return 2 + part.reduce((n, v) => n + measure(v), 0) + Math.max(0, part.length - 1) * 2
    if (typeof part === 'object') {
      const entries = Object.entries(part)
      return 2 + entries.reduce((n, [k, v]) => n + Buffer.byteLength(JSON.stringify(k), 'utf8') + 2 + measure(v), 0) + Math.max(0, entries.length - 1) * 2
    }
    if (typeof part === 'number') {
      const text = String(part), match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text)
      if (match) {
        const digits = match[2] + (match[3] ?? ''), position = match[2].length + Number(match[4])
        return match[1].length + (position <= 0 ? 2 - position + digits.length : position >= digits.length ? position : digits.length + 1)
      }
    }
    return Buffer.byteLength(JSON.stringify(part), 'utf8')
  }
  return measure(JSON.parse(serialized))
}

export function packStagingRows(rows: Record<string, unknown>[], size: number = batchStagingLimits.defaultRows): Record<string, unknown>[][] {
  validateBatchSize(size)
  const batches: Record<string, unknown>[][] = []
  let batch: Record<string, unknown>[] = [], bytes = 2
  for (const row of rows) {
    const rowBytes = postgresJsonBytes(row)
    if (rowBytes + 2 > batchStagingLimits.maxBytes) throw new Error('Staging row exceeds payload limit')
    if (batch.length && (batch.length === size || bytes + 2 + rowBytes > batchStagingLimits.targetBytes)) {
      batches.push(batch); batch = []; bytes = 2
    }
    bytes += (batch.length ? 2 : 0) + rowBytes; batch.push(row)
  }
  if (batch.length) batches.push(batch)
  return batches
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function verifyBatchIds(ids: unknown, count: number): asserts ids is string[] {
  if (!Array.isArray(ids) || ids.length !== count || ids.some(id => typeof id !== 'string' || !uuid.test(id))
    || new Set(ids.map(id => String(id).toLowerCase())).size !== count) throw new StagingUnconfirmedError()
}
const stable = (value: unknown): string => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
const timestamp = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) throw new StagingUnconfirmedError()
  const fraction = /\.(\d+)/.exec(text)?.[1] ?? ''
  return String(BigInt(ms) * 1000n + BigInt((fraction.slice(3, 6) + '000').slice(0, 3)))
}
const nullableText = ['source_record_key', 'source_path', 'item_fingerprint', 'source_product_key', 'source_product_key_origin', 'proposed_action', 'action_fingerprint']
const evidence = ['proposed_product', 'proposed_diff']

export function verifyBatchEvidence(runId: string, submitted: Record<string, unknown>[], ids: string[], records: Record<string, any>[]): void {
  if (records.length !== submitted.length || new Set(records.map(r => r.id)).size !== records.length) throw new StagingUnconfirmedError()
  const byId = new Map(records.map(r => [r.id, r]))
  submitted.forEach((row, i) => {
    const saved = byId.get(ids[i])
    if (!saved || saved.feed_run_id !== runId || saved.row_persistence_version !== 2 || saved.apply_state !== 'pending'
      || saved.raw_record !== null || saved.applied_at !== null || saved.failure_code !== null || saved.failure_detail !== null
      || saved.result_product_id !== null || saved.result_product_revision !== null || stable(saved.outcome_codes) !== '[]') throw new StagingUnconfirmedError()
    const expected: Record<string, unknown> = {
      row_number: row.row_number === undefined || row.row_number === null || row.row_number === '' ? null : Number(row.row_number),
      row_kind: row.row_kind ?? 'source_item', validation_status: row.validation_status ?? 'pending',
      validation_errors: row.validation_errors ?? [], validation_warnings: row.validation_warnings ?? [],
      matched_product_id: row.matched_product_id ? String(row.matched_product_id).toLowerCase() : null,
    }
    for (const key of nullableText) expected[key] = row[key] === undefined || row[key] === null ? null : String(row[key])
    for (const key of evidence) expected[key] = row[key] ?? null
    if (Object.entries(expected).some(([key, value]) => stable(saved[key]) !== stable(value))
      || String(saved.expected_product_revision ?? '') !== String(row.expected_product_revision ? BigInt(String(row.expected_product_revision)) : '')
      || timestamp(saved.expected_product_updated_at) !== timestamp(row.expected_product_updated_at)) throw new StagingUnconfirmedError()
  })
}

export function verifyStagedCounts(rows: Record<string, any>[], expected: FeedPlan['counts']): void {
  const counts = { create: 0, update: 0, unchanged: 0, reject: 0, review: 0, potential_missing: 0, cost_changes: 0 }
  const ids = new Set<string>(), fingerprints = new Set<string>()
  for (const row of rows) {
    if (row.row_persistence_version !== 2 || row.apply_state !== 'pending' || typeof row.id !== 'string' || ids.has(row.id)
      || typeof row.action_fingerprint !== 'string' || fingerprints.has(row.action_fingerprint)
      || !['create', 'update', 'unchanged', 'reject', 'review', 'potential_missing'].includes(row.proposed_action)) throw new StagingUnconfirmedError()
    ids.add(row.id); fingerprints.add(row.action_fingerprint)
    counts[row.proposed_action as keyof typeof counts]++
    if (row.proposed_action === 'update' && row.proposed_diff?.costChange === true) counts.cost_changes++
  }
  if (Object.entries(counts).some(([key, count]) => count !== expected[key as keyof typeof expected])) throw new StagingUnconfirmedError()
}
