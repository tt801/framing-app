import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parseWessexMouldings } from '../server/platform/supplierFeeds/wessexMouldings.js'
import { normalizeWessexArtifact } from '../server/platform/supplierFeeds/wessexNormalization.js'

const sourceUrl = 'https://www.wessexpictures.com/res/WessexMouldings.xls'
const headers = ['Reference', 'Description', 'Price/mtr', 'Width']
const a007 = ['A007', '3/8" Black Hockey Gold Sight', 3.22, 13]
const stmo = ['STMO', '1 1/2" x 3/4" Stretcher Moulding', 3.6, 2]
const options = {
  supplierId: 'test-wessex', runId: 'test-run', sourceId: 'test-wessex-mouldings', scopeId: 'mouldings',
  publishedDatabaseUpdateDate: '08/10/2026', acquisitionComplete: true, completeReleaseConfirmed: true,
}

function parse(rows: unknown[][] = [a007, stmo], lastModified = 'Thu, 08 Oct 2026 15:21:52 GMT') {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'gen')
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
  return parseWessexMouldings(bytes, {
    sourceUrl, originalFilename: 'WessexMouldings.xls', byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    retrievedAt: '2026-10-12T11:31:43Z', lastModified,
  })
}

describe('Wessex normalization into generic Block 2E', () => {
  it('maps A007 exactly and keeps STMO unchanged as supplier identity', () => {
    const raw = parse()
    const release = normalizeWessexArtifact(raw, options)
    expect(release.candidates).toHaveLength(2)
    expect(release.candidates[0]).toEqual({
      supplierId: options.supplierId, runId: options.runId, sourceId: options.sourceId, scopeId: options.scopeId,
      adapter: { id: 'wessex-wpp4-mouldings', version: '2' },
      item: { key: 'A007', rowNumber: 2, path: 'gen!A2:D2' },
      sourceProductKey: 'A007', sourceProductKeyOrigin: 'supplier_provided',
      fields: { category: 'frame', supplierDescription: a007[1], lifecycle: 'active', availability: 'unknown', widthMm: 13 },
      cost: { amount: '3.22', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-08T15:21:52.000Z' },
    })
    expect(release.candidates[1]).toMatchObject({ item: { key: 'STMO' }, sourceProductKey: 'STMO', sourceProductKeyOrigin: 'supplier_provided', fields: { supplierDescription: stmo[1], widthMm: 2 } })
  })

  it('normalizes boundary whitespace (spaces + NBSP) while preserving internal whitespace and raw evidence', () => {
    const c2164 = '\u00a01" Flat Distressed Bright Gold\u00a0\u00a0\u00a0\u00a0'
    const pw45 = ' 7/8" Gothic  Oak '
    const release = normalizeWessexArtifact(parse([
      ['C2164', c2164, 4.1, 17],
      ['PW45', pw45, 5.2, 22],
    ]), options)
    expect(release.candidates[0].fields.supplierDescription).toBe('1" Flat Distressed Bright Gold')
    expect(release.candidates[1].fields.supplierDescription).toBe('7/8" Gothic  Oak')
    expect(release.candidates[1].fields.supplierDescription).toContain('  ')
    expect(release.provenance.rawRows[0].description).toBe(c2164)
    expect(release.provenance.rawRows[1].description).toBe(pw45)
  })

  it('fails closed when a description becomes empty after boundary-whitespace normalization', () => {
    const raw = parse([['A009', 'Valid Description', 5.1, 20]])
    raw.rows[0].description = '\u00a0 \t \u00a0 '
    expect(() => normalizeWessexArtifact(raw, options)).toThrow(/Invalid Wessex raw evidence/)
  })

  it('never derives SKU, purchase unit, dimensions or descriptor attributes from description text', () => {
    const release = normalizeWessexArtifact(parse([['A009', 'White  / Black - Ribbed', 5.1, 20]]), options)
    expect(release.candidates[0].fields.supplierDescription).toBe('White  / Black - Ribbed')
    expect(release.candidates[0].sourceProductKey).toBe('A009')
    for (const key of ['supplierSku', 'purchaseUnit', 'colour', 'finish', 'material', 'collectionName', 'depthMm', 'rebateWidthMm', 'rebateDepthMm'])
      expect(release.candidates[0].fields).not.toHaveProperty(key)
  })

  it('sets snapshot context and complete private cost tuple only after successful normalization', () => {
    const release = normalizeWessexArtifact(parse(), options)
    expect(release.context).toMatchObject({
      coverage: 'snapshot', authoritative: true, acquisitionComplete: true,
      parsingComplete: true, validationSafeForMissing: true, missingInferenceEnabled: true,
    })
    expect(release.candidates[0].cost).toEqual({ amount: '3.22', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-08T15:21:52.000Z' })
  })

  it('fails closed when published date or Last-Modified evidence is absent or mismatched', () => {
    expect(() => normalizeWessexArtifact(parse(), { ...options, publishedDatabaseUpdateDate: '' })).toThrow(/required|disagree/)
    const withoutLastModified = parse([a007])
    withoutLastModified.acquisition.lastModified = undefined
    expect(() => normalizeWessexArtifact(withoutLastModified, options)).toThrow(/required/)
    expect(() => normalizeWessexArtifact(parse([a007], 'Thu, 09 Oct 2026 15:21:52 GMT'), options)).toThrow(/disagree/)
  })

  it('fails closed if normalized rows are corrupted after phase-1 parsing', () => {
    const raw = parse()
    raw.rows[0].widthRaw = 0
    expect(() => normalizeWessexArtifact(raw, options)).toThrow(/Invalid Wessex raw evidence/)
  })

  it('is deterministic and keeps evidence provenance with identity stability unconfirmed', () => {
    const raw = parse()
    const first = normalizeWessexArtifact(raw, options)
    expect(normalizeWessexArtifact(raw, options)).toEqual(first)
    expect(first.planningRows.every((row) => row.result.value && row.result.errors.length === 0)).toBe(true)
    expect(first.provenance).toMatchObject({
      artifactSha256: raw.acquisition.sha256,
      publishedDatabaseUpdateDate: '08/10/2026',
      publishedDateProvenance: 'operator_transcription_of_published_wessex_date',
      httpLastModified: raw.acquisition.lastModified,
      effectiveAtInstantSource: 'http_last_modified',
      priceAndDimensionSemantics: 'operator_confirmed',
      catalogueCompletenessSemantics: 'operator_confirmed',
      identityStability: 'unconfirmed',
      rawRows: raw.rows,
    })
  })
})
