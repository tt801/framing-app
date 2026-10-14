import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { createClient } from '@supabase/supabase-js'
import { install } from './helpers/block2eBatchFixture.js'
import { orchestrateWessexCheckAndPlan } from '../server/platform/supplierFeeds/block2eOrchestrator.js'
import { config, default as route } from '../api/benchmarks/phase5e-stage-b-synthetic.js'
import { createPhase5eStageBHandler, createStageBBoundary, loadStageBArtifact } from '../server/benchmarks/phase5eStageB.js'
import { readStageBFixture, stageBFixtureManifest, verifyStageBFixture } from '../server/benchmarks/phase5eStageBFixture.js'
import { createHash, randomUUID } from 'node:crypto'
import { normalizeWessexArtifact } from '../server/platform/supplierFeeds/wessexNormalization.js'

const time = Date.parse('2026-10-14T14:00:00.000Z')
const secret = 'local-benchmark-secret-not-a-live-credential'
const env = {
  PHASE5E_STAGE_B_SECRET: secret, PHASE5E_STAGE_B_EXPIRES_AT: '2026-10-14T15:00:00.000Z',
  SUPABASE_URL: 'https://zminmylvmtyglkujxxyk.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'local-service-key',
  SUPPLIER_FEED_EXPECTED_PROJECT_REF: 'zminmylvmtyglkujxxyk',
  VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'preview',
  VERCEL_PROJECT_ID: 'prj_dcEP7V7BF01v09o2au9FpqsLjCDu', VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'tt801', VERCEL_GIT_REPO_SLUG: 'framing-app',
  VERCEL_GIT_COMMIT_REF: 'phase5e-stage-b-benchmark', VERCEL_DEPLOYMENT_ID: 'dpl_localBenchmark123',
  VERCEL_GIT_COMMIT_SHA: 'bdecde1854c61b4174aec1be5e9c1305b7736195', VERCEL_REGION: 'iad1',
}
const request = (overrides: Record<string, unknown> = {}) => ({ method: 'GET', query: {}, headers: { authorization: `Bearer ${secret}` }, ...overrides })
const response = () => {
  const res: any = { statusCode: 0, body: undefined, setHeader: vi.fn(), once: vi.fn() }
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: unknown) => { res.body = body; return res })
  return res
}
async function invoke(overrides = {}, configuration: Record<string, string | undefined> = env) {
  const getClient = vi.fn(() => { throw new Error('Database must not be constructed') })
  const res = response()
  await createPhase5eStageBHandler({ env: configuration, wallNow: () => time, getClient, log: vi.fn() })(request(overrides) as any, res as any)
  return { getClient, res, status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] }
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Stage B admission before any database construction', () => {
  it('declares 300 seconds only on the separate route', () => {
    expect(config).toEqual({ maxDuration: 300 }); expect(typeof route).toBe('function')
  })
  it('GET is authenticated metadata-only and works without enabling ordinary automation', async () => {
    const r = await invoke()
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ outcome: 'preflight', synthetic: true, deployment: { environment: 'preview', branch: 'phase5e-stage-b-benchmark' } })
    expect(r.getClient).not.toHaveBeenCalled()
    expect(r.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    expect(JSON.stringify(r.body)).not.toContain(secret)
    expect(JSON.stringify(r.body)).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY)
  })
  it.each(['PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('rejects method %s', async method => {
    const r = await invoke({ method }); expect(r.status).toBe(405); expect(r.getClient).not.toHaveBeenCalled()
  })
  it.each([undefined, '', 'Bearer wrong', 'bearer wrong', ['Bearer wrong'], `Bearer ${secret} extra`, `Bearer ${'é'.repeat(secret.length)}`])('rejects invalid authorization %j', async authorization => {
    const r = await invoke({ headers: { authorization } }); expect(r.status).toBe(403); expect(r.getClient).not.toHaveBeenCalled()
  })
  it.each(['', undefined, 'short'])('rejects missing/malformed configured secret %j', async configured => {
    const r = await invoke({}, { ...env, PHASE5E_STAGE_B_SECRET: configured }); expect(r.status).toBe(403); expect(r.getClient).not.toHaveBeenCalled()
  })
  it.each([undefined, '', 'not-a-date', '2026-10-14T13:59:59.000Z', '2026-10-14T14:04:59.999Z', '2026-10-14T15:00:00+00:00', '2026-02-30T15:00:00.000Z'])('rejects invalid/expired/insufficient window %j', async expiry => {
    const r = await invoke({}, { ...env, PHASE5E_STAGE_B_EXPIRES_AT: expiry }); expect(r.status).toBe(403); expect(r.getClient).not.toHaveBeenCalled()
  })
  it.each(Object.keys(env).filter(k => k !== 'PHASE5E_STAGE_B_SECRET' && k !== 'PHASE5E_STAGE_B_EXPIRES_AT' && k !== 'VERCEL_REGION'))('rejects missing guard %s before constructing a client', async key => {
    const r = await invoke({}, { ...env, [key]: undefined }); expect(r.status).toBe(503); expect(r.getClient).not.toHaveBeenCalled()
  })
  it.each(Object.keys(env).filter(key => key !== 'VERCEL_REGION'))('POST also rejects missing %s before client construction', async key => {
    const r = await invoke({ method: 'POST', body: {} }, { ...env, [key]: undefined })
    expect(r.status).toBe(key.startsWith('PHASE5E_STAGE_B_') ? 403 : 503); expect(r.getClient).not.toHaveBeenCalled()
  })
  it.each([{ method: 'POST', body: {}, query: { sourceId: 'injected' } },
    { method: 'POST', body: {}, url: '/api/benchmarks/phase5e-stage-b-synthetic?url=injected' },
    { method: 'POST', body: Object.create(null) }, { method: 'POST', body: { [Symbol('hidden')]: true } }])('rejects structural/query injection %j', async overrides => {
    const r = await invoke(overrides); expect(r.status).toBe(400); expect(r.getClient).not.toHaveBeenCalled()
  })
  it('accepts precisely a complete 300-second admission window', async () => {
    const r = await invoke({}, { ...env, PHASE5E_STAGE_B_EXPIRES_AT: new Date(time + 300000).toISOString() })
    expect(r.status).toBe(200); expect(r.getClient).not.toHaveBeenCalled()
  })
  it.each([
    ['SUPABASE_URL', 'https://zminmylvmtyglkujxxyk.supabase.co/'], ['SUPABASE_URL', ' https://zminmylvmtyglkujxxyk.supabase.co'],
    ['SUPABASE_URL', 'https://other.invalid'], ['SUPABASE_SERVICE_ROLE_KEY', '   '], ['SUPPLIER_FEED_EXPECTED_PROJECT_REF', 'other'],
    ['VERCEL', '0'], ['VERCEL_ENV', 'production'], ['VERCEL_TARGET_ENV', 'production'], ['VERCEL_TARGET_ENV', 'custom'],
    ['VERCEL_PROJECT_ID', 'prj_other'], ['VERCEL_GIT_PROVIDER', 'other'], ['VERCEL_GIT_REPO_OWNER', 'other'],
    ['VERCEL_GIT_REPO_SLUG', 'other'], ['VERCEL_GIT_COMMIT_REF', 'restart-development'],
    ['VERCEL_DEPLOYMENT_ID', 'malformed'], ['VERCEL_GIT_COMMIT_SHA', 'not-a-sha'],
  ])('rejects mismatching guard %s=%s', async (key, value) => {
    const r = await invoke({}, { ...env, [key]: value }); expect(r.status).toBe(503); expect(r.getClient).not.toHaveBeenCalled()
  })
  it('does not substitute request headers or NODE_ENV for trusted deployment metadata', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const r = await invoke({ headers: { authorization: `Bearer ${secret}`, host: 'benchmark.vercel.app', 'x-vercel-env': 'preview' } }, { ...env, VERCEL_ENV: undefined })
    expect(r.status).toBe(503); expect(r.getClient).not.toHaveBeenCalled()
  })
  it.each([{ query: { supplierId: 'other' } }, { method: 'POST', body: undefined }, { method: 'POST', body: null },
    { method: 'POST', body: [] }, { method: 'POST', body: '{}' }, { method: 'POST', body: { supplierId: 'other' } },
    { method: 'POST', body: { sourceId: 'other' } }, { method: 'POST', body: { url: 'https://other.invalid' } },
    { method: 'POST', body: { artifact: [] } }, { method: 'POST', body: { upload: 'bytes' } }, { method: 'POST', body: { plan: {} } },
    { method: 'POST', body: { rpc: 'apply' } }, { method: 'POST', body: { operation: 'delete' } }, { method: 'POST', body: { unknown: true } },
    { body: { execute: true } }])('rejects input injection %j', async overrides => {
    const r = await invoke(overrides); expect(r.status).toBe(400); expect(r.getClient).not.toHaveBeenCalled()
  })
})

describe('fixed Stage B server-only synthetic fixture', () => {
  it('pins the actual distinct BIFF8 byte length and SHA', () => {
    const bytes = readStageBFixture()
    expect(bytes.length).toBe(225792)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('a1b53ebf47d7e12e24164e04392e8ece1bacf3a85b45b9e04af25ea7aec72dff')
    expect(stageBFixtureManifest).toMatchObject({ synthetic: true, acceptedRows: 1194, byteLength: 225792,
      sha256: 'a1b53ebf47d7e12e24164e04392e8ece1bacf3a85b45b9e04af25ea7aec72dff', referencePrefix: 'PHASE5E-SYNTHETIC-STAGEB-V1-' })
    expect(readStageBFixture()).toEqual(bytes)
    expect(() => verifyStageBFixture(bytes.subarray(1))).toThrow()
    bytes[100] ^= 1
    expect(() => verifyStageBFixture(bytes)).toThrow()
  })
  it('uses the real parser/normalizer for 1194 accepted rows with replaced synthetic provenance and no fetch', () => {
    const network = vi.fn(() => { throw new Error('Network forbidden') }); vi.stubGlobal('fetch', network)
    const sourceId = randomUUID(), artifact = loadStageBArtifact(sourceId, '2026-10-14T14:00:00.000Z')
    expect(artifact.acquisition.sourceUrl).toBe(`https://phase5e-stageb-synthetic.invalid/${sourceId}/fixture-v1.xls`)
    expect(artifact.acquisition.originalFilename).toBe('PHASE5E-SYNTHETIC-STAGEB-V1.xls')
    expect(JSON.stringify(artifact)).not.toContain('https://www.wessexpictures.com/')
    const normalized = normalizeWessexArtifact(artifact, { supplierId: randomUUID(), sourceId, runId: randomUUID(), scopeId: 'mouldings',
      publishedDatabaseUpdateDate: stageBFixtureManifest.simulatedUpdateDate, acquisitionComplete: true, completeReleaseConfirmed: true })
    expect(normalized.candidates).toHaveLength(1194); expect(normalized.rejected).toHaveLength(0)
    expect(normalized.candidates.every(r => r.sourceProductKey.startsWith('PHASE5E-SYNTHETIC-STAGEB-V1-'))).toBe(true)
    expect(network).not.toHaveBeenCalled()
  })
})

function boundaryFixture() {
  const supplierId = randomUUID(), sourceId = randomUUID(), runId = randomUUID()
  const db = { from: vi.fn(), rpc: vi.fn(async (_name: string, _args?: Record<string, unknown>): Promise<{ data: string | null; error: unknown }> => ({ data: runId, error: null })) }
  const boundary = createStageBBoundary({ db, supplierId, sourceId, deadline: time + 240000, wallNow: () => time })
  const input = { supplierId, sourceId, scopeKey: 'mouldings', logicalRunKey: `wessex:${sourceId}:${stageBFixtureManifest.sha256}`,
    mode: 'apply_requested' as const, coverage: 'snapshot' as const, authoritative: true, adapterId: 'wessex-wpp4-mouldings',
    adapterVersion: '2', plannerVersion: 'block2e-planner-v1', checksum: stageBFixtureManifest.sha256,
    artifactRef: `https://phase5e-stageb-synthetic.invalid/${sourceId}/fixture-v1.xls#sha256=${stageBFixtureManifest.sha256}`,
    acquisitionComplete: true, parsingComplete: true, validationSafeForMissing: true, missingInferenceEnabled: true }
  return { db, boundary, input, supplierId, sourceId, runId }
}
describe('harness-local narrowing and fail-stop boundary', () => {
  it.each(['block2e_stage_row', 'block2e_approve_run', 'block2e_apply_row', 'block2e_finish_empty_run', 'arbitrary_rpc'])('denies %s before network dispatch', name => {
    const f = boundaryFixture()
    expect(() => f.boundary.safeDb.rpc(name, {})).toThrow()
    expect(f.db.rpc).not.toHaveBeenCalled()
  })
  it('denies stageRow before dispatch and latches catch-path writes off', async () => {
    const f = boundaryFixture()
    await expect(f.boundary.store.stageRow(f.runId, {})).rejects.toThrow()
    await expect(f.boundary.store.recordSourceCheck({} as any)).rejects.toThrow()
    expect(f.boundary.stopped()).toBe(true); expect(f.db.rpc).not.toHaveBeenCalled()
  })
  it.each(['insert', 'update', 'delete', 'upsert'])('denies canonical/alias DML %s', method => {
    const f = boundaryFixture()
    for (const table of ['supplier_products', 'supplier_product_aliases']) expect(() => f.boundary.safeDb.from(table)[method]({})).toThrow()
    expect(() => f.boundary.safeDb.from('supplier_product_cost_events')).toThrow()
    expect(f.db.rpc).not.toHaveBeenCalled()
  })
  it('binds run creation and disallows a second creation', async () => {
    const f = boundaryFixture()
    expect(await f.boundary.store.createRun(f.input)).toBe(f.runId)
    await expect(f.boundary.store.createRun(f.input)).rejects.toThrow()
    expect(f.db.rpc).toHaveBeenCalledTimes(1)
  })
  it.each(['beginStaging', 'stageRows', 'verifyStagedPlan', 'freezePlan', 'readRun'])('binds %s to only its newly created run', async method => {
    const f = boundaryFixture(); await f.boundary.store.createRun(f.input)
    await expect((f.boundary.store[method as keyof typeof f.boundary.store] as any)(randomUUID(), [])).rejects.toThrow()
    expect(f.db.rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects selecting canonical products for another supplier', async () => {
    const f = boundaryFixture()
    await expect(f.boundary.store.listCanonicalProducts(randomUUID())).rejects.toThrow()
    expect(f.db.from).not.toHaveBeenCalled()
  })
  it('rejects official/error source-check provenance before persistence', async () => {
    const f = boundaryFixture(); await f.boundary.store.createRun(f.input)
    await expect(f.boundary.store.recordSourceCheck({ feedSourceId: f.sourceId, feedRunId: f.runId,
      sourceUrl: 'https://www.wessexpictures.com/res/WessexMouldings.xls', status: 'planning_error' } as any)).rejects.toThrow()
    expect(f.db.rpc).toHaveBeenCalledTimes(1); expect(f.boundary.stopped()).toBe(true)
  })
  it('latches failed create response and never resends it', async () => {
    const f = boundaryFixture(); f.db.rpc.mockResolvedValue({ data: null as any, error: new Error('private transport value') })
    await expect(f.boundary.store.createRun(f.input)).rejects.toThrow()
    await expect(f.boundary.store.createRun(f.input)).rejects.toThrow()
    expect(f.db.rpc).toHaveBeenCalledTimes(1); expect(f.boundary.stopped()).toBe(true)
  })
  it.each(['sourceUrl', 'publishedUpdateSourceUrl', 'publishedUpdateMatch', 'publishedUpdateDateRaw', 'sha256', 'feedRunId', 'planFingerprint'])('validates source-check %s independently after freeze', async field => {
    const f = boundaryFixture(), fingerprint = 'c'.repeat(64)
    f.db.rpc.mockImplementation(async name => ({ data: name === 'block2e_freeze_plan' ? fingerprint : f.runId, error: null }))
    await f.boundary.store.createRun(f.input); await f.boundary.store.freezePlan(f.runId, {})
    const input = { feedSourceId: f.sourceId, feedRunId: f.runId, planFingerprint: fingerprint, status: 'changed',
      sourceUrl: `https://phase5e-stageb-synthetic.invalid/${f.sourceId}/fixture-v1.xls`,
      publishedUpdateSourceUrl: `https://phase5e-stageb-synthetic.invalid/${f.sourceId}/manifest-v1.json`,
      publishedUpdateDate: stageBFixtureManifest.simulatedUpdateDate,
      publishedUpdateDateRaw: `SYNTHETIC STAGE B VERIFICATION — simulated ${stageBFixtureManifest.simulatedUpdateDate}`,
      publishedUpdateMatch: `SYNTHETIC STAGE B VERIFICATION — simulated ${stageBFixtureManifest.simulatedUpdateDate}`,
      artifactRetrievedAt: new Date(time).toISOString(), evidenceRetrievedAt: new Date(time).toISOString(),
      sha256: stageBFixtureManifest.sha256, contentByteLength: stageBFixtureManifest.byteLength,
      lastModified: stageBFixtureManifest.simulatedLastModified, releaseLogicalKey: f.input.logicalRunKey,
      [field]: 'official-or-foreign-evidence' }
    await expect(f.boundary.store.recordSourceCheck(input as any)).rejects.toThrow()
    expect(f.db.rpc).toHaveBeenCalledTimes(2); expect(f.boundary.stopped()).toBe(true)
  })
  it('does not extend the shared cooperative deadline', async () => {
    const f = boundaryFixture(), wallNow = vi.fn(() => time)
    const boundary = createStageBBoundary({ db: f.db, supplierId: f.supplierId, sourceId: f.sourceId, deadline: time + 240000, wallNow })
    wallNow.mockReturnValue(time + 240000)
    await expect(boundary.store.createRun(f.input)).rejects.toThrow()
    expect(f.db.rpc).not.toHaveBeenCalled(); expect(boundary.stopped()).toBe(true)
  })
})

describe('harness transport containment', () => {
  it.each([
    ['https://not-sandbox.invalid/rest/v1/suppliers', 'POST'],
    ['https://zminmylvmtyglkujxxyk.supabase.co/auth/v1/token', 'POST'],
    ['https://zminmylvmtyglkujxxyk.supabase.co/rest/v1/rpc/block2e_stage_row', 'POST'],
    ['https://zminmylvmtyglkujxxyk.supabase.co/rest/v1/rpc/block2e_approve_run', 'POST'],
    ['https://zminmylvmtyglkujxxyk.supabase.co/rest/v1/supplier_products', 'POST'],
    ['https://zminmylvmtyglkujxxyk.supabase.co/rest/v1/suppliers', 'DELETE'],
    ['https://www.wessexpictures.com/res/WessexMouldings.xls', 'GET'],
  ])('denies %s %s before any outbound dispatch', async (url, method) => {
    const outbound = vi.fn(), res = response()
    const getClient = vi.fn((_url: string, _key: string, options: any) => ({
      rpc: vi.fn(), from: () => {
        const query: any = { insert: () => query, abortSignal: () => query,
          then: (resolve: any, reject: any) => options.global.fetch(url, { method, body: method === 'GET' ? undefined : '{}' }).then(resolve, reject) }
        return query
      },
    }))
    await createPhase5eStageBHandler({ env, wallNow: () => time, getClient, fetch: outbound, log: vi.fn() })(request({ method: 'POST', body: {} }) as any, res)
    expect(outbound).not.toHaveBeenCalled(); expect(res.statusCode).toBe(503); expect(res.body.evidence.writesStopped).toBe(true)
    expect(getClient.mock.calls[0][0]).toBe(env.SUPABASE_URL)
    expect(getClient.mock.calls[0][2].auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false })
  })
})

// In-memory SQL/PostgREST transport only: no server and no external network.
function localPostgrest(db: PGlite, fault?: string) {
  const calls: { path: string; method: string; bytes: number; rows?: number }[] = []
  let faultUsed = false
  const identifier = (value: string) => { if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('local identifier'); return value }
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET'
    const path = url.pathname.slice('/rest/v1/'.length), body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ path, method, bytes: typeof init?.body === 'string' ? Buffer.byteLength(init.body) : 0, rows: body?.p_rows?.length })
    try {
      if (path.startsWith('rpc/')) {
        const name = identifier(path.slice(4)), params = Object.entries(body)
        const result = await db.query<any>(`SELECT public.${name}(${params.map(([key], i) => `${identifier(key)} => $${i + 1}`).join(',')}) AS result`,
          params.map(([, value]) => value !== null && typeof value === 'object' ? JSON.stringify(value) : value))
        if (name === fault && !faultUsed) { faultUsed = true; throw new Error('uncertain after local commit') }
        return new Response(JSON.stringify(result.rows[0].result), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const table = identifier(path), values: unknown[] = [], where: string[] = [], orders: string[] = []
      if (fault === 'read-once' && path === 'supplier_products' && !faultUsed) { faultUsed = true; throw new Error('local read uncertain') }
      if (method === 'POST') {
        const entries = Object.entries(body)
        await db.query(`INSERT INTO public.${table}(${entries.map(([key]) => identifier(key)).join(',')}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(',')})`,
          entries.map(([, value]) => value !== null && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value))
        return new Response(null, { status: 201 })
      }
      for (const [key, value] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue
        const column = identifier(key)
        if (value.startsWith('eq.')) { values.push(value.slice(3)); where.push(`${column}=$${values.length}`) }
        else if (value.startsWith('in.(')) { values.push(value.slice(4, -1).split(',')); where.push(`${column}=ANY($${values.length})`) }
        else throw new Error('local unsupported filter')
      }
      for (const spec of (url.searchParams.get('order') ?? '').split(',').filter(Boolean)) {
        const [key, direction] = spec.split('.'); orders.push(`${identifier(key)} ${direction === 'desc' ? 'DESC' : 'ASC'}`)
      }
      let rows: any[] = (await db.query(`SELECT * FROM public.${table}${where.length ? ' WHERE ' + where.join(' AND ') : ''}${orders.length ? ' ORDER BY ' + orders.join(',') : ''}`, values)).rows
      const count = rows.length, offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? rows.length)
      rows = rows.slice(offset, offset + limit)
      if (fault === 'checkpoint' && path === 'supplier_feed_rows' && url.searchParams.has('id') && !faultUsed) {
        faultUsed = true; rows[0].proposed_product.fields.supplierDescription = 'tampered checkpoint'
      }
      if (fault === 'final-check' && path === 'supplier_feed_source_checks' && url.searchParams.has('id')) rows[0].source_url = 'https://official.invalid/not-synthetic'
      const single = String(new Headers(init?.headers).get('Accept')).includes('object+json')
      const headers = { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${count}` }
      return new Response(method === 'HEAD' ? null : JSON.stringify(single ? rows[0] : rows), { status: 200, headers })
    } catch {
      return new Response(JSON.stringify({ code: 'LOCAL_FAULT', message: 'forbidden-token ownership_token raw-secret-error' }), { status: 500 })
    }
  }
  return { transport, calls }
}

describe('local SQL-backed Stage B harness execution (never Sandbox)', () => {
  let db: PGlite
  beforeAll(async () => { db = new PGlite(); await install(db) }, 20000)
  afterAll(async () => { await db?.close() })
  async function run(fault?: string) {
    const local = localPostgrest(db, fault), log = vi.fn(), orchestrate = vi.fn(orchestrateWessexCheckAndPlan)
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external network forbidden'))
    const client = vi.fn(createClient), res = response()
    await createPhase5eStageBHandler({ env, wallNow: () => time, getClient: client, fetch: local.transport, orchestrate, log })(request({ method: 'POST', body: {} }) as any, res)
    expect(network).not.toHaveBeenCalled()
    expect(client).toHaveBeenCalledTimes(1)
    expect(orchestrate, JSON.stringify({ code: res.body?.code, calls: local.calls })).toHaveBeenCalledTimes(1)
    for (const [event, listener] of res.once.mock.calls) if (event === 'finish') listener()
    const output = JSON.stringify({ body: res.body, log: log.mock.calls })
    for (const token of [secret, env.SUPABASE_SERVICE_ROLE_KEY, 'ownership_token', 'forbidden-token', 'raw-secret-error', 'Authorization']) expect(output).not.toContain(token)
    network.mockRestore()
    return { res, local, log, orchestrate }
  }
  it('exercises the real batch/SQL machinery exactly once per request with fresh identities', async () => {
    const first = await run(), second = await run()
    for (const result of [first, second]) {
      expect(result.res.statusCode, JSON.stringify({ code: result.res.body?.code, rpcCounts: result.res.body?.evidence?.rpcCounts })).toBe(200)
      expect(result.res.body.ok).toBe(true)
      const evidence = result.res.body.evidence
      expect(evidence.accepted).toBe(1194); expect(evidence.rejected).toBe(0)
      expect(evidence.persisted).toMatchObject({ staged: 1194, persistenceVersion: 2, status: 'awaiting_approval', approvalUnset: true, applicationUnset: true })
      expect(evidence.persisted.counts).toEqual({ create: 1194, update: 0, unchanged: 0, review: 0, reject: 0, potential_missing: 0, cost_changes: 0 })
      expect(evidence.control).toMatchObject({ synthetic: true, canApprove: false, canApply: false, canContinue: false })
      expect(evidence.attempt).toMatchObject({ outcome: 'planned', stage: 'complete', runId: evidence.ids.runId, checkId: evidence.ids.checkId })
      expect(evidence.frozenFingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(evidence.batches).toHaveLength(24)
      expect(evidence.batches.map((batch: any) => batch.rows)).toEqual([...Array(23).fill(50), 44])
      for (const batch of evidence.batches) {
        expect(batch.jsonbBytes).toBeLessThanOrEqual(131072); expect(batch.httpBodyBytes).toBeGreaterThan(0)
        expect(batch.rpcMs).toBeGreaterThanOrEqual(0); expect(batch.checkpointMs).toBeGreaterThanOrEqual(0)
      }
      expect(evidence.batchLatencyMs).toMatchObject({ count: 24 })
      const latencies = evidence.batches.map((batch: any) => batch.rpcMs).sort((a: number, b: number) => a - b)
      expect(evidence.batchLatencyMs.min).toBe(latencies[0]); expect(evidence.batchLatencyMs.max).toBe(latencies.at(-1))
      expect(evidence.batchLatencyMs.mean).toBeCloseTo(latencies.reduce((sum: number, value: number) => sum + value, 0) / latencies.length)
      for (const [label, fraction] of [['p50', .5], ['p95', .95], ['p99', .99]] as const) expect(evidence.batchLatencyMs[label]).toBe(latencies[Math.ceil(latencies.length * fraction) - 1])
      expect(result.log.mock.calls.some(([event]) => event.event === 'stage_b_response_finished')).toBe(true)
      expect(evidence.rpcCounts.block2e_stage_rows).toBe(24); expect(evidence.rpcCounts.block2e_stage_row).toBeUndefined()
      expect(result.local.calls.filter(call => call.path === 'rpc/block2e_stage_rows')).toHaveLength(24)
      expect(result.local.calls.some(call => /apply|approve|finish_empty|stage_row$/.test(call.path))).toBe(false)
      expect(result.local.calls.filter(call => call.method === 'POST' && !call.path.startsWith('rpc/')).map(call => call.path)).toEqual(['suppliers', 'supplier_feed_sources'])
      expect(result.log.mock.calls.filter(([event]) => event.event === 'stage_b_batch_checkpoint')).toHaveLength(24)
      for (const key of ['fixtureVerificationParsing', 'normalization', 'registration', 'attemptClaim', 'reconciliationReads', 'canonicalAliasReadsWall', 'plannerBoundary',
        'beginStaging', 'stagingWall', 'checkpointReadbackTotal', 'verifyStagedPlan', 'freezePlan', 'postFreezeReadback', 'recordSourceCheck', 'finalPersistedVerification', 'attemptCompletion', 'responsePreparation', 'handler']) {
        expect(evidence.timingsMs[key], key).toBeGreaterThanOrEqual(0)
      }
    }
    for (const key of ['supplierId', 'sourceId', 'attemptId', 'checkId', 'runId']) expect(first.res.body.evidence.ids[key]).not.toBe(second.res.body.evidence.ids[key])
    for (const table of ['supplier_products', 'supplier_product_aliases', 'supplier_product_cost_events']) {
      expect((await db.query<any>(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n).toBe(0)
    }
  }, 20000)
  it.each(['read-once', 'block2e_stage_rows', 'checkpoint', 'block2e_freeze_plan', 'block2e_record_source_check', 'final-check', 'block2e_finish_feed_execution'])('never retries uncertain %s', async fault => {
    const { res, local } = await run(fault)
    expect(res.statusCode).toBe(503); expect(res.body.ok).toBe(false); expect(res.body.evidence.writesStopped).toBe(true)
    const writes = local.calls.filter(call => call.method === 'POST').map(call => call.path)
    if (fault === 'block2e_stage_rows' || fault === 'checkpoint') {
      expect(writes.filter(path => path === 'rpc/block2e_stage_rows')).toHaveLength(1); expect(writes).not.toContain('rpc/block2e_freeze_plan')
    }
    if (fault !== 'block2e_finish_feed_execution') expect(writes).not.toContain('rpc/block2e_finish_feed_execution')
    if (['block2e_stage_rows', 'checkpoint', 'block2e_freeze_plan'].includes(fault)) expect(writes).not.toContain('rpc/block2e_record_source_check')
    if (fault.startsWith('block2e_')) expect(writes.filter(path => path === `rpc/${fault}`)).toHaveLength(1)
    if (fault === 'read-once') expect(local.calls.filter(call => call.path === 'supplier_products')).toHaveLength(1)
  }, 20000)
})
