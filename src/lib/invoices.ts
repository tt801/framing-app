// src/lib/invoices.ts
import { useEffect, useState } from 'react'
import { useCatalog } from './store'

export type InvoiceItem = { id: string; description: string; qty: number; unitPrice: number }
export type Payment = { id: string; dateISO: string; amount: number; method?: string; notes?: string }
export type Invoice = {
  id: string
  number: string
  createdAt: string
  dateISO?: string
  dueDateISO?: string
  customerId: string
  items: InvoiceItem[]
  subtotal: number
  total: number
  notes?: string
  payments?: Payment[]
  seq?: number // internal numeric sequence used for numbering
}

const STORAGE_KEY = 'invoices_v1'
const META_KEY = 'invoices_meta_v1'

function safeParse<T>(raw: string | null): T | null { try { return raw ? JSON.parse(raw) as T : null } catch { return null } }
function rid() { return Math.random().toString(36).slice(2, 10) }

function extractNum(s: string | undefined): number | null {
  if (!s) return null
  const m = s.match(/(\d+)/g)
  if (!m) return null
  return Number(m[m.length - 1])
}

export function useInvoices() {
  const { catalog } = useCatalog()
  const [invoices, setInvoices] = useState<Invoice[]>(() => safeParse<Invoice[]>(localStorage.getItem(STORAGE_KEY)) || [])
  const [meta, setMeta] = useState<{ lastSeq?: number }>(() => safeParse(localStorage.getItem(META_KEY)) || {})

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices)) }, [invoices])
  useEffect(() => { localStorage.setItem(META_KEY, JSON.stringify(meta)) }, [meta])

  const refreshLastSeqFromExisting = (list: Invoice[]): number => {
    const seqs = list.map(inv => inv.seq).filter((n): n is number => typeof n === 'number')
    const parsedNums = list.map(inv => extractNum(inv.number) ?? -Infinity)
    const maxParsed = parsedNums.length ? Math.max(...parsedNums) : -Infinity
    const maxSeq = seqs.length ? Math.max(...seqs) : -Infinity
    const best = Math.max(maxParsed, maxSeq, 0)
    return best
  }

  const addFromQuote = (input: {
    customerId: string
    items: InvoiceItem[]
    subtotal: number
    total: number
    notes?: string
  }) => {
    const now = new Date().toISOString()
    const start = Number(catalog.settings.invoiceStartNumber ?? 1)
    const prefix = String(catalog.settings.invoicePrefix ?? '')
    const last = typeof meta.lastSeq === 'number' ? meta.lastSeq : refreshLastSeqFromExisting(invoices)
    const nextSeq = Math.max(last + 1, start)
    const number = `${prefix}${nextSeq}`

    const terms = Number(catalog.settings.paymentTermsDays ?? 14)
    const due = new Date(now); due.setDate(due.getDate() + terms)

    const inv: Invoice = {
      id: rid(),
      number,
      createdAt: now,
      dueDateISO: due.toISOString(),
      customerId: input.customerId,
      items: input.items,
      subtotal: input.subtotal,
      total: input.total,
      notes: input.notes || '',
      payments: [],
      seq: nextSeq,
    }
    setInvoices(prev => [inv, ...prev])
    setMeta({ lastSeq: nextSeq })
    return inv
  }

  const remove = (id: string) => setInvoices(prev => prev.filter(x => x.id !== id))
  const addPayment = (invoiceId: string, p: Payment) =>
    setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, payments: [...(inv.payments || []), p] } : inv))

  return { invoices, addFromQuote, remove, addPayment }
}
