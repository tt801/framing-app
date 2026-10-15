import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import * as XLSX from '@e965/xlsx'
import type { FeedAcquisition } from './contracts.js'

export const INTERNATIONAL_ZIP_URL = 'https://s3.amazonaws.com/im-dropbox-sync/Excel%20Price%20Lists.zip'
export const INTERNATIONAL_RESOURCES_URL = 'https://www.internationalmoulding.com/page/22'
export const INTERNATIONAL_MEMBER = 'International Moulding Price List Moulding.xlsx'
export const internationalLimits = Object.freeze({ zipBytes: 8_000_000, entries: 100, decompressedBytes: 32_000_000, workbookBytes: 4_000_000, xlsxEntries: 200, xlsxBytes: 16_000_000, rows: 10_000 })
const headers = ['Item #', 'Description', 'Box', 'Split', 'Length', 'Chop', 'Join', 'Sample'] as const
export type PriceTier = 'Box' | 'Split' | 'Length' | 'Chop' | 'Join' | 'Sample'
export type InternationalRow = {
  item: { key: string; rowNumber: number; path: string }
  reference: string; description: string
  /** Display-scale source evidence only: neither currency nor canonical cost is asserted. */
  prices: Record<PriceTier, { raw: number | string; decimal: string | null }>
}
export type InternationalArtifact = {
  adapter: { id: 'international-moulding-historical'; version: '1' }
  acquisition: FeedAcquisition
  selectedMember: typeof INTERNATIONAL_MEMBER
  workbookSha256: string; workbookByteSize: number
  worksheet: 'Table 1'; publishedTitle: string; publishedDate: '16/01/2023'
  rows: InternationalRow[]
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const fail = (reason: string): never => { throw new Error(`Invalid International source: ${reason}`) }
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Central-directory bounds are checked before inflation. Nothing is extracted to disk.
 * ZIP64, encryption, symlinks, duplicate names and ambiguous local headers fail closed.
 */
function readZip(bytes: Uint8Array, maxEntries: number, maxExpanded: number) {
  const b = Buffer.from(bytes)
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) return fail('ZIP structure')
  let end = -1
  for (let at = b.length - 22; at >= Math.max(0, b.length - 65557); at--) {
    if (b.readUInt32LE(at) === 0x06054b50 && at + 22 + b.readUInt16LE(at + 20) === b.length) { end = at; break }
  }
  if (end < 0 || b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6)) return fail('ZIP end/disk')
  const count = b.readUInt16LE(end + 10), size = b.readUInt32LE(end + 12), start = b.readUInt32LE(end + 16)
  if (!count || count > maxEntries || count !== b.readUInt16LE(end + 8) || start + size !== end) return fail('ZIP bounds/entry count')
  const entries = new Map<string, { offset: number; compressed: number; expanded: number; method: number; crc: number }>()
  let cursor = start, total = 0, previousEnd = 0
  const extents: [number, number][] = []
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || b.readUInt32LE(cursor) !== 0x02014b50) return fail('ZIP directory')
    const flags = b.readUInt16LE(cursor + 8), method = b.readUInt16LE(cursor + 10), crc = b.readUInt32LE(cursor + 16)
    const compressed = b.readUInt32LE(cursor + 20), expanded = b.readUInt32LE(cursor + 24)
    const nameSize = b.readUInt16LE(cursor + 28), extraSize = b.readUInt16LE(cursor + 30), commentSize = b.readUInt16LE(cursor + 32)
    const local = b.readUInt32LE(cursor + 42)
    if (cursor + 46 + nameSize + extraSize + commentSize > end || flags & ~0x80e || ![0, 8].includes(method) || ((flags & 6) && method !== 8)
      || b.readUInt16LE(cursor + 34) || (b.readUInt32LE(cursor + 38) >>> 16 & 0xf000) === 0xa000) return fail('unsafe ZIP entry')
    const nameBytes = b.subarray(cursor + 46, cursor + 46 + nameSize)
    const name = nameBytes.toString('utf8')
    if (!name || !Buffer.from(name).equals(nameBytes) || /[\\\x00-\x1f\x7f:]/.test(name) || name.startsWith('/')
      || name.split('/').some(part => part === '..' || part === '.' || !part) || entries.has(name)) return fail('unsafe/duplicate ZIP name')
    total += expanded
    if (total > maxExpanded || expanded === 0xffffffff || compressed === 0xffffffff || local + 30 > start
      || b.readUInt32LE(local) !== 0x04034b50 || b.readUInt16LE(local + 6) !== flags || b.readUInt16LE(local + 8) !== method) return fail('ZIP decompressed bounds/local header')
    const localNameSize = b.readUInt16LE(local + 26), offset = local + 30 + localNameSize + b.readUInt16LE(local + 28)
    if (!b.subarray(local + 30, local + 30 + localNameSize).equals(nameBytes) || offset + compressed > start) return fail('ZIP local name/size')
    let extentEnd = offset + compressed
    if (flags & 8) {
      if (extentEnd + 12 > start) return fail('ZIP descriptor bounds')
      const descriptor = extentEnd + (b.readUInt32LE(extentEnd) === 0x08074b50 ? 4 : 0)
      if (descriptor + 12 > start || b.readUInt32LE(descriptor) !== crc || b.readUInt32LE(descriptor + 4) !== compressed || b.readUInt32LE(descriptor + 8) !== expanded) return fail('ZIP descriptor')
      extentEnd = descriptor + 12
    } else if (b.readUInt32LE(local + 14) !== crc || b.readUInt32LE(local + 18) !== compressed || b.readUInt32LE(local + 22) !== expanded) return fail('ZIP local sizes')
    extents.push([local, extentEnd])
    entries.set(name, { offset, compressed, expanded, method, crc })
    cursor += 46 + nameSize + extraSize + commentSize
  }
  if (cursor !== end) return fail('ZIP directory size')
  for (const [from, to] of extents.sort((a, c) => a[0] - c[0])) {
    if (from !== previousEnd) return fail('ZIP overlapping/unlisted content')
    previousEnd = to
  }
  if (previousEnd !== start) return fail('ZIP trailing local content')
  return { names: [...entries.keys()], read(name: string) {
    const entry = entries.get(name)
    if (!entry) return fail('missing selected member/part')
    const compressed = b.subarray(entry.offset, entry.offset + entry.compressed)
    let out: Buffer
    try { out = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.expanded) }) }
    catch { return fail('ZIP inflation bound') }
    if (out.length !== entry.expanded || crc32(out) !== entry.crc) return fail('ZIP integrity')
    return out
  } }
}
function safeText(cell: XLSX.CellObject | undefined, max: number) {
  if (cell?.t !== 's' || typeof cell.v !== 'string' || !cell.v.trim() || cell.v !== cell.v.trim() || cell.v.length > max || /[\p{C}]/u.test(cell.v)) return fail('product text')
  return cell.v
}
export function parseInternationalMoulding(bytes: Uint8Array, acquisition: FeedAcquisition): InternationalArtifact {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > internationalLimits.zipBytes) return fail('ZIP download bounds')
  if (acquisition.sourceUrl !== INTERNATIONAL_ZIP_URL || acquisition.originalFilename !== 'Excel Price Lists.zip'
    || acquisition.byteSize !== bytes.length || acquisition.sha256 !== digest(bytes)
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(acquisition.retrievedAt) || !Number.isFinite(Date.parse(acquisition.retrievedAt))) return fail('acquisition provenance')
  for (const value of [acquisition.etag, acquisition.lastModified]) if (value != null && (typeof value !== 'string' || value.length > 256 || /[\p{C}]/u.test(value))) return fail('HTTP provenance')
  const archive = readZip(bytes, internationalLimits.entries, internationalLimits.decompressedBytes)
  const workbook = archive.read(INTERNATIONAL_MEMBER)
  if (!workbook.length || workbook.length > internationalLimits.workbookBytes) return fail('workbook bounds')
  const parts = readZip(workbook, internationalLimits.xlsxEntries, internationalLimits.xlsxBytes)
  if (!['[Content_Types].xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml'].every(name => parts.names.includes(name))) return fail('XLSX structure')
  if (parts.names.some(name => /vba|embedding|externalLinks|activeX/i.test(name))) return fail('active XLSX content')
  for (const name of parts.names) if (/\.(xml|rels)$/.test(name)) {
    const bytes = parts.read(name), text = bytes.toString('utf8')
    if (!Buffer.from(text).equals(bytes) || /\x00|<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External["']/i.test(text)) return fail('external/unsafe XLSX content')
    if (/^xl\/worksheets\//.test(name)) {
      if (name !== 'xl/worksheets/sheet1.xml') return fail('unexpected worksheet part')
      // Bound coordinates before the XLSX reader can allocate dense worksheet rows.
      const tags = [...text.matchAll(/<(row|c)\b([^>]*)>/g)], seen = new Set<string>()
      if (tags.length > (internationalLimits.rows + 2) * 10) return fail('worksheet cell bounds')
      for (const [, tag, attrs] of tags) {
        const address = /\sr="([^"]+)"/.exec(attrs)?.[1] ?? ''
        const match = (tag === 'row' ? /^([1-9]\d{0,4})$/ : /^[A-I]([1-9]\d{0,4})$/).exec(address)
        if (!match || Number(match[1]) > internationalLimits.rows + 2 || seen.has(address)) return fail('worksheet coordinate bounds/duplicate')
        seen.add(address)
      }
      const dimension = /<dimension\b[^>]*\bref="([^"]+)"/.exec(text)?.[1]
      if (!dimension || !/^A1:[H-I][1-9]\d{0,4}$/.test(dimension) || Number(dimension.split(':')[1].slice(1)) > internationalLimits.rows + 2) return fail('worksheet dimension bounds')
    }
  }
  const book = XLSX.read(workbook, { type: 'buffer', dense: true, cellFormula: true, cellHTML: false, cellNF: false, cellStyles: false, bookVBA: false })
  if (book.SheetNames.length !== 1 || book.SheetNames[0] !== 'Table 1' || book.Workbook?.Sheets?.[0]?.Hidden) return fail('worksheet')
  const sheet = book.Sheets['Table 1'], range = sheet['!ref'] && XLSX.utils.decode_range(sheet['!ref'])
  if (!range || range.s.r !== 0 || range.s.c !== 0 || range.e.c < 7 || range.e.c > 8 || range.e.r < 2 || range.e.r > internationalLimits.rows + 1) return fail('worksheet bounds')
  const cells = sheet['!data'] as Array<Array<XLSX.CellObject | undefined> | undefined>
  if (cells.some(row => row?.some((cell, col) => cell?.f != null || cell?.t === 'e' || (col > 7 && cell?.v != null)))) return fail('formula/error/unexpected column')
  const publishedTitle = safeText(cells[0]?.[0], 200)
  if (publishedTitle !== 'International Moulding Price List Effective January 16,2023' || cells[0]?.slice(1).some(cell => cell?.v != null)) return fail('historical publication title')
  if (!headers.every((header, col) => cells[1]?.[col]?.t === 's' && cells[1][col]?.v === header)) return fail('headers')
  const rows: InternationalRow[] = [], seen = new Set<string>()
  for (let index = 2; index <= range.e.r; index++) {
    const row = cells[index], reference = safeText(row?.[0], 256), description = safeText(row?.[1], 2000)
    if (reference === 'Item #' || seen.has(reference.toLowerCase())) return fail('duplicate/unexpected Item #')
    seen.add(reference.toLowerCase())
    const prices = {} as InternationalRow['prices']
    for (let col = 2; col < 8; col++) {
      const cell = row?.[col], tier = headers[col] as PriceTier
      if (tier === 'Sample' && cell?.t === 's' && typeof cell.v === 'string' && /^\$\s*‐$/.test(cell.v)) prices[tier] = { raw: cell.v, decimal: null }
      else {
        if (cell?.t !== 'n' || typeof cell.v !== 'number' || !Number.isFinite(cell.v) || cell.v <= 0 || cell.v > 1_000_000) return fail(`malformed ${tier} price`)
        // Two-decimal evidence, not String(number), currency or a canonical cost.
        const decimal = XLSX.SSF.format('0.00', cell.v)
        if (!/^\d+\.\d{2}$/.test(decimal) || Number(decimal) <= 0) return fail('price precision')
        prices[tier] = { raw: cell.v, decimal }
      }
    }
    rows.push({ item: { key: reference, rowNumber: index + 1, path: `${INTERNATIONAL_MEMBER}!Table 1!A${index + 1}:H${index + 1}` }, reference, description, prices })
  }
  return { adapter: { id: 'international-moulding-historical', version: '1' }, acquisition: { ...acquisition }, selectedMember: INTERNATIONAL_MEMBER,
    workbookSha256: digest(workbook), workbookByteSize: workbook.length, worksheet: 'Table 1', publishedTitle, publishedDate: '16/01/2023', rows }
}
