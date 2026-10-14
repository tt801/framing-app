import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as XLSX from '@e965/xlsx'
import { PGlite } from '@electric-sql/pglite'
import {
  orchestrateWessexCheckAndPlan,
  type Block2eStore,
  type SourceCheckStatus,
} from '../server/platform/supplierFeeds/block2eOrchestrator.js'
import {
  WESSEX_MOULDINGS_XLS_URL,
  WESSEX_UPDATES_PAGE_URL,
  type WessexFetchCheckResult,
} from '../server/platform/supplierFeeds/wessexFetchCheck.js'
import { normalizeWessexArtifact } from '../server/platform/supplierFeeds/wessexNormalization.js'
import { parseWessexMouldings } from '../server/platform/supplierFeeds/wessexMouldings.js'
import { createSupabaseBlock2eStore } from '../server/platform/supplierFeeds/block2eOrchestrator.js'
import { localClient } from './helpers/block2eBatchFixture'

const migration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')

const supplierId = '11111111-1111-4111-8111-111111111111'
const feedSourceId = '44444444-4444-4444-8444-444444444444'
const scopeKey = 'catalog-a'

let db: PGlite
let canonicalBaseline: string
async function canonicalSignature() {
  return JSON.stringify({ products: await rows('SELECT * FROM supplier_products ORDER BY id'), events: await rows('SELECT * FROM supplier_product_cost_events ORDER BY id') })
}

const rows = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as Record<string, any>[]

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
    CREATE TABLE public.company_accounts(id uuid PRIMARY KEY, owner_user_id uuid);
    CREATE TABLE public.company_members(company_account_id uuid, user_id uuid, status text, role text);
    CREATE FUNCTION public.is_company_account_writable(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;`)
  await db.exec(migration('20261007_block2b_supplier_foundation.sql'))
  await db.exec(migration('20261008_block2d_supplier_cost_audit.sql'))
  await db.exec(migration('20261009_block2e_supplier_feed_framework.sql'))
  await db.exec(migration('20261012_block2d_initial_cost_event_on_insert.sql'))
  await db.exec(migration('20261013_block2f_supplier_feed_source_checks.sql'))
  await db.exec(migration('20261014_phase5e_batch_staging.sql'))

  await rows(`INSERT INTO public.suppliers(id,name,slug) VALUES ($1,'Wessex','wessex')`, [supplierId])
  await rows(`INSERT INTO public.supplier_feed_sources(id,supplier_id,source_key,scope_key,allows_authoritative_snapshots)
    VALUES ($1,$2,'wessex-mouldings',$3,true)`, [feedSourceId, supplierId, scopeKey])
  canonicalBaseline = await canonicalSignature()
})

afterEach(async () => {
  expect(await canonicalSignature()).toBe(canonicalBaseline)
  await db.close()
})

function workbook(dataRows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Reference', 'Description', 'Price/mtr', 'Width'],
    ...dataRows,
  ]), 'gen')
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer)
}

function fetchResultFixture(options: {
  rows: unknown[][]
  classification: 'changed' | 'unchanged'
  previousSha256: string | null
}): WessexFetchCheckResult {
  const bytes = workbook(options.rows)
  const latestSha256 = createHash('sha256').update(bytes).digest('hex')
  const artifact = parseWessexMouldings(bytes, {
    sourceUrl: WESSEX_MOULDINGS_XLS_URL,
    originalFilename: 'WessexMouldings.xls',
    byteSize: bytes.length,
    sha256: latestSha256,
    retrievedAt: '2026-10-13T12:00:00.000Z',
    etag: '"fixture-etag"',
    lastModified: 'Thu, 08 Oct 2026 15:21:52 GMT',
  })

  const normalized = normalizeWessexArtifact(artifact, {
    supplierId,
    runId: '00000000-0000-4000-8000-000000000111',
    sourceId: feedSourceId,
    scopeId: scopeKey,
    publishedDatabaseUpdateDate: '08/10/2026',
    acquisitionComplete: true,
    completeReleaseConfirmed: true,
  })

  return {
    classification: options.classification,
    hashChanged: options.classification === 'changed',
    previousSha256: options.previousSha256,
    latestSha256,
    artifact,
    publishedUpdate: {
      sourceUrl: WESSEX_UPDATES_PAGE_URL,
      retrievedAt: '2026-10-13T12:00:01.000Z',
      matchedText: 'Databases last updated 08/10/26',
      publishedDatabaseUpdateDateRaw: '08/10/26',
      publishedDatabaseUpdateDate: '08/10/2026',
      extractionRule: 'fixture',
    },
    normalized,
  }
}

function makeStore(options: {
  failStageAtCall?: number
  failStageMessage?: string
  failFreeze?: boolean
  failFreezeMessage?: string
} = {}): Block2eStore {
  let stageCalls = 0

  return {
    async ensureFeedSource(identity) {
      const found = await rows(
        `SELECT 1 FROM public.supplier_feed_sources WHERE id=$1 AND supplier_id=$2 AND scope_key=$3`,
        [identity.feedSourceId, identity.supplierId, identity.scopeKey],
      )
      if (!found[0]) throw new Error('Configured feed source was not found')
    },

    async getLatestSuccessfulChecksum(sourceId) {
      const result = await rows(
        `SELECT sha256 FROM public.supplier_feed_source_checks
         WHERE feed_source_id=$1 AND status IN ('changed','unchanged') AND sha256 IS NOT NULL
         ORDER BY checked_at DESC, created_at DESC LIMIT 1`,
        [sourceId],
      )
      return result[0]?.sha256 ?? null
    },

    async findRunByLogicalKey(supplier, logicalRunKey) {
      const result = await rows(
        `SELECT id,status,plan_fingerprint,plan_counts,source_checksum
           FROM public.supplier_feed_runs
          WHERE supplier_id=$1 AND persistence_version=2 AND logical_run_key=$2
          LIMIT 1`,
        [supplier, logicalRunKey],
      )
      if (!result[0]) return null
      return {
        id: result[0].id,
        status: result[0].status,
        planFingerprint: result[0].plan_fingerprint,
        planCounts: result[0].plan_counts,
        sourceChecksum: result[0].source_checksum,
      }
    },

    async createRun(input) {
      const result = await rows(
        `SELECT public.block2e_create_run($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS id`,
        [
          input.supplierId,
          input.sourceId,
          input.scopeKey,
          input.logicalRunKey,
          input.mode,
          input.coverage,
          input.authoritative,
          input.adapterId,
          input.adapterVersion,
          input.plannerVersion,
          input.checksum,
          input.artifactRef,
          input.acquisitionComplete,
          input.parsingComplete,
          input.validationSafeForMissing,
          input.missingInferenceEnabled,
        ],
      )
      return String(result[0].id)
    },

    async beginStaging(runId) {
      await rows(`SELECT public.block2e_begin_staging($1::uuid)`, [runId])
    },

    async stageRow(runId, row) {
      stageCalls += 1
      if (options.failStageAtCall && stageCalls === options.failStageAtCall) {
        throw new Error(options.failStageMessage ?? 'forced staging failure')
      }
      const staged = await rows(`SELECT public.block2e_stage_row($1::uuid,$2::jsonb) AS id`, [runId, JSON.stringify(row)])
      return String(staged[0].id)
    },

    async stageRows(runId, batch) {
      stageCalls += 1
      if (options.failStageAtCall && stageCalls === options.failStageAtCall) throw new Error(options.failStageMessage ?? 'forced staging failure')
      return createSupabaseBlock2eStore(() => localClient(db)).stageRows(runId, batch)
    },

    async verifyStagedPlan(runId, counts) {
      await createSupabaseBlock2eStore(() => localClient(db)).verifyStagedPlan(runId, counts)
    },

    async freezePlan(runId, policy) {
      if (options.failFreeze) throw new Error(options.failFreezeMessage ?? 'forced freeze failure')
      const frozen = await rows(`SELECT public.block2e_freeze_plan($1::uuid,$2::jsonb) AS fingerprint`, [runId, JSON.stringify(policy)])
      return String(frozen[0].fingerprint)
    },

    async readRun(runId) {
      const result = await rows(
        `SELECT id,status,plan_fingerprint,plan_counts,source_checksum
           FROM public.supplier_feed_runs WHERE id=$1`,
        [runId],
      )
      return {
        id: result[0].id,
        status: result[0].status,
        planFingerprint: result[0].plan_fingerprint,
        planCounts: result[0].plan_counts,
        sourceChecksum: result[0].source_checksum,
      }
    },

    async listCanonicalProducts(supplier) {
      const result = await rows(`SELECT * FROM public.supplier_products WHERE supplier_id=$1`, [supplier])
      return result.map((row) => ({
        id: row.id,
        supplierId: row.supplier_id,
        sourceProductKey: row.source_product_key,
        ownerScopeId: row.owner_scope_key,
        ownerSourceId: row.owner_feed_source_id,
        updatedAt: row.updated_at,
        ...(row.product_revision ? { productRevision: String(row.product_revision) } : {}),
        fields: {
          category: row.category,
          supplierDescription: row.supplier_description,
          lifecycle: row.lifecycle,
          availability: row.availability,
          supplierSku: row.supplier_sku,
          catalogScope: row.catalog_scope,
          variantKey: row.variant_key,
          subcategory: row.subcategory,
          displayDescription: row.display_description,
          collectionName: row.collection_name,
          colour: row.colour,
          finish: row.finish,
          material: row.material,
          purchaseUnit: row.purchase_unit,
          widthMm: row.width_mm === null ? null : Number(row.width_mm),
          depthMm: row.depth_mm === null ? null : Number(row.depth_mm),
          rebateWidthMm: row.rebate_width_mm === null ? null : Number(row.rebate_width_mm),
          rebateDepthMm: row.rebate_depth_mm === null ? null : Number(row.rebate_depth_mm),
          sheetWidthMm: row.sheet_width_mm === null ? null : Number(row.sheet_width_mm),
          sheetHeightMm: row.sheet_height_mm === null ? null : Number(row.sheet_height_mm),
          matThicknessMm: row.mat_thickness_mm === null ? null : Number(row.mat_thickness_mm),
          glazingThicknessMm: row.glazing_thickness_mm === null ? null : Number(row.glazing_thickness_mm),
          glazingUvPercent: row.glazing_uv_percent === null ? null : Number(row.glazing_uv_percent),
        },
      }))
    },

    async listSourceKeyAliases(supplier) {
      const result = await rows(
        `SELECT supplier_id,supplier_product_id,alias_kind,alias_value
           FROM public.supplier_product_aliases WHERE supplier_id=$1`,
        [supplier],
      )
      return result.map((row) => ({
        supplierId: row.supplier_id,
        productId: row.supplier_product_id,
        aliasKind: row.alias_kind,
        aliasValue: row.alias_value,
      }))
    },

    async recordSourceCheck(input) {
      const result = await rows(
        `SELECT public.block2e_record_source_check(
          $1::uuid,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,
          $11,$12,$13::integer,$14,$15,$16::uuid,$17,$18,$19
        ) AS id`,
        [
          input.feedSourceId,
          input.checkedAt,
          input.status,
          input.sourceUrl,
          input.publishedUpdateSourceUrl,
          input.publishedUpdateDate,
          input.publishedUpdateDateRaw,
          input.publishedUpdateMatch,
          input.artifactRetrievedAt,
          input.evidenceRetrievedAt,
          input.etag,
          input.lastModified,
          input.contentByteLength,
          input.sha256,
          input.releaseLogicalKey,
          input.feedRunId,
          input.planFingerprint,
          input.errorCode,
          input.errorSummary,
        ],
      )
      return String(result[0].id)
    },
  }
}

async function checkStatuses(): Promise<SourceCheckStatus[]> {
  const data = await rows(`SELECT status FROM public.supplier_feed_source_checks ORDER BY checked_at, created_at`)
  return data.map((entry) => entry.status as SourceCheckStatus)
}

describe('Block 2F Phase 5B orchestration', () => {
  it('reconciles a historical alternative release key without creating a run', async () => {
    const fixture = fetchResultFixture({ rows: [['A100', 'Frame', 3.2, 20]], classification: 'changed', previousSha256: null })
    const store = makeStore()
    const first = await orchestrateWessexCheckAndPlan(store, { source: { supplierId, feedSourceId, scopeKey }, acquisitionComplete: true, completeReleaseConfirmed: true, fetchCheck: async () => fixture })
    if (first.outcome !== 'planned') throw new Error('fixture not planned')
    store.findReleaseByChecksum = async () => ({ id: first.runId, status: 'awaiting_approval', planFingerprint: first.planFingerprint, planCounts: first.planCounts, sourceChecksum: fixture.latestSha256 })
    store.findRunByLogicalKey = async () => { throw new Error('must use historical match') }
    expect((await orchestrateWessexCheckAndPlan(store, { source: { supplierId, feedSourceId, scopeKey }, acquisitionComplete: true, completeReleaseConfirmed: true, fetchCheck: async () => fixture })).outcome).toBe('planned')
    expect((await rows('select count(*)::int as n from supplier_feed_runs'))[0].n).toBe(1)
  })
  it('reconciles freeze commit with lost response and never stages a replacement', async () => {
    const fixture = fetchResultFixture({ rows: [['A101', 'Frame', 3.2, 20]], classification: 'changed', previousSha256: null })
    const store = makeStore(), freeze = store.freezePlan
    store.freezePlan = async (...args) => { await freeze(...args); throw new Error('response lost') }
    expect((await orchestrateWessexCheckAndPlan(store, { source: { supplierId, feedSourceId, scopeKey }, acquisitionComplete: true, completeReleaseConfirmed: true, fetchCheck: async () => fixture })).outcome).toBe('planned')
    expect((await rows('select status from supplier_feed_runs'))[0].status).toBe('awaiting_approval')
  })
  it('records normalization and planner-input failures without canonical effects', async () => {
    const fixture = fetchResultFixture({ rows: [['A102', 'Frame', 3.2, 20]], classification: 'changed', previousSha256: null })
    const store = makeStore()
    store.listCanonicalProducts = async () => { throw new Error('planning input failed') }
    expect((await orchestrateWessexCheckAndPlan(store, { source: { supplierId, feedSourceId, scopeKey }, acquisitionComplete: true, completeReleaseConfirmed: true, fetchCheck: async () => fixture })).outcome).toBe('planning_error')
    const invalid = fetchResultFixture({ rows: [['A103', 'Frame', 3.2, 20]], classification: 'changed', previousSha256: null })
    invalid.artifact.rows[0].artifactSha256 = 'f'.repeat(64)
    expect((await orchestrateWessexCheckAndPlan(makeStore(), { source: { supplierId, feedSourceId, scopeKey }, acquisitionComplete: true, completeReleaseConfirmed: true, fetchCheck: async () => invalid })).outcome).toBe('planning_error')
  })
  it('records a planner exception without staging or canonical/cost-event mutation', async () => {
    const fixture = fetchResultFixture({ rows: [['A104', 'Frame', 3.2, 20]], classification: 'changed', previousSha256: null })
    const store = makeStore()
    // Fault injection at the planner input boundary; the production planner is used.
    store.listCanonicalProducts = async () => [null as any]
    const result = await orchestrateWessexCheckAndPlan(store, { source: { supplierId, feedSourceId, scopeKey }, acquisitionComplete: true, completeReleaseConfirmed: true, fetchCheck: async () => fixture })
    expect(result.outcome).toBe('planning_error')
    expect(await rows('select id from supplier_feed_rows')).toHaveLength(0)
    expect(await rows('select id from supplier_products')).toHaveLength(0)
    expect(await rows('select id from supplier_product_cost_events')).toHaveLength(0)
  })
  it('changed release persists check, creates one run, stages rows, and freezes awaiting approval', async () => {
    const fixture = fetchResultFixture({
      rows: [
        ['A007', 'Profile A', 3.22, 13],
        ['A008', 'Profile B', 3.56, 13],
      ],
      classification: 'changed',
      previousSha256: null,
    })

    const result = await orchestrateWessexCheckAndPlan(makeStore(), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      fetchCheck: async () => fixture,
    })

    expect(result.outcome).toBe('planned')
    if (result.outcome !== 'planned') return
    expect(result.reusedExistingRun).toBe(false)

    const run = (await rows(`SELECT status,approved_by,applied_by,row_count,change_count FROM public.supplier_feed_runs WHERE id=$1`, [result.runId]))[0]
    expect(run).toMatchObject({
      status: 'awaiting_approval',
      approved_by: null,
      applied_by: null,
      row_count: 2,
      change_count: 2,
    })

    const checks = await rows(`SELECT status,sha256,feed_run_id,plan_fingerprint FROM public.supplier_feed_source_checks`)
    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ status: 'changed', sha256: fixture.latestSha256, feed_run_id: result.runId })
    expect(typeof checks[0].plan_fingerprint).toBe('string')
  })

  it('unchanged release persists check and creates no run', async () => {
    const fixture = fetchResultFixture({
      rows: [['A010', 'Profile C', 5.12, 18]],
      classification: 'unchanged',
      previousSha256: 'a'.repeat(64),
    })

    const result = await orchestrateWessexCheckAndPlan(makeStore(), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      fetchCheck: async () => fixture,
    })

    expect(result.outcome).toBe('unchanged')
    expect((await rows(`SELECT count(*)::int AS n FROM public.supplier_feed_runs`))[0].n).toBe(0)
    expect(await checkStatuses()).toEqual(['unchanged'])
  })

  it('persists fetch/evidence/validation failures without creating runs', async () => {
    const failing = async (message: string) => {
      const outcome = await orchestrateWessexCheckAndPlan(makeStore(), {
        source: { supplierId, feedSourceId, scopeKey },
        acquisitionComplete: true,
        completeReleaseConfirmed: true,
        fetchCheck: async () => {
          throw new Error(message)
        },
      })
      expect(outcome.outcome).toBe('check_error')
    }

    await failing('Wessex XLS request failed with HTTP 503')
    await failing('Wessex published update date is missing from the updates page')
    await failing('Not a bounded OLE2 Wessex workbook')

    expect(await checkStatuses()).toEqual(['fetch_error', 'evidence_error', 'validation_error'])
    expect((await rows(`SELECT count(*)::int AS n FROM public.supplier_feed_runs`))[0].n).toBe(0)
  })

  it('uses latest successful SHA even when a newer error check exists', async () => {
    const changed = fetchResultFixture({
      rows: [['A011', 'Profile D', 6.12, 25]],
      classification: 'changed',
      previousSha256: null,
    })

    const seen: Array<string | null> = []

    await orchestrateWessexCheckAndPlan(makeStore(), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      fetchCheck: async ({ previousSha256 }) => {
        seen.push(previousSha256)
        return changed
      },
    })

    await orchestrateWessexCheckAndPlan(makeStore(), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      fetchCheck: async ({ previousSha256 }) => {
        seen.push(previousSha256)
        throw new Error('Wessex updates page request failed with HTTP 500')
      },
    })

    await orchestrateWessexCheckAndPlan(makeStore(), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      fetchCheck: async ({ previousSha256 }) => {
        seen.push(previousSha256)
        return fetchResultFixture({
          rows: [['A011', 'Profile D', 6.12, 25]],
          classification: 'unchanged',
          previousSha256,
        })
      },
    })

    expect(seen[0]).toBeNull()
    expect(seen[1]).toBe(changed.latestSha256)
    expect(seen[2]).toBe(changed.latestSha256)
  })

  it('enforces append-only check history (no update/delete)', async () => {
    const id = (await rows(
      `SELECT public.block2e_record_source_check(
         $1::uuid,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,
         $11,$12,$13::integer,$14,$15,$16::uuid,$17,$18,$19
       ) AS id`,
      [
        feedSourceId,
        '2026-10-13T12:00:00.000Z',
        'unchanged',
        WESSEX_MOULDINGS_XLS_URL,
        WESSEX_UPDATES_PAGE_URL,
        '08/10/2026',
        '08/10/26',
        'Databases last updated 08/10/26',
        '2026-10-13T12:00:00.000Z',
        '2026-10-13T12:00:01.000Z',
        '"etag"',
        'Thu, 08 Oct 2026 15:21:52 GMT',
        123,
        'a'.repeat(64),
        null,
        null,
        null,
        null,
        null,
      ],
    ))[0].id

    await expect(rows(`UPDATE public.supplier_feed_source_checks SET status='changed' WHERE id=$1`, [id]))
      .rejects.toThrow('append-only')
    await expect(rows(`DELETE FROM public.supplier_feed_source_checks WHERE id=$1`, [id]))
      .rejects.toThrow('append-only')
  })

  it('sanitizes staging uncertainty and stops without further persistence', async () => {
    const longMessage = 'x'.repeat(1800)
    const fixture = fetchResultFixture({
      rows: [
        ['A020', 'Profile X', 5.0, 20],
        ['A021', 'Profile Y', 5.1, 20],
      ],
      classification: 'changed',
      previousSha256: null,
    })

    await expect(orchestrateWessexCheckAndPlan(makeStore({
      failStageAtCall: 2,
      failStageMessage: longMessage,
    }), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      stagingBatchSize: 1,
      fetchCheck: async () => fixture,
    })).rejects.toThrow('Staging checkpoint unconfirmed; recovery required. No automatic replay.')
    expect(await rows('SELECT id FROM supplier_feed_source_checks')).toHaveLength(0)
    expect(await rows('SELECT id FROM supplier_feed_rows')).toHaveLength(1)
  })

  it('reuses existing planned release run for identical source+sha and avoids duplicate run creation', async () => {
    const fixture = fetchResultFixture({
      rows: [['A030', 'Profile R', 7.22, 31]],
      classification: 'changed',
      previousSha256: null,
    })

    const first = await orchestrateWessexCheckAndPlan(makeStore(), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      fetchCheck: async () => fixture,
    })
    expect(first.outcome).toBe('planned')

    const second = await orchestrateWessexCheckAndPlan(makeStore(), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      fetchCheck: async () => fixture,
    })
    expect(second.outcome).toBe('planned')
    if (second.outcome !== 'planned') return
    expect(second.reusedExistingRun).toBe(true)

    expect((await rows(`SELECT count(*)::int AS n FROM public.supplier_feed_runs`))[0].n).toBe(1)
    expect(await checkStatuses()).toEqual(['changed', 'changed'])
  })

  it('concurrent invocations for the same release do not create duplicate runs', async () => {
    const fixture = fetchResultFixture({
      rows: [['A040', 'Profile S', 8.22, 35]],
      classification: 'changed',
      previousSha256: null,
    })

    const [a, b] = await Promise.all([
      orchestrateWessexCheckAndPlan(makeStore(), {
        source: { supplierId, feedSourceId, scopeKey },
        acquisitionComplete: true,
        completeReleaseConfirmed: true,
        fetchCheck: async () => fixture,
      }),
      orchestrateWessexCheckAndPlan(makeStore(), {
        source: { supplierId, feedSourceId, scopeKey },
        acquisitionComplete: true,
        completeReleaseConfirmed: true,
        fetchCheck: async () => fixture,
      }),
    ])

    expect((await rows(`SELECT count(*)::int AS n FROM public.supplier_feed_runs`))[0].n).toBe(1)
    const outcomes = [a.outcome, b.outcome]
    expect(outcomes.includes('planned') || outcomes.includes('planning_error')).toBe(true)
  })

  it('partial staging leaves one recoverable run and retry does not create a duplicate run', async () => {
    const fixture = fetchResultFixture({
      rows: [
        ['A050', 'Profile T', 9.10, 40],
        ['A051', 'Profile U', 9.20, 41],
      ],
      classification: 'changed',
      previousSha256: null,
    })

    await expect(orchestrateWessexCheckAndPlan(makeStore({ failStageAtCall: 2 }), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      stagingBatchSize: 1,
      fetchCheck: async () => fixture,
    })).rejects.toThrow(/recovery required/)

    const retry = await orchestrateWessexCheckAndPlan(makeStore(), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      fetchCheck: async () => fixture,
    })

    expect(retry.outcome).toBe('planning_error')
    expect((await rows(`SELECT count(*)::int AS n FROM public.supplier_feed_runs`))[0].n).toBe(1)
    expect((await rows(`SELECT status FROM public.supplier_feed_runs LIMIT 1`))[0].status).toBe('staged')
  })

  it('freeze failure records planning_error and never reports changed/planned success', async () => {
    const fixture = fetchResultFixture({
      rows: [['A060', 'Profile V', 10.4, 42]],
      classification: 'changed',
      previousSha256: null,
    })

    const result = await orchestrateWessexCheckAndPlan(makeStore({ failFreeze: true }), {
      source: { supplierId, feedSourceId, scopeKey },
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
      fetchCheck: async () => fixture,
    })

    expect(result.outcome).toBe('planning_error')
    const latest = (await rows(`SELECT status FROM public.supplier_feed_source_checks ORDER BY created_at DESC LIMIT 1`))[0]
    expect(latest.status).toBe('planning_error')
  })
})