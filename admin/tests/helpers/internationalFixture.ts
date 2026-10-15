import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import * as XLSX from '@e965/xlsx'

export const member = 'International Moulding Price List Moulding.xlsx'
export const title = 'International Moulding Price List Effective January 16,2023'
export const headers = ['Item #', 'Description', 'Box', 'Split', 'Length', 'Chop', 'Join', 'Sample']
export const product = ['0354‐3029', '1 1/2" Mahogany Reverse Stairs', 1.27, 1.58, 2.54, 4.4400000000000004, 6.22, '$        ‐']
export const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export function workbook(rows: unknown[][] = [product], options: { sheet?: string; headers?: unknown[]; title?: string } = {}) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([ [options.title ?? title], options.headers ?? headers, ...rows ]), options.sheet ?? 'Table 1')
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
}
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
// Deterministic local ZIP builder; supports intentional duplicate/unsafe names.
export function zip(entries: [string, Uint8Array][], compress = false) {
  const locals: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(value), body = compress ? deflateRawSync(bytes) : bytes
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(compress ? 8 : 0, 8)
    local.writeUInt32LE(crc32(bytes), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(compress ? 8 : 0, 10)
    entry.writeUInt32LE(crc32(bytes), 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42)
    locals.push(local, filename, body); central.push(entry, filename); offset += local.length + filename.length + body.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
export function acquisition(bytes: Uint8Array) {
  return { sourceUrl: 'https://s3.amazonaws.com/im-dropbox-sync/Excel%20Price%20Lists.zip', originalFilename: 'Excel Price Lists.zip', byteSize: bytes.length,
    sha256: sha(bytes), retrievedAt: '2026-10-15T12:00:00.000Z', lastModified: 'Wed, 16 Aug 2023 13:00:14 GMT', etag: '"fixture"' }
}
export function workbookParts(bytes = workbook()): [string, Uint8Array][] {
  const cfb = XLSX.CFB.read(bytes, { type: 'buffer' })
  return cfb.FullPaths.flatMap((name: string, i: number) => cfb.FileIndex[i].type === 2 && !name.includes('\x01')
    ? [[name.replace(/^Root Entry\//, ''), Buffer.from(cfb.FileIndex[i].content)] as [string, Uint8Array]] : [])
}
