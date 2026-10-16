import { createHash } from 'node:crypto'
import type { FeedAcquisition } from './contracts.js'
import { LION_CSV_URL, LION_SCOPE, lionLimits, parseLionCsv } from './lionCatalogue.js'
import { normalizeLionCatalogue, type LionIdentity } from './lionNormalization.js'

type Options = LionIdentity & { previousSha256?: string | null; timeoutMs?: number; now?: () => Date }
/** Fixed first-party public CSV only. Single attempt, no cookie/auth/browser/session replay. */
export async function runLionFetchCheck(options: Options) {
  if (options.scopeId !== LION_SCOPE || (options.previousSha256 != null && !/^[a-f0-9]{64}$/.test(options.previousSha256))
    || (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1))) throw new Error('Invalid Lion acquisition input')
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error('Lion request timed out')); controller.abort(); void reader?.cancel().catch(() => {}) },
      Math.min(options.timeoutMs ?? lionLimits.requestMs, lionLimits.requestMs))
  })
  const bounded = <T>(work: Promise<T>) => Promise.race([work, timeout])
  try {
    const response = await bounded(fetch(LION_CSV_URL, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal,
      headers: { accept: 'text/csv', 'user-agent': 'FramersApp LION public mouldings catalogue' } }).catch(() => { throw new Error('Lion request failed') }))
    if (response.status !== 200 || !response.body || (response.url && response.url !== LION_CSV_URL)
      || response.headers.has('content-range') || !/^text\/csv(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      void response.body?.cancel().catch(() => {}); throw new Error('Lion request failed: HTTP/content type/URL/partial response')
    }
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > lionLimits.bytes)) {
      void response.body.cancel().catch(() => {}); throw new Error('Lion request failed: declared byte limit')
    }
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const chunk = await bounded(reader.read().catch(() => { throw new Error('Lion request failed: incomplete body') }))
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > lionLimits.bytes) throw new Error('Lion request failed: actual byte limit')
      chunks.push(chunk.value)
    }
    // fetch decompresses encoded bodies; Content-Length then describes wire bytes.
    if (length !== null && (!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity')
      && Number(length) !== size) throw new Error('Lion request failed: incomplete content length')
    const bytes = Buffer.concat(chunks)
    const acquisition: FeedAcquisition = { sourceUrl: LION_CSV_URL, originalFilename: 'estlite_lionmouldings.csv', byteSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: (options.now ?? (() => new Date()))().toISOString(),
      etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') }
    const artifact = parseLionCsv(bytes, acquisition)
    if (artifact.rows.length < lionLimits.minProducts) throw new Error('Lion CSV product count bounds; possible incomplete catalogue')
    const normalized = normalizeLionCatalogue(artifact, options)
    return { classification: options.previousSha256 === acquisition.sha256 ? 'unchanged' as const : 'changed' as const,
      latestSha256: acquisition.sha256, artifact, normalized,
      publishedUpdate: { sourceUrl: LION_CSV_URL, retrievedAt: acquisition.retrievedAt,
        matchedText: `Report generated ${artifact.generation.generatedAtRaw}; timezone unspecified; not a price-effective/publication date`,
        publishedDatabaseUpdateDateRaw: null, publishedDatabaseUpdateDate: null,
        extractionRule: 'Validated EstLite generation preamble and dated terminal footer; generation retained separately from publication/effective dates.' } }
  } finally { clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {}) }
}
