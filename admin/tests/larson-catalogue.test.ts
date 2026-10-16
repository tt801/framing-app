import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { assembleLarsonCatalogue, parseLarsonCataloguePage, LARSON_CATALOGUE_URL } from '../server/platform/supplierFeeds/larsonJuhlCatalogue.js'
import type { FeedAcquisition } from '../server/platform/supplierFeeds/contracts.js'
import { generatedLarsonPage } from './helpers/larsonFixture.js'

export const fixture = readFileSync(new URL('./fixtures/larson-juhl/catalogue.html', import.meta.url))
export const acquisition = (bytes: Buffer, page = 1): FeedAcquisition => ({ sourceUrl: `${LARSON_CATALOGUE_URL}?sort=Id&count=500&page=${page}`,
  sha256: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.length, retrievedAt: '2026-10-16T06:56:01Z', originalFilename: `page-${page}.html` })
const parse = (bytes = fixture) => parseLarsonCataloguePage(bytes, acquisition(bytes))

it('parses bounded real primary tiles preserving exact identifiers, references and unlabeled evidence', () => {
  const page = parse()
  expect(page.total).toBe(6)
  expect(page.rows.map(r => r.sku)).toEqual(['0475WG', '0701AW', '185127000E', '991247116', '999002196', '20380'])
  expect(page.rows[0]).toMatchObject({ sku: '0475WG', dataId: '0475WG', name: 'LJE Moulding',
    url: 'https://larsonjuhl.co.uk/mouldings/lje-moulding-0475wg', image: 'https://larsonjuhl.co.uk/product/image/medium/0475wg_1.jpg',
    attributes: ['Walnut', 'Stain', 'Spoon', 'None'] })
  expect(assembleLarsonCatalogue([page]).rows).toHaveLength(6)
})

it.each([
  ['missing data id', (s: string) => s.replace('data-id="0475WG"', 'data-id=""')],
  ['SKU/data-id mismatch', (s: string) => s.replace('data-id="0475WG"', 'data-id="WRONG"')],
  ['duplicate identity', (s: string) => s.replaceAll('0701AW', '0475WG')],
  ['empty name', (s: string) => s.replaceAll('LJE Moulding', '')],
  ['foreign product URL', (s: string) => s.replaceAll('/mouldings/lje-moulding-0475wg', 'https://evil.invalid/mouldings/p')],
  ['truncated listing', (s: string) => s.slice(0, s.indexOf('data-id="0701AW"'))],
])('rejects %s', (_name, mutate) => {
  const bytes = Buffer.from(mutate(fixture.toString()))
  expect(() => parse(bytes)).toThrow()
})

it('rejects incomplete coverage, unexpected page URLs, byte/hash mismatch and ambiguous counts', () => {
  const page = parse()
  expect(() => assembleLarsonCatalogue([{ ...page, total: 7 }])).toThrow()
  expect(() => assembleLarsonCatalogue([page, page])).toThrow()
  expect(() => parseLarsonCataloguePage(fixture, { ...acquisition(fixture), sourceUrl: 'https://larsonjuhl.co.uk/profile/login' })).toThrow()
  expect(() => parseLarsonCataloguePage(fixture, { ...acquisition(fixture), sha256: '0'.repeat(64) })).toThrow()
  const bytes = Buffer.from(fixture.toString().replace('</body>', '<span>7</span> product(s) found</body>'))
  expect(() => parse(bytes)).toThrow()
})

it('hashes normalized product data rather than return URLs or HTML presentation', () => {
  const a = assembleLarsonCatalogue([parse()])
  const bytes = Buffer.from(fixture.toString().replace(/returnurl=/g, 'returnurl=presentation').replace('<h1>', '<!-- presentation --> <h1>'))
  expect(assembleLarsonCatalogue([parse(bytes)]).manifestSha256).toBe(a.manifestSha256)
  const changed = Buffer.from(fixture.toString().replaceAll('LJE Moulding', 'LJE Changed Moulding'))
  expect(assembleLarsonCatalogue([parse(changed)]).manifestSha256).not.toBe(a.manifestSha256)
})

it('accepts retained first-page provenance for the observed oversized-count request capped by the supplier', () => {
  const evidence = { ...acquisition(fixture), sourceUrl: `${LARSON_CATALOGUE_URL}?sort=Id&count=2326` }
  expect(parseLarsonCataloguePage(fixture, evidence).acquisition.sourceUrl).toBe(evidence.sourceUrl)
})

it('preserves the supplier no-image placeholder observed on two retained catalogue entries', () => {
  const bytes = Buffer.from(fixture.toString().replaceAll('/product/image/medium/0475wg_1.jpg', '/content/files/icons/no-image-medium.png'))
  expect(parse(bytes).rows[0].image).toBe('https://larsonjuhl.co.uk/content/files/icons/no-image-medium.png')
})

it('rejects duplicate identities across otherwise correctly sized catalogue windows', () => {
  const first = generatedLarsonPage(501), last = generatedLarsonPage(501, 0, 1)
  const pages = [parseLarsonCataloguePage(first, acquisition(first)), parseLarsonCataloguePage(last, acquisition(last, 2))]
  expect(() => assembleLarsonCatalogue(pages)).toThrow('across pages')
})

it('binds aggregate acquisition hash and size to the actual derived manifest, retaining raw response evidence separately', () => {
  const artifact = assembleLarsonCatalogue([parse()])
  const manifest = Buffer.from(JSON.stringify({ version: 1, rows: artifact.rows }))
  expect(artifact.acquisition.sha256).toBe(createHash('sha256').update(manifest).digest('hex'))
  expect(artifact.acquisition.byteSize).toBe(manifest.length)
  expect(artifact.pages[0].acquisition.byteSize).toBe(fixture.length)
})
