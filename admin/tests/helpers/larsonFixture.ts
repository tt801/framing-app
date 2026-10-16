import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FeedAcquisition } from '../../server/platform/supplierFeeds/contracts.js'

export const larsonFixture = readFileSync(new URL('../fixtures/larson-juhl/catalogue.html', import.meta.url))
export const larsonUrl = 'https://larsonjuhl.co.uk/mouldings/'
export const larsonAcquisition = (bytes: Buffer, page = 1): FeedAcquisition => ({ sourceUrl: `${larsonUrl}?sort=Id&count=500&page=${page}`,
  sha256: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.length, retrievedAt: '2026-10-16T06:56:01Z', originalFilename: `page-${page}.html` })
/** Generated bounded pagination fixture, not supplier evidence. */
export function generatedLarsonPage(total: number, offset = 0, length = Math.min(500, total - offset)): Buffer {
  const tiles = Array.from({ length }, (_, n) => {
    const sku = `P${String(n + offset).padStart(5, '0')}`
    return `<div class="l-products-item" data-id="${sku}"><span itemprop="productID">${sku}</span><a class="product-title" href="/mouldings/test-${sku}"><span itemprop="name">Fixture Moulding</span></a><div class="product-attributes"><span>20x30</span></div></div>`
  }).join('')
  return Buffer.from(`<!doctype html><html><body><span>${total}</span> product(s) found<div id="list-of-products">${tiles}</div></body></html>`)
}
