import { createHash } from 'node:crypto'
import type { FeedAcquisition } from './contracts.js'

export const LION_CSV_URL = 'https://cdn.lionpic.co.uk/website/media/m4vnra0t/estlite_lionmouldings.csv'
export const LION_SCOPE = 'uk-mouldings-lengths'
export const lionLimits = Object.freeze({ bytes: 1_048_576, minProducts: 500, maxProducts: 10_000, requestMs: 30_000 })
export type LionRow = { sku: string; name: string; priceRaw: string; widthRaw: string; stockRaw: string; rowNumber: number }
export type LionCatalogue = { adapter: { id: 'lion-uk-public-mouldings'; version: '1' }; acquisition: FeedAcquisition;
  generation: { dateRaw: string; generatedAtRaw: string; timezone: null }; rows: LionRow[]; bytes: Uint8Array }

/** Strict bounded RFC4180 reader. Never trims source identities or silently drops malformed rows. */
function csvRecords(text: string): string[][] {
  const rows: string[][] = [], row: string[] = []
  let cell = '', quoted = false, closed = false
  const endCell = () => { row.push(cell); cell = ''; closed = false }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true }
      } else cell += c
    } else if (c === '"') {
      if (cell || closed) throw new Error('Lion CSV malformed quote')
      quoted = true
    } else if (c === ',') endCell()
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[++i] !== '\n') throw new Error('Lion CSV invalid newline')
      endCell(); rows.push([...row]); row.length = 0
      if (rows.length > lionLimits.maxProducts + 4) throw new Error('Lion CSV row limit')
    } else {
      if (closed) throw new Error('Lion CSV malformed quoted field')
      cell += c
    }
    if (cell.length > 1000 || row.length > 5) throw new Error('Lion CSV field limit')
  }
  if (quoted || cell || row.length || closed) throw new Error('Lion CSV incomplete/truncated record')
  return rows
}

function calendarDate(day: string, month: string, year: string) {
  const y = Number(year), m = Number(month), d = Number(day)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error('Lion CSV invalid generation date')
}

export function parseLionCsv(bytes: Uint8Array, acquisition: FeedAcquisition): LionCatalogue {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (!bytes.length || bytes.length > lionLimits.bytes || acquisition.sourceUrl !== LION_CSV_URL
    || acquisition.sha256 !== sha256 || acquisition.byteSize !== bytes.length || !Number.isFinite(Date.parse(acquisition.retrievedAt)))
    throw new Error('Lion CSV invalid acquisition evidence/byte limit')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('Lion CSV invalid UTF-8') }
  const hasControls = [...text].some(char => {
    const code = char.charCodeAt(0)
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127
  })
  if (hasControls || !text.endsWith('\n')) throw new Error('Lion CSV incomplete/control bytes')
  const records = csvRecords(text)
  const [printed, title, headers] = records
  if (printed?.length !== 4 || printed[0] !== 'Printed By:' || !/^LIONPIC\\[A-Za-z0-9._-]+$/.test(printed[1]) || printed[2] !== 'on'
    || title?.length !== 1 || title[0] !== 'Lion Moulding Prices & Stock (EstLite)'
    || JSON.stringify(headers) !== JSON.stringify(['Product Code', 'Description', 'Price', 'Width', 'Available Stock'])) throw new Error('Lion CSV unexpected preamble/schema')
  const generated = /^(\d{2})\/(\d{2})\/(\d{2}) ([0-2]\d):([0-5]\d):([0-5]\d)$/.exec(printed[3])
  if (!generated || Number(generated[4]) > 23) throw new Error('Lion CSV invalid generation date')
  calendarDate(generated[1], generated[2], `20${generated[3]}`)
  const dateRaw = `${generated[1]}/${generated[2]}/20${generated[3]}`
  const footer = records.at(-1)
  if (footer?.length !== 2 || footer[0] !== 'EstLite Moulding Price Report scheduled' || footer[1] !== dateRaw)
    throw new Error('Lion CSV missing/inconsistent footer; possible truncation')
  const body = records.slice(3, -1)
  if (!body.length || body.length > lionLimits.maxProducts) throw new Error('Lion CSV product count bounds')
  const seen = new Set<string>(), folded = new Set<string>()
  const rows = body.map((cells, index): LionRow => {
    if (cells.length !== 5) throw new Error('Lion CSV incomplete row shape')
    const [sku, name, priceRaw, widthRaw, stockRaw] = cells
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(sku) || !name.trim() || name.length > 500 || /[\r\n]/.test(name)
      || !/^\d+\.\d{2}$/.test(priceRaw) || !/^\d+(?:\.\d+)?$/.test(widthRaw)
      || (stockRaw !== '' && !/^-?\d+(?:\.\d+)?$/.test(stockRaw))) throw new Error('Lion CSV invalid product fields')
    if (seen.has(sku)) throw new Error('Lion CSV duplicate identifier')
    if (folded.has(sku.toLowerCase())) throw new Error('Lion CSV case-fold identifier collision')
    seen.add(sku); folded.add(sku.toLowerCase())
    return { sku, name, priceRaw, widthRaw, stockRaw, rowNumber: index + 4 }
  })
  return { adapter: { id: 'lion-uk-public-mouldings', version: '1' }, acquisition: { ...acquisition },
    generation: { dateRaw, generatedAtRaw: printed[3], timezone: null }, rows, bytes: Uint8Array.from(bytes) }
}
