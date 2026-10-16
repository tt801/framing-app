import { createHash } from 'node:crypto'
import type { FeedAcquisition } from './contracts.js'
import { assembleLarsonCatalogue, parseLarsonCataloguePage, larsonLimits, larsonPageUrl, LARSON_CATALOGUE_URL, LARSON_SCOPE, type LarsonPage } from './larsonJuhlCatalogue.js'
import { normalizeLarsonCatalogue, type LarsonIdentity } from './larsonJuhlNormalization.js'

type Options = LarsonIdentity & { previousSha256?: string | null; timeoutMs?: number; now?: () => Date }
/** Internal public acquisition only. No request-controlled URL, authentication or persistence. */
export async function runLarsonFetchCheck(options: Options) {
  if (options.scopeId !== LARSON_SCOPE || (options.previousSha256 != null && !/^[0-9a-f]{64}$/.test(options.previousSha256))
    || (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1))) throw new Error('Invalid Larson acquisition input')
  const deadline = Date.now() + larsonLimits.acquisitionMs
  const pages: LarsonPage[] = []
  let expectedPages = 1, acquiredBytes = 0
  for (let page = 1; page <= expectedPages; page++) {
    if (page > 1) {
      if (Date.now() + larsonLimits.crawlDelayMs >= deadline) throw new Error('Larson request timed out: acquisition deadline')
      await new Promise(resolve => setTimeout(resolve, larsonLimits.crawlDelayMs))
    }
    const remaining = deadline - Date.now()
    if (remaining < 1) throw new Error('Larson request timed out: acquisition deadline')
    const sourceUrl = larsonPageUrl(page)
    const timeoutMs = Math.min(options.timeoutMs ?? larsonLimits.requestMs, larsonLimits.requestMs, remaining)
    const { bytes, acquisition } = await requestPage(sourceUrl, page, timeoutMs, options.now ?? (() => new Date()))
    acquiredBytes += bytes.length
    if (acquiredBytes > larsonLimits.totalBytes) throw new Error('Larson catalogue total byte limit')
    const parsed = parseLarsonCataloguePage(bytes, acquisition)
    if (page === 1) expectedPages = Math.ceil(parsed.total / larsonLimits.pageSize)
    if (parsed.total !== (pages[0]?.total ?? parsed.total)
      || parsed.rows.length !== Math.min(larsonLimits.pageSize, parsed.total - (page - 1) * larsonLimits.pageSize)) throw new Error('Larson catalogue incomplete/inconsistent pagination')
    pages.push(parsed)
  }
  const artifact = assembleLarsonCatalogue(pages)
  const normalized = normalizeLarsonCatalogue(artifact, options)
  return { classification: options.previousSha256 === artifact.manifestSha256 ? 'unchanged' as const : 'changed' as const,
    latestSha256: artifact.manifestSha256, artifact, normalized,
    publishedUpdate: { sourceUrl: LARSON_CATALOGUE_URL, retrievedAt: artifact.acquisition.retrievedAt,
      matchedText: `${artifact.rows.length} product(s) found`, publishedDatabaseUpdateDateRaw: null, publishedDatabaseUpdateDate: null,
      extractionRule: 'Observed public category count; no supplier publication date declared. Retrieval is not publication.' } }
}

async function requestPage(sourceUrl: string, page: number, timeoutMs: number, now: () => Date) {
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error('Larson request timed out')); controller.abort(); void reader?.cancel().catch(() => {}) }, timeoutMs)
  })
  const bounded = <T>(work: Promise<T>) => Promise.race([work, timeout])
  try {
    const response = await bounded(fetch(sourceUrl, { method: 'GET', credentials: 'omit', redirect: 'manual', signal: controller.signal,
      headers: { 'user-agent': 'FramersApp Larson-Juhl public catalogue', accept: 'text/html' } }).catch(() => { throw new Error('Larson request failed') }))
    if (response.status !== 200 || !response.body || (response.url && response.url !== sourceUrl)
      || !/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      void response.body?.cancel().catch(() => {})
      throw new Error('Larson request failed: HTTP/content type/URL')
    }
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > larsonLimits.pageBytes)) {
      void response.body.cancel().catch(() => {}); throw new Error('Larson request failed: byte limit')
    }
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const chunk = await bounded(reader.read().catch(() => { throw new Error('Larson request failed: body read') }))
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > larsonLimits.pageBytes) throw new Error('Larson request failed: byte limit')
      chunks.push(chunk.value)
    }
    const bytes = Buffer.concat(chunks)
    const acquisition: FeedAcquisition = { sourceUrl, originalFilename: `larson-juhl-uk-page-${page}.html`, byteSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: now().toISOString(),
      etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') }
    return { bytes, acquisition }
  } finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}) }
}
