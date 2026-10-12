import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseWessexMouldings } from '../server/platform/supplierFeeds/wessexMouldings.js'
import { normalizeWessexArtifact } from '../server/platform/supplierFeeds/wessexNormalization.js'
import { planFeed } from '../server/platform/supplierFeeds/planner.js'

const artifactPath = '/opt/data/cache/scratch/wessex-block2f/WessexMouldings.xls'
const outputPath = '/opt/data/cache/scratch/wessex-block2f/phase2_dryrun_results.json'
const sourceUrl = 'https://www.wessexpictures.com/res/WessexMouldings.xls'

describe('real Wessex artifact dry run through parser + normalizer + planner', () => {
  it('records artifact statistics and empty-state planner counts without DB writes', () => {
    const bytes = readFileSync(artifactPath)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const raw = parseWessexMouldings(bytes, {
      sourceUrl,
      originalFilename: 'WessexMouldings.xls',
      byteSize: bytes.length,
      sha256,
      retrievedAt: '2026-10-12T11:31:43Z',
      lastModified: 'Thu, 08 Oct 2026 15:21:52 GMT',
    })
    const release = normalizeWessexArtifact(raw, {
      supplierId: 'wessex-supplier',
      runId: 'wessex-run-1',
      sourceId: 'wessex-mouldings',
      scopeId: 'mouldings',
      publishedDatabaseUpdateDate: '08/10/2026',
      acquisitionComplete: true,
      completeReleaseConfirmed: true,
    })

    const emptyPlan = planFeed({
      context: release.context,
      rows: release.planningRows,
      existingProducts: [],
      aliases: [],
      massChangePolicy: {},
    })

    const costs = release.candidates.map((candidate) => Number(candidate.cost?.amount)).filter(Number.isFinite)
    const widths = release.candidates.map((candidate) => candidate.fields.widthMm).filter((value): value is number => typeof value === 'number')
    const keyCounts = new Map<string, number>()
    for (const candidate of release.candidates) keyCounts.set(candidate.sourceProductKey, (keyCounts.get(candidate.sourceProductKey) ?? 0) + 1)

    const c2164 = release.candidates.find((candidate) => candidate.sourceProductKey === 'C2164')
    const pw45 = release.candidates.find((candidate) => candidate.sourceProductKey === 'PW45')

    const output = {
      artifactSha256: sha256,
      parsedRowCount: raw.observedRows,
      normalizedCandidateCount: release.candidates.length,
      rejectedNormalizationRowCount: release.rejected.length,
      reviewCountOnEmptyPlan: emptyPlan.counts.review,
      duplicateSourceProductKeyCount: [...keyCounts.values()].filter((count) => count > 1).length,
      minCost: Math.min(...costs),
      maxCost: Math.max(...costs),
      minWidthMm: Math.min(...widths),
      maxWidthMm: Math.max(...widths),
      anomalies: release.rejected,
      c2164SupplierDescription: c2164?.fields.supplierDescription,
      pw45SupplierDescription: pw45?.fields.supplierDescription,
      plannerEmptyStateCounts: emptyPlan.counts,
    }
    writeFileSync(outputPath, JSON.stringify(output, null, 2))

    expect(sha256).toBe('f96d393af1847d30929b8be8a2e165404a48ed6c3e93f7bcc6c2b0fd0d0f7e80')
    expect(raw.observedRows).toBe(1194)
    expect(release.planningRows.length).toBe(1194)
    expect(release.candidates.length).toBe(1194)
    expect(release.rejected.length).toBe(0)
    expect(emptyPlan.counts.create).toBe(1194)
    expect(emptyPlan.counts.reject).toBe(0)
    expect(c2164?.fields.supplierDescription).toBe('1" Flat Distressed Bright Gold')
    expect(pw45?.fields.supplierDescription).toBe('7/8" Gothic Oak')
  })
})
