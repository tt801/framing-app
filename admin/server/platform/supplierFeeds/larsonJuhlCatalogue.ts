import { createHash } from 'node:crypto'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import type { FeedAcquisition } from './contracts.js'

export const LARSON_CATALOGUE_URL = 'https://larsonjuhl.co.uk/mouldings/'
export const LARSON_SCOPE = 'uk-public-mouldings-category'
export const LARSON_NO_IMAGE = 'https://larsonjuhl.co.uk/content/files/icons/no-image-medium.png'
export const larsonLimits = Object.freeze({ pageSize: 500, pages: 20, products: 10000, pageBytes: 3_000_000,
  totalBytes: 32_000_000, crawlDelayMs: 10000, requestMs: 30000, acquisitionMs: 240000 })
export type LarsonRow = { sku: string; dataId: string; name: string; url: string; image: string | null; attributes: string[] }
export type LarsonPage = { page: number; total: number; rows: LarsonRow[]; acquisition: FeedAcquisition }
export type LarsonCatalogue = { adapter: { id: 'larson-juhl-uk-public-catalogue'; version: '1' }; rows: LarsonRow[];
  pages: LarsonPage[]; manifestSha256: string; acquisition: FeedAcquisition }
type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
const element = (node: Node): node is Element => 'tagName' in node
const attr = (node: Node, name: string) => element(node) ? node.attrs.find(a => a.name === name)?.value : undefined
const hasClass = (node: Node, name: string) => (attr(node, 'class') ?? '').split(/\s+/).includes(name)
const children = (node: Node): Node[] => 'childNodes' in node ? node.childNodes : []
function walk(root: Node): Node[] {
  const result: Node[] = [], stack = [root]
  while (stack.length) { const node = stack.pop()!; result.push(node); stack.push(...children(node).slice().reverse()) }
  return result
}
function text(node: Node): string {
  return walk(node).filter(n => n.nodeName === '#text' && !['script', 'style'].includes('parentNode' in n ? n.parentNode?.nodeName ?? '' : ''))
    .map(n => 'value' in n ? n.value : '').join(' ').replace(/\s+/g, ' ').trim()
}
const one = (nodes: Node[], predicate: (n: Node) => boolean, label: string) => {
  const found = nodes.filter(predicate)
  if (found.length !== 1) throw new Error(`Larson catalogue invalid ${label}`)
  return found[0]
}
export function larsonPageUrl(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1 || page > larsonLimits.pages) throw new Error('Larson catalogue page limit')
  return `${LARSON_CATALOGUE_URL}?sort=Id&count=500&page=${page}`
}
function pageNumber(sourceUrl: string): number {
  const url = new URL(sourceUrl)
  const page = Number(url.searchParams.get('page') ?? '1')
  // The discovery's first request asked for the total and was capped at 500.
  // Retain that original URL honestly; live acquisition always requests 500.
  const requestedCount = Number(url.searchParams.get('count'))
  if (url.origin + url.pathname !== LARSON_CATALOGUE_URL || url.username || url.password || url.hash
    || url.searchParams.get('sort') !== 'Id' || !Number.isSafeInteger(requestedCount)
    || requestedCount < larsonLimits.pageSize || requestedCount > larsonLimits.products || (page !== 1 && requestedCount !== larsonLimits.pageSize)
    || [...url.searchParams.keys()].some(k => !['sort', 'count', 'page'].includes(k))
    || [...url.searchParams.keys()].some(k => url.searchParams.getAll(k).length !== 1)
    || !Number.isSafeInteger(page) || page < 1 || page > larsonLimits.pages) throw new Error('Larson catalogue source URL invalid')
  return page
}
function reference(raw: string | undefined, kind: 'product' | 'image'): string {
  if (!raw) throw new Error(`Larson catalogue missing ${kind} URL`)
  const url = new URL(raw, LARSON_CATALOGUE_URL)
  const prefix = kind === 'product' ? '/mouldings/' : '/product/image/'
  if (url.origin !== 'https://larsonjuhl.co.uk' || url.username || url.password || url.hash
    || (!url.pathname.startsWith(prefix) && !(kind === 'image' && url.href === LARSON_NO_IMAGE))
    || (kind === 'image' && url.search) || [...url.searchParams.keys()].some(k => k !== 'returnurl')) throw new Error(`Larson catalogue unsafe ${kind} URL`)
  url.search = ''
  return url.href
}
function verifiedDocument(bytes: Buffer, acquisition: FeedAcquisition) {
  if (!bytes.length || bytes.length > larsonLimits.pageBytes || acquisition.byteSize !== bytes.length
    || !/^[0-9a-f]{64}$/.test(acquisition.sha256) || createHash('sha256').update(bytes).digest('hex') !== acquisition.sha256
    || !Number.isFinite(Date.parse(acquisition.retrievedAt))) throw new Error('Larson catalogue acquisition evidence invalid')
  // Fatal decoding rejects replacement-character identities instead of repairing supplier text.
  return parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { sourceCodeLocationInfo: true })
}
export function parseLarsonCataloguePage(bytes: Buffer, acquisition: FeedAcquisition): LarsonPage {
  const page = pageNumber(acquisition.sourceUrl)
  const document = verifiedDocument(bytes, acquisition), nodes = walk(document)
  const totals = [...text(document).matchAll(/\b([0-9]+)\s+product\(s\) found/g)]
  if (totals.length !== 1) throw new Error('Larson catalogue advertised total invalid')
  const total = Number(totals[0][1])
  if (!Number.isSafeInteger(total) || total < 1 || total > larsonLimits.products) throw new Error('Larson catalogue product limit')
  const listing = one(nodes, n => attr(n, 'id') === 'list-of-products', 'primary listing')
  if (!element(listing) || !listing.sourceCodeLocation?.endTag) throw new Error('Larson catalogue truncated listing')
  const tiles = children(listing).filter(n => hasClass(n, 'l-products-item'))
  if (!tiles.length || tiles.length > larsonLimits.pageSize) throw new Error('Larson catalogue invalid tile count')
  const seen = new Set<string>()
  const rows = tiles.map(tile => {
    if (!element(tile) || !tile.sourceCodeLocation?.endTag) throw new Error('Larson catalogue truncated tile')
    const sub = walk(tile), dataId = attr(tile, 'data-id') ?? ''
    const sku = text(one(sub, n => attr(n, 'itemprop') === 'productID', 'SKU'))
    if (!/^[A-Za-z0-9]{1,64}$/.test(dataId) || sku !== dataId || seen.has(sku)) throw new Error('Larson catalogue duplicate/missing/mismatched identity')
    seen.add(sku)
    const name = text(one(sub, n => attr(n, 'itemprop') === 'name', 'name'))
    if (!name || name.length > 2000) throw new Error('Larson catalogue missing name')
    const link = one(sub, n => hasClass(n, 'product-title'), 'product link')
    const imageNode = sub.find(n => n.nodeName === 'img' && attr(n, 'data-src'))
      ?? sub.find(n => n.nodeName === 'img' && attr(n, 'itemprop') === 'image')
    const rawImage = imageNode && (attr(imageNode, 'data-src') ?? attr(imageNode, 'src'))
    const attributesNode = sub.find(n => hasClass(n, 'product-attributes'))
    return { sku, dataId, name, url: reference(attr(link, 'href'), 'product'), image: rawImage ? reference(rawImage, 'image') : null,
      attributes: attributesNode ? children(attributesNode).filter(element).map(text) : [] }
  })
  return { page, total, rows, acquisition: { ...acquisition } }
}
export function assembleLarsonCatalogue(pages: LarsonPage[]): LarsonCatalogue {
  const first = pages[0], total = first?.total
  if (!first || pages.length !== Math.ceil(total / larsonLimits.pageSize) || pages.length > larsonLimits.pages) throw new Error('Larson catalogue incomplete page coverage')
  const rows: LarsonRow[] = [], seen = new Set<string>(), folded = new Set<string>()
  for (const [i, page] of pages.entries()) {
    const expected = Math.min(larsonLimits.pageSize, total - i * larsonLimits.pageSize)
    if (page.page !== i + 1 || pageNumber(page.acquisition.sourceUrl) !== page.page || page.total !== total || page.rows.length !== expected)
      throw new Error('Larson catalogue inconsistent/incomplete pagination')
    for (const row of page.rows) {
      if (!row.sku || row.sku !== row.dataId || seen.has(row.sku) || folded.has(row.sku.toLowerCase())) throw new Error('Larson catalogue duplicate/missing identity across pages')
      seen.add(row.sku); folded.add(row.sku.toLowerCase()); rows.push(row)
    }
  }
  const byteSize = pages.reduce((n, p) => n + p.acquisition.byteSize, 0)
  if (rows.length !== total || byteSize > larsonLimits.totalBytes) throw new Error('Larson catalogue incomplete/oversized acquisition')
  const sorted = [...rows].sort((a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)
  // Versioned semantic manifest; never use session-bearing raw HTML as release identity.
  const manifest = Buffer.from(JSON.stringify({ version: 1, rows: sorted }), 'utf8')
  const manifestSha256 = createHash('sha256').update(manifest).digest('hex')
  return { adapter: { id: 'larson-juhl-uk-public-catalogue', version: '1' }, rows: sorted, pages, manifestSha256,
    acquisition: { sourceUrl: LARSON_CATALOGUE_URL, sha256: manifestSha256, byteSize: manifest.length,
      retrievedAt: pages[pages.length - 1].acquisition.retrievedAt, originalFilename: 'larson-juhl-uk-catalogue-manifest-v1.json' } }
}
