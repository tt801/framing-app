import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parseWessexMouldings } from '../server/platform/supplierFeeds/wessexMouldings.js'
import { normalizeWessexArtifact } from '../server/platform/supplierFeeds/wessexNormalization.js'
import { planFeed } from '../server/platform/supplierFeeds/planner.js'
import { validateCandidate } from '../server/platform/supplierFeeds/validation.js'
import type { Candidate, CanonicalProduct } from '../server/platform/supplierFeeds/contracts.js'

const outputPath = '/opt/data/cache/scratch/wessex-block2f/phase2_planner_scenarios_results.json'
const sourceUrl = 'https://www.wessexpictures.com/res/WessexMouldings.xls'
const options = {
  supplierId: 'test-wessex', runId: 'test-run', sourceId: 'test-wessex-mouldings', scopeId: 'mouldings',
  publishedDatabaseUpdateDate: '08/10/2026', acquisitionComplete: true, completeReleaseConfirmed: true,
}

function release(rows: unknown[][]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Reference', 'Description', 'Price/mtr', 'Width'], ...rows]), 'gen')
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
  return normalizeWessexArtifact(parseWessexMouldings(bytes, {
    sourceUrl, originalFilename: 'WessexMouldings.xls', byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    retrievedAt: '2026-10-12T11:31:43Z', lastModified: 'Thu, 08 Oct 2026 15:21:52 GMT',
  }), options)
}
function canonical(candidates: Candidate[]): CanonicalProduct[] {
  return candidates.map((candidate, index) => ({
    id: `p-${index + 1}`,
    supplierId: candidate.supplierId,
    sourceProductKey: candidate.sourceProductKey,
    ownerScopeId: candidate.scopeId,
    ownerSourceId: candidate.sourceId,
    updatedAt: '2026-10-08T15:30:00Z',
    productRevision: '1',
    fields: candidate.fields,
    ...(candidate.cost ? { cost: candidate.cost } : {}),
  }))
}

const baseRows = [
  ['A007', '3/8" Black Hockey Gold Sight', 3.22, 13],
  ['A008', '3/8" Gold Hockey Black Sight', 3.56, 13],
  ['STMO', '1 1/2" x 3/4" Stretcher Moulding', 3.6, 2],
]
const base = release(baseRows)
const existing = canonical(base.candidates)
const run = (incoming = base, products = existing, policy = {}) =>
  planFeed({ context: incoming.context, rows: incoming.planningRows, existingProducts: products, aliases: [], massChangePolicy: policy })

function scenarioCounts() {
  const A = run(base, [])
  const B = run(base, existing)
  const C = run(release([['A007', '3/8" Black Hockey Gold Sight', 4.22, 13], baseRows[1], baseRows[2]]), existing)
  const D = run(release([['A007', 'Changed Description', 3.22, 13], baseRows[1], baseRows[2]]), existing)
  const E = run(release([['A007', '3/8" Black Hockey Gold Sight', 3.22, 14], baseRows[1], baseRows[2]]), existing)
  const F = run(release([...baseRows, ['NEW1', 'New Profile', 9.99, 18]]), existing)
  const G = run(release([baseRows[0], baseRows[1]]), existing)
  const H = run(release([baseRows[0]]), existing, { potentialMissing: { count: 0, proportion: 0 } })
  const I = run(base, [{ ...existing[0], id: 'foreign', supplierId: 'other-supplier', sourceProductKey: 'FOREIGN-1' }])

  const original = base.candidates[0]
  const candidate: Candidate = {
    ...original,
    sourceProductKey: 'A007-ALT',
    item: { ...original.item, key: 'A007-ALT' },
    fields: { ...original.fields, supplierSku: 'SHARED-SKU' },
  }
  const validated = validateCandidate(candidate)
  if (!validated.value || validated.errors.length) throw new Error('scenario J candidate invalid')
  const J = planFeed({
    context: base.context,
    rows: [{ item: candidate.item, result: validated }],
    existingProducts: [{ ...existing[0], fields: { ...existing[0].fields, supplierSku: 'SHARED-SKU' } }],
    aliases: [],
    massChangePolicy: {},
  })

  return {
    A: A.counts,
    B: B.counts,
    C: C.counts,
    D: D.counts,
    E: E.counts,
    F: F.counts,
    G: G.counts,
    H: { counts: H.counts, requiresAcknowledgement: H.requiresAcknowledgement, flags: H.massChangeFlags },
    I: I.counts,
    J: { counts: J.counts, warnings: J.entries[0]?.warnings ?? [] },
  }
}

describe('generic Block 2E planner scenarios A-J with normalized Wessex candidates', () => {
  it('matches expected scenario actions and safety flags', () => {
    const scenarios = scenarioCounts()
    writeFileSync(outputPath, JSON.stringify(scenarios, null, 2))

    expect(scenarios.A).toMatchObject({ create: 3, update: 0, unchanged: 0, potential_missing: 0, reject: 0, review: 0 })
    expect(scenarios.B).toMatchObject({ unchanged: 3, create: 0, update: 0, potential_missing: 0, reject: 0, review: 0 })
    expect(scenarios.C).toMatchObject({ update: 1, cost_changes: 1, unchanged: 2 })
    expect(scenarios.D).toMatchObject({ update: 1 })
    expect(scenarios.E).toMatchObject({ update: 1 })
    expect(scenarios.F).toMatchObject({ create: 1, unchanged: 3 })
    expect(scenarios.G).toMatchObject({ potential_missing: 1 })
    expect(scenarios.H.counts).toMatchObject({ potential_missing: 2 })
    expect(scenarios.H.requiresAcknowledgement).toBe(true)
    expect(scenarios.I).toMatchObject({ create: 3, potential_missing: 0 })
    expect(scenarios.J.counts).toMatchObject({ review: 1, create: 0, update: 0 })
    expect(scenarios.J.warnings.some((warning) => warning.code === 'sku_collision')).toBe(true)
  })
})
