import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parseWessexMouldings, wessexBytesChanged } from '../server/platform/supplierFeeds/wessexMouldings.js'

const headers = ['Reference', 'Description', 'Price/mtr', 'Width']
const evidenceRows: unknown[][] = [
  ['A007', '3/8" Black Hockey Gold Sight', 3.22, 13],
  ['A008', '3/8" Gold Hockey Black Sight', 3.56, 13],
  ['STMO', '1 1/2" x 3/4" Stretcher Moulding', 3.60, 2],
]
function workbook(rows: unknown[][] = evidenceRows, sheet = 'gen', heading: unknown[] = headers): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([heading, ...rows]), sheet)
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
}
function acquire(bytes: Buffer) {
  return {
    sourceUrl: 'https://www.wessexpictures.com/res/WessexMouldings.xls',
    etag: '"29400-65d55ca8c251c"', lastModified: 'Thu, 08 Oct 2026 15:21:52 GMT',
    retrievedAt: '2026-10-12T11:31:43Z', originalFilename: 'WessexMouldings.xls',
    byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

describe('Wessex WPP4 moulding evidence parser', () => {
  it('preserves supplier reference and raw workbook evidence without producing a canonical candidate', () => {
    const bytes = workbook()
    const result = parseWessexMouldings(bytes, acquire(bytes))
    expect(result).toMatchObject({
      adapter: { id: 'wessex-wpp4-mouldings', version: '1' },
      acquisition: acquire(bytes), worksheet: 'gen', observedRows: 3,
      completeness: 'unknown', authoritative: false, missingInferenceEnabled: false, canonicalReady: false,
      rows: [
        { item: { key: 'A007', rowNumber: 2, path: 'gen!A2:D2' }, sourceProductKey: 'A007', sourceProductKeyOrigin: 'supplier_provided', reference: 'A007', description: '3/8" Black Hockey Gold Sight', pricePerMetreRaw: 3.22, widthRaw: 13, artifactSha256: acquire(bytes).sha256 },
        { sourceProductKey: 'A008', item: { rowNumber: 3 } },
        { sourceProductKey: 'STMO', item: { rowNumber: 4 } },
      ],
    })
    expect(JSON.stringify(result)).not.toMatch(/"(?:cost|widthMm|lifecycle|availability|potential_missing)"/)
    expect(parseWessexMouldings(bytes, acquire(bytes))).toEqual(result)
  })

  it.each([
    { name: 'blank Reference', rows: [['  ', 'Description', 3, 12]], error: /Invalid Reference/ },
    { name: 'blank Description', rows: [['A007', '  ', 3, 12]], error: /Invalid Description/ },
    { name: 'duplicate Reference', rows: [...evidenceRows, ['A007', 'Other', 3, 12]], error: /Duplicate Reference/ },
    { name: 'case-colliding Reference', rows: [...evidenceRows, ['a007', 'Other', 3, 12]], error: /Duplicate Reference/ },
    { name: 'text Price/mtr', rows: [['A007', 'Description', '3.22', 12]], error: /Invalid Price\/mtr/ },
    { name: 'zero Price/mtr', rows: [['A007', 'Description', 0, 12]], error: /Invalid Price\/mtr/ },
    { name: 'negative Price/mtr', rows: [['A007', 'Description', -1, 12]], error: /Invalid Price\/mtr/ },
    { name: 'nonfinite Price/mtr', rows: [['A007', 'Description', Infinity, 12]], error: /Invalid Price\/mtr/ },
    { name: 'text Width', rows: [['A007', 'Description', 3, '12']], error: /Invalid Width/ },
    { name: 'zero Width', rows: [['A007', 'Description', 3, 0]], error: /Invalid Width/ },
    { name: 'negative Width', rows: [['A007', 'Description', 3, -1]], error: /Invalid Width/ },
    { name: 'nonfinite Width', rows: [['A007', 'Description', 3, Infinity]], error: /Invalid Width/ },
    { name: 'padded Reference', rows: [[' A007 ', 'Description', 3, 12]], error: /Invalid Reference/ },
  ])('rejects $name', ({ rows, error }) => {
    const bytes = workbook(rows)
    expect(() => parseWessexMouldings(bytes, acquire(bytes))).toThrow(error)
  })

  it('retains Description whitespace verbatim but never trims or invents a reference', () => {
    const bytes = workbook([['STMO2', '  2-Way Stretcher Moulding With Grooves  ', 4.7, 2]])
    const [row] = parseWessexMouldings(bytes, acquire(bytes)).rows
    expect(row.reference).toBe('STMO2')
    expect(row.description).toBe('  2-Way Stretcher Moulding With Grooves  ')
    expect(row.identityStability).toBe('unconfirmed')
  })

  it('rejects a missing gen sheet, changed headers and extra columns', () => {
    for (const bytes of [
      workbook(evidenceRows, 'other'),
      workbook(evidenceRows, 'gen', ['Reference', 'Description', 'Price', 'Width']),
      workbook(evidenceRows, 'gen', ['Reference', 'Description', 'Price/mtr']),
      workbook(evidenceRows, 'gen', ['Reference', 'Description', 'Price/mtr', 'Width', 'Extra']),
    ]) expect(() => parseWessexMouldings(bytes, acquire(bytes))).toThrow()
  })

  it('rejects altered bytes, nonofficial provenance, and a non-BIFF8 input', () => {
    const bytes = workbook()
    expect(() => parseWessexMouldings(bytes, { ...acquire(bytes), sha256: '0'.repeat(64) })).toThrow(/provenance/)
    expect(() => parseWessexMouldings(bytes, { ...acquire(bytes), sourceUrl: 'https://example.com/file.xls' })).toThrow(/provenance/)
    const other = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(other, XLSX.utils.aoa_to_sheet([headers, ...evidenceRows]), 'gen')
    const xlsx = XLSX.write(other, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    expect(() => parseWessexMouldings(xlsx, acquire(xlsx))).toThrow(/OLE2/)
  })

  it('uses only SHA256 to decide whether bytes changed, not HTTP validators', () => {
    const previous = acquire(workbook())
    const sameBytes = { ...previous, etag: 'different', lastModified: 'different', retrievedAt: '2026-10-13T00:00:00Z' }
    expect(wessexBytesChanged(previous.sha256, sameBytes.sha256)).toBe(false)
    const changed = acquire(workbook([evidenceRows[0]]))
    expect(wessexBytesChanged(previous.sha256, changed.sha256)).toBe(true)
    expect(() => wessexBytesChanged('', changed.sha256)).toThrow(/SHA256/)
  })

  it('does not turn raw prices, widths or missing rows into canonical fields', () => {
    const bytes = workbook([evidenceRows[0]])
    const result = parseWessexMouldings(bytes, acquire(bytes))
    expect(result.rows).toHaveLength(1)
    expect(result).toMatchObject({ completeness: 'unknown', authoritative: false, missingInferenceEnabled: false, canonicalReady: false })
    expect(result.rows[0]).not.toHaveProperty('cost')
    expect(result.rows[0]).not.toHaveProperty('widthMm')
    expect(result.rows[0]).not.toHaveProperty('lifecycle')
    expect(result.rows[0]).not.toHaveProperty('availability')
  })
})
