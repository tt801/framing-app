import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { planFeed } from '../server/platform/supplierFeeds/planner.js'
import { normalizeInternationalArtifact } from '../server/platform/supplierFeeds/internationalNormalization.js'
import { parseInternationalMoulding } from '../server/platform/supplierFeeds/internationalMoulding.js'
import { acquisition, member, workbook, zip } from './helpers/internationalFixture.js'

it('normalizes historical identity/description only, with immutable dry-run/no-missing policy', () => {
  const bytes = zip([[member, workbook()]])
  const raw = parseInternationalMoulding(bytes, acquisition(bytes))
  const out = normalizeInternationalArtifact(raw, { supplierId: 'supplier', sourceId: 'source', scopeId: 'mouldings', runId: 'actual-run', mode: 'apply_requested', authoritative: true } as any)
  expect(out.context).toMatchObject({ runId: 'actual-run', mode: 'dry_run', authoritative: false, missingInferenceEnabled: false, validationSafeForMissing: false })
  expect(out.planningRows).toHaveLength(1)
  expect(out.candidates[0]).toMatchObject({ sourceProductKey: '0354‐3029', fields: { supplierSku: '0354‐3029', supplierDescription: '1 1/2" Mahogany Reverse Stairs' } })
  expect(out.candidates[0]).not.toHaveProperty('cost')
  expect(out.candidates[0].fields).not.toHaveProperty('widthMm')
  expect(out.provenance.rawRows[0].prices.Chop.decimal).toBe('4.44')
  const plan = planFeed({ context: out.context, rows: out.planningRows, aliases: [], massChangePolicy: {}, existingProducts: [{
    id: 'existing-product', supplierId: 'supplier', sourceProductKey: 'OLD-NOT-IN-HISTORICAL-FILE', ownerSourceId: 'source', ownerScopeId: 'mouldings',
    updatedAt: '2026-10-15T00:00:00Z', productRevision: '1', fields: { category: 'frame', supplierDescription: 'Existing current product', lifecycle: 'active', availability: 'available' },
    cost: { amount: '99', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-15T00:00:00Z' },
  }] })
  expect(plan.counts.potential_missing).toBe(0)
  expect(plan.counts.cost_changes).toBe(0)
  expect(plan.missingInferenceEligible).toBe(false)
  expect(plan.entries).toHaveLength(1)
})

it('accepts the complete official historical fixture without asserting any canonical cost or dimension', () => {
  const book = readFileSync(new URL('./fixtures/international-moulding/january-2023.xlsx', import.meta.url))
  const bytes = zip([[member, book]])
  const out = normalizeInternationalArtifact(parseInternationalMoulding(bytes, acquisition(bytes)), { supplierId: 'supplier', sourceId: 'source', scopeId: 'mouldings', runId: 'local-only' })
  expect(out.candidates).toHaveLength(1024)
  expect(out.planningRows.every(row => row.result.errors.length === 0)).toBe(true)
  expect(out.candidates.every(candidate => candidate.cost === undefined && candidate.fields.widthMm === undefined)).toBe(true)
})
