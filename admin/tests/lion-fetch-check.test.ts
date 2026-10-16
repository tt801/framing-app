import { afterEach, expect, it, vi } from 'vitest'
import { runLionFetchCheck } from '../server/platform/supplierFeeds/lionFetchCheck.js'
import { lionLimits, LION_CSV_URL } from '../server/platform/supplierFeeds/lionCatalogue.js'
import { generatedLionCsv, lionFixture, lionIdentity } from './helpers/lionFixture.js'
const options = { ...lionIdentity, now: () => new Date('2026-10-16T12:00:00Z') }
const response = (body: BodyInit = generatedLionCsv(), headers = {}) => new Response(body, { headers: { 'content-type': 'text/csv', ...headers } })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('bounds anonymous acquisition to one fixed CSV GET and preserves raw checksum and generation evidence', async () => {
  const fetcher = vi.fn(async () => response()); vi.stubGlobal('fetch', fetcher)
  const out = await runLionFetchCheck(options)
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(LION_CSV_URL, expect.objectContaining({ method: 'GET', redirect: 'manual', credentials: 'omit' }))
  expect(out.artifact.rows).toHaveLength(500)
  expect(out.artifact.acquisition.byteSize).toBe(generatedLionCsv().length)
  expect(out.latestSha256).toMatch(/^[a-f0-9]{64}$/)
  expect(out.publishedUpdate).toMatchObject({ publishedDatabaseUpdateDate: null, publishedDatabaseUpdateDateRaw: null })
  expect(out.publishedUpdate.matchedText).toContain('09/10/26 10:00:33')
  expect(out.normalized.candidates.every(c => c.cost === undefined)).toBe(true)
  expect((await runLionFetchCheck({ ...options, previousSha256: out.latestSha256 })).classification).toBe('unchanged')
})

it.each([206, 302, 401, 403, 429, 500])('rejects HTTP %s without redirects, authentication or automatic retry', async status => {
  const fetcher = vi.fn(async () => new Response('blocked', { status })); vi.stubGlobal('fetch', fetcher)
  await expect(runLionFetchCheck(options)).rejects.toThrow('request failed')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each([
  { 'content-type': 'text/html' }, { 'content-length': String(lionLimits.bytes + 1) },
  { 'content-length': 'oops' }, { 'content-length': '12' }, { 'content-range': 'bytes 0-12/30000' },
])('rejects wrong content or incomplete/oversized declared responses %j', async headers => {
  vi.stubGlobal('fetch', vi.fn(async () => response(generatedLionCsv(), headers)))
  await expect(runLionFetchCheck(options)).rejects.toThrow('request failed')
})

it('enforces actual streamed byte and reasonable product-count bounds, not only declared length', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response('x'.repeat(lionLimits.bytes + 1))))
  await expect(runLionFetchCheck(options)).rejects.toThrow('byte limit')
  vi.stubGlobal('fetch', vi.fn(async () => response(lionFixture)))
  await expect(runLionFetchCheck(options)).rejects.toThrow('count bounds')
  vi.stubGlobal('fetch', vi.fn(async () => response(generatedLionCsv(10001))))
  await expect(runLionFetchCheck(options)).rejects.toThrow()
})

it('rejects invalid scope/checksum/deadline before acquisition', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  for (const override of [{ scopeId: 'wrong' }, { previousSha256: 'bad' }, { timeoutMs: 0 }, { timeoutMs: Number.NaN }])
    await expect(runLionFetchCheck({ ...options, ...override })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

it.each(['headers', 'body'])('times out stalled %s and sanitizes transport errors', async stage => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(() => stage === 'headers' ? new Promise<Response>(() => {})
    : Promise.resolve(response(new ReadableStream({ start() { /* Deliberate stall. */ } })))))
  const pending = expect(runLionFetchCheck({ ...options, timeoutMs: 20 })).rejects.toThrow('request timed out')
  await vi.advanceTimersByTimeAsync(20); await pending
})

it('fails closed on a terminal footer lost at a clean row boundary', async () => {
  const text = generatedLionCsv().toString(); vi.stubGlobal('fetch', vi.fn(async () => response(text.slice(0, text.indexOf('EstLite Moulding Price Report scheduled')))))
  await expect(runLionFetchCheck(options)).rejects.toThrow('footer')
})
