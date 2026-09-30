// src/lib/quotes.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useBillingAccess, useBillingWriteGuard } from '@/lib/billingAccess'
import { isRecord, normalizeLineItems } from './persistedRows'

export type Quote = {
  id: string
  customerId: string
  items: { id: string; description: string; qty: number; unitPrice: number }[]
  notes?: string
  meta?: any
  createdAt?: string
  [key: string]: any
}

export type QuoteOpResult =
  | { ok: true; quote: Quote }
  | { ok: false; error: string }

const LEGACY_STORAGE_KEY = 'quotes_v1'

function uid() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)
}

function safeParse<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function loadLegacyLocalQuotes(): Quote[] {
  return safeParse<Quote[]>(localStorage.getItem(LEGACY_STORAGE_KEY)) || []
}

/** Count of never-imported browser-local quotes, for the explicit import prompt. */
export function getLegacyLocalQuoteCount(): number {
  return loadLegacyLocalQuotes().length
}

type QuoteRow = { id: string; payload: unknown }

export const rowToQuote = (row: QuoteRow): Quote | null => {
  const payload = row.payload
  if (!isRecord(payload)) return null
  const items = normalizeLineItems(payload.items)
  if (!items) return null
  return { ...payload, id: row.id, customerId: typeof payload.customerId === 'string' ? payload.customerId : '', items }
}

/** React hook for database-backed quote CRUD, scoped to the current company account. */
export function useQuotes() {
  const billing = useBillingAccess()
  const allowWrite = useBillingWriteGuard()
  const companyAccountId = billing.companyAccountId
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current

    if (!supabase || !companyAccountId) {
      setQuotes([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('quotes')
      .select('id, payload')
      .eq('company_account_id', companyAccountId)
      .order('created_at', { ascending: false })

    // Ignore a response if a newer request (e.g. account switch) has since started.
    if (requestIdRef.current !== requestId) return

    if (fetchError) {
      setQuotes([])
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const mapped = ((data || []) as QuoteRow[]).map(rowToQuote)
    setQuotes(mapped.filter((quote): quote is Quote => quote !== null))
    setError(mapped.includes(null) ? 'Some saved quotes have incomplete data and were not shown.' : null)
    setLoading(false)
  }, [companyAccountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const add = useCallback(
    async (q: Partial<Quote>): Promise<QuoteOpResult> => {
      if (!allowWrite('create quotes')) return { ok: false, error: 'Read-only account' }
      if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }

      const id = q.id || uid()
      const payload = { ...q, id, createdAt: q.createdAt || new Date().toISOString() }
      const customerId = q.customerId || null

      const { data, error: insertError } = await supabase
        .from('quotes')
        .insert({ id, company_account_id: companyAccountId, customer_id: customerId, payload })
        .select('id, payload')
        .single()

      if (insertError || !data) {
        return { ok: false, error: insertError?.message || 'Could not save quote' }
      }

      const quote = rowToQuote(data as QuoteRow)
      if (!quote) return { ok: false, error: 'Saved quote has incomplete data' }
      setQuotes(prev => [quote, ...prev])
      return { ok: true, quote }
    },
    [allowWrite, companyAccountId]
  )

  const update = useCallback(
    async (patch: Partial<Quote> & { id: string }): Promise<QuoteOpResult> => {
      if (!allowWrite('edit quotes')) return { ok: false, error: 'Read-only account' }
      if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }

      const current = quotes.find(q => q.id === patch.id)
      const merged = { ...(current || {}), ...patch }
      const customerId = merged.customerId || null

      const { data, error: updateError } = await supabase
        .from('quotes')
        .update({ payload: merged, customer_id: customerId })
        .eq('id', patch.id)
        .eq('company_account_id', companyAccountId)
        .select('id, payload')
        .single()

      if (updateError || !data) {
        return { ok: false, error: updateError?.message || 'Could not update quote' }
      }

      const quote = rowToQuote(data as QuoteRow)
      if (!quote) return { ok: false, error: 'Saved quote has incomplete data' }
      setQuotes(prev => prev.map(q => (q.id === quote.id ? quote : q)))
      return { ok: true, quote }
    },
    [allowWrite, companyAccountId, quotes]
  )

  const remove = useCallback(
    async (id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!allowWrite('delete quotes')) return { ok: false, error: 'Read-only account' }
      if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }

      // A delete matching zero rows (nonexistent or inaccessible id) does not raise an
      // error by itself, so confirm the affected row before reporting success.
      const { data, error: deleteError } = await supabase
        .from('quotes')
        .delete()
        .eq('id', id)
        .eq('company_account_id', companyAccountId)
        .select('id')

      if (deleteError) return { ok: false, error: deleteError.message }
      if (!data || data.length === 0) return { ok: false, error: 'Quote not found' }

      setQuotes(prev => prev.filter(q => q.id !== id))
      return { ok: true }
    },
    [allowWrite, companyAccountId]
  )

  /**
   * Explicit, user-confirmed import of never-migrated browser-local quotes into the
   * current company. Idempotent: re-running skips ids already present for this company.
   * Ids already used by a *different* company are flagged as conflicts, not remapped.
   * A customerId that does not resolve to a customer of this company is preserved
   * unchanged inside the payload but left unlinked at the database level, and reported.
   */
  const importLegacyLocalQuotes = useCallback(async (): Promise<
    | { ok: true; imported: number; skipped: number; conflicts: number; unresolvedCustomers: number }
    | { ok: false; error: string }
  > => {
    if (!allowWrite('import quotes')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }

    const legacy = loadLegacyLocalQuotes()
    if (legacy.length === 0) return { ok: true, imported: 0, skipped: 0, conflicts: 0, unresolvedCustomers: 0 }

    const quoteIds = legacy.map(q => q.id).filter(Boolean)
    const { data: existingQuotes, error: existingQuotesError } = await supabase
      .from('quotes')
      .select('id, company_account_id')
      .in('id', quoteIds.length > 0 ? quoteIds : ['__none__'])
    if (existingQuotesError) return { ok: false, error: existingQuotesError.message }
    const existingQuoteById = new Map((existingQuotes || []).map((r: any) => [r.id as string, r.company_account_id as string]))

    const customerIds = Array.from(new Set(legacy.map(q => q.customerId).filter(Boolean)))
    const { data: existingCustomers, error: existingCustomersError } = await supabase
      .from('customers')
      .select('id, company_account_id')
      .in('id', customerIds.length > 0 ? customerIds : ['__none__'])
    if (existingCustomersError) return { ok: false, error: existingCustomersError.message }
    const customerCompanyById = new Map((existingCustomers || []).map((r: any) => [r.id as string, r.company_account_id as string]))

    let skipped = 0
    let conflicts = 0
    let unresolvedCustomers = 0
    const toInsert: { id: string; company_account_id: string; customer_id: string | null; payload: Record<string, any> }[] = []

    for (const q of legacy) {
      const existingCompany = q.id ? existingQuoteById.get(q.id) : undefined
      if (existingCompany === companyAccountId) {
        skipped += 1 // already imported for this company: idempotent retry
        continue
      }
      if (existingCompany && existingCompany !== companyAccountId) {
        conflicts += 1 // quote id already used by a different company: flag, do not remap
        continue
      }

      let customerId: string | null = null
      if (q.customerId) {
        const custCompany = customerCompanyById.get(q.customerId)
        if (custCompany === companyAccountId) {
          customerId = q.customerId // valid reference for this company
        } else {
          unresolvedCustomers += 1 // missing or belongs to another company: leave unlinked, do not remap
        }
      }

      toInsert.push({
        id: q.id || uid(),
        company_account_id: companyAccountId,
        customer_id: customerId,
        payload: q, // original payload preserved unchanged, including its customerId value
      })
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from('quotes').insert(toInsert)
      if (insertError) return { ok: false, error: insertError.message }
    }

    await refresh()
    return { ok: true, imported: toInsert.length, skipped, conflicts, unresolvedCustomers }
  }, [allowWrite, companyAccountId, refresh])

  return {
    quotes,
    loading,
    error,
    readOnly: billing.readOnly,
    companyName: billing.companyName,
    add,
    update,
    remove,
    refresh,
    getLegacyLocalQuoteCount,
    importLegacyLocalQuotes,
  }
}
