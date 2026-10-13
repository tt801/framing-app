import { createHash } from 'node:crypto'
import { normalizeWessexArtifact, type WessexNormalizationInput } from './wessexNormalization.js'
import { parseWessexMouldings, wessexBytesChanged, type WessexRawArtifact } from './wessexMouldings.js'

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

export type WessexPublishedUpdateEvidence = {
  sourceUrl: string
  retrievedAt: string
  matchedText: string
  publishedDatabaseUpdateDateRaw: string
  publishedDatabaseUpdateDate: string
  extractionRule: string
}

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
  const timeoutMs = options.timeoutMs ?? 30_000
  const now = options.now ?? (() => new Date())

  const [xlsResponse, updatesResponse] = await Promise.all([
    fetchRequired(WESSEX_MOULDINGS_XLS_URL, 'Wessex XLS', timeoutMs),
    fetchRequired(WESSEX_UPDATES_PAGE_URL, 'Wessex updates page', timeoutMs),
  ])

  const xlsRetrievedAt = now().toISOString()
  const pageRetrievedAt = now().toISOString()

  const [xlsBytes, updatesHtml] = await Promise.all([
    xlsResponse.arrayBuffer().then(buffer => new Uint8Array(buffer)),
    updatesResponse.text(),
  ])

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

async function fetchRequired(url: string, label: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'FramersApp Wessex fetch check' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`)
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
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
