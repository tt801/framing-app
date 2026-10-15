import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseInternationalMoulding } from '../server/platform/supplierFeeds/internationalMoulding.js'
import { internationalLimits } from '../server/platform/supplierFeeds/internationalMoulding.js'
import { acquisition, member, product, sha, workbook, workbookParts, zip } from './helpers/internationalFixture.js'

const parse = (bytes: Uint8Array) => parseInternationalMoulding(bytes, acquisition(bytes))
const wrap = (book: Uint8Array) => zip([[member, book]])

describe('International historical workbook evidence', () => {
  it('parses all 1024 genuine historical rows deterministically with no network', () => {
    const book = readFileSync(new URL('./fixtures/international-moulding/january-2023.xlsx', import.meta.url))
    expect(sha(book)).toBe('591fa9833e812d06f0b0d7ee371bc9c30dbd376224ac73a77029f863f0ace86a')
    const raw = parse(wrap(book))
    expect(raw.rows).toHaveLength(1024)
    expect(new Set(raw.rows.map(row => row.reference)).size).toBe(1024)
    expect(raw.rows[0].description).toBe('1 1/2"  Mahogany Reverse Stairs')
    expect(raw.rows.filter(row => row.prices.Sample.decimal === null)).toHaveLength(2)
    expect(parse(wrap(book))).toEqual(raw)
  })
  it.each([
    [[product, product], {}, /duplicate/],
    [[product, [], ['OTHER', ...product.slice(1)]], {}, /product text/],
    [[product, ['Footer']], {}, /product text/],
    [[product.map((v, i) => i === 0 ? 354 : v)], {}, /product text/],
    [[product.map((v, i) => i === 2 ? '$1.27' : v)], {}, /price/],
    [[product.map((v, i) => i === 3 ? -1 : v)], {}, /price/],
    [[product.map((v, i) => i === 4 ? 0 : v)], {}, /price/],
    [[product.map((v, i) => i === 5 ? null : v)], {}, /price/],
    [[product.map((v, i) => i === 6 ? { t: 'n', v: 2, f: '1+1' } : v)], {}, /formula/],
    [[product.map((v, i) => i === 7 ? '-' : v)], {}, /price/],
    [[product], { sheet: 'Products' }, /worksheet/],
    [[product], { title: 'International Moulding Price List Effective January 16,2024' }, /publication/],
    [[product], { headers: ['SKU', 'Description', 'Box', 'Split', 'Length', 'Chop', 'Join', 'Sample'] }, /headers/],
    [[product.concat('unexpected')], {}, /column/],
  ] as const)('rejects malformed rows/workbook case %#', (rows, options, error) => {
    expect(() => parse(wrap(workbook(rows as unknown as unknown[][], options as any)))).toThrow(error)
  })
  it.each(['../evil.xlsx', '/evil.xlsx', 'C:evil.xlsx', 'a\\evil.xlsx', 'a/../evil.xlsx'])('rejects unsafe archive path %s', name => {
    expect(() => parse(zip([[member, workbook()], [name, Buffer.from('bad')]]))).toThrow(/unsafe/)
  })
  it('rejects missing/extraneous/duplicate selected names and duplicate unrelated entries', () => {
    expect(() => parse(zip([['International Moulding Price List.xlsx', workbook()]]))).toThrow(/missing/)
    expect(() => parse(zip([[`${member} `, workbook()]]))).toThrow(/missing/)
    expect(() => parse(zip([[member, workbook()], [member, workbook()]]))).toThrow(/duplicate/)
    expect(() => parse(zip([[member, workbook()], ['other', Buffer.from('a')], ['other', Buffer.from('b')]]))).toThrow(/duplicate/)
  })
  it('checks ZIP size, entry count, expanded bounds, integrity and local/central consistency', () => {
    expect(() => parse(Buffer.alloc(internationalLimits.zipBytes + 1))).toThrow(/bounds/)
    expect(() => parse(zip(Array.from({ length: internationalLimits.entries + 1 }, (_, i) => [String(i), Buffer.from('x')])))).toThrow(/entry count/)
    const bomb = zip([[member, Buffer.alloc(1000)]], true), directory = bomb.readUInt32LE(bomb.length - 6)
    bomb.writeUInt32LE(internationalLimits.decompressedBytes + 1, directory + 24)
    expect(() => parse(bomb)).toThrow(/bounds/)
    const corrupt = wrap(workbook()); corrupt[30 + Buffer.byteLength(member) + 50] ^= 1
    expect(() => parse(corrupt)).toThrow(/integrity/)
    const mismatch = wrap(workbook()); mismatch[30] = 88
    expect(() => parse(mismatch)).toThrow(/local name/)
    const encrypted = wrap(workbook()); encrypted.writeUInt16LE(0x801, encrypted.readUInt32LE(encrypted.length - 6) + 8)
    expect(() => parse(encrypted)).toThrow(/unsafe/)
    expect(() => parse(Buffer.from('not a ZIP'))).toThrow(/ZIP/)
  })
  it.each(['macro', 'external', 'entity', 'range', 'duplicate', 'missing', 'duplicate-cell', 'single-quoted-oversized-coordinate'])('rejects unsafe/malformed XLSX %s', kind => {
    let parts = workbookParts()
    if (kind === 'macro') parts.push(['xl/vbaProject.bin', Buffer.from('bad')])
    if (kind === 'external') parts.push(['xl/evil.rels', Buffer.from('<Relationship TargetMode="External" Target="https://evil.invalid"/>')])
    if (kind === 'entity') parts.push(['xl/evil.xml', Buffer.from('<!DOCTYPE evil [<!ENTITY x SYSTEM "file:///secret">]>')])
    if (kind === 'range') parts = parts.map(([name, bytes]) => [name, name === 'xl/worksheets/sheet1.xml' ? Buffer.from(bytes.toString().replace('A1:H3', 'A1:H99999999')) : bytes])
    if (kind === 'duplicate-cell') parts = parts.map(([name, bytes]) => [name, name === 'xl/worksheets/sheet1.xml' ? Buffer.from(bytes.toString().replace('r="B3"', 'r="A3"')) : bytes])
    if (kind === 'single-quoted-oversized-coordinate') parts = parts.map(([name, bytes]) => [name, name === 'xl/worksheets/sheet1.xml' ? Buffer.from(bytes.toString().replace('r="B3"', "r='B99999999'")) : bytes])
    if (kind === 'duplicate') parts.push(parts.find(([name]) => name === 'xl/workbook.xml')!)
    if (kind === 'missing') parts = parts.filter(([name]) => name !== 'xl/workbook.xml')
    expect(() => parse(wrap(zip(parts)))).toThrow()
  })
  it('binds claimed acquisition evidence to exact downloaded bytes and official source', () => {
    const oversizedBook = zip([[member, Buffer.alloc(internationalLimits.workbookBytes + 1)]], true)
    expect(() => parse(oversizedBook)).toThrow(/workbook bounds/)
    const oversizedParts = Array.from({ length: internationalLimits.xlsxEntries + 1 }, (_, i) => [`part${i}.xml`, Buffer.from('x')] as [string, Uint8Array])
    expect(() => parse(wrap(zip(oversizedParts)))).toThrow(/entry count/)
    const inflation = zip([[member, Buffer.alloc(1000)]], true), directory = inflation.readUInt32LE(inflation.length - 6)
    inflation.writeUInt32LE(1, directory + 24); inflation.writeUInt32LE(1, 22)
    expect(() => parse(inflation)).toThrow(/inflation bound/)
    const bytes = wrap(workbook())
    expect(() => parseInternationalMoulding(bytes, { ...acquisition(bytes), sha256: 'a'.repeat(64) })).toThrow(/provenance/)
    expect(() => parseInternationalMoulding(bytes, { ...acquisition(bytes), sourceUrl: 'https://evil.invalid' })).toThrow(/provenance/)
  })
  it('selects only the exact moulding member and preserves references, prices and publication provenance', () => {
    const book = workbook(), bytes = zip([[member, book], ['International Moulding Price List.xlsx', workbook([['OTHER', ...product.slice(1)]])]], true)
    const raw = parseInternationalMoulding(bytes, acquisition(bytes))
    expect(raw.selectedMember).toBe(member)
    expect(raw.workbookSha256).toBe(sha(book))
    expect(raw.acquisition).toEqual(acquisition(bytes))
    expect(raw.publishedDate).toBe('16/01/2023')
    expect(raw.rows).toHaveLength(1)
    expect(raw.rows[0]).toMatchObject({ reference: '0354‐3029', prices: { Chop: { raw: 4.4400000000000004, decimal: '4.44' }, Sample: { raw: '$        ‐', decimal: null } } })
  })
})
