import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parseWessexMouldings } from '../server/platform/supplierFeeds/wessexMouldings.js'
import { normalizeWessexArtifact } from '../server/platform/supplierFeeds/wessexNormalization.js'
import { planFeed, type PlanningRow } from '../server/platform/supplierFeeds/planner.js'
import { validateCandidate } from '../server/platform/supplierFeeds/validation.js'
import type { Candidate, CanonicalProduct, FeedContext } from '../server/platform/supplierFeeds/contracts.js'

const artifactPath = '/opt/data/cache/scratch/wessex-block2f/WessexMouldings.xls'
const summaryPath = '/opt/data/cache/scratch/wessex-block2f/phase3_successive_release_summary.json'
const sourceUrl = 'https://www.wessexpictures.com/res/WessexMouldings.xls'
const baseLastModified = 'Thu, 08 Oct 2026 15:21:52 GMT'
const basePublishedDate = '08/10/2026'
const baseRetrievedAt = '2026-10-12T11:31:43Z'

const supplierId = 'wessex-phase3-supplier'
const sourceId = 'wessex-phase3-source'
const scopeId = 'mouldings'

const asCanonical = (candidates: Candidate[]): CanonicalProduct[] => candidates.map((candidate, index) => ({
  id: `wessex-p-${index + 1}`,
  supplierId: candidate.supplierId,
  sourceProductKey: candidate.sourceProductKey,
  ownerScopeId: candidate.scopeId,
  ownerSourceId: candidate.sourceId,
  updatedAt: '2026-10-08T15:30:00Z',
  productRevision: '1',
  fields: candidate.fields,
  ...(candidate.cost ? { cost: candidate.cost } : {}),
}))

const toRows = (release: ReturnType<typeof normalizeWessexArtifact>) =>
  release.provenance.rawRows.map((row) => [row.reference, row.description, row.pricePerMetreRaw, row.widthRaw] as [string, string, number, number])

const cloneRows = (rows: Array<[string, string, number, number]>) => rows.map((row) => [...row] as [string, string, number, number])

function makeRelease(rows: Array<[string, string, number, number]>, config: {
  runId: string
  publishedDate: string
  lastModified: string
  retrievedAt: string
  acquisitionComplete?: boolean
  completeReleaseConfirmed?: boolean
}) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Reference', 'Description', 'Price/mtr', 'Width'], ...rows]), 'gen')
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const raw = parseWessexMouldings(bytes, {
    sourceUrl,
    originalFilename: 'WessexMouldings.xls',
    byteSize: bytes.length,
    sha256,
    retrievedAt: config.retrievedAt,
    lastModified: config.lastModified,
  })
  return normalizeWessexArtifact(raw, {
    supplierId,
    runId: config.runId,
    sourceId,
    scopeId,
    publishedDatabaseUpdateDate: config.publishedDate,
    acquisitionComplete: config.acquisitionComplete ?? true,
    completeReleaseConfirmed: config.completeReleaseConfirmed ?? true,
  })
}

const plan = (context: FeedContext, rows: PlanningRow[], existingProducts: CanonicalProduct[], policy = {}) =>
  planFeed({ context, rows, existingProducts, aliases: [], massChangePolicy: policy })

function withRow(rows: Array<[string, string, number, number]>, key: string, updater: (row: [string, string, number, number]) => void) {
  const copy = cloneRows(rows)
  const target = copy.find((row) => row[0] === key)
  if (!target) throw new Error(`Missing fixture row for ${key}`)
  updater(target)
  return copy
}

describe('Wessex successive release/update/disappearance behaviour (Phase 3)', () => {
  it('exercises scenarios A-N through generic Block 2E planning only', () => {
    const bytesA = readFileSync(artifactPath)
    const shaA = createHash('sha256').update(bytesA).digest('hex')
    const rawA = parseWessexMouldings(bytesA, {
      sourceUrl,
      originalFilename: 'WessexMouldings.xls',
      byteSize: bytesA.length,
      sha256: shaA,
      retrievedAt: baseRetrievedAt,
      lastModified: baseLastModified,
    })
    const releaseA = normalizeWessexArtifact(rawA, {
      supplierId,
      runId: 'release-a',
      sourceId,
      scopeId,
      publishedDatabaseUpdateDate: basePublishedDate,
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
    })
    const rowsA = toRows(releaseA)
    const existingA = asCanonical(releaseA.candidates)

    const releaseBIdentical = makeRelease(rowsA, {
      runId: 'release-b-identical',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
    })
    const scenarioA = plan(releaseBIdentical.context, releaseBIdentical.planningRows, existingA)
    const existingB = asCanonical(releaseBIdentical.candidates)

    const rowsPriceChange = withRow(rowsA, 'A007', (row) => { row[2] = Number((row[2] + 1).toFixed(2)) })
    const releaseBPrice = makeRelease(rowsPriceChange, {
      runId: 'release-b-price-change',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
    })
    const scenarioB = plan(releaseBPrice.context, releaseBPrice.planningRows, existingB)

    const rowsDescChange = withRow(rowsA, 'A007', (row) => { row[1] = `${row[1]} CHANGED` })
    const releaseBDesc = makeRelease(rowsDescChange, {
      runId: 'release-b-description-change',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
    })
    const scenarioC = plan(releaseBDesc.context, releaseBDesc.planningRows, existingB)

    const rowsWidthChange = withRow(rowsA, 'A007', (row) => { row[3] = row[3] + 1 })
    const releaseBWidth = makeRelease(rowsWidthChange, {
      runId: 'release-b-width-change',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
    })
    const scenarioD = plan(releaseBWidth.context, releaseBWidth.planningRows, existingB)

    const rowsAdd = [...cloneRows(rowsA), ['ZZ_SYNTH_NEW_001', 'Synthetic Test Profile', 7.77, 19] as [string, string, number, number]]
    const releaseBNew = makeRelease(rowsAdd, {
      runId: 'release-b-new-product',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
    })
    const scenarioE = plan(releaseBNew.context, releaseBNew.planningRows, existingB)

    const removedKey = 'A007'
    const rowsMissingOne = cloneRows(rowsA).filter((row) => row[0] !== removedKey)
    const releaseBMissingOne = makeRelease(rowsMissingOne, {
      runId: 'release-b-missing-one',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
    })
    const scenarioF = plan(releaseBMissingOne.context, releaseBMissingOne.planningRows, existingB)

    const keysRemovedSmall = new Set(['A007', 'A008', 'A016'])
    const rowsMissingSmall = cloneRows(rowsA).filter((row) => !keysRemovedSmall.has(row[0]))
    const releaseBMissingSmall = makeRelease(rowsMissingSmall, {
      runId: 'release-b-missing-small',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
    })
    const scenarioG = plan(releaseBMissingSmall.context, releaseBMissingSmall.planningRows, existingB)

    const rowsTruncated = cloneRows(rowsA).slice(0, 120)
    const releaseBTruncated = makeRelease(rowsTruncated, {
      runId: 'release-b-truncated',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
    })
    const scenarioH = plan(releaseBTruncated.context, releaseBTruncated.planningRows, existingB, {
      potentialMissing: { count: 30, proportion: 0.02 },
    })

    const releaseBUnhealthy = makeRelease(rowsMissingOne, {
      runId: 'release-b-unhealthy',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
      acquisitionComplete: false,
      completeReleaseConfirmed: true,
    })
    const scenarioI = plan(releaseBUnhealthy.context, releaseBUnhealthy.planningRows, existingB)

    const invalidCandidate = { ...releaseBMissingOne.candidates[0], sourceProductKey: ' ' }
    const invalidResult = validateCandidate(invalidCandidate)
    if (!invalidResult.errors.length) throw new Error('expected invalid candidate result for scenario J')
    const rowsJ = [...releaseBMissingOne.planningRows]
    rowsJ[0] = { item: rowsJ[0].item, result: invalidResult }
    const scenarioJ = plan(releaseBMissingOne.context, rowsJ, existingB)

    const scenarioKMissing = scenarioF
    const existingAfterDiscontinued = existingB.map((product) => product.sourceProductKey === removedKey
      ? { ...product, fields: { ...product.fields, lifecycle: 'discontinued' as const } }
      : product)
    const scenarioKReappear = plan(releaseBIdentical.context, releaseBIdentical.planningRows, existingAfterDiscontinued)

    const rowsReuseRisk = withRow(rowsA, 'A007', (row) => {
      row[1] = 'Completely Different Profile Signature'
      row[3] = 71
    })
    const releaseBReuseRisk = makeRelease(rowsReuseRisk, {
      runId: 'release-b-reference-reuse-risk',
      publishedDate: '09/10/2026',
      lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
      retrievedAt: '2026-10-13T10:15:00Z',
    })
    const scenarioL = plan(releaseBReuseRisk.context, releaseBReuseRisk.planningRows, existingB)

    const foreignSameSupplierOtherScope: CanonicalProduct = {
      ...existingB[0],
      id: 'foreign-scope',
      ownerSourceId: 'other-source',
      ownerScopeId: 'other-scope',
      sourceProductKey: 'FOREIGN-SCOPE-KEY',
    }
    const foreignOtherSupplier: CanonicalProduct = {
      ...existingB[1],
      id: 'foreign-supplier',
      supplierId: 'another-supplier',
      sourceProductKey: 'FOREIGN-SUPPLIER-KEY',
    }
    const scenarioM = plan(releaseBMissingOne.context, releaseBMissingOne.planningRows, [...existingB, foreignSameSupplierOtherScope, foreignOtherSupplier])

    const scenarioN1 = plan(releaseBPrice.context, releaseBPrice.planningRows, existingB)
    const scenarioN2 = plan(releaseBPrice.context, releaseBPrice.planningRows, existingB)

    const scenarioAEntry = scenarioA.entries.find((entry) => entry.sourceProductKey === 'A007')
    const scenarioKEntry = scenarioKReappear.entries.find((entry) => entry.sourceProductKey === removedKey)
    const scenarioLEntry = scenarioL.entries.find((entry) => entry.sourceProductKey === 'A007')

    const summary = {
      baseline: {
        artifactSha256: shaA,
        parsedRows: rawA.observedRows,
        normalizedCandidates: releaseA.candidates.length,
        rejected: releaseA.rejected.length,
        duplicateSourceProductKeys: releaseA.candidates.length - new Set(releaseA.candidates.map((candidate) => candidate.sourceProductKey)).size,
      },
      scenarios: {
        A_identical_new_release: {
          counts: scenarioA.counts,
          exampleA007: scenarioAEntry ? {
            action: scenarioAEntry.action,
            ordinaryChanges: scenarioAEntry.ordinaryChanges,
            lifecycleChanges: scenarioAEntry.lifecycleChanges,
            costChange: scenarioAEntry.costChange,
          } : null,
        },
        B_price_change: scenarioB.counts,
        C_description_change: scenarioC.counts,
        D_width_change: scenarioD.counts,
        E_new_product: scenarioE.counts,
        F_single_disappearance: {
          counts: scenarioF.counts,
          missingInferenceEligible: scenarioF.missingInferenceEligible,
        },
        G_multiple_disappearances_small: {
          counts: scenarioG.counts,
          requiresAcknowledgement: scenarioG.requiresAcknowledgement,
          massChangeFlags: scenarioG.massChangeFlags,
        },
        H_large_truncated_snapshot: {
          counts: scenarioH.counts,
          requiresAcknowledgement: scenarioH.requiresAcknowledgement,
          massChangeFlags: scenarioH.massChangeFlags,
        },
        I_unhealthy_incomplete_release: {
          counts: scenarioI.counts,
          missingInferenceEligible: scenarioI.missingInferenceEligible,
          warnings: scenarioI.warnings,
        },
        J_invalid_row_in_complete_release: {
          counts: scenarioJ.counts,
          missingInferenceEligible: scenarioJ.missingInferenceEligible,
          warnings: scenarioJ.warnings,
        },
        K_reappearance: {
          missingStepCounts: scenarioKMissing.counts,
          reappearCounts: scenarioKReappear.counts,
          reappearA007: scenarioKEntry ? {
            action: scenarioKEntry.action,
            lifecycleChanges: scenarioKEntry.lifecycleChanges,
            costChange: scenarioKEntry.costChange,
          } : null,
        },
        L_reference_reuse_risk: {
          counts: scenarioL.counts,
          a007: scenarioLEntry ? {
            action: scenarioLEntry.action,
            warnings: scenarioLEntry.warnings,
            ordinaryChanges: scenarioLEntry.ordinaryChanges,
            lifecycleChanges: scenarioLEntry.lifecycleChanges,
            costChange: scenarioLEntry.costChange,
          } : null,
        },
        M_non_wessex_isolation: scenarioM.counts,
        N_determinism: {
          sameCounts: JSON.stringify(scenarioN1.counts) === JSON.stringify(scenarioN2.counts),
          sameEntries: JSON.stringify(scenarioN1.entries) === JSON.stringify(scenarioN2.entries),
          firstActionId: scenarioN1.entries[0]?.actionId,
          secondActionId: scenarioN2.entries[0]?.actionId,
        },
      },
      metadata: {
        basePublishedDate,
        baseLastModified,
        syntheticReleaseMetadata: {
          publishedDate: '09/10/2026',
          lastModified: 'Fri, 09 Oct 2026 10:05:00 GMT',
          retrievedAt: '2026-10-13T10:15:00Z',
          provenance: 'test_fixture_only_not_real_wessex_release',
        },
      },
    }

    writeFileSync(summaryPath, JSON.stringify(summary, null, 2))

    expect(releaseA.candidates.length).toBe(1194)
    expect(releaseA.rejected.length).toBe(0)
    expect(summary.baseline.duplicateSourceProductKeys).toBe(0)

    expect(scenarioA.counts.update).toBe(1194)
    expect(scenarioA.counts.cost_changes).toBe(1194)
    expect(scenarioA.counts.create).toBe(0)
    expect(scenarioA.counts.potential_missing).toBe(0)

    expect(scenarioB.counts).toMatchObject({ update: 1, unchanged: 1193, create: 0, potential_missing: 0, cost_changes: 1 })
    expect(scenarioC.counts).toMatchObject({ update: 1, unchanged: 1193, create: 0, potential_missing: 0 })
    expect(scenarioD.counts).toMatchObject({ update: 1, unchanged: 1193, create: 0, potential_missing: 0 })
    expect(scenarioE.counts).toMatchObject({ create: 1, unchanged: 1194, potential_missing: 0 })

    expect(scenarioF.counts).toMatchObject({ potential_missing: 1, unchanged: 1193, create: 0 })
    expect(scenarioF.missingInferenceEligible).toBe(true)

    expect(scenarioG.counts).toMatchObject({ potential_missing: 3, unchanged: 1191 })
    expect(scenarioG.requiresAcknowledgement).toBe(false)

    expect(scenarioH.counts.potential_missing).toBe(1074)
    expect(scenarioH.requiresAcknowledgement).toBe(true)
    expect(scenarioH.massChangeFlags.some((flag) => flag.kind === 'potentialMissing')).toBe(true)

    expect(scenarioI.counts.potential_missing).toBe(0)
    expect(scenarioI.missingInferenceEligible).toBe(false)

    expect(scenarioJ.counts.reject).toBe(1)
    expect(scenarioJ.counts.potential_missing).toBe(0)
    expect(scenarioJ.missingInferenceEligible).toBe(false)

    expect(scenarioKMissing.counts.potential_missing).toBe(1)
    expect(scenarioKEntry?.action).toBe('update')
    expect(scenarioKEntry?.lifecycleChanges).toContain('lifecycle')

    expect(scenarioLEntry?.action).toBe('update')
    expect((scenarioLEntry?.warnings ?? []).length).toBe(0)

    expect(scenarioM.counts.potential_missing).toBe(1)

    expect(scenarioN1).toEqual(scenarioN2)
  })
})
