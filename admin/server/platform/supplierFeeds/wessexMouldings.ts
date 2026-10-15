import { createHash } from 'node:crypto'
import * as XLSX from '@e965/xlsx'
import type { FeedAcquisition } from './contracts.js'

/** Raw evidence only. Not a Block 2E Candidate or an approval/apply request.
 * The supplier reference is a candidate sourceProductKey within this artifact; Wessex must
 * confirm long-term immutability, reuse and namespace before canonical mapping.
 * Block 2E requires snapshot/delta and lifecycle; neither can be asserted here.
 * Source URL and HTTP headers are caller-supplied evidence, not proof of authenticated origin.
 */
export type WessexAcquisition = FeedAcquisition
export type WessexRawRow = {
  item: { key: string; rowNumber: number; path: string }
  sourceProductKey: string
  sourceProductKeyOrigin: 'supplier_provided'
  identityStability: 'unconfirmed'
  reference: string
  description: string
  /** Do not convert to cost: currency, tax basis, effective date and price meaning are unknown. */
  pricePerMetreRaw: number
  /** Do not convert to widthMm: unit and meaning are unconfirmed. */
  widthRaw: number
  artifactSha256: string
}
export type WessexRawArtifact = {
  adapter: { id: 'wessex-wpp4-mouldings'; version: '1' }
  acquisition: WessexAcquisition
  worksheet: 'gen'
  observedRows: number
  completeness: 'unknown'
  authoritative: false
  missingInferenceEnabled: false
  canonicalReady: false
  rows: WessexRawRow[]
}

const officialUrl = 'https://www.wessexpictures.com/res/WessexMouldings.xls'
const expectedHeaders = ['Reference', 'Description', 'Price/mtr', 'Width'] as const
const signature = Buffer.from('d0cf11e0a1b11ae1', 'hex')
const maxBytes = 5_000_000
const maxRows = 50_000

/** Compare fully retrieved bytes, not HTTP validators: ETag and Last-Modified are only hints. */
export function wessexBytesChanged(previousSha256: string, currentSha256: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(previousSha256) || !/^[0-9a-f]{64}$/.test(currentSha256))
    throw new Error('Invalid artifact SHA256')
  return previousSha256 !== currentSha256
}

/** Transport supplies bytes/HTTP metadata separately; no network, macros, staging or canonical writes. */
export function parseWessexMouldings(bytes: Uint8Array, acquisition: WessexAcquisition): WessexRawArtifact {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maxBytes ||
      !Buffer.from(bytes.subarray(0, 8)).equals(signature)) throw new Error('Not a bounded OLE2 Wessex workbook')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (acquisition.sourceUrl !== officialUrl || acquisition.originalFilename !== 'WessexMouldings.xls' ||
      acquisition.byteSize !== bytes.length || acquisition.sha256 !== sha256 ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(acquisition.retrievedAt) ||
      !Number.isFinite(Date.parse(acquisition.retrievedAt))) throw new Error('Invalid Wessex artifact provenance')
  for (const value of [acquisition.etag, acquisition.lastModified]) {
    if (value != null && (typeof value !== 'string' || value.length > 256 || /[\r\n\p{C}]/u.test(value)))
      throw new Error('Invalid HTTP provenance')
  }

  // Inspect OLE/BIFF before the spreadsheet parser; reject macro-bearing or unexpected streams.
  const cfb = XLSX.CFB.read(Buffer.from(bytes), { type: 'buffer' })
  const allowedStreams = new Set(['Root Entry', 'R', 'Workbook', '\u0005SummaryInformation', '\u0005DocumentSummaryInformation'])
  if (cfb.FileIndex.some((entry: { name: string; size: number; type: number }) =>
    !(allowedStreams.has(entry.name) ||
      (entry.name === '\u0001Sh33tJ5' && entry.type === 2 && entry.size === 4) ||
      (entry.name === '' && entry.type === 0 && entry.size === 0))))
    throw new Error('Unexpected OLE stream or embedded workbook content')
  const stream = XLSX.CFB.find(cfb, 'Workbook')
  const content = stream?.content && Buffer.from(stream.content)
  if (!content || content.length < 8 || content.readUInt16LE(0) !== 0x0809 ||
      content.readUInt16LE(4) !== 0x0600 || content.readUInt16LE(6) !== 0x0005)
    throw new Error('Expected a BIFF8 workbook stream')

  const book = XLSX.read(Buffer.from(bytes), {
    type: 'buffer', dense: true, raw: true, bookVBA: false,
    cellFormula: true, cellHTML: false, cellStyles: false, cellNF: false, cellText: false,
  })
  if (book.SheetNames.length !== 1 || book.SheetNames[0] !== 'gen' ||
      book.Workbook?.Sheets?.[0]?.Hidden) throw new Error('Expected one visible gen worksheet')
  const sheet = book.Sheets.gen
  const range = sheet?.['!ref'] && XLSX.utils.decode_range(sheet['!ref'])
  if (!range || range.s.r !== 0 || range.s.c !== 0 || range.e.c !== 3 || range.e.r < 1 || range.e.r > maxRows)
    throw new Error('Unexpected Wessex worksheet dimensions')
  const cells = sheet['!data'] as Array<Array<XLSX.CellObject | undefined> | undefined>
  if (cells.some(row => row?.some(cell => cell?.f != null)))
    throw new Error('Formula cells are not accepted as source evidence')
  if (!expectedHeaders.every((header, i) => cells?.[0]?.[i]?.t === 's' && cells[0][i]?.v === header))
    throw new Error('Wessex headers differ from the approved four-column layout')

  const rows: WessexRawRow[] = []
  const seen = new Set<string>()
  for (let index = 1; index <= range.e.r; index++) {
    const row = cells[index]
    const [reference, description, price, width] = [0, 1, 2, 3].map(col => row?.[col])
    const rowNumber = index + 1
    if (reference?.t !== 's' || typeof reference.v !== 'string' || !reference.v.trim() ||
        reference.v !== reference.v.trim() || /[\p{C}]/u.test(reference.v) || reference.v.length > 256)
      throw new Error(`Invalid Reference at gen row ${rowNumber}`)
    if (seen.has(reference.v.toLowerCase())) throw new Error(`Duplicate Reference at gen row ${rowNumber}`)
    seen.add(reference.v.toLowerCase())
    if (description?.t !== 's' || typeof description.v !== 'string' || !description.v.trim() ||
        /[\p{C}]/u.test(description.v) || description.v.length > 2000)
      throw new Error(`Invalid Description at gen row ${rowNumber}`)
    if (price?.t !== 'n' || typeof price.v !== 'number' || !Number.isFinite(price.v) || price.v <= 0)
      throw new Error(`Invalid Price/mtr at gen row ${rowNumber}`)
    if (width?.t !== 'n' || typeof width.v !== 'number' || !Number.isFinite(width.v) || width.v <= 0)
      throw new Error(`Invalid Width at gen row ${rowNumber}`)
    rows.push({
      item: { key: reference.v, rowNumber, path: `gen!A${rowNumber}:D${rowNumber}` },
      sourceProductKey: reference.v, sourceProductKeyOrigin: 'supplier_provided',
      identityStability: 'unconfirmed', reference: reference.v, description: description.v,
      pricePerMetreRaw: price.v, widthRaw: width.v, artifactSha256: sha256,
    })
  }
  return {
    adapter: { id: 'wessex-wpp4-mouldings', version: '1' }, acquisition: { ...acquisition },
    worksheet: 'gen', observedRows: rows.length,
    completeness: 'unknown', authoritative: false, missingInferenceEnabled: false,
    canonicalReady: false, rows,
  }
}
