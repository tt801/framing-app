import { createHash } from 'node:crypto'
import { normalizeWessexArtifact, type WessexNormalizationInput } from './wessexNormalization.js'
import { parseWessexMouldings, wessexBytesChanged, type WessexRawArtifact } from './wessexMouldings.js'
import type { PublicationEvidence } from './contracts.js'

export const WESSEX_MOULDINGS_XLS_URL = 'https://www.wessexpictures.com/res/WessexMouldings.xls'
export const WESSEX_UPDATES_PAGE_URL = 'https://www.wessexpictures.com/wessex_pricing_program_downloads.html'
export const WESSEX_UPDATES_DATE_EXTRACTION_RULE =
  'Databases last updated <DD/MM/YY or DD/MM/YYYY> appears exactly once in server-returned page text'

const RFC_1123_GMT = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/
const PUBLISHED_DATE_MARKER = /\bDatabases\s+last\s+updated\s+(\d{2}\/\d{2}\/(?:\d{2}|\d{4}))\b/gi
const PUBLISHED_DATE_VALUE = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/

export type WessexFetchCheckOptions = {
  supplierId: WessexNormalizationInput['supplierId']
  runId: WessexNormalizationInput['runId']
  sourceId: WessexNormalizationInput['sourceId']
  scopeId: WessexNormalizationInput['scopeId']
  acquisitionComplete: WessexNormalizationInput['acquisitionComplete']
  completeReleaseConfirmed: WessexNormalizationInput['completeReleaseConfirmed']
  previousSha256?: string | null
  timeoutMs?: number
  now?: () => Date
}

export type WessexFetchCheckClassification = 'changed' | 'unchanged'

export type WessexPublishedUpdateEvidence = PublicationEvidence

export type WessexFetchCheckResult = {
  classification: WessexFetchCheckClassification
  hashChanged: boolean
  previousSha256: string | null
  latestSha256: string
  artifact: WessexRawArtifact
  publishedUpdate: WessexPublishedUpdateEvidence
  normalized: ReturnType<typeof normalizeWessexArtifact>
}

type PublishedDateParse = {
  raw: string
  normalized: string
  isoDate: string
}

export async function runWessexFetchCheck(options: WessexFetchCheckOptions): Promise<WessexFetchCheckResult> {
  const timeoutMs = Math.min(30_000, Math.max(1, options.timeoutMs ?? 30_000))
  const now = options.now ?? (() => new Date())

  // Await both bounded requests even on failure: no orphaned acquisition work.
  const responses = await Promise.allSettled([
    fetchRequired(WESSEX_MOULDINGS_XLS_URL, 'Wessex XLS', timeoutMs, 5_000_000),
    fetchRequired(WESSEX_UPDATES_PAGE_URL, 'Wessex updates page', timeoutMs, 1_000_000),
  ])
  for (const response of responses) if (response.status === 'rejected') throw response.reason
  const [xlsResponse, updatesResponse] = responses.map(response => (response as PromiseFulfilledResult<{ headers: Headers; bytes: Uint8Array }>).value)

  const xlsRetrievedAt = now().toISOString()
  const pageRetrievedAt = now().toISOString()

  const xlsBytes = xlsResponse.bytes
  const updatesHtml = new TextDecoder().decode(updatesResponse.bytes)

  const lastModified = validateLastModifiedHeader(xlsResponse.headers.get('last-modified'))
  const sha256 = createHash('sha256').update(xlsBytes).digest('hex')

  const rawArtifact = parseWessexMouldings(xlsBytes, {
    sourceUrl: WESSEX_MOULDINGS_XLS_URL,
    originalFilename: 'WessexMouldings.xls',
    byteSize: xlsBytes.length,
    sha256,
    retrievedAt: xlsRetrievedAt,
    etag: sanitizeHeaderValue(xlsResponse.headers.get('etag')),
    lastModified,
  })

  const publishedDate = extractPublishedUpdateDate(updatesHtml)
  const lastModifiedIsoDate = new Date(lastModified).toISOString().slice(0, 10)
  if (publishedDate.isoDate !== lastModifiedIsoDate) {
    throw new Error('Wessex published update date and XLS Last-Modified UTC date disagree')
  }

  const normalized = normalizeWessexArtifact(rawArtifact, {
    supplierId: options.supplierId,
    runId: options.runId,
    sourceId: options.sourceId,
    scopeId: options.scopeId,
    publishedDatabaseUpdateDate: publishedDate.normalized,
    acquisitionComplete: options.acquisitionComplete,
    completeReleaseConfirmed: options.completeReleaseConfirmed,
  })

  const previousSha256 = options.previousSha256 ?? null
  const hashChanged = previousSha256 === null ? true : wessexBytesChanged(previousSha256, sha256)

  return {
    classification: hashChanged ? 'changed' : 'unchanged',
    hashChanged,
    previousSha256,
    latestSha256: sha256,
    artifact: rawArtifact,
    publishedUpdate: {
      sourceUrl: WESSEX_UPDATES_PAGE_URL,
      retrievedAt: pageRetrievedAt,
      matchedText: `Databases last updated ${publishedDate.raw}`,
      publishedDatabaseUpdateDateRaw: publishedDate.raw,
      publishedDatabaseUpdateDate: publishedDate.normalized,
      extractionRule: WESSEX_UPDATES_DATE_EXTRACTION_RULE,
    },
    normalized,
  }
}

async function fetchRequired(url: string, label: string, timeoutMs: number, maxBytes: number): Promise<{ headers: Headers; bytes: Uint8Array }> {
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} request timed out`))
      controller.abort()
      void reader?.cancel().catch(() => {})
    }, timeoutMs)
  })
  const bounded = <T>(work: Promise<T>) => Promise.race([work, timeout])
  const fail = (reason: string): never => { throw new Error(`${label} ${reason}`) }
  try {
    let destination = url
    for (let redirects = 0; ; redirects++) {
      const response = await bounded(fetch(destination, {
        method: 'GET', redirect: 'manual', credentials: 'omit',
        headers: { 'user-agent': 'FramersApp Wessex fetch check' }, signal: controller.signal,
      }))
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => {})
        if (redirects >= 2) fail('redirect limit exceeded')
        let next: URL
        try { next = new URL(response.headers.get('location') ?? '', destination) } catch { return fail('redirect rejected') }
        // Deliberately narrow: only this exact HTTPS resource, no credentials,
        // alternate hosts, ports, query strings or fragments. No ambient headers.
        if (!response.headers.get('location') || next.href !== url || next.username || next.password) fail('redirect rejected')
        destination = next.href
        continue
      }
      if (!response.ok) { void response.body?.cancel().catch(() => {}); fail(`request failed with HTTP ${response.status}`) }
      const length = response.headers.get('content-length')
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) fail('body exceeds permitted size')
      if (!response.body) fail('request failed with empty body')
      reader = response.body!.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const part = await bounded(reader.read())
        if (part.done) break
        size += part.value.byteLength
        if (size > maxBytes) fail('body exceeds permitted size')
        chunks.push(part.value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return { headers: response.headers, bytes }
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label} request timed out`)
    // Only our own finite messages may escape; fetch exceptions are untrusted.
    if (error instanceof Error && new RegExp(`^${label} (?:redirect rejected|redirect limit exceeded|body exceeds permitted size|request failed with (?:HTTP \\d{3}|empty body))$`).test(error.message)) throw error
    throw new Error(`${label} request failed`)
  } finally {
    clearTimeout(timer)
    controller.abort()
    void reader?.cancel().catch(() => {})
  }
}

function sanitizeHeaderValue(value: string | null): string | null {
  if (value == null) return null
  return value.trim() || null
}

function validateLastModifiedHeader(value: string | null): string {
  const header = sanitizeHeaderValue(value)
  if (!header) throw new Error('Wessex XLS Last-Modified header is required')
  if (!RFC_1123_GMT.test(header)) throw new Error('Wessex XLS Last-Modified header is invalid')
  const parsed = new Date(header)
  if (!Number.isFinite(parsed.getTime()) || parsed.toUTCString() !== header) {
    throw new Error('Wessex XLS Last-Modified header is invalid')
  }
  return header
}

export function extractPublishedUpdateDate(html: string): PublishedDateParse {
  const text = htmlToSearchText(html)
  const marker = new RegExp(PUBLISHED_DATE_MARKER.source, 'gi')
  const matches = [...text.matchAll(marker)]

  if (matches.length === 0) {
    throw new Error('Wessex published update date is missing from the updates page')
  }
  if (matches.length > 1) {
    throw new Error('Wessex published update date is ambiguous or duplicated on the updates page')
  }

  const raw = matches[0][1]
  const parsed = parsePublishedDate(raw)
  if (!parsed) throw new Error('Wessex published update date is malformed')
  return parsed
}

function htmlToSearchText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePublishedDate(raw: string): PublishedDateParse | null {
  const match = PUBLISHED_DATE_VALUE.exec(raw)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const yearRaw = Number(match[3])
  const year = match[3].length === 2 ? 2000 + yearRaw : yearRaw

  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) return null

  return {
    raw,
    normalized: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}`,
    isoDate: utc.toISOString().slice(0, 10),
  }
}
