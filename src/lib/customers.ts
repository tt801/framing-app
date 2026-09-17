// src/lib/customers.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useBillingAccess, useBillingWriteGuard } from '@/lib/billingAccess'

export type Customer = {
  id: string
  firstName: string
  lastName: string
  company?: string
  email: string
  phone?: string
  notes?: string
}

export type CustomerOpResult =
  | { ok: true; customer: Customer }
  | { ok: false; error: string }

const LEGACY_STORAGE_KEY = 'customers_v1'

export function emptyCustomer(): Customer {
  return { id: '', firstName: '', lastName: '', email: '', company: '', phone: '', notes: '' }
}

function uid() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)
}

function loadLegacyLocalCustomers(): Customer[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Customer[]) : []
  } catch {
    return []
  }
}

/** Count of never-imported browser-local customers, for the explicit import prompt. */
export function getLegacyLocalCustomerCount(): number {
  return loadLegacyLocalCustomers().length
}

export function validateCustomer(c: Customer): string[] {
  const errs: string[] = []
  if (!c.firstName.trim()) errs.push('First name is required')
  if (!c.lastName.trim()) errs.push('Last name is required')
  if (!c.email.trim()) errs.push('Email is required')
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errs.push('Email format looks invalid')
  return errs
}

/** Converts customers into CSV format. Escapes commas, quotes, newlines. */
export function customersToCSV(list: Customer[]): string {
  const header = ['id', 'firstName', 'lastName', 'company', 'email', 'phone', 'notes']
  const esc = (v: any) => {
    const s = (v ?? '').toString().replace(/"/g, '""')
    return /[",\n]/.test(s) ? `"${s}"` : s
  }
  const rows = list.map(c => header.map(k => esc((c as any)[k])).join(','))
  return [header.join(','), ...rows].join('\n')
}

/** Triggers a client-side download for a given CSV string. */
export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

type CustomerRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  company_name: string | null
  notes: string | null
}

const rowToCustomer = (row: CustomerRow): Customer => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  phone: row.phone || '',
  company: row.company_name || '',
  notes: row.notes || '',
})

const customerToRow = (c: Customer, companyAccountId: string, userId: string | null) => ({
  id: c.id || uid(),
  company_account_id: companyAccountId,
  first_name: c.firstName,
  last_name: c.lastName,
  email: c.email,
  phone: c.phone || null,
  company_name: c.company || null,
  notes: c.notes || null,
  created_by_user_id: userId,
})

const SELECT_COLUMNS = 'id, first_name, last_name, email, phone, company_name, notes'

/** React hook for database-backed customer CRUD, scoped to the current company account. */
export function useCustomers() {
  const billing = useBillingAccess()
  const allowWrite = useBillingWriteGuard()
  const companyAccountId = billing.companyAccountId
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current

    if (!supabase || !companyAccountId) {
      setCustomers([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error: fetchError } = await supabase
      .from('customers')
      .select(SELECT_COLUMNS)
      .eq('company_account_id', companyAccountId)
      .order('created_at', { ascending: false })

    // Ignore a response if a newer request (e.g. account switch) has since started.
    if (requestIdRef.current !== requestId) return

    if (fetchError) {
      setCustomers([])
      setError(fetchError.message)
      setLoading(false)
      return
    }

    setCustomers(((data || []) as CustomerRow[]).map(rowToCustomer))
    setError(null)
    setLoading(false)
  }, [companyAccountId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const add = useCallback(
    async (c: Customer): Promise<CustomerOpResult> => {
      if (!allowWrite('add customers')) return { ok: false, error: 'Read-only account' }
      if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }

      const row = customerToRow(c, companyAccountId, billing.userId)
      const { data, error: insertError } = await supabase
        .from('customers')
        .insert(row)
        .select(SELECT_COLUMNS)
        .single()

      if (insertError || !data) {
        return { ok: false, error: insertError?.message || 'Could not save customer' }
      }

      const customer = rowToCustomer(data as CustomerRow)
      setCustomers(prev => [customer, ...prev])
      return { ok: true, customer }
    },
    [allowWrite, companyAccountId, billing.userId]
  )

  const update = useCallback(
    async (c: Customer): Promise<CustomerOpResult> => {
      if (!allowWrite('edit customers')) return { ok: false, error: 'Read-only account' }
      if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }

      const { data, error: updateError } = await supabase
        .from('customers')
        .update({
          first_name: c.firstName,
          last_name: c.lastName,
          email: c.email,
          phone: c.phone || null,
          company_name: c.company || null,
          notes: c.notes || null,
        })
        .eq('id', c.id)
        .eq('company_account_id', companyAccountId)
        .select(SELECT_COLUMNS)
        .single()

      if (updateError || !data) {
        return { ok: false, error: updateError?.message || 'Could not update customer' }
      }

      const customer = rowToCustomer(data as CustomerRow)
      setCustomers(prev => prev.map(x => (x.id === customer.id ? customer : x)))
      return { ok: true, customer }
    },
    [allowWrite, companyAccountId]
  )

  const remove = useCallback(
    async (id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!allowWrite('delete customers')) return { ok: false, error: 'Read-only account' }
      if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }

      // A delete matching zero rows (nonexistent or inaccessible id) does not raise an
      // error by itself, so confirm the affected row before reporting success.
      const { data, error: deleteError } = await supabase
        .from('customers')
        .delete()
        .eq('id', id)
        .eq('company_account_id', companyAccountId)
        .select('id')

      if (deleteError) return { ok: false, error: deleteError.message }
      if (!data || data.length === 0) {
        return { ok: false, error: 'Customer not found' }
      }

      setCustomers(prev => prev.filter(x => x.id !== id))
      return { ok: true }
    },
    [allowWrite, companyAccountId]
  )

  /**
   * Explicit, user-confirmed import of never-migrated browser-local customers into the
   * current company. Idempotent: re-running skips ids already present for this company.
   * Ids already used by a *different* company are flagged as conflicts, not remapped.
   */
  const importLegacyLocalCustomers = useCallback(async (): Promise<
    | { ok: true; imported: number; skipped: number; conflicts: number }
    | { ok: false; error: string }
  > => {
    if (!allowWrite('import customers')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }

    const legacy = loadLegacyLocalCustomers()
    if (legacy.length === 0) return { ok: true, imported: 0, skipped: 0, conflicts: 0 }

    const ids = legacy.map(c => c.id).filter(Boolean)
    const { data: existing, error: existingError } = await supabase
      .from('customers')
      .select('id, company_account_id')
      .in('id', ids.length > 0 ? ids : ['__none__'])

    if (existingError) return { ok: false, error: existingError.message }

    const existingById = new Map((existing || []).map((r: any) => [r.id as string, r.company_account_id as string]))

    const toInsert: ReturnType<typeof customerToRow>[] = []
    let skipped = 0
    let conflicts = 0

    for (const c of legacy) {
      const existingCompany = c.id ? existingById.get(c.id) : undefined
      if (existingCompany === companyAccountId) {
        skipped += 1 // already imported for this company: idempotent retry
        continue
      }
      if (existingCompany && existingCompany !== companyAccountId) {
        conflicts += 1 // id already used by a different company: flag, do not remap
        continue
      }
      toInsert.push(customerToRow(c, companyAccountId, billing.userId))
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from('customers').insert(toInsert)
      if (insertError) return { ok: false, error: insertError.message }
    }

    await refresh()
    return { ok: true, imported: toInsert.length, skipped, conflicts }
  }, [allowWrite, companyAccountId, billing.userId, refresh])

  return {
    customers,
    loading,
    error,
    readOnly: billing.readOnly,
    companyName: billing.companyName,
    add,
    update,
    remove,
    refresh,
    findByEmail: (email: string) => customers.find(c => c.email === email),
    getById: (id: string) => customers.find(c => c.id === id),
    getLegacyLocalCustomerCount,
    importLegacyLocalCustomers,
  }
}
