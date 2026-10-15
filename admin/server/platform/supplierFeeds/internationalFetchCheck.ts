import { createHash } from 'node:crypto'
import { parseInternationalMoulding, INTERNATIONAL_ZIP_URL, internationalLimits } from './internationalMoulding.js'
import { normalizeInternationalArtifact, type InternationalIdentity } from './internationalNormalization.js'

type Options = InternationalIdentity & { previousSha256?: string | null; timeoutMs?: number; now?: () => Date }
/** Internal historical acquisition. No request-controlled URL or policy. */
export async function runInternationalFetchCheck(options: Options) {
  const previousSha256 = options.previousSha256 ?? null
  if (previousSha256 !== null && !/^[0-9a-f]{64}$/.test(previousSha256)) throw new Error('Invalid previous International checksum')
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('International request timed out')); controller.abort()
      void reader?.cancel().catch(() => {})
    }, Math.min(30_000, Math.max(1, options.timeoutMs ?? 30_000)))
  })
  const bounded = <T>(work: Promise<T>) => Promise.race([work, timeout])
  try {
    const response = await bounded(fetch(INTERNATIONAL_ZIP_URL, {
      method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal,
      headers: { 'user-agent': 'FramersApp International historical proof' },
    }).catch(() => { throw new Error('International request failed') }))
    if (response.status !== 200 || !response.body) {
      void response.body?.cancel().catch(() => {})
      throw new Error('International request failed: HTTP failure')
    }
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > internationalLimits.zipBytes)) {
      void response.body.cancel().catch(() => {})
      throw new Error('International request failed: download size exceeded')
    }
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const part = await bounded(reader.read().catch(() => { throw new Error('International request failed') }))
      if (part.done) break
      size += part.value.byteLength
      if (size > internationalLimits.zipBytes) throw new Error('International request failed: download size exceeded')
      chunks.push(part.value)
    }
    return release(Buffer.concat(chunks), response.headers, options)
  } finally {
    clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => {})
  }
}

function release(bytes: Buffer, headers: Headers, options: Options) {
  const artifact = parseInternationalMoulding(bytes, {
    sourceUrl: INTERNATIONAL_ZIP_URL, originalFilename: 'Excel Price Lists.zip', byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    retrievedAt: (options.now ?? (() => new Date()))().toISOString(),
    etag: headers.get('etag'), lastModified: headers.get('last-modified'),
  })
  const previousSha256 = options.previousSha256 ?? null, latestSha256 = artifact.workbookSha256
  return {
    classification: previousSha256 === latestSha256 ? 'unchanged' as const : 'changed' as const,
    hashChanged: previousSha256 !== latestSha256, previousSha256, latestSha256, artifact,
    publishedUpdate: {
      sourceUrl: `${INTERNATIONAL_ZIP_URL}#${encodeURIComponent(artifact.selectedMember)}`,
      retrievedAt: artifact.acquisition.retrievedAt, matchedText: artifact.publishedTitle,
      publishedDatabaseUpdateDateRaw: 'January 16,2023', publishedDatabaseUpdateDate: artifact.publishedDate,
      extractionRule: 'Exact historical title in selected workbook, Table 1!A1; HTTP upload date is not publication date',
    },
    normalized: normalizeInternationalArtifact(artifact, options),
  }
}
