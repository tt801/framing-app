import { timingSafeEqual } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { PlatformDependencies } from './dependencies.js'
import { createSupabaseBlock2eStore, orchestrateWessexCheckAndPlan, type WessexOrchestrationResult } from './supplierFeeds/block2eOrchestrator.js'
import { readRunControl } from './supplierFeeds/control.js'
import { isSynthetic, runColumns } from './supplierFeeds/operations.js'

export const wessexSource = Object.freeze({ supplierId: '1312e794-ec94-4bf0-aa3a-9ffc35b4428d', feedSourceId: '468247ee-809b-4784-aca1-bba44f860c85', scopeKey: 'mouldings' })
export const executionLimits = { hardSeconds: 300, workMs: 240_000, requestMs: 15_000 } as const
const sandbox = 'zminmylvmtyglkujxxyk'
type Database = { from: (table: string) => any; rpc: (name: string, args: any) => any }
type Environment = Record<string, string | undefined>
export class ExecutionError extends Error { constructor(public status: number, public code: string) { super(code) } }
export function checkExecutionEnvironment(env: Environment) {
  if (env.SUPPLIER_FEED_AUTOMATION_ENABLED !== 'true') throw new ExecutionError(503, 'automation_disabled')
  // Sandbox-only for this phase. Enabling any other project requires a separate release decision.
  if (env.SUPPLIER_FEED_EXPECTED_PROJECT_REF !== sandbox || env.SUPABASE_URL !== `https://${sandbox}.supabase.co`)
    throw new ExecutionError(503, 'project_mismatch')
}
const planningRPCs = new Set(['block2e_create_run', 'block2e_begin_staging', 'block2e_stage_row', 'block2e_freeze_plan', 'block2e_record_source_check'])
const readTables = new Set(['supplier_feed_sources', 'supplier_feed_source_checks', 'supplier_feed_runs', 'supplier_feed_rows', 'supplier_products', 'supplier_product_aliases'])
const readMethods = new Set(['select', 'eq', 'in', 'not', 'order', 'range', 'limit', 'single', 'maybeSingle', 'abortSignal'])
// Runtime capability boundary, not just a TypeScript interface. No arbitrary RPC
// or DML method is forwarded to the privileged client.
export function planningFacade(db: Database, deadline: number, now = Date.now): Database {
  function gate() { if (now() >= deadline) throw new ExecutionError(504, 'deadline') }
  function wrap(query: any): any {
    return new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve: any, reject: any) => {
        gate()
        const signal = AbortSignal.timeout(Math.max(1, Math.min(executionLimits.requestMs, deadline - now())))
        return Promise.resolve(typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query).then(resolve, reject)
      }
      if (typeof key !== 'string' || !readMethods.has(key)) throw new ExecutionError(500, 'capability_denied')
      return (...args: any[]) => { gate(); return wrap(query[key](...args)) }
    } })
  }
  return {
    from(table) { gate(); if (!readTables.has(table)) throw new ExecutionError(500, 'capability_denied'); return wrap(db.from(table)) },
    rpc(name, args) { gate(); if (!planningRPCs.has(name)) throw new ExecutionError(500, 'capability_denied'); return wrap(db.rpc(name, args)) },
  }
}
async function checked(query: any) {
  const result = await (typeof query.abortSignal === 'function' ? query.abortSignal(AbortSignal.timeout(executionLimits.requestMs)) : query)
  if (result.error) throw new ExecutionError(503, 'persistence_unconfirmed')
  return result.data
}
export type ExecutionResponse = { outcome: 'already_running' | 'unchanged' | 'planned' | 'failed'; attemptId?: string; checkId?: string; runId?: string; runStatus?: string; elapsedMs: number; code?: string }
export async function executeSupplierFeedCheck(deps: {
  getSupabaseAdmin: () => Database; env?: Environment; now?: () => number;
  orchestrate?: typeof orchestrateWessexCheckAndPlan;
}, trigger: 'scheduled' | 'manual', feedId = wessexSource.feedSourceId): Promise<ExecutionResponse> {
  const env = deps.env ?? process.env
  checkExecutionEnvironment(env)
  if (feedId !== wessexSource.feedSourceId) throw new ExecutionError(400, 'unsupported_feed')
  const now = deps.now ?? Date.now, started = now(), deadline = started + executionLimits.workMs
  const db = deps.getSupabaseAdmin()
  const attempt = await checked(db.rpc('block2e_claim_feed_execution', { p_source_id: feedId, p_trigger: trigger }))
  if (!attempt) return { outcome: 'already_running', elapsedMs: now() - started }
  if (typeof attempt.id !== 'string' || typeof attempt.ownership_token !== 'string') throw new ExecutionError(503, 'persistence_unconfirmed')
  const safeDb = planningFacade(db, deadline, now)
  const store = createSupabaseBlock2eStore(() => safeDb)
  let result: WessexOrchestrationResult | undefined
  let outcome: 'unchanged' | 'planned' | 'failed' = 'failed'
  let stage = 'planning'
  let code: string | undefined
  let runStatus: string | undefined
  try {
    result = await (deps.orchestrate ?? orchestrateWessexCheckAndPlan)(store, {
      source: wessexSource, acquisitionComplete: true, completeReleaseConfirmed: true,
      fetchTimeoutMs: Math.min(30_000, Math.max(1, deadline - now())),
    })
    if (result.outcome === 'planned') {
      const run = await checked(safeDb.from('supplier_feed_runs').select(runColumns).eq('id', result.runId).single())
      if (!run || run.feed_source_id !== feedId || run.supplier_id !== wessexSource.supplierId || run.scope_key !== wessexSource.scopeKey
        || run.source_checksum !== result.latestSha256 || run.plan_fingerprint !== result.planFingerprint || isSynthetic(run)) throw new ExecutionError(503, 'plan_unconfirmed')
      const control = await readRunControl(safeDb, run)
      if (control.synthetic || control.progress.total !== run.row_count || control.progress.version2 !== control.progress.total) throw new ExecutionError(503, 'plan_unconfirmed')
      // Existing approved/applied runs are observations only, never transitioned.
      if (!result.reusedExistingRun && (run.status !== 'awaiting_approval' || run.approved_by || run.approved_at || run.approved_plan_fingerprint
        || control.progress.pending !== control.progress.total || control.progress.applied || control.progress.failed || control.progress.conflict)) throw new ExecutionError(503, 'plan_unconfirmed')
      outcome = 'planned'
      runStatus = run.status
    } else if (result.outcome === 'unchanged') outcome = 'unchanged'
    else { stage = result.outcome === 'check_error' ? 'checking' : 'planning'; code = result.errorCode }
    const check = await checked(safeDb.from('supplier_feed_source_checks').select('id,feed_source_id,status,feed_run_id,plan_fingerprint').eq('id', result.checkId).single())
    if (!check || check.feed_source_id !== feedId || (outcome === 'planned' && result.outcome === 'planned' && (check.status !== 'changed' || check.feed_run_id !== result.runId || check.plan_fingerprint !== result.planFingerprint))
      || (outcome === 'unchanged' && check.status !== 'unchanged')) throw new ExecutionError(503, 'check_unconfirmed')
  } catch (error) {
    outcome = 'failed'; code = error instanceof ExecutionError ? error.code : 'execution_failed'
    stage = now() >= deadline ? 'deadline' : 'persistence'
  }
  const runId = result && 'runId' in result ? result.runId : null
  const checkId = result?.checkId ?? null
  const finish = { p_attempt_id: attempt.id, p_token: attempt.ownership_token, p_outcome: outcome,
    p_stage: outcome === 'failed' ? stage : 'complete', p_check_id: checkId, p_run_id: runId }
  // Lost finish response may mean commit succeeded; exact readback is authority.
  try { await checked(db.rpc('block2e_finish_feed_execution', finish)) } catch { /* verify below */ }
  const persisted = await checked(db.from('supplier_feed_execution_attempts').select('id,outcome,completed_at,source_check_id,feed_run_id').eq('id', attempt.id).single())
  if (!persisted || persisted.outcome !== outcome || !persisted.completed_at || persisted.source_check_id !== checkId || persisted.feed_run_id !== runId)
    throw new ExecutionError(503, 'persistence_unconfirmed')
  return { outcome, attemptId: attempt.id, ...(checkId ? { checkId } : {}), ...(runId ? { runId } : {}), ...(outcome === 'planned' ? { runStatus } : {}), elapsedMs: now() - started, ...(code ? { code } : {}) }
}

// Match existing mutation-origin policy without widening Phase 5D action inputs.
function safeManual(req: VercelRequest) {
  const { origin, host, 'sec-fetch-site': site } = req.headers
  if (Array.isArray(origin) || Array.isArray(host) || Array.isArray(site) || (site && !['same-origin', 'none'].includes(site))) return false
  if (origin !== undefined) {
    try {
      const url = new URL(origin)
      const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if (url.origin !== origin || url.host !== host || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) return false
    } catch { return false }
  }
  return typeof req.headers.authorization === 'string' && /^Bearer [^\s]+$/i.test(req.headers.authorization)
}
export function createCheckHandler(deps: PlatformDependencies, trigger: 'scheduled' | 'manual') {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store')
    const method = trigger === 'scheduled' ? 'GET' : 'POST'
    if (req.method !== method) { res.setHeader('Allow', method); return res.status(405).end() }
    try {
      if (trigger === 'scheduled') {
        const secret = process.env.CRON_SECRET, header = req.headers.authorization
        if (!secret || !/^[^\s]{16,256}$/.test(secret) || typeof header !== 'string' || header.length !== secret.length + 7
          || !timingSafeEqual(Buffer.from(header), Buffer.from(`Bearer ${secret}`))) throw new ExecutionError(403, 'unauthorized')
        if (Object.keys(req.query ?? {}).length || (req.body !== undefined && req.body !== '')) throw new ExecutionError(400, 'invalid_request')
      } else {
        try { await deps.requirePlatformAdmin(req) } catch { throw new ExecutionError(403, 'unauthorized') }
        if (!safeManual(req)) throw new ExecutionError(403, 'unauthorized')
        if (typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'])) throw new ExecutionError(415, 'invalid_content_type')
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1
          || req.body.feedId !== wessexSource.feedSourceId || Object.keys(req.query ?? {}).length) throw new ExecutionError(400, 'invalid_request')
      }
      const result = await executeSupplierFeedCheck(deps, trigger)
      return res.status(result.outcome === 'failed' ? 503 : 200).json(result)
    } catch (error) {
      const status = error instanceof ExecutionError ? error.status : 503
      return res.status(status).json({ error: error instanceof ExecutionError ? error.code : 'supplier_check_not_confirmed' })
    }
  }
}
