import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInternationalFetchCheck } from '../server/platform/supplierFeeds/internationalFetchCheck.js'
import { INTERNATIONAL_ZIP_URL, internationalLimits } from '../server/platform/supplierFeeds/internationalMoulding.js'
import { member, sha, workbook, zip } from './helpers/internationalFixture.js'

const options = { supplierId: 'supplier', sourceId: 'source', runId: 'pending', scopeId: 'mouldings', now: () => new Date('2026-10-15T12:00:00Z') }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('International bounded manual acquisition (mock HTTP only)', () => {
  it('rejects invalid prior evidence before requesting source bytes', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(runInternationalFetchCheck({ ...options, previousSha256: 'invalid' })).rejects.toThrow('checksum')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('classifies transport failure without propagating untrusted error details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('untrusted transport details')))
    await expect(runInternationalFetchCheck(options)).rejects.toThrow(/^International request failed$/)
  })
  it('uses only the server-owned official URL and distinguishes workbook release from ZIP upload metadata', async () => {
    const book = workbook(), bytes = zip([[member, book], ['Other.xlsx', Buffer.from('unrelated')]])
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(bytes, { headers: { 'last-modified': 'Wed, 16 Aug 2023 13:00:14 GMT', etag: '"old-public-file"' } }))
    vi.stubGlobal('fetch', fetcher)
    const check = await runInternationalFetchCheck({ ...options, sourceUrl: 'https://evil.invalid', mode: 'apply_requested' } as any)
    expect(fetcher.mock.calls[0][0]).toBe(INTERNATIONAL_ZIP_URL)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' })
    expect(check.latestSha256).toBe(sha(book))
    expect(check.artifact.acquisition.sha256).toBe(sha(bytes))
    expect(check.normalized.context).toMatchObject({ mode: 'dry_run', authoritative: false, missingInferenceEnabled: false })
    expect(check.publishedUpdate.publishedDatabaseUpdateDate).toBe('16/01/2023')
    expect(check.publishedUpdate.matchedText).toContain('January 16,2023')
    expect(JSON.stringify(check)).not.toMatch(/wessex|GBP|metre|exclusive/i)
    const changedArchive = zip([[member, book], ['Other.xlsx', Buffer.from('changed-other-supplier')]])
    fetcher.mockImplementation(async () => new Response(changedArchive))
    const unchanged = await runInternationalFetchCheck({ ...options, previousSha256: check.latestSha256 })
    expect(unchanged.classification).toBe('unchanged')
    expect(unchanged.artifact.acquisition.sha256).not.toBe(check.artifact.acquisition.sha256)
  })
  it.each([301, 302, 403, 500])('rejects HTTP %s without following a different destination', async status => {
    const fetcher = vi.fn(async () => new Response('no', { status, headers: { location: 'https://evil.invalid' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(runInternationalFetchCheck(options)).rejects.toThrow('HTTP failure')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('enforces both declared and streamed download bounds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'content-length': String(internationalLimits.zipBytes + 1) } })))
    await expect(runInternationalFetchCheck(options)).rejects.toThrow('size exceeded')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(internationalLimits.zipBytes + 1)); controller.close() } }))))
    await expect(runInternationalFetchCheck(options)).rejects.toThrow('size exceeded')
  })
  it('times out even if the transport ignores cancellation, with no orphan reader', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const rejected = expect(runInternationalFetchCheck({ ...options, timeoutMs: 5 })).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(5)
    await rejected
  })
})
