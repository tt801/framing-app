import type { Candidate, FeedContext } from './contracts.js'
import { validateCandidate } from './validation.js'
import type { PlanningRow } from './planner.js'
import type { WessexRawArtifact } from './wessexMouldings.js'

const trimBoundaryWhitespace = (value: string) => value.replace(/^[\p{White_Space}]+|[\p{White_Space}]+$/gu, '')

export type WessexNormalizationInput = {
  /** Caller must supply registered source/scope/run identity; this module never registers one. */
  supplierId: string
  runId: string
  sourceId: string
  scopeId: string
  /** Operator's transcription of the Wessex-published update date (DD/MM/YYYY). */
  publishedDatabaseUpdateDate: string
  /** Independent transport and release-completeness checks; never inferred from a row count. */
  acquisitionComplete: boolean
  completeReleaseConfirmed: boolean
}

/** No persistence or application: candidate fields are generic, evidence remains outside Candidate. */
export function normalizeWessexArtifact(raw: WessexRawArtifact, input: WessexNormalizationInput) {
  if (raw?.adapter?.id !== 'wessex-wpp4-mouldings' || raw.adapter.version !== '1' ||
      raw.worksheet !== 'gen' || raw.canonicalReady !== false ||
      !Array.isArray(raw.rows) || raw.rows.length < 1 || raw.observedRows !== raw.rows.length ||
      !/^[0-9a-f]{64}$/.test(raw.acquisition?.sha256 ?? '') ||
      typeof input.acquisitionComplete !== 'boolean' || typeof input.completeReleaseConfirmed !== 'boolean')
    throw new Error('Unverified Wessex release evidence')

  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.publishedDatabaseUpdateDate ?? '')
  const lastModified = raw.acquisition.lastModified
  if (!dateMatch || typeof lastModified !== 'string' ||
      !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(lastModified))
    throw new Error('Wessex update date and HTTP Last-Modified are both required')
  const [, day, month, year] = dateMatch
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const instant = new Date(lastModified)
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) ||
      date.getUTCDate() !== Number(day) || !Number.isFinite(instant.getTime()) ||
      instant.toUTCString() !== lastModified || instant.toISOString().slice(0, 10) !== date.toISOString().slice(0, 10))
    throw new Error('Wessex published update date and HTTP Last-Modified UTC date disagree')

  const adapter = { id: 'wessex-wpp4-mouldings', version: '2' }
  const context: FeedContext = {
    supplierId: input.supplierId, runId: input.runId, sourceId: input.sourceId, scopeId: input.scopeId,
    adapter, mode: 'dry_run', coverage: 'snapshot',
    authoritative: input.completeReleaseConfirmed,
    acquisitionComplete: input.acquisitionComplete, parsingComplete: true,
    validationSafeForMissing: false, missingInferenceEnabled: false,
  }
  const planningRows: PlanningRow[] = []
  const candidates: Candidate[] = []
  const rejected: Array<{ item: Candidate['item']; errors: ReturnType<typeof validateCandidate>['errors'] }> = []
  const seen = new Set<string>()
  for (const row of raw.rows) {
    const amount = String(row?.pricePerMetreRaw)
    const normalizedDescription = typeof row?.description === 'string' ? trimBoundaryWhitespace(row.description) : ''
    if (row?.artifactSha256 !== raw.acquisition.sha256 || row.identityStability !== 'unconfirmed' ||
        row.sourceProductKeyOrigin !== 'supplier_provided' || row.sourceProductKey !== row.reference ||
        row.item?.key !== row.reference || !Number.isSafeInteger(row.item.rowNumber) || row.item.rowNumber < 2 ||
        row.item.path !== `gen!A${row.item.rowNumber}:D${row.item.rowNumber}` ||
        typeof row.reference !== 'string' || !row.reference.trim() || row.reference !== row.reference.trim() ||
        seen.has(row.reference.toLowerCase()) || typeof row.description !== 'string' || !normalizedDescription ||
        !Number.isFinite(row.pricePerMetreRaw) || row.pricePerMetreRaw <= 0 ||
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) ||
        !Number.isFinite(row.widthRaw) || row.widthRaw <= 0)
      throw new Error(`Invalid Wessex raw evidence at row ${row?.item?.rowNumber ?? 'unknown'}`)
    seen.add(row.reference.toLowerCase())
    const candidate: Candidate = {
      supplierId: context.supplierId, runId: context.runId, sourceId: context.sourceId, scopeId: context.scopeId,
      adapter, item: { ...row.item }, sourceProductKey: row.reference,
      sourceProductKeyOrigin: 'supplier_provided',
      fields: { category: 'frame', supplierDescription: normalizedDescription, lifecycle: 'active', availability: 'unknown', widthMm: row.widthRaw },
      cost: { amount, currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: instant.toISOString() },
    }
    const result = validateCandidate(candidate)
    planningRows.push({ item: candidate.item, result })
    if (result.value && result.errors.length === 0) candidates.push(result.value)
    else rejected.push({ item: candidate.item, errors: result.errors })
  }
  context.validationSafeForMissing = rejected.length === 0
  context.missingInferenceEnabled = input.acquisitionComplete && input.completeReleaseConfirmed && context.validationSafeForMissing
  return {
    candidates, planningRows, context, rejected,
    provenance: {
      artifactSha256: raw.acquisition.sha256,
      acquisition: { ...raw.acquisition },
      rawRows: raw.rows,
      publishedDatabaseUpdateDate: input.publishedDatabaseUpdateDate,
      publishedDateProvenance: 'operator_transcription_of_published_wessex_date' as const,
      httpLastModified: lastModified,
      effectiveAtInstantSource: 'http_last_modified' as const,
      priceAndDimensionSemantics: 'operator_confirmed' as const,
      catalogueCompletenessSemantics: 'operator_confirmed' as const,
      completeReleaseConfirmed: input.completeReleaseConfirmed,
      identityStability: 'unconfirmed' as const,
    },
  }
}
