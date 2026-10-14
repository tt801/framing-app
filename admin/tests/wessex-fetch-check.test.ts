import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { createHash } from 'node:crypto'
import {
  WESSEX_MOULDINGS_XLS_URL,
  WESSEX_UPDATES_PAGE_URL,
  extractPublishedUpdateDate,
  runWessexFetchCheck,
} from '../server/platform/supplierFeeds/wessexFetchCheck.js'

const FIXED_NOW = new Date('2026-10-13T12:00:00.000Z')
const LAST_MODIFIED = 'Thu, 08 Oct 2026 15:21:52 GMT'
const BASE_PAGE = '<html><body><p>Databases last updated 08/10/26</p></body></html>'

const options = {
  supplierId: 'wessex-supplier',
  runId: 'wessex-run-check',
  sourceId: 'wessex-source',
  scopeId: 'mouldings',
  acquisitionComplete: true,
  completeReleaseConfirmed: true,
  now: () => FIXED_NOW,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function workbook(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Reference', 'Description', 'Price/mtr', 'Width'],
    ...rows,
  ]), 'gen')
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer)
}

function mockFetch(args: {
  xlsBody?: Uint8Array
  xlsStatus?: number
  xlsHeaders?: Record<string, string>
  pageBody?: string
  pageStatus?: number
}) {
  const xlsBody = args.xlsBody ?? workbook([
    ['A007', '3/8" Black Hockey Gold Sight', 3.22, 13],
    ['A008', '3/8" Gold Hockey Black Sight', 3.56, 13],
  ])
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === WESSEX_MOULDINGS_XLS_URL) {
      return new Response(Buffer.from(xlsBody), {
        status: args.xlsStatus ?? 200,
        headers: {
          'content-type': 'application/vnd.ms-excel',
          'last-modified': LAST_MODIFIED,
          etag: '"abc123"',
          ...(args.xlsHeaders ?? {}),
        },
      })
    }
    if (url === WESSEX_UPDATES_PAGE_URL) {
      return new Response(args.pageBody ?? BASE_PAGE, {
        status: args.pageStatus ?? 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    throw new Error(`Unexpected URL in test: ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, xlsBody }
}

describe('Wessex fetch/check evidence layer (Phase 5A)', () => {
  it('bounds streaming bodies before parsing', async () => {
    mockFetch({ pageBody: 'x'.repeat(1_000_001) })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('body exceeds')
  })
  it('times out while consuming a body, not only waiting for headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() { /* no bytes and no close */ } }))))
    await expect(runWessexFetchCheck({ ...options, timeoutMs: 10 })).rejects.toThrow('request timed out')
  })
  it.each(['https://evil.test/file?token=private', 'http://www.wessexpictures.com/res/WessexMouldings.xls', 'https://www.wessexpictures.com/other', 'https://user:private@www.wessexpictures.com/res/WessexMouldings.xls'])('rejects unapproved redirect without leaking its value: %s', async location => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location } })))
    await expect(runWessexFetchCheck(options)).rejects.toThrow('redirect rejected')
    await expect(runWessexFetchCheck(options)).rejects.not.toThrow('private')
  })
  it('bounds redirects even to approved exact resource URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(null, { status: 302, headers: { location: url } })))
    await expect(runWessexFetchCheck(options)).rejects.toThrow('redirect limit')
  })
  it('accepts a bounded redirect only to the same approved resource', async () => {
    const { fetch: normal } = mockFetch({})
    const seen = new Set<string>()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (!seen.has(url)) { seen.add(url); return new Response(null, { status: 302, headers: { location: new URL(url).pathname } }) }
      expect(init.redirect).toBe('manual')
      return normal(url)
    }))
    expect((await runWessexFetchCheck(options)).classification).toBe('changed')
  })
  it('extracts the published date from the official updates marker', () => {
    expect(extractPublishedUpdateDate(BASE_PAGE)).toMatchObject({
      raw: '08/10/26',
      normalized: '08/10/2026',
      isoDate: '2026-10-08',
    })
  })

  it('returns a healthy changed result with provenance and normalization', async () => {
    mockFetch({})
    const result = await runWessexFetchCheck(options)
    expect(result.classification).toBe('changed')
    expect(result.hashChanged).toBe(true)
    expect(result.latestSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.artifact.observedRows).toBe(2)
    expect(result.publishedUpdate).toMatchObject({
      sourceUrl: WESSEX_UPDATES_PAGE_URL,
      publishedDatabaseUpdateDateRaw: '08/10/26',
      publishedDatabaseUpdateDate: '08/10/2026',
    })
    expect(result.normalized.candidates).toHaveLength(2)
  })

  it('classifies identical SHA as unchanged', async () => {
    const { xlsBody } = mockFetch({})
    const sha = createHash('sha256').update(xlsBody).digest('hex')
    const result = await runWessexFetchCheck({ ...options, previousSha256: sha })
    expect(result.classification).toBe('unchanged')
    expect(result.hashChanged).toBe(false)
  })

  it('classifies different SHA as changed', async () => {
    const { xlsBody } = mockFetch({})
    const current = createHash('sha256').update(xlsBody).digest('hex')
    const previous = current.replace(/^./, current[0] === 'a' ? 'b' : 'a')
    const result = await runWessexFetchCheck({ ...options, previousSha256: previous })
    expect(result.classification).toBe('changed')
    expect(result.hashChanged).toBe(true)
  })

  it('fails closed on XLS HTTP failure', async () => {
    mockFetch({ xlsStatus: 503 })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('Wessex XLS request failed with HTTP 503')
  })

  it('fails closed on updates-page HTTP failure', async () => {
    mockFetch({ pageStatus: 500 })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('Wessex updates page request failed with HTTP 500')
  })

  it('fails closed when Last-Modified is missing', async () => {
    mockFetch({ xlsHeaders: { 'last-modified': '' } })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('Last-Modified header is required')
  })

  it('fails closed when Last-Modified is invalid', async () => {
    mockFetch({ xlsHeaders: { 'last-modified': 'not-a-date' } })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('Last-Modified header is invalid')
  })

  it('fails closed when published update date is missing', async () => {
    mockFetch({ pageBody: '<html><body><p>Downloads page</p></body></html>' })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('published update date is missing')
  })

  it('fails closed when published update date is malformed', async () => {
    mockFetch({ pageBody: '<html><body><p>Databases last updated 32/13/26</p></body></html>' })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('published update date is malformed')
  })

  it('fails closed when published update date is duplicated/ambiguous', async () => {
    mockFetch({ pageBody: '<html><body><p>Databases last updated 08/10/26</p><p>Databases last updated 08/10/26</p></body></html>' })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('ambiguous or duplicated')
  })

  it('fails closed when published date and Last-Modified UTC date disagree', async () => {
    mockFetch({ pageBody: '<html><body><p>Databases last updated 09/10/26</p></body></html>' })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('UTC date disagree')
  })

  it('fails closed on malformed/truncated XLS bytes', async () => {
    mockFetch({ xlsBody: new Uint8Array([1, 2, 3, 4, 5]) })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('Not a bounded OLE2 Wessex workbook')
  })

  it('fails closed on duplicate Reference values in XLS', async () => {
    mockFetch({ xlsBody: workbook([
      ['A007', 'Desc 1', 3.22, 13],
      ['a007', 'Desc 2', 3.56, 13],
    ]) })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('Duplicate Reference')
  })

  it('normalizes only after evidence agreement succeeds', async () => {
    mockFetch({ pageBody: '<html><body><p>Databases last updated 09/10/26</p></body></html>' })
    await expect(runWessexFetchCheck(options)).rejects.toThrow('UTC date disagree')

    mockFetch({
      pageBody: '<html><body><p>Databases last updated 08/10/26</p></body></html>',
      xlsBody: workbook([
        ['A009', 'Profile', 4.5, 22],
      ]),
    })
    const ok = await runWessexFetchCheck(options)
    expect(ok.normalized.candidates).toHaveLength(1)
    expect(ok.normalized.candidates[0].cost?.effectiveAt).toBe('2026-10-08T15:21:52.000Z')
  })
})
