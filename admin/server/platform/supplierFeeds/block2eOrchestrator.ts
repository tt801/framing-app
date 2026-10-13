import { createHash } from 'node:crypto'
import { planFeed } from './planner.js'
import { normalizeWessexArtifact } from './wessexNormalization.js'
import {
  WESSEX_MOULDINGS_XLS_URL,
  WESSEX_UPDATES_PAGE_URL,
  runWessexFetchCheck,
  type WessexFetchCheckResult,
} from './wessexFetchCheck.js'
import type {
  CanonicalProduct,
  FeedIssue,
  MassChangePolicy,
  PlanEntry,
  ProductFields,
  SourceAsset,
  SourceKeyAlias,
} from './contracts.js'

export type SourceCheckStatus =
  | 'changed'
  | 'unchanged'
  | 'fetch_error'
  | 'evidence_error'
  | 'validation_error'
  | 'planning_error'

export type FeedSourceIdentity = {
  supplierId: string
  feedSourceId: string
  scopeKey: string
}

export type ExistingReleaseRun = {
  id: string
  status: string
  planFingerprint: string | null
  planCounts: Record<string, number> | null
  sourceChecksum: string | null
}

export type RunSnapshot = {
  id: string
  status: string
  planFingerprint: string | null
  planCounts: Record<string, number> | null
  sourceChecksum: string | null
}

export type Block2eStore = {
  ensureFeedSource(identity: FeedSourceIdentity): Promise<void>
  getLatestSuccessfulChecksum(feedSourceId: string): Promise<string | null>
  findRunByLogicalKey(supplierId: string, logicalRunKey: string): Promise<ExistingReleaseRun | null>
  createRun(input: {
    supplierId: string
    sourceId: string
    scopeKey: string
    logicalRunKey: string
    mode: 'dry_run' | 'apply_requested'
    coverage: 'snapshot' | 'delta'
    authoritative: boolean
    adapterId: string
    adapterVersion: string
    plannerVersion: string
    checksum: string
    artifactRef: string | null
    acquisitionComplete: boolean
    parsingComplete: boolean
    validationSafeForMissing: boolean
    missingInferenceEnabled: boolean
  }): Promise<string>
  beginStaging(runId: string): Promise<void>
  stageRow(runId: string, row: Record<string, unknown>): Promise<string>
  freezePlan(runId: string, policy: MassChangePolicy): Promise<string>
  readRun(runId: string): Promise<RunSnapshot>
  listCanonicalProducts(supplierId: string): Promise<CanonicalProduct[]>
  listSourceKeyAliases(supplierId: string): Promise<SourceKeyAlias[]>
  recordSourceCheck(input: {
    feedSourceId: string
    checkedAt: string
    status: SourceCheckStatus
    sourceUrl: string
    publishedUpdateSourceUrl: string
    publishedUpdateDate: string | null
    publishedUpdateDateRaw: string | null
    publishedUpdateMatch: string | null
    artifactRetrievedAt: string | null
    evidenceRetrievedAt: string | null
    etag: string | null
    lastModified: string | null
    contentByteLength: number | null
    sha256: string | null
    releaseLogicalKey: string | null
    feedRunId: string | null
    planFingerprint: string | null
    errorCode: string | null
    errorSummary: string | null
  }): Promise<string>
}

export type WessexOrchestrationOptions = {
  source: FeedSourceIdentity
  acquisitionComplete: boolean
  completeReleaseConfirmed: boolean
  massChangePolicy?: MassChangePolicy
  stagingBatchSize?: number
  fetchCheck?: (args: {
    previousSha256: string | null
    supplierId: string
    sourceId: string
    scopeId: string
    acquisitionComplete: boolean
    completeReleaseConfirmed: boolean
    timeoutMs?: number
  }) => Promise<WessexFetchCheckResult>
  fetchTimeoutMs?: number
}

export type WessexOrchestrationResult =
  | {
      outcome: 'unchanged'
      checkId: string
      previousSha256: string | null
      latestSha256: string
      releaseLogicalKey: null
    }
  | {
      outcome: 'planned'
      checkId: string
      previousSha256: string | null
      latestSha256: string
      releaseLogicalKey: string
      runId: string
      planFingerprint: string
      runStatus: string
      planCounts: Record<string, number> | null
      reusedExistingRun: boolean
    }
  | {
      outcome: 'planning_error'
      checkId: string
      previousSha256: string | null
      latestSha256: string | null
      releaseLogicalKey: string | null
      runId: string | null
      errorCode: string
      errorSummary: string
    }
  | {
      outcome: 'check_error'
      checkId: string
      previousSha256: string | null
      latestSha256: null
      status: 'fetch_error' | 'evidence_error' | 'validation_error'
      errorCode: string
      errorSummary: string
    }

const PLANNER_VERSION = 'block2e-planner-v1'
const DEFAULT_STAGING_BATCH_SIZE = 20
const ACCEPTED_CHANGED_RUN_STATES = new Set([
  'planned',
  'awaiting_approval',
  'approved',
  'applying',
  'partially_applied',
  'applied',
])

export async function orchestrateWessexCheckAndPlan(
  store: Block2eStore,
  options: WessexOrchestrationOptions,
): Promise<WessexOrchestrationResult> {
  const source = options.source
  await store.ensureFeedSource(source)

  const previousSha256 = await store.getLatestSuccessfulChecksum(source.feedSourceId)
  const checkedAt = new Date().toISOString()

  const fetchCheck = options.fetchCheck ?? defaultFetchCheck

  let check: WessexFetchCheckResult
  try {
    check = await fetchCheck({
      previousSha256,
      supplierId: source.supplierId,
      sourceId: source.feedSourceId,
      scopeId: source.scopeKey,
      acquisitionComplete: options.acquisitionComplete,
      completeReleaseConfirmed: options.completeReleaseConfirmed,
      timeoutMs: options.fetchTimeoutMs,
    })
  } catch (error) {
    const { status, code, summary } = classifyFetchCheckError(error)
    const checkId = await store.recordSourceCheck({
      feedSourceId: source.feedSourceId,
      checkedAt,
      status,
      sourceUrl: WESSEX_MOULDINGS_XLS_URL,
      publishedUpdateSourceUrl: WESSEX_UPDATES_PAGE_URL,
      publishedUpdateDate: null,
      publishedUpdateDateRaw: null,
      publishedUpdateMatch: null,
      artifactRetrievedAt: null,
      evidenceRetrievedAt: null,
      etag: null,
      lastModified: null,
      contentByteLength: null,
      sha256: null,
      releaseLogicalKey: null,
      feedRunId: null,
      planFingerprint: null,
      errorCode: code,
      errorSummary: summary,
    })
    return {
      outcome: 'check_error',
      checkId,
      previousSha256,
      latestSha256: null,
      status,
      errorCode: code,
      errorSummary: summary,
    }
  }

  if (check.classification === 'unchanged') {
    const checkId = await store.recordSourceCheck({
      feedSourceId: source.feedSourceId,
      checkedAt,
      status: 'unchanged',
      sourceUrl: check.artifact.acquisition.sourceUrl,
      publishedUpdateSourceUrl: check.publishedUpdate.sourceUrl,
      publishedUpdateDate: check.publishedUpdate.publishedDatabaseUpdateDate,
      publishedUpdateDateRaw: check.publishedUpdate.publishedDatabaseUpdateDateRaw,
      publishedUpdateMatch: check.publishedUpdate.matchedText,
      artifactRetrievedAt: check.artifact.acquisition.retrievedAt,
      evidenceRetrievedAt: check.publishedUpdate.retrievedAt,
      etag: check.artifact.acquisition.etag ?? null,
      lastModified: check.artifact.acquisition.lastModified ?? null,
      contentByteLength: check.artifact.acquisition.byteSize,
      sha256: check.latestSha256,
      releaseLogicalKey: null,
      feedRunId: null,
      planFingerprint: null,
      errorCode: null,
      errorSummary: null,
    })
    return {
      outcome: 'unchanged',
      checkId,
      previousSha256,
      latestSha256: check.latestSha256,
      releaseLogicalKey: null,
    }
  }

  const releaseLogicalKey = logicalRunKey(source.feedSourceId, check.latestSha256)
  const existingRun = await store.findRunByLogicalKey(source.supplierId, releaseLogicalKey)
  if (existingRun) {
    if (existingRun.planFingerprint && ACCEPTED_CHANGED_RUN_STATES.has(existingRun.status)) {
      const checkId = await store.recordSourceCheck({
        feedSourceId: source.feedSourceId,
        checkedAt,
        status: 'changed',
        sourceUrl: check.artifact.acquisition.sourceUrl,
        publishedUpdateSourceUrl: check.publishedUpdate.sourceUrl,
        publishedUpdateDate: check.publishedUpdate.publishedDatabaseUpdateDate,
        publishedUpdateDateRaw: check.publishedUpdate.publishedDatabaseUpdateDateRaw,
        publishedUpdateMatch: check.publishedUpdate.matchedText,
        artifactRetrievedAt: check.artifact.acquisition.retrievedAt,
        evidenceRetrievedAt: check.publishedUpdate.retrievedAt,
        etag: check.artifact.acquisition.etag ?? null,
        lastModified: check.artifact.acquisition.lastModified ?? null,
        contentByteLength: check.artifact.acquisition.byteSize,
        sha256: check.latestSha256,
        releaseLogicalKey,
        feedRunId: existingRun.id,
        planFingerprint: existingRun.planFingerprint,
        errorCode: null,
        errorSummary: null,
      })
      return {
        outcome: 'planned',
        checkId,
        previousSha256,
        latestSha256: check.latestSha256,
        releaseLogicalKey,
        runId: existingRun.id,
        planFingerprint: existingRun.planFingerprint,
        runStatus: existingRun.status,
        planCounts: existingRun.planCounts,
        reusedExistingRun: true,
      }
    }

    const { code, summary } = classifyPlanningError(
      new Error(`Existing run ${existingRun.id} for ${releaseLogicalKey} is ${existingRun.status} and cannot be auto-reused`),
    )
    const checkId = await store.recordSourceCheck({
      feedSourceId: source.feedSourceId,
      checkedAt,
      status: 'planning_error',
      sourceUrl: check.artifact.acquisition.sourceUrl,
      publishedUpdateSourceUrl: check.publishedUpdate.sourceUrl,
      publishedUpdateDate: check.publishedUpdate.publishedDatabaseUpdateDate,
      publishedUpdateDateRaw: check.publishedUpdate.publishedDatabaseUpdateDateRaw,
      publishedUpdateMatch: check.publishedUpdate.matchedText,
      artifactRetrievedAt: check.artifact.acquisition.retrievedAt,
      evidenceRetrievedAt: check.publishedUpdate.retrievedAt,
      etag: check.artifact.acquisition.etag ?? null,
      lastModified: check.artifact.acquisition.lastModified ?? null,
      contentByteLength: check.artifact.acquisition.byteSize,
      sha256: check.latestSha256,
      releaseLogicalKey,
      feedRunId: existingRun.id,
      planFingerprint: existingRun.planFingerprint,
      errorCode: code,
      errorSummary: summary,
    })
    return {
      outcome: 'planning_error',
      checkId,
      previousSha256,
      latestSha256: check.latestSha256,
      releaseLogicalKey,
      runId: existingRun.id,
      errorCode: code,
      errorSummary: summary,
    }
  }

  let runId: string | null = null
  try {
    try {
      runId = await store.createRun({
        supplierId: source.supplierId,
        sourceId: source.feedSourceId,
        scopeKey: source.scopeKey,
        logicalRunKey: releaseLogicalKey,
        mode: 'apply_requested',
        coverage: check.normalized.context.coverage,
        authoritative: check.normalized.context.authoritative,
        adapterId: check.normalized.context.adapter.id,
        adapterVersion: check.normalized.context.adapter.version,
        plannerVersion: PLANNER_VERSION,
        checksum: check.latestSha256,
        artifactRef: `${check.artifact.acquisition.sourceUrl}#sha256=${check.latestSha256}`,
        acquisitionComplete: check.normalized.context.acquisitionComplete,
        parsingComplete: check.normalized.context.parsingComplete,
        validationSafeForMissing: check.normalized.context.validationSafeForMissing,
        missingInferenceEnabled: check.normalized.context.missingInferenceEnabled,
      })
    } catch (createError) {
      const existingAfterConflict = await store.findRunByLogicalKey(source.supplierId, releaseLogicalKey)
      if (!existingAfterConflict) throw createError

      if (existingAfterConflict.planFingerprint && ACCEPTED_CHANGED_RUN_STATES.has(existingAfterConflict.status)) {
        const checkId = await store.recordSourceCheck({
          feedSourceId: source.feedSourceId,
          checkedAt,
          status: 'changed',
          sourceUrl: check.artifact.acquisition.sourceUrl,
          publishedUpdateSourceUrl: check.publishedUpdate.sourceUrl,
          publishedUpdateDate: check.publishedUpdate.publishedDatabaseUpdateDate,
          publishedUpdateDateRaw: check.publishedUpdate.publishedDatabaseUpdateDateRaw,
          publishedUpdateMatch: check.publishedUpdate.matchedText,
          artifactRetrievedAt: check.artifact.acquisition.retrievedAt,
          evidenceRetrievedAt: check.publishedUpdate.retrievedAt,
          etag: check.artifact.acquisition.etag ?? null,
          lastModified: check.artifact.acquisition.lastModified ?? null,
          contentByteLength: check.artifact.acquisition.byteSize,
          sha256: check.latestSha256,
          releaseLogicalKey,
          feedRunId: existingAfterConflict.id,
          planFingerprint: existingAfterConflict.planFingerprint,
          errorCode: null,
          errorSummary: null,
        })
        return {
          outcome: 'planned',
          checkId,
          previousSha256,
          latestSha256: check.latestSha256,
          releaseLogicalKey,
          runId: existingAfterConflict.id,
          planFingerprint: existingAfterConflict.planFingerprint,
          runStatus: existingAfterConflict.status,
          planCounts: existingAfterConflict.planCounts,
          reusedExistingRun: true,
        }
      }

      const { code, summary } = classifyPlanningError(
        new Error(`Existing run ${existingAfterConflict.id} for ${releaseLogicalKey} is ${existingAfterConflict.status} and cannot be auto-reused`),
      )
      const checkId = await store.recordSourceCheck({
        feedSourceId: source.feedSourceId,
        checkedAt,
        status: 'planning_error',
        sourceUrl: check.artifact.acquisition.sourceUrl,
        publishedUpdateSourceUrl: check.publishedUpdate.sourceUrl,
        publishedUpdateDate: check.publishedUpdate.publishedDatabaseUpdateDate,
        publishedUpdateDateRaw: check.publishedUpdate.publishedDatabaseUpdateDateRaw,
        publishedUpdateMatch: check.publishedUpdate.matchedText,
        artifactRetrievedAt: check.artifact.acquisition.retrievedAt,
        evidenceRetrievedAt: check.publishedUpdate.retrievedAt,
        etag: check.artifact.acquisition.etag ?? null,
        lastModified: check.artifact.acquisition.lastModified ?? null,
        contentByteLength: check.artifact.acquisition.byteSize,
        sha256: check.latestSha256,
        releaseLogicalKey,
        feedRunId: existingAfterConflict.id,
        planFingerprint: existingAfterConflict.planFingerprint,
        errorCode: code,
        errorSummary: summary,
      })
      return {
        outcome: 'planning_error',
        checkId,
        previousSha256,
        latestSha256: check.latestSha256,
        releaseLogicalKey,
        runId: existingAfterConflict.id,
        errorCode: code,
        errorSummary: summary,
      }
    }

    const normalized = normalizeWessexArtifact(check.artifact, {
      supplierId: source.supplierId,
      runId,
      sourceId: source.feedSourceId,
      scopeId: source.scopeKey,
      publishedDatabaseUpdateDate: check.publishedUpdate.publishedDatabaseUpdateDate,
      acquisitionComplete: check.normalized.context.acquisitionComplete,
      completeReleaseConfirmed: check.normalized.context.authoritative,
    })

    const [existingProducts, aliases] = await Promise.all([
      store.listCanonicalProducts(source.supplierId),
      store.listSourceKeyAliases(source.supplierId),
    ])

    const plan = planFeed({
      context: {
        ...normalized.context,
        mode: 'apply_requested',
      },
      rows: normalized.planningRows,
      existingProducts,
      aliases,
      massChangePolicy: options.massChangePolicy ?? {},
    })

    await store.beginStaging(runId)
    await stagePlanRows(store, runId, plan.entries, options.stagingBatchSize ?? DEFAULT_STAGING_BATCH_SIZE)
    const fingerprint = await store.freezePlan(runId, options.massChangePolicy ?? {})
    const run = await store.readRun(runId)

    if (!run.planFingerprint || run.planFingerprint !== fingerprint) {
      throw new Error('Planned run fingerprint was not persisted')
    }

    const checkId = await store.recordSourceCheck({
      feedSourceId: source.feedSourceId,
      checkedAt,
      status: 'changed',
      sourceUrl: check.artifact.acquisition.sourceUrl,
      publishedUpdateSourceUrl: check.publishedUpdate.sourceUrl,
      publishedUpdateDate: check.publishedUpdate.publishedDatabaseUpdateDate,
      publishedUpdateDateRaw: check.publishedUpdate.publishedDatabaseUpdateDateRaw,
      publishedUpdateMatch: check.publishedUpdate.matchedText,
      artifactRetrievedAt: check.artifact.acquisition.retrievedAt,
      evidenceRetrievedAt: check.publishedUpdate.retrievedAt,
      etag: check.artifact.acquisition.etag ?? null,
      lastModified: check.artifact.acquisition.lastModified ?? null,
      contentByteLength: check.artifact.acquisition.byteSize,
      sha256: check.latestSha256,
      releaseLogicalKey,
      feedRunId: run.id,
      planFingerprint: run.planFingerprint,
      errorCode: null,
      errorSummary: null,
    })

    return {
      outcome: 'planned',
      checkId,
      previousSha256,
      latestSha256: check.latestSha256,
      releaseLogicalKey,
      runId: run.id,
      planFingerprint: run.planFingerprint,
      runStatus: run.status,
      planCounts: run.planCounts,
      reusedExistingRun: false,
    }
  } catch (error) {
    const { code, summary } = classifyPlanningError(error)
    const checkId = await store.recordSourceCheck({
      feedSourceId: source.feedSourceId,
      checkedAt,
      status: 'planning_error',
      sourceUrl: check.artifact.acquisition.sourceUrl,
      publishedUpdateSourceUrl: check.publishedUpdate.sourceUrl,
      publishedUpdateDate: check.publishedUpdate.publishedDatabaseUpdateDate,
      publishedUpdateDateRaw: check.publishedUpdate.publishedDatabaseUpdateDateRaw,
      publishedUpdateMatch: check.publishedUpdate.matchedText,
      artifactRetrievedAt: check.artifact.acquisition.retrievedAt,
      evidenceRetrievedAt: check.publishedUpdate.retrievedAt,
      etag: check.artifact.acquisition.etag ?? null,
      lastModified: check.artifact.acquisition.lastModified ?? null,
      contentByteLength: check.artifact.acquisition.byteSize,
      sha256: check.latestSha256,
      releaseLogicalKey,
      feedRunId: runId,
      planFingerprint: null,
      errorCode: code,
      errorSummary: summary,
    })

    return {
      outcome: 'planning_error',
      checkId,
      previousSha256,
      latestSha256: check.latestSha256,
      releaseLogicalKey,
      runId,
      errorCode: code,
      errorSummary: summary,
    }
  }
}

async function stagePlanRows(
  store: Block2eStore,
  runId: string,
  entries: PlanEntry[],
  batchSize: number,
): Promise<void> {
  const effectiveBatchSize = Math.max(1, Number.isFinite(batchSize) ? Math.floor(batchSize) : 1)
  for (let i = 0; i < entries.length; i += effectiveBatchSize) {
    const chunk = entries.slice(i, i + effectiveBatchSize)
    for (const entry of chunk) {
      await store.stageRow(runId, planEntryToStagedRow(entry))
    }
  }
}

function planEntryToStagedRow(entry: PlanEntry): Record<string, unknown> {
  const rowKind = entry.action === 'potential_missing' ? 'potential_missing' : 'source_item'
  const row: Record<string, unknown> = {
    row_kind: rowKind,
    proposed_action: entry.action,
    validation_status: entry.errors.length > 0 || entry.action === 'reject' ? 'invalid' : 'valid',
    validation_errors: entry.errors,
    validation_warnings: entry.warnings,
    proposed_diff: {
      ordinaryChanges: entry.ordinaryChanges,
      lifecycleChanges: entry.lifecycleChanges,
      assetChanges: entry.assetChanges,
      costChange: entry.costChange,
    },
    action_fingerprint: entry.actionId,
  }

  if (entry.item?.rowNumber !== undefined) row.row_number = entry.item.rowNumber
  if (entry.item?.key) row.source_record_key = entry.item.key
  if (entry.item?.path) row.source_path = entry.item.path
  if (entry.item) row.item_fingerprint = hashHex(stableSignature(entry.item))
  if (entry.sourceProductKey) row.source_product_key = entry.sourceProductKey
  if (entry.candidate?.sourceProductKeyOrigin) row.source_product_key_origin = entry.candidate.sourceProductKeyOrigin
  if (entry.candidate) row.proposed_product = entry.candidate
  if (entry.productId) row.matched_product_id = entry.productId
  if (entry.expectedProductRevision) row.expected_product_revision = entry.expectedProductRevision
  if (entry.expectedUpdatedAt) row.expected_product_updated_at = entry.expectedUpdatedAt

  return row
}

function classifyFetchCheckError(error: unknown): {
  status: 'fetch_error' | 'evidence_error' | 'validation_error'
  code: string
  summary: string
} {
  const message = messageText(error)
  const normalized = message.toLowerCase()
  if (normalized.includes('request failed') || normalized.includes('request timed out')) {
    return { status: 'fetch_error', code: 'fetch_failed', summary: boundedErrorSummary(message) }
  }
  if (normalized.includes('last-modified') || normalized.includes('published update date')) {
    return { status: 'evidence_error', code: 'evidence_invalid', summary: boundedErrorSummary(message) }
  }
  return { status: 'validation_error', code: 'artifact_invalid', summary: boundedErrorSummary(message) }
}

function classifyPlanningError(error: unknown): { code: string; summary: string } {
  return { code: 'planning_failed', summary: boundedErrorSummary(messageText(error)) }
}

function messageText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'unknown error'
}

function boundedErrorSummary(message: string): string {
  return message
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512)
}

function logicalRunKey(feedSourceId: string, sha256: string): string {
  return `wessex:${feedSourceId}:${sha256}`
}

function defaultFetchCheck(args: {
  previousSha256: string | null
  supplierId: string
  sourceId: string
  scopeId: string
  acquisitionComplete: boolean
  completeReleaseConfirmed: boolean
  timeoutMs?: number
}): Promise<WessexFetchCheckResult> {
  return runWessexFetchCheck({
    supplierId: args.supplierId,
    runId: '00000000-0000-4000-8000-000000000000',
    sourceId: args.sourceId,
    scopeId: args.scopeId,
    acquisitionComplete: args.acquisitionComplete,
    completeReleaseConfirmed: args.completeReleaseConfirmed,
    previousSha256: args.previousSha256,
    timeoutMs: args.timeoutMs,
  })
}

const stableSignature = (value: unknown): string => JSON.stringify(
  value,
  (_key, part: unknown) => (part && typeof part === 'object' && !Array.isArray(part)
    ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b)))
    : part),
)

function hashHex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

const decimalString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value
  return undefined
}

const textOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parsePermittedUses(value: unknown): string[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const uses = (value as Record<string, unknown>).uses
  if (!Array.isArray(uses)) return undefined
  const normalized = uses.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return normalized.length > 0 ? normalized : undefined
}

function mapProductFields(row: Record<string, unknown>): ProductFields {
  return {
    category: String(row.category) as ProductFields['category'],
    supplierDescription: String(row.supplier_description),
    lifecycle: String(row.lifecycle) as ProductFields['lifecycle'],
    availability: String(row.availability) as ProductFields['availability'],
    supplierSku: textOrNull(row.supplier_sku),
    catalogScope: textOrNull(row.catalog_scope) ?? 'default',
    variantKey: textOrNull(row.variant_key) ?? '',
    subcategory: textOrNull(row.subcategory),
    displayDescription: textOrNull(row.display_description),
    collectionName: textOrNull(row.collection_name),
    colour: textOrNull(row.colour),
    finish: textOrNull(row.finish),
    material: textOrNull(row.material),
    purchaseUnit: textOrNull(row.purchase_unit),
    widthMm: row.width_mm === null ? null : Number(row.width_mm),
    depthMm: row.depth_mm === null ? null : Number(row.depth_mm),
    rebateWidthMm: row.rebate_width_mm === null ? null : Number(row.rebate_width_mm),
    rebateDepthMm: row.rebate_depth_mm === null ? null : Number(row.rebate_depth_mm),
    sheetWidthMm: row.sheet_width_mm === null ? null : Number(row.sheet_width_mm),
    sheetHeightMm: row.sheet_height_mm === null ? null : Number(row.sheet_height_mm),
    matThicknessMm: row.mat_thickness_mm === null ? null : Number(row.mat_thickness_mm),
    glazingThicknessMm: row.glazing_thickness_mm === null ? null : Number(row.glazing_thickness_mm),
    glazingUvPercent: row.glazing_uv_percent === null ? null : Number(row.glazing_uv_percent),
  }
}

function mapProductCost(row: Record<string, unknown>) {
  const amount = decimalString(row.wholesale_cost)
  const currency = textOrNull(row.cost_currency)
  const unit = textOrNull(row.cost_unit)
  const taxBasis = textOrNull(row.cost_tax_basis)
  const effectiveAt = textOrNull(row.cost_effective_at)
  if (!amount || !currency || !unit || !taxBasis || !effectiveAt) return undefined
  return { amount, currency, unit, taxBasis: taxBasis as 'exclusive' | 'inclusive' | 'exempt' | 'unknown', effectiveAt }
}

function mapProductAsset(row: Record<string, unknown>): SourceAsset | undefined {
  const rightsStatus = textOrNull(row.image_rights_status)
  if (!rightsStatus) return undefined
  return {
    rightsStatus: rightsStatus as SourceAsset['rightsStatus'],
    sourceUrl: textOrNull(row.source_image_url),
    attribution: textOrNull(row.source_attribution),
    sourceUpdatedAt: textOrNull(row.source_image_updated_at),
    permittedUses: parsePermittedUses(row.image_permitted_uses),
  }
}

export function createSupabaseBlock2eStore(getSupabaseAdmin: () => { from: (table: string) => any; rpc: any }): Block2eStore {
  const db = () => getSupabaseAdmin()

  return {
    async ensureFeedSource(identity) {
      const { data, error } = await db().from('supplier_feed_sources')
        .select('id,supplier_id,scope_key')
        .eq('id', identity.feedSourceId)
        .eq('supplier_id', identity.supplierId)
        .eq('scope_key', identity.scopeKey)
        .single()
      if (error || !data) throw error ?? new Error('Configured feed source was not found')
    },

    async getLatestSuccessfulChecksum(feedSourceId) {
      const { data, error } = await db().from('supplier_feed_source_checks')
        .select('sha256,checked_at,created_at')
        .eq('feed_source_id', feedSourceId)
        .in('status', ['changed', 'unchanged'])
        .not('sha256', 'is', null)
        .order('checked_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      const row = (data ?? [])[0] as { sha256?: string } | undefined
      return row?.sha256 ?? null
    },

    async findRunByLogicalKey(supplierId, logicalRunKey) {
      const { data, error } = await db().from('supplier_feed_runs')
        .select('id,status,plan_fingerprint,plan_counts,source_checksum')
        .eq('supplier_id', supplierId)
        .eq('persistence_version', 2)
        .eq('logical_run_key', logicalRunKey)
        .limit(1)
      if (error) throw error
      const row = (data ?? [])[0] as Record<string, unknown> | undefined
      if (!row) return null
      return {
        id: String(row.id),
        status: String(row.status),
        planFingerprint: textOrNull(row.plan_fingerprint),
        planCounts: (row.plan_counts ?? null) as Record<string, number> | null,
        sourceChecksum: textOrNull(row.source_checksum),
      }
    },

    async createRun(input) {
      const { data, error } = await db().rpc('block2e_create_run', {
        p_supplier_id: input.supplierId,
        p_source_id: input.sourceId,
        p_scope_key: input.scopeKey,
        p_key: input.logicalRunKey,
        p_mode: input.mode,
        p_coverage: input.coverage,
        p_authoritative: input.authoritative,
        p_adapter_id: input.adapterId,
        p_adapter_version: input.adapterVersion,
        p_planner_version: input.plannerVersion,
        p_checksum: input.checksum,
        p_artifact_ref: input.artifactRef,
        p_acquired: input.acquisitionComplete,
        p_parsed: input.parsingComplete,
        p_validation_safe: input.validationSafeForMissing,
        p_missing_enabled: input.missingInferenceEnabled,
      })
      if (error || typeof data !== 'string') throw error ?? new Error('block2e_create_run did not return run ID')
      return data
    },

    async beginStaging(runId) {
      const { error } = await db().rpc('block2e_begin_staging', { p_run_id: runId })
      if (error) throw error
    },

    async stageRow(runId, row) {
      const { data, error } = await db().rpc('block2e_stage_row', { p_run_id: runId, p_row: row })
      if (error || typeof data !== 'string') throw error ?? new Error('block2e_stage_row did not return row ID')
      return data
    },

    async freezePlan(runId, policy) {
      const { data, error } = await db().rpc('block2e_freeze_plan', { p_run_id: runId, p_policy: policy })
      if (error || typeof data !== 'string') throw error ?? new Error('block2e_freeze_plan did not return fingerprint')
      return data
    },

    async readRun(runId) {
      const { data, error } = await db().from('supplier_feed_runs')
        .select('id,status,plan_fingerprint,plan_counts,source_checksum')
        .eq('id', runId)
        .single()
      if (error || !data) throw error ?? new Error('Run not found after plan freeze')
      return {
        id: String(data.id),
        status: String(data.status),
        planFingerprint: textOrNull(data.plan_fingerprint),
        planCounts: (data.plan_counts ?? null) as Record<string, number> | null,
        sourceChecksum: textOrNull(data.source_checksum),
      }
    },

    async listCanonicalProducts(supplierId) {
      const { data, error } = await db().from('supplier_products').select([
        'id',
        'supplier_id',
        'source_product_key',
        'owner_scope_key',
        'owner_feed_source_id',
        'updated_at',
        'product_revision',
        'category',
        'supplier_description',
        'lifecycle',
        'availability',
        'supplier_sku',
        'catalog_scope',
        'variant_key',
        'subcategory',
        'display_description',
        'collection_name',
        'colour',
        'finish',
        'material',
        'purchase_unit',
        'width_mm',
        'depth_mm',
        'rebate_width_mm',
        'rebate_depth_mm',
        'sheet_width_mm',
        'sheet_height_mm',
        'mat_thickness_mm',
        'glazing_thickness_mm',
        'glazing_uv_percent',
        'wholesale_cost',
        'cost_currency',
        'cost_unit',
        'cost_tax_basis',
        'cost_effective_at',
        'source_image_url',
        'source_attribution',
        'image_rights_status',
        'image_permitted_uses',
        'source_image_updated_at',
      ].join(','))
        .eq('supplier_id', supplierId)
      if (error) throw error
      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        supplierId: String(row.supplier_id),
        sourceProductKey: textOrNull(row.source_product_key),
        ownerScopeId: textOrNull(row.owner_scope_key),
        ownerSourceId: textOrNull(row.owner_feed_source_id),
        updatedAt: String(row.updated_at),
        productRevision: decimalString(row.product_revision),
        fields: mapProductFields(row),
        ...(mapProductCost(row) ? { cost: mapProductCost(row) } : {}),
        ...(mapProductAsset(row) ? { asset: mapProductAsset(row) } : {}),
      }))
    },

    async listSourceKeyAliases(supplierId) {
      const { data, error } = await db().from('supplier_product_aliases')
        .select('supplier_id,supplier_product_id,alias_kind,alias_value')
        .eq('supplier_id', supplierId)
      if (error) throw error
      return (data ?? []).map((row: Record<string, unknown>) => ({
        supplierId: String(row.supplier_id),
        productId: String(row.supplier_product_id),
        aliasKind: String(row.alias_kind) as SourceKeyAlias['aliasKind'],
        aliasValue: String(row.alias_value),
      }))
    },

    async recordSourceCheck(input) {
      const { data, error } = await db().rpc('block2e_record_source_check', {
        p_feed_source_id: input.feedSourceId,
        p_checked_at: input.checkedAt,
        p_status: input.status,
        p_source_url: input.sourceUrl,
        p_published_update_source_url: input.publishedUpdateSourceUrl,
        p_published_update_date: input.publishedUpdateDate,
        p_published_update_date_raw: input.publishedUpdateDateRaw,
        p_published_update_match: input.publishedUpdateMatch,
        p_artifact_retrieved_at: input.artifactRetrievedAt,
        p_evidence_retrieved_at: input.evidenceRetrievedAt,
        p_etag: input.etag,
        p_last_modified: input.lastModified,
        p_content_byte_length: input.contentByteLength,
        p_sha256: input.sha256,
        p_release_logical_key: input.releaseLogicalKey,
        p_feed_run_id: input.feedRunId,
        p_plan_fingerprint: input.planFingerprint,
        p_error_code: input.errorCode,
        p_error_summary: input.errorSummary,
      })
      if (error || typeof data !== 'string') throw error ?? new Error('block2e_record_source_check did not return check ID')
      return data
    },
  }
}

export type CheckRowForReport = {
  id: string
  feed_source_id: string
  checked_at: string
  status: SourceCheckStatus
  release_classification: 'changed' | 'unchanged' | null
  sha256: string | null
  release_logical_key: string | null
  feed_run_id: string | null
  error_code: string | null
  error_summary: string | null
}

export function issueCodes(issues: FeedIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.code).filter(Boolean))]
}
