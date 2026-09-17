import { useCallback, useEffect, useRef, useState } from 'react'
import { useCatalog } from './store'
import { supabase } from '@/lib/supabase'
import { useBillingAccess, useBillingWriteGuard } from '@/lib/billingAccess'

export type InvoiceItem = { id: string; description?: string; name?: string; qty: number; unitPrice: number; [key: string]: any }
export type Payment = { id: string; dateISO?: string; createdAt?: string; amount: number; method?: string; notes?: string; [key: string]: any }
export type Invoice = {
  id: string
  number: string
  createdAt: string
  dateISO?: string
  dueDateISO?: string
  customerId?: string
  quoteId?: string
  items: InvoiceItem[]
  subtotal: number
  total: number
  notes?: string
  payments?: Payment[]
  seq?: number
  [key: string]: any
}

export type InvoiceOpResult =
  | { ok: true; invoice: Invoice }
  | { ok: false; error: string }

const LEGACY_STORAGE_KEY = 'invoices_v1'

function safeParse<T>(raw: string | null): T | null {
  try { return raw ? JSON.parse(raw) as T : null } catch { return null }
}

function rid() { return Math.random().toString(36).slice(2, 10) }

function loadLegacyLocalInvoices(): Invoice[] {
  if (typeof window === 'undefined') return []
  return safeParse<Invoice[]>(window.localStorage.getItem(LEGACY_STORAGE_KEY)) || []
}

export function getLegacyLocalInvoiceCount(): number { return loadLegacyLocalInvoices().length }

type InvoiceRow = {
  id: string
  payload: Record<string, any>
  customer_id: string | null
  quote_id: string | null
  invoice_number: string
}

const rowToInvoice = (row: InvoiceRow): Invoice => ({
  ...(row.payload || {}),
  id: row.id,
  number: row.invoice_number || row.payload?.number || '',
  customerId: row.customer_id || row.payload?.customerId || undefined,
  quoteId: row.quote_id || row.payload?.quoteId || undefined,
})

const errorMessage = (error: any, fallback: string) => error?.message || fallback

export function useInvoices() {
  const billing = useBillingAccess()
  const allowWrite = useBillingWriteGuard()
  const { catalog } = useCatalog()
  const companyAccountId = billing.companyAccountId
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!supabase || !companyAccountId) {
      setInvoices([]); setError(null); setLoading(false); return
    }
    setInvoices([])
    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('invoices')
      .select('id, payload, customer_id, quote_id, invoice_number')
      .eq('company_account_id', companyAccountId)
      .order('created_at', { ascending: false })

    if (requestIdRef.current !== requestId) return
    if (fetchError) {
      setInvoices([]); setError(fetchError.message); setLoading(false); return
    }
    setInvoices(((data || []) as InvoiceRow[]).map(rowToInvoice))
    setError(null); setLoading(false)
  }, [companyAccountId])

  useEffect(() => { void refresh() }, [refresh])

  const addInvoice = useCallback(async (input: Partial<Invoice>): Promise<InvoiceOpResult> => {
    if (!allowWrite('create invoices')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }

    const { __payload, ...inputFields } = input as Partial<Invoice> & { __payload?: Record<string, any> }
    const payload = { ...(__payload || inputFields), id: input.id || rid(), createdAt: input.createdAt || new Date().toISOString() }
    const settings = catalog?.settings || {}
    const { data, error: insertError } = await supabase.rpc('create_invoice', {
      p_id: payload.id,
      p_company_account_id: companyAccountId,
      p_customer_id: input.customerId || null,
      p_quote_id: input.quoteId || null,
      p_payload: payload,
      p_prefix: String(settings.invoicePrefix ?? 'INV-'),
      p_start_number: Number(settings.invoiceStartNumber ?? 1),
    })
    if (insertError || !data) return { ok: false, error: errorMessage(insertError, 'Could not save invoice') }
    const invoice = rowToInvoice(data as InvoiceRow)
    setInvoices(prev => [invoice, ...prev.filter(row => row.id !== invoice.id)])
    return { ok: true, invoice }
  }, [allowWrite, companyAccountId, catalog])

  const addFromQuote = useCallback(async (input: Partial<Invoice>): Promise<InvoiceOpResult> => addInvoice(input), [addInvoice])

  const updateInvoice = useCallback(async (id: string, patch: Partial<Invoice>): Promise<InvoiceOpResult> => {
    if (!allowWrite('edit invoices')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const current = invoices.find(row => row.id === id)
    if (!current) return { ok: false, error: 'Invoice not found' }
    const merged = { ...current, ...patch, id: current.id, number: current.number }
    const { data, error: updateError } = await supabase
      .from('invoices')
      .update({ payload: merged, customer_id: merged.customerId || null, quote_id: merged.quoteId || null })
      .eq('id', id)
      .eq('company_account_id', companyAccountId)
      .select('id, payload, customer_id, quote_id, invoice_number')
      .single()
    if (updateError || !data) return { ok: false, error: errorMessage(updateError, 'Could not update invoice') }
    const invoice = rowToInvoice(data as InvoiceRow)
    setInvoices(prev => prev.map(row => row.id === invoice.id ? invoice : row))
    return { ok: true, invoice }
  }, [allowWrite, companyAccountId, invoices])

  const remove = useCallback(async (id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!allowWrite('delete invoices')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const { data, error: deleteError } = await supabase
      .from('invoices').delete().eq('id', id).eq('company_account_id', companyAccountId).select('id')
    if (deleteError) return { ok: false, error: deleteError.message }
    if (!data || data.length === 0) return { ok: false, error: 'Invoice not found' }
    setInvoices(prev => prev.filter(row => row.id !== id))
    return { ok: true }
  }, [allowWrite, companyAccountId])

  const addPayment = useCallback(async (invoiceId: string, payment: Payment): Promise<InvoiceOpResult> => {
    if (!allowWrite('record payments')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const { data, error: paymentError } = await supabase.rpc('append_invoice_payment', {
      p_company_account_id: companyAccountId, p_invoice_id: invoiceId, p_payment: payment,
    })
    if (paymentError || !data) return { ok: false, error: errorMessage(paymentError, 'Could not record payment') }
    const invoice = rowToInvoice(data as InvoiceRow)
    setInvoices(prev => prev.map(row => row.id === invoice.id ? invoice : row))
    return { ok: true, invoice }
  }, [allowWrite, companyAccountId])

  const importLegacyLocalInvoices = useCallback(async () => {
    if (!allowWrite('import invoices')) return { ok: false as const, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false as const, error: 'No active company account' }
    const legacy = loadLegacyLocalInvoices()
    if (!legacy.length) return { ok: true as const, imported: 0, skipped: 0, collisions: 0, unresolvedCustomers: 0, unresolvedQuotes: 0 }

    const ids = legacy.map(row => row.id).filter(Boolean)
    const numbers = legacy.map(row => row.number).filter(Boolean)
    const [{ data: existingById, error: idError }, { data: existingByNumber, error: numberError }] = await Promise.all([
      supabase.from('invoices').select('id, invoice_number').in('id', ids.length ? ids : ['__none__']),
      supabase.from('invoices').select('id, invoice_number').in('invoice_number', numbers.length ? numbers : ['__none__']),
    ])
    if (idError || numberError) return { ok: false as const, error: errorMessage(idError || numberError, 'Could not inspect existing invoices') }
    const idsPresent = new Map((existingById || []).map((row: any) => [row.id, row.invoice_number]))
    const numbersPresent = new Map((existingByNumber || []).map((row: any) => [row.invoice_number, row.id]))

    const customerIds = [...new Set(legacy.map(row => row.customerId).filter(Boolean))]
    const quoteIds = [...new Set(legacy.map(row => row.quoteId).filter(Boolean))]
    const [{ data: customers }, { data: quotes }] = await Promise.all([
      supabase.from('customers').select('id').in('id', customerIds.length ? customerIds : ['__none__']),
      supabase.from('quotes').select('id').in('id', quoteIds.length ? quoteIds : ['__none__']),
    ])
    const customerSet = new Set((customers || []).map((row: any) => row.id))
    const quoteSet = new Set((quotes || []).map((row: any) => row.id))
    let imported = 0; let skipped = 0; let collisions = 0; let unresolvedCustomers = 0; let unresolvedQuotes = 0
    const failures: { id: string; reason: string }[] = []

    for (const legacyInvoice of legacy) {
      if (idsPresent.has(legacyInvoice.id)) { skipped++; continue }
      if (legacyInvoice.number && numbersPresent.has(legacyInvoice.number)) { collisions++; continue }
      const validCustomer = !legacyInvoice.customerId || customerSet.has(legacyInvoice.customerId)
      const validQuote = !legacyInvoice.quoteId || quoteSet.has(legacyInvoice.quoteId)
      if (!validCustomer) unresolvedCustomers++
      if (!validQuote) unresolvedQuotes++
      const result = await addInvoice({
        ...legacyInvoice,
        customerId: validCustomer ? legacyInvoice.customerId : undefined,
        quoteId: validQuote ? legacyInvoice.quoteId : undefined,
        __payload: legacyInvoice,
      })
      if (result.ok) {
        imported++; idsPresent.set(result.invoice.id, result.invoice.number); numbersPresent.set(result.invoice.number, result.invoice.id)
      } else {
        failures.push({ id: legacyInvoice.id, reason: result.error })
      }
    }
    await refresh()
    return { ok: true as const, imported, skipped, collisions, unresolvedCustomers, unresolvedQuotes, failures }
  }, [addInvoice, allowWrite, companyAccountId, refresh])

  return {
    invoices, loading, error, refresh, readOnly: billing.readOnly, companyName: billing.companyName,
    addInvoice, add: addInvoice, addFromQuote, updateInvoice, saveInvoice: updateInvoice,
    remove, addPayment, getLegacyLocalInvoiceCount, importLegacyLocalInvoices,
  }
}
