import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseLionCsv, LION_CSV_URL } from '../server/platform/supplierFeeds/lionCatalogue.js'

const bytes = readFileSync(new URL('./fixtures/lion/estlite-sample.csv', import.meta.url))
const acquisition = (body = bytes) => ({ sourceUrl: LION_CSV_URL, byteSize: body.length,
  sha256: createHash('sha256').update(body).digest('hex'), retrievedAt: '2026-10-16T12:00:00Z', originalFilename: 'estlite_lionmouldings.csv' })
const parse = (text: string) => { const body = Buffer.from(text); return parseLionCsv(body, acquisition(body)) }

it('binds the bounded retained fixture to its provenance checksum and product count', () => {
  const provenance = JSON.parse(readFileSync(new URL('./fixtures/lion/provenance.json', import.meta.url), 'utf8'))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.fixtureSha256)
  expect(parseLionCsv(bytes, acquisition()).rows).toHaveLength(provenance.fixtureProducts)
  expect(provenance.sourceUrl).toBe(LION_CSV_URL)
})

it('parses the retained report with exact source strings and separates generation from publication', () => {
  const out = parseLionCsv(bytes, acquisition())
  expect(out.rows).toHaveLength(11)
  expect(out.rows.map(r => r.sku)).toContain('L001')
  expect(out.rows.map(r => r.sku)).toContain('L012')
  expect(out.rows.map(r => r.sku)).toContain('10450L')
  expect(out.rows.map(r => r.sku)).toContain('9777LT')
  expect(out.rows.find(r => r.sku === 'L001')).toMatchObject({ widthRaw: '21', priceRaw: '4.65', stockRaw: '-1079.40' })
  expect(out.rows.find(r => r.sku === 'L1996')?.name.endsWith(' ')).toBe(true)
  expect(out.generation).toEqual({ dateRaw: '09/10/2026', generatedAtRaw: '09/10/26 10:00:33', timezone: null })
})

it.each([
  ['duplicate', (s: string) => s.replace('L012,', 'L001,')],
  ['case-fold', (s: string) => s.replace('L012,', 'l001,')],
  ['blank code', (s: string) => s.replace('L001,', ',')],
  ['whitespace code', (s: string) => s.replace('L001,', ' L001,')],
  ['header', (s: string) => s.replace('Available Stock', 'Stock')],
  ['preamble', (s: string) => s.replace('Lion Moulding Prices', 'Other Prices')],
  ['row shape', (s: string) => s.replace('4.65,21,-1079.40', '4.65,21')],
  ['blank row', (s: string) => s.replace('L001,', '\r\nL001,')],
  ['unterminated quote', (s: string) => s.replace('L001,', '"L001,')],
  ['quote suffix', (s: string) => s.replace('L001,', '"L001"x,')],
  ['footer', (s: string) => s.slice(0, s.indexOf('EstLite Moulding Price Report scheduled'))],
  ['partial last record', (s: string) => s.slice(0, -5)],
  ['extra record', (s: string) => s + 'L123,Extra,1.00,5,0\r\n'],
  ['footer date', (s: string) => s.replace('09/10/2026', '10/10/2026')],
  ['calendar date', (s: string) => s.replaceAll('09/10/', '31/02/')],
  ['price', (s: string) => s.replace('4.65,21', 'NaN,21')],
  ['width', (s: string) => s.replace('4.65,21', '4.65,-21')],
  ['control bytes', (s: string) => s.replace('L001,', 'L001,\u0000')],
])('rejects %s anomalies instead of silently dropping rows', (_label, mutate) => {
  expect(() => parse(mutate(bytes.toString()))).toThrow('Lion CSV')
})

it('preserves distinct suffix/chop/sample strings and quoted CSV values without numeric coercion', () => {
  const extra = ['L3369X', 'L3802X', 'CL001', '10450', 'CHL001'].map(sku => `${sku},"Name, with ""quotes""",1.00,0,`).join('\r\n') + '\r\n'
  const out = parse(bytes.toString().replace('EstLite Moulding Price Report scheduled', extra + 'EstLite Moulding Price Report scheduled'))
  expect(out.rows.slice(-5).map(r => r.sku)).toEqual(['L3369X', 'L3802X', 'CL001', '10450', 'CHL001'])
  expect(out.rows.at(-1)?.name).toBe('Name, with "quotes"')
  expect(out.rows.at(-1)?.stockRaw).toBe('')
})

it('rejects oversized, invalidly encoded or provenance-mismatched bytes', () => {
  for (const body of [Buffer.alloc(1_048_577), Buffer.from([255]), Buffer.from('')])
    expect(() => parseLionCsv(body, acquisition(body))).toThrow()
  expect(() => parseLionCsv(bytes, { ...acquisition(), sha256: '0'.repeat(64) })).toThrow()
  expect(() => parseLionCsv(bytes, { ...acquisition(), byteSize: 1 })).toThrow()
  expect(() => parseLionCsv(bytes, { ...acquisition(), sourceUrl: 'https://example.com' })).toThrow()
})
