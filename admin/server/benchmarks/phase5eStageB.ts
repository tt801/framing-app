import { randomUUID, timingSafeEqual } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js'
import { parseWessexMouldings } from '../platform/supplierFeeds/wessexMouldings.js'
import { readStageBFixture, stageBFixtureManifest } from './phase5eStageBFixture.js'
import { createSupabaseBlock2eStore, orchestrateWessexCheckAndPlan, type Block2eStore } from '../platform/supplierFeeds/block2eOrchestrator.js'
import { executionLimits, planningFacade } from '../platform/supplier-feed-checks.js'
import { postgresJsonBytes } from '../platform/supplierFeeds/batchStaging.js'
import { normalizeWessexArtifact } from '../platform/supplierFeeds/wessexNormalization.js'
import { readRunControl } from '../platform/supplierFeeds/control.js'

const sandbox = 'zminmylvmtyglkujxxyk'
const sandboxUrl = 'https://zminmylvmtyglkujxxyk.supabase.co'
const project = 'prj_dcEP7V7BF01v09o2au9FpqsLjCDu'
const branch = 'phase5e-stage-b-benchmark'
export function loadStageBArtifact(sourceId: string, retrievedAt: string) {
  const bytes = readStageBFixture()
  const artifact = parseWessexMouldings(bytes, {
    // Required parser metadata is exclusively a LOCAL format-validation input.
    sourceUrl: 'https://www.wessexpictures.com/res/WessexMouldings.xls', originalFilename: 'WessexMouldings.xls',
    byteSize: bytes.length, sha256: stageBFixtureManifest.sha256, retrievedAt,
    etag: null, lastModified: stageBFixtureManifest.simulatedLastModified,
  })
  artifact.acquisition.sourceUrl = `https://phase5e-stageb-synthetic.invalid/${sourceId}/fixture-v1.xls`
  artifact.acquisition.originalFilename = 'PHASE5E-SYNTHETIC-STAGEB-V1.xls'
  return artifact
}
type Environment = Record<string, string | undefined>
export type BenchmarkDependencies = {
  env?: Environment
  wallNow?: () => number
  monotonicNow?: () => number
  getClient?: (url: string, key: string, options: SupabaseClientOptions<'public'>) => Database
  fetch?: typeof fetch
  orchestrate?: typeof orchestrateWessexCheckAndPlan
  log?: (evidence: Record<string, unknown>) => void
}
class BenchmarkError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}
function requireCondition(condition: unknown, status: number, code: string): asserts condition {
  if (!condition) throw new BenchmarkError(status, code)
}
type Database = { from: (table: string) => any; rpc: (name: string, args: any) => any }
type BatchTiming = { batch: number; rows: number; jsonbBytes: number; httpBodyBytes: number | null; rpcMs: number | null; checkpointMs: number | null; storeMs: number | null }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const expectedCounts = Object.freeze({ create: 1194, update: 0, unchanged: 0, review: 0, reject: 0, potential_missing: 0, cost_changes: 0 })
const provenance = (sourceId: string) => ({
  artifactUrl: `https://phase5e-stageb-synthetic.invalid/${sourceId}/fixture-v1.xls`,
  manifestUrl: `https://phase5e-stageb-synthetic.invalid/${sourceId}/manifest-v1.json`,
  logicalKey: `wessex:${sourceId}:${stageBFixtureManifest.sha256}`,
  dateRaw: `SYNTHETIC STAGE B VERIFICATION — simulated ${stageBFixtureManifest.simulatedUpdateDate}`,
})

// Supervisor capabilities stay private; the orchestrator receives only the narrowed store.
export function createStageBBoundary(options: {
  db: Database; supplierId: string; sourceId: string; deadline: number;
  wallNow?: () => number; monotonicNow?: () => number; log?: (evidence: Record<string, unknown>) => void;
}) {
  const { db, supplierId, sourceId, deadline } = options
  const clock = options.monotonicNow ?? (() => performance.now()), wall = options.wallNow ?? Date.now
  const urls = provenance(sourceId), timingsMs: Record<string, number> = {}, rpcCounts: Record<string, number> = {}, batches: BatchTiming[] = []
  let halted = false, runId: string | undefined, checkId: string | undefined, fingerprint: string | undefined
  let createDispatched = false, registrationDispatched = false, claimDispatched = false, finishDispatched = false
  let permittedRpc: string | undefined, attempt: { id: string; ownership_token: string } | undefined, activeBatch: BatchTiming | undefined
  let normalizationStart = 0, readsStart = 0, readsEnd = 0, readsFinished = 0, stagingStart = 0
  const stop = (code = 'benchmark_unconfirmed'): never => { halted = true; throw new BenchmarkError(503, code) }
  const guard = (condition: unknown, code = 'capability_denied') => { if (!condition) stop(code) }
  const gate = (write: boolean) => { guard(wall() < deadline, 'deadline'); if (write) guard(!halted, 'writes_stopped') }
  const tracked = (query: any, rpcName?: string, queryState = { checkpoint: false }): any => {
    let execution: Promise<any> | undefined
    return new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve: any, reject: any) => {
        execution ??= (async () => {
          gate(Boolean(rpcName)); const started = clock()
          try {
            const noRetry = typeof query?.retry === 'function' ? query.retry(false) : query
            const bounded = typeof noRetry?.abortSignal === 'function' ? noRetry.abortSignal(AbortSignal.timeout(Math.max(1, Math.min(executionLimits.requestMs, deadline - wall())))) : noRetry
            const result = await bounded
            if (!result || result.error) stop('persistence_unconfirmed')
            return result
          } catch { return stop('persistence_unconfirmed') }
          finally {
            const elapsed = clock() - started
            if (rpcName === 'block2e_stage_rows' && activeBatch) activeBatch.rpcMs = elapsed
            if (queryState.checkpoint && activeBatch) activeBatch.checkpointMs = elapsed
          }
        })()
        return execution.then(resolve, reject)
      }
      return (...args: any[]) => {
        if (key === 'in' && args[0] === 'id') queryState.checkpoint = true
        if (key === 'abortSignal' && typeof query?.abortSignal !== 'function') return tracked(query, rpcName, queryState)
        return tracked(query?.[key](...args), rpcName, queryState)
      }
    } })
  }
  const instrumented: Database = {
    from: table => tracked(db.from(table)),
    rpc(name, args) {
      gate(true); guard(name === permittedRpc && name !== 'block2e_stage_row')
      rpcCounts[name] = (rpcCounts[name] ?? 0) + 1
      return tracked(db.rpc(name, args), name)
    },
  }
  const safeDb = planningFacade(instrumented, deadline, wall), base = createSupabaseBlock2eStore(() => safeDb)
  const writeRpc: Partial<Record<keyof Block2eStore, string>> = {
    createRun: 'block2e_create_run', beginStaging: 'block2e_begin_staging', stageRows: 'block2e_stage_rows',
    freezePlan: 'block2e_freeze_plan', recordSourceCheck: 'block2e_record_source_check',
  }
  const store = {} as Block2eStore
  for (const name of Object.keys(base) as (keyof Block2eStore)[]) {
    ;(store as any)[name] = async (...args: any[]) => {
      const started = clock(), write = Boolean(writeRpc[name]); gate(write)
      guard(name !== 'stageRow')
      if (name === 'ensureFeedSource' || name === 'findReleaseByChecksum') {
        guard(args[0].supplierId === supplierId && args[0].feedSourceId === sourceId && args[0].scopeKey === 'mouldings')
        if (name === 'findReleaseByChecksum') guard(args[1] === stageBFixtureManifest.sha256)
      }
      if (name === 'getLatestSuccessfulChecksum') guard(args[0] === sourceId)
      if (name === 'findRunByLogicalKey') guard(args[0] === supplierId && args[1] === urls.logicalKey)
      if (name === 'listCanonicalProducts' || name === 'listSourceKeyAliases') {
        guard(args[0] === supplierId); readsStart ||= started
        timingsMs.normalizationBoundary = started - normalizationStart
      }
      if (name === 'createRun') {
        const input = args[0]
        guard(!createDispatched && input.supplierId === supplierId && input.sourceId === sourceId && input.scopeKey === 'mouldings'
          && input.logicalRunKey === urls.logicalKey && input.checksum === stageBFixtureManifest.sha256
          && input.artifactRef === `${urls.artifactUrl}#sha256=${stageBFixtureManifest.sha256}`
          && input.mode === 'apply_requested' && input.coverage === 'snapshot' && input.authoritative === true
          && input.adapterId === 'wessex-wpp4-mouldings' && input.adapterVersion === '2' && input.plannerVersion === 'block2e-planner-v1'
          && input.acquisitionComplete === true && input.parsingComplete === true && input.validationSafeForMissing === true && input.missingInferenceEnabled === true)
        createDispatched = true
      }
      if (['beginStaging', 'stageRows', 'verifyStagedPlan', 'freezePlan', 'readRun'].includes(name)) guard(uuid(runId) && args[0] === runId)
      if (name === 'beginStaging') timingsMs.plannerBoundary = started - readsEnd
      if (name === 'stageRows') {
        guard(args[1].every((row: any) => row.proposed_action === 'create' && row.proposed_product?.supplierId === supplierId
          && row.proposed_product?.sourceId === sourceId && row.proposed_product?.runId === runId
          && row.source_product_key?.startsWith(stageBFixtureManifest.referencePrefix)))
        stagingStart ||= started
        activeBatch = { batch: batches.length + 1, rows: args[1].length, jsonbBytes: postgresJsonBytes(args[1]), httpBodyBytes: null, rpcMs: null, checkpointMs: null, storeMs: null }
        batches.push(activeBatch)
      }
      if (name === 'verifyStagedPlan') {
        guard(Object.entries(expectedCounts).every(([key, value]) => args[1][key] === value))
        timingsMs.stagingWall = started - stagingStart
      }
      if (name === 'freezePlan') guard(args[1] && Reflect.ownKeys(args[1]).length === 0)
      if (name === 'recordSourceCheck') {
        const input = args[0]
        guard(!checkId && input.feedSourceId === sourceId && input.feedRunId === runId && input.planFingerprint === fingerprint && digest(fingerprint)
          && input.status === 'changed' && input.sourceUrl === urls.artifactUrl && input.publishedUpdateSourceUrl === urls.manifestUrl
          && input.publishedUpdateDateRaw === urls.dateRaw && input.publishedUpdateDate === stageBFixtureManifest.simulatedUpdateDate
          && input.publishedUpdateMatch === urls.dateRaw && input.artifactRetrievedAt === input.evidenceRetrievedAt
          && input.sha256 === stageBFixtureManifest.sha256 && input.releaseLogicalKey === urls.logicalKey
          && input.contentByteLength === stageBFixtureManifest.byteLength && input.lastModified === stageBFixtureManifest.simulatedLastModified
          && input.etag == null && input.errorCode == null && input.errorSummary == null)
      }
      permittedRpc = writeRpc[name]
      try {
        const result = await (base[name] as any)(...args)
        if (name === 'createRun') { guard(uuid(result), 'run_unconfirmed'); runId = result; normalizationStart = clock() }
        if (name === 'beginStaging') stagingStart = clock()
        if (name === 'getLatestSuccessfulChecksum' || name === 'findReleaseByChecksum' || name === 'findRunByLogicalKey') guard(result === null, 'existing_identity_not_allowed')
        if (name === 'listCanonicalProducts' || name === 'listSourceKeyAliases') {
          guard(result.length === 0, 'fresh_supplier_not_empty'); readsEnd = clock(); readsFinished++
          if (readsFinished === 2) timingsMs.canonicalAliasReadsWall = readsEnd - readsStart
        }
        if (name === 'freezePlan') { guard(digest(result), 'freeze_unconfirmed'); fingerprint = result }
        if (name === 'recordSourceCheck') { guard(uuid(result), 'check_unconfirmed'); checkId = result }
        return result
      } catch { return stop('store_unconfirmed') }
      finally {
        permittedRpc = undefined; timingsMs[name] = (timingsMs[name] ?? 0) + clock() - started
        if (name === 'stageRows' && activeBatch) {
          activeBatch.storeMs = clock() - started
          options.log?.({ event: 'stage_b_batch_checkpoint', supplierId, sourceId, runId, confirmed: !halted, batch: { ...activeBatch } })
        }
      }
    }
  }
  async function supervisorRpc(name: string, args: Record<string, unknown>) {
    gate(true); permittedRpc = name
    try { return (await instrumented.rpc(name, args)).data }
    finally { permittedRpc = undefined }
  }
  return {
    store, safeDb, timingsMs, rpcCounts, batches, stopped: () => halted,
    ids: () => ({ supplierId, sourceId, attemptId: attempt?.id, runId, checkId }),
    stop: () => { halted = true },
    recordHttpBytes: (bytes: number) => { if (activeBatch) activeBatch.httpBodyBytes = bytes },
    async register(metadata: Record<string, unknown>) {
      gate(true); guard(!registrationDispatched); registrationDispatched = true
      await tracked(db.from('suppliers').insert({ id: supplierId, name: stageBFixtureManifest.purpose, slug: `phase5e-stageb-synthetic-${supplierId}`,
        status: 'draft', countries: [], source_metadata: metadata, asset_rights_status: 'unknown' }))
      const supplier = (await tracked(db.from('suppliers').select('id,name,status,source_metadata').eq('id', supplierId).single())).data
      guard(supplier?.id === supplierId && supplier.name === stageBFixtureManifest.purpose && supplier.status === 'draft'
        && supplier.source_metadata?.synthetic === true && supplier.source_metadata?.sha256 === stageBFixtureManifest.sha256, 'registration_unconfirmed')
      gate(true)
      await tracked(db.from('supplier_feed_sources').insert({ id: sourceId, supplier_id: supplierId, source_key: `PHASE5E-SYNTHETIC-STAGEB-V1-${sourceId}`,
        scope_key: 'mouldings', allows_authoritative_snapshots: true }))
      const source = (await tracked(db.from('supplier_feed_sources').select('*').eq('id', sourceId).single())).data
      guard(source?.id === sourceId && source.supplier_id === supplierId && source.scope_key === 'mouldings' && source.allows_authoritative_snapshots === true, 'registration_unconfirmed')
    },
    async claim() {
      guard(!claimDispatched); claimDispatched = true
      const claimed = await supervisorRpc('block2e_claim_feed_execution', { p_source_id: sourceId, p_trigger: 'manual' })
      guard(uuid(claimed?.id) && uuid(claimed?.ownership_token) && claimed.feed_source_id === sourceId && claimed.outcome === 'running' && claimed.completed_at == null, 'attempt_unconfirmed')
      attempt = { id: claimed.id, ownership_token: claimed.ownership_token }
      const saved = (await tracked(db.from('supplier_feed_execution_attempts').select('id,feed_source_id,outcome,completed_at').eq('id', attempt.id).single())).data
      guard(saved?.id === attempt.id && saved.feed_source_id === sourceId && saved.outcome === 'running' && saved.completed_at == null, 'attempt_unconfirmed')
    },
    async complete() {
      guard(!finishDispatched && attempt && checkId && runId); finishDispatched = true
      await supervisorRpc('block2e_finish_feed_execution', { p_attempt_id: attempt!.id, p_token: attempt!.ownership_token,
        p_outcome: 'planned', p_stage: 'complete', p_check_id: checkId!, p_run_id: runId! })
      const saved = (await tracked(db.from('supplier_feed_execution_attempts').select('id,feed_source_id,outcome,stage,completed_at,source_check_id,feed_run_id').eq('id', attempt!.id).single())).data
      guard(saved?.id === attempt!.id && saved.feed_source_id === sourceId && saved.outcome === 'planned' && saved.stage === 'complete'
        && saved.completed_at && saved.source_check_id === checkId && saved.feed_run_id === runId, 'attempt_unconfirmed')
      return { id: saved.id, outcome: saved.outcome, stage: saved.stage, completedAt: saved.completed_at, checkId: saved.source_check_id, runId: saved.feed_run_id }
    },
  }
}
type Boundary = ReturnType<typeof createStageBBoundary>
function latencyDistribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
  return { count: sorted.length, min: sorted[0] ?? null, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
    p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1) ?? null, method: 'nearest-rank' }
}
async function verifyFinal(boundary: Boundary, result: Awaited<ReturnType<typeof orchestrateWessexCheckAndPlan>>) {
  const ids = boundary.ids(), urls = provenance(ids.sourceId)
  requireCondition(!boundary.stopped() && result.outcome === 'planned' && result.runId === ids.runId && result.checkId === ids.checkId
    && result.planFingerprint && result.latestSha256 === stageBFixtureManifest.sha256, 503, 'result_unconfirmed')
  const run = (await boundary.safeDb.from('supplier_feed_runs').select('*').eq('id', ids.runId).single()).data
  requireCondition(run?.id === ids.runId && run.supplier_id === ids.supplierId && run.feed_source_id === ids.sourceId
    && run.logical_run_key === urls.logicalKey && run.source_checksum === stageBFixtureManifest.sha256
    && run.artifact_ref === `${urls.artifactUrl}#sha256=${stageBFixtureManifest.sha256}`
    && run.persistence_version === 2 && run.status === 'awaiting_approval' && run.row_count === 1194
    && digest(run.plan_fingerprint) && run.plan_fingerprint === result.planFingerprint
    && Object.entries(expectedCounts).every(([key, value]) => run.plan_counts?.[key] === value)
    && run.approved_by == null && run.approved_at == null && run.approved_plan_fingerprint == null
    && run.acknowledged_anomalies == null && run.applied_by == null && run.failure_code == null, 503, 'persisted_run_unconfirmed')
  const check = (await boundary.safeDb.from('supplier_feed_source_checks').select('*').eq('id', ids.checkId).single()).data
  requireCondition(check?.feed_source_id === ids.sourceId && check.feed_run_id === ids.runId && check.plan_fingerprint === run.plan_fingerprint
    && check.status === 'changed' && check.release_classification === 'changed' && check.source_url === urls.artifactUrl && check.published_update_source_url === urls.manifestUrl
    && check.published_update_date_raw === urls.dateRaw && check.published_update_date === stageBFixtureManifest.simulatedUpdateDate
    && check.published_update_match === urls.dateRaw && check.etag == null
    && check.sha256 === stageBFixtureManifest.sha256 && check.content_byte_length === stageBFixtureManifest.byteLength
    && check.last_modified === stageBFixtureManifest.simulatedLastModified && check.release_logical_key === urls.logicalKey
    && check.error_code == null && check.error_summary == null, 503, 'persisted_check_unconfirmed')
  const control = await readRunControl(boundary.safeDb, run)
  requireCondition(control.synthetic === true && control.canApprove === false && control.canApply === false && control.canContinue === false
    && control.progress.total === 1194 && control.progress.version2 === 1194 && control.progress.pending === 1194
    && ['applied', 'skipped', 'failed', 'conflict'].every(key => (control.progress as any)[key] === 0), 503, 'synthetic_controls_unconfirmed')
  const keys = new Set<string>(); let staged = 0
  for (let offset = 0; offset < 1500; offset += 500) {
    const rows: any[] = (await boundary.safeDb.from('supplier_feed_rows').select('id,feed_run_id,row_persistence_version,proposed_action,source_product_key,validation_status,apply_state,applied_at,result_product_id,result_product_revision,failure_code')
      .eq('feed_run_id', ids.runId).order('id').range(offset, offset + 499)).data
    requireCondition(Array.isArray(rows), 503, 'rows_unconfirmed')
    for (const row of rows) {
      requireCondition(row.feed_run_id === ids.runId && row.row_persistence_version === 2 && row.proposed_action === 'create' && row.validation_status === 'valid'
        && row.source_product_key?.startsWith(stageBFixtureManifest.referencePrefix) && row.apply_state === 'pending' && row.applied_at == null
        && row.result_product_id == null && row.result_product_revision == null && row.failure_code == null, 503, 'rows_unconfirmed')
      keys.add(row.source_product_key); staged++
    }
    if (rows.length < 500) break
  }
  requireCondition(staged === 1194 && keys.size === 1194 && boundary.rpcCounts.block2e_stage_rows === 24 && boundary.batches.length === 24
    && boundary.batches.every((batch, i) => batch.rows === (i === 23 ? 44 : 50) && batch.jsonbBytes <= 131072 && batch.rpcMs !== null && batch.checkpointMs !== null), 503, 'counts_unconfirmed')
  return { persisted: { staged, status: run.status, persistenceVersion: run.persistence_version, counts: { ...expectedCounts }, approvalUnset: true, applicationUnset: true },
    frozenFingerprint: run.plan_fingerprint, control: { synthetic: control.synthetic, canApprove: control.canApprove, canApply: control.canApply, canContinue: control.canContinue, progress: control.progress } }
}
function admission(req: VercelRequest, env: Environment, now: number) {
  const secret = env.PHASE5E_STAGE_B_SECRET, header = req.headers.authorization
  requireCondition(typeof secret === 'string' && /^[^\s]{32,256}$/.test(secret), 403, 'unauthorized')
  requireCondition(typeof header === 'string' && header.length === secret!.length + 7
    && Buffer.byteLength(header) === Buffer.byteLength(`Bearer ${secret}`)
    && timingSafeEqual(Buffer.from(header), Buffer.from(`Bearer ${secret}`)), 403, 'unauthorized')
  const expiry = env.PHASE5E_STAGE_B_EXPIRES_AT
  const instant = typeof expiry === 'string' ? Date.parse(expiry) : NaN
  requireCondition(typeof expiry === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(expiry)
    && Number.isFinite(instant) && new Date(instant).toISOString() === expiry && instant - now >= 300000, 403, 'execution_window_closed')
  requireCondition(env.SUPABASE_URL === `https://${sandbox}.supabase.co`
    && env.SUPPLIER_FEED_EXPECTED_PROJECT_REF === sandbox && Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim()), 503, 'sandbox_guard')
  const expected: Environment = {
    VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'preview', VERCEL_PROJECT_ID: project,
    VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'tt801', VERCEL_GIT_REPO_SLUG: 'framing-app', VERCEL_GIT_COMMIT_REF: branch,
  }
  requireCondition(Object.entries(expected).every(([key, value]) => env[key] === value)
    && /^dpl_[A-Za-z0-9]+$/.test(env.VERCEL_DEPLOYMENT_ID ?? '')
    && /^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ''), 503, 'preview_guard')
  requireCondition(Object.keys(req.query ?? {}).length === 0 && !req.url?.includes('?'), 400, 'invalid_request')
  if (req.method === 'POST') requireCondition(req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    && Object.getPrototypeOf(req.body) === Object.prototype && Reflect.ownKeys(req.body).length === 0, 400, 'invalid_request')
  else requireCondition(req.body === undefined || req.body === '', 400, 'invalid_request')
  return {
    projectId: project, deploymentId: env.VERCEL_DEPLOYMENT_ID!, gitSha: env.VERCEL_GIT_COMMIT_SHA!,
    branch, environment: 'preview', targetEnvironment: 'preview',
    region: /^[a-z]{3}\d$/.test(env.VERCEL_REGION ?? '') ? env.VERCEL_REGION : null, nodeVersion: process.version,
  }
}
export function createPhase5eStageBHandler(deps: BenchmarkDependencies = {}) {
  const instanceId = randomUUID(); let invocation = 0
  return async (req: VercelRequest, res: VercelResponse) => {
    const clock = deps.monotonicNow ?? (() => performance.now()), wall = deps.wallNow ?? Date.now
    const started = clock(), wallStarted = wall(), environment = deps.env ?? process.env
    const log = (event: Record<string, unknown>) => { try { (deps.log ?? (value => console.info(JSON.stringify(value))))(event) } catch { /* Logging cannot change execution or cause a retry. */ } }
    let boundary: Boundary | undefined
    const evidence: Record<string, any> = { schemaVersion: 1, synthetic: true, instanceId, invocationOrdinal: ++invocation, fixture: stageBFixtureManifest, timingsMs: {}, orchestrationInvocations: 0 }
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'POST'].includes(req.method ?? '')) {
      res.setHeader('Allow', 'GET, POST'); res.status(405).json({ outcome: 'rejected', code: 'method_not_allowed' }); return
    }
    try {
      const deployment = admission(req, environment, wallStarted)
      evidence.deployment = deployment
      if (req.method === 'GET') {
        res.status(200).json({ outcome: 'preflight', synthetic: true, deployment, fixture: stageBFixtureManifest,
          limits: { ...executionLimits }, handlerMs: clock() - started }); return
      }
      const measure = async <T,>(name: string, operation: () => Promise<T> | T): Promise<T> => {
        const phase = clock(); try { return await operation() } finally { evidence.timingsMs[name] = clock() - phase }
      }
      const supplierId = randomUUID(), sourceId = randomUUID(), urls = provenance(sourceId)
      evidence.ids = { supplierId, sourceId }
      const artifact = await measure('fixtureVerificationParsing', () => loadStageBArtifact(sourceId, new Date(wallStarted).toISOString()))
      const normalized = await measure('normalization', () => normalizeWessexArtifact(artifact, {
        supplierId, sourceId, runId: randomUUID(), scopeId: 'mouldings', publishedDatabaseUpdateDate: stageBFixtureManifest.simulatedUpdateDate,
        acquisitionComplete: true, completeReleaseConfirmed: true,
      }))
      evidence.accepted = normalized.candidates.length; evidence.rejected = normalized.rejected.length
      requireCondition(evidence.accepted === 1194 && evidence.rejected === 0 && normalized.planningRows.length === 1194, 503, 'fixture_rows_invalid')
      const deadline = wallStarted + executionLimits.workMs
      requireCondition(wall() < deadline, 503, 'deadline')
      const transport: typeof fetch = async (input, init) => {
        try {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
          const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
          const tables = ['suppliers', 'supplier_feed_sources', 'supplier_feed_runs', 'supplier_feed_rows', 'supplier_feed_source_checks', 'supplier_feed_execution_attempts', 'supplier_products', 'supplier_product_aliases']
          const rpcs = ['block2e_claim_feed_execution', 'block2e_finish_feed_execution', 'block2e_create_run', 'block2e_begin_staging', 'block2e_stage_rows', 'block2e_freeze_plan', 'block2e_record_source_check']
          const path = url.pathname.slice('/rest/v1/'.length)
          requireCondition(boundary && wall() < deadline && url.origin === sandboxUrl && !url.username && !url.password && !url.hash
            && url.pathname.startsWith('/rest/v1/') && ((['GET', 'HEAD'].includes(method) && tables.includes(path))
              || (method === 'POST' && !boundary.stopped() && (['suppliers', 'supplier_feed_sources'].includes(path) || rpcs.some(name => path === `rpc/${name}`)))), 503, 'transport_denied')
          if (path === 'rpc/block2e_stage_rows' && typeof init?.body === 'string') boundary.recordHttpBytes(Buffer.byteLength(init.body))
          const result = await (deps.fetch ?? globalThis.fetch)(input, { ...init, redirect: 'error' })
          requireCondition(result.ok && !result.redirected, 503, 'transport_unconfirmed')
          return result
        } catch { boundary?.stop(); throw new BenchmarkError(503, 'transport_unconfirmed') }
      }
      // All admission/fixture checks precede construction; no shared cached client or credential fallback.
      const db = (deps.getClient ?? createClient)(sandboxUrl, environment.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport },
      })
      boundary = createStageBBoundary({ db, supplierId, sourceId, deadline, wallNow: wall, monotonicNow: clock, log })
      await measure('registration', () => boundary!.register({ ...stageBFixtureManifest, sourceUrl: urls.artifactUrl, manifestUrl: urls.manifestUrl }))
      await measure('attemptClaim', () => boundary!.claim())
      log({ event: 'stage_b_attempt_claimed', ...boundary.ids(), fixtureSha: stageBFixtureManifest.sha256 })
      evidence.orchestrationInvocations++
      const result = await measure('orchestration', () => (deps.orchestrate ?? orchestrateWessexCheckAndPlan)(boundary!.store, {
          source: { supplierId, feedSourceId: sourceId, scopeKey: 'mouldings' }, acquisitionComplete: true, completeReleaseConfirmed: true,
          fetchCheck: async () => ({ artifact, normalized, classification: 'changed', hashChanged: true, previousSha256: null, latestSha256: stageBFixtureManifest.sha256,
            publishedUpdate: { sourceUrl: urls.manifestUrl, retrievedAt: new Date(wallStarted).toISOString(), matchedText: urls.dateRaw,
              publishedDatabaseUpdateDate: stageBFixtureManifest.simulatedUpdateDate,
              publishedDatabaseUpdateDateRaw: urls.dateRaw, extractionRule: 'fixed_explicitly_synthetic_stage_b_manifest_v1' } }),
        }))
      Object.assign(evidence, await measure('finalPersistedVerification', () => verifyFinal(boundary!, result)))
      evidence.timingsMs.nonAcquisitionThroughFinalReadback = clock() - started
      evidence.attempt = await measure('attemptCompletion', () => boundary!.complete())
      requireCondition(!boundary.stopped(), 503, 'writes_stopped')
      const prepared = clock()
      Object.assign(evidence.timingsMs, boundary.timingsMs)
      evidence.timingsMs.reconciliationReads = (boundary.timingsMs.getLatestSuccessfulChecksum ?? 0) + (boundary.timingsMs.findReleaseByChecksum ?? 0) + (boundary.timingsMs.findRunByLogicalKey ?? 0)
      evidence.timingsMs.checkpointReadbackTotal = boundary.batches.reduce((sum, batch) => sum + (batch.checkpointMs ?? 0), 0)
      evidence.timingsMs.postFreezeReadback = boundary.timingsMs.readRun ?? 0
      evidence.timingsMs.stagingRpcTotal = boundary.batches.reduce((sum, batch) => sum + (batch.rpcMs ?? 0), 0)
      evidence.ids = boundary.ids(); evidence.rpcCounts = { ...boundary.rpcCounts }; evidence.batches = boundary.batches.map(batch => ({ ...batch }))
      evidence.batchLatencyMs = latencyDistribution(boundary.batches.flatMap(batch => batch.rpcMs === null ? [] : [batch.rpcMs]))
      evidence.timingsMs.responsePreparation = clock() - prepared
      evidence.timingsMs.handler = clock() - started
      res.once('finish', () => log({ event: 'stage_b_response_finished', ...boundary!.ids(), handlerThroughResponseFinishMs: clock() - started }))
      log({ event: 'stage_b_completed', ...boundary.ids(), timingsMs: evidence.timingsMs })
      res.status(200).json({ ok: true, outcome: 'planned', evidence })
    } catch (error) {
      boundary?.stop()
      const code = error instanceof BenchmarkError ? error.code : 'benchmark_failed'
      if (!boundary) { res.status(error instanceof BenchmarkError ? error.status : 503).json({ ok: false, outcome: 'failed', code }); return }
      evidence.ids = boundary.ids(); evidence.rpcCounts = { ...boundary.rpcCounts }; evidence.batches = boundary.batches.map(batch => ({ ...batch }))
      evidence.writesStopped = true; Object.assign(evidence.timingsMs, boundary.timingsMs); evidence.timingsMs.handler = clock() - started
      log({ event: 'stage_b_failed', code, ...boundary.ids(), batches: evidence.batches })
      res.status(503).json({ ok: false, outcome: 'failed', code, evidence })
    }
  }
}
