import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FeedAcquisition } from '../../server/platform/supplierFeeds/contracts.js'
import { LION_CSV_URL, parseLionCsv } from '../../server/platform/supplierFeeds/lionCatalogue.js'

export const lionFixture = readFileSync(new URL('../fixtures/lion/estlite-sample.csv', import.meta.url))
export const lionAcquisition = (bytes: Uint8Array): FeedAcquisition => ({ sourceUrl: LION_CSV_URL,
  sha256: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.length,
  retrievedAt: '2026-10-16T10:49:00.407323+00:00', originalFilename: 'estlite_lionmouldings.csv' })
export const lionArtifact = () => parseLionCsv(lionFixture, lionAcquisition(lionFixture))
export const lionIdentity = { supplierId: 'supplier', sourceId: 'source', scopeId: 'uk-mouldings-lengths', runId: 'run' }
/** Synthetic size-boundary fixture; NOT supplier evidence or a retained catalogue. */
export function generatedLionCsv(count = 500) {
  const text = lionFixture.toString(), footer = text.indexOf('EstLite Moulding Price Report scheduled')
  const extras = Array.from({ length: Math.max(0, count - 11) }, (_, i) => `SYNTH${i},Synthetic boundary moulding,1.00,20,0\r\n`).join('')
  return Buffer.from(text.slice(0, footer) + extras + text.slice(footer))
}
