import { afterEach, expect, it, vi } from 'vitest'
import { runLarsonFetchCheck } from '../server/platform/supplierFeeds/larsonJuhlFetchCheck.js'
import { LARSON_SCOPE } from '../server/platform/supplierFeeds/larsonJuhlCatalogue.js'
import { generatedLarsonPage, larsonFixture, larsonUrl } from './helpers/larsonFixture.js'

const options = { supplierId: 'supplier', sourceId: 'source', scopeId: LARSON_SCOPE, runId: 'run', now: () => new Date('2026-10-16T07:00:00Z') }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const response = (bytes: Buffer) => new Response(bytes.toString('utf8'), { headers: { 'content-type': 'text/html; charset=utf-8' } })

it('acquires explicit complete windows with robots pacing and per-page provenance, not lazy-loader arithmetic', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn().mockResolvedValueOnce(response(generatedLarsonPage(501))).mockResolvedValueOnce(response(generatedLarsonPage(501, 500)))
  vi.stubGlobal('fetch', fetcher)
  const pending = runLarsonFetchCheck(options)
  await vi.advanceTimersByTimeAsync(9999)
  expect(fetcher).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  const out = await pending
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([`${larsonUrl}?sort=Id&count=500&page=1`, `${larsonUrl}?sort=Id&count=500&page=2`])
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' })
  expect(out.artifact.rows).toHaveLength(501)
  expect(out.artifact.pages.map(p => p.acquisition.sourceUrl)).toHaveLength(2)
  expect(out.normalized.context).toMatchObject({ authoritative: false, missingInferenceEnabled: false })
  expect(out.publishedUpdate).toMatchObject({ publishedDatabaseUpdateDate: null, publishedDatabaseUpdateDateRaw: null })
})

it('detects unchanged semantic releases without deriving publication dates', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response(larsonFixture)))
  const first = await runLarsonFetchCheck(options)
  const second = await runLarsonFetchCheck({ ...options, previousSha256: first.latestSha256 })
  expect(second.classification).toBe('unchanged')
  expect(second.publishedUpdate.publishedDatabaseUpdateDate).toBeNull()
  expect(second.normalized.candidates.every(c => c.cost === undefined)).toBe(true)
})

it.each([302, 403, 500])('rejects HTTP %s without following redirects', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('login', { status, headers: { location: '/profile/login', 'content-type': 'text/html' } })))
  await expect(runLarsonFetchCheck(options)).rejects.toThrow('request failed')
})

it('rejects changed totals and repeated/short pages instead of declaring acquisition complete', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn().mockResolvedValueOnce(response(generatedLarsonPage(501))).mockResolvedValueOnce(response(generatedLarsonPage(502, 500)))
  vi.stubGlobal('fetch', fetcher)
  const pending = expect(runLarsonFetchCheck(options)).rejects.toThrow('pagination')
  await vi.advanceTimersByTimeAsync(10000)
  await pending
})

it('bounds content type, declared size, checksum input and source scope before release creation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(larsonFixture, { headers: { 'content-type': 'application/json' } })))
  await expect(runLarsonFetchCheck(options)).rejects.toThrow()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(larsonFixture, { headers: { 'content-type': 'text/html', 'content-length': '3000001' } })))
  await expect(runLarsonFetchCheck(options)).rejects.toThrow()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(runLarsonFetchCheck({ ...options, previousSha256: 'invalid' })).rejects.toThrow()
  await expect(runLarsonFetchCheck({ ...options, scopeId: 'wrong' })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

it('times out stalled requests without logging upstream error detail', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  const pending = expect(runLarsonFetchCheck({ ...options, timeoutMs: 20 })).rejects.toThrow('request timed out')
  await vi.advanceTimersByTimeAsync(20)
  await pending
})
