import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useBillingAccess, useBillingWriteGuard } from '@/lib/billingAccess'

export type JobStatus = 'new' | 'in_progress' | 'on_hold' | 'done' | 'cancelled' | string
export type Job = {
  id: string; refNo?: number; createdAt: string; updatedAt?: string; dueDateISO?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent' | string; status: JobStatus; assignedTo?: string
  customerId?: string; invoiceId?: string; quoteId?: string; customer: Record<string, any>
  artwork: Record<string, any>; frame: Record<string, any>
  checklist: Array<{ key: string; label: string; done: boolean }>; notes?: string; [key: string]: any
}
export type JobOpResult = { ok: true; job: Job } | { ok: false; error: string }
const LEGACY_STORAGE_KEY = 'jobs_v1'
function safeParse<T>(raw: string | null): T | null { try { return raw ? JSON.parse(raw) as T : null } catch { return null } }
function loadLegacyJobs(): Job[] { return typeof window === 'undefined' ? [] : safeParse<Job[]>(localStorage.getItem(LEGACY_STORAGE_KEY)) || [] }
export function getLegacyLocalJobCount() { return loadLegacyJobs().length }
type JobRow = { id: string; ref_no: number; payload: Record<string, any>; customer_id: string | null; quote_id: string | null; invoice_id: string | null; updated_at: string }
const rowToJob = (row: JobRow): Job => ({ ...(row.payload || {}), id: row.id, refNo: row.ref_no, customerId: row.customer_id || row.payload?.customerId, quoteId: row.quote_id || row.payload?.quoteId, invoiceId: row.invoice_id || row.payload?.invoiceId, updatedAt: row.updated_at })
const message = (error: any, fallback: string) => error?.message || fallback

export function useJobs() {
  const billing = useBillingAccess(); const allowWrite = useBillingWriteGuard(); const companyAccountId = billing.companyAccountId
  const [jobs, setJobs] = useState<Job[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const requestIdRef = useRef(0)
  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!supabase || !companyAccountId) { setJobs([]); setError(null); setLoading(false); return }
    setJobs([]); setLoading(true)
    const { data, error: fetchError } = await supabase.from('jobs').select('id, ref_no, payload, customer_id, quote_id, invoice_id, updated_at').eq('company_account_id', companyAccountId).order('created_at', { ascending: false })
    if (requestIdRef.current !== requestId) return
    if (fetchError) { setJobs([]); setError(fetchError.message); setLoading(false); return }
    setJobs(((data || []) as JobRow[]).map(rowToJob)); setError(null); setLoading(false)
  }, [companyAccountId])
  useEffect(() => { void refresh() }, [refresh])

  const add = useCallback(async (input: Partial<Job>): Promise<JobOpResult> => {
    if (!allowWrite('create jobs')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const { __payload, ...fields } = input as Partial<Job> & { __payload?: Record<string, any> }
    const payload = { ...(__payload || fields), id: input.id || Math.random().toString(36).slice(2, 10), createdAt: input.createdAt || new Date().toISOString() }
    const { data, error: createError } = await supabase.rpc('create_job', { p_id: payload.id, p_company_account_id: companyAccountId, p_payload: payload, p_customer_id: input.customerId || input.customer?.id || null, p_quote_id: input.quoteId || null, p_invoice_id: input.invoiceId || null, p_ref_no: input.refNo || null })
    if (createError || !data) return { ok: false, error: message(createError, 'Could not save job') }
    const job = rowToJob(data as JobRow); setJobs(prev => [job, ...prev.filter(row => row.id !== job.id)]); return { ok: true, job }
  }, [allowWrite, companyAccountId])

  const update = useCallback(async (patch: Partial<Job> & { id: string }): Promise<JobOpResult> => {
    if (!allowWrite('edit jobs')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const current = jobs.find(job => job.id === patch.id); if (!current) return { ok: false, error: 'Job not found' }
    const merged = { ...current, ...patch, id: current.id, refNo: current.refNo }
    let query = supabase.from('jobs').update({ ref_no: merged.refNo, customer_id: merged.customerId || merged.customer?.id || null, quote_id: merged.quoteId || null, invoice_id: merged.invoiceId || null, payload: merged }).eq('id', patch.id).eq('company_account_id', companyAccountId)
    if (current.updatedAt) query = query.eq('updated_at', current.updatedAt)
    const { data, error: updateError } = await query.select('id, ref_no, payload, customer_id, quote_id, invoice_id, updated_at').single()
    if (updateError || !data) return { ok: false, error: message(updateError, 'Job changed or no longer exists') }
    const job = rowToJob(data as JobRow); setJobs(prev => prev.map(row => row.id === job.id ? job : row)); return { ok: true, job }
  }, [allowWrite, companyAccountId, jobs])

  const remove = useCallback(async (id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!allowWrite('delete jobs')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const { data, error: deleteError } = await supabase.from('jobs').delete().eq('id', id).eq('company_account_id', companyAccountId).select('id')
    if (deleteError) return { ok: false, error: deleteError.message }; if (!data?.length) return { ok: false, error: 'Job not found' }
    setJobs(prev => prev.filter(row => row.id !== id)); return { ok: true }
  }, [allowWrite, companyAccountId])

  const importLegacyLocalJobs = useCallback(async () => {
    if (!allowWrite('import jobs')) return { ok: false as const, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false as const, error: 'No active company account' }
    const legacy = loadLegacyJobs(); if (!legacy.length) return { ok: true as const, imported: 0, skipped: 0, collisions: 0, unresolved: 0, failures: [] as any[] }
    const ids = legacy.map(job => job.id).filter(Boolean); const refs = legacy.map(job => job.refNo).filter((ref): ref is number => Number.isFinite(ref))
    const [{ data: existingIds }, { data: existingRefs }] = await Promise.all([supabase.from('jobs').select('id, ref_no').in('id', ids.length ? ids : ['__none__']), supabase.from('jobs').select('id, ref_no').in('ref_no', refs.length ? refs : [-1])])
    const idSet = new Set((existingIds || []).map((row: any) => row.id)); const refSet = new Set((existingRefs || []).map((row: any) => row.ref_no))
    const customerIds = [...new Set(legacy.map(job => job.customerId || job.customer?.id).filter(Boolean))]; const quoteIds = [...new Set(legacy.map(job => job.quoteId).filter(Boolean))]; const invoiceIds = [...new Set(legacy.map(job => job.invoiceId).filter(Boolean))]
    const [{ data: customers }, { data: quotes }, { data: invoices }] = await Promise.all([supabase.from('customers').select('id').in('id', customerIds.length ? customerIds : ['__none__']), supabase.from('quotes').select('id').in('id', quoteIds.length ? quoteIds : ['__none__']), supabase.from('invoices').select('id').in('id', invoiceIds.length ? invoiceIds : ['__none__'])])
    const customerSet = new Set((customers || []).map((row: any) => row.id)); const quoteSet = new Set((quotes || []).map((row: any) => row.id)); const invoiceSet = new Set((invoices || []).map((row: any) => row.id))
    let imported = 0; let skipped = 0; let collisions = 0; let unresolved = 0; const failures: any[] = []
    for (const legacyJob of legacy) {
      if (idSet.has(legacyJob.id)) { skipped++; continue }; if (legacyJob.refNo != null && refSet.has(legacyJob.refNo)) { collisions++; continue }
      const customerId = legacyJob.customerId || legacyJob.customer?.id; const validCustomer = !customerId || customerSet.has(customerId); const validQuote = !legacyJob.quoteId || quoteSet.has(legacyJob.quoteId); const validInvoice = !legacyJob.invoiceId || invoiceSet.has(legacyJob.invoiceId)
      if (!validCustomer) unresolved++; if (!validQuote) unresolved++; if (!validInvoice) unresolved++
      const result = await add({ ...legacyJob, customerId: validCustomer ? customerId : undefined, quoteId: validQuote ? legacyJob.quoteId : undefined, invoiceId: validInvoice ? legacyJob.invoiceId : undefined, __payload: legacyJob })
      if (result.ok) { imported++; idSet.add(result.job.id); if (result.job.refNo != null) refSet.add(result.job.refNo) } else failures.push({ id: legacyJob.id, reason: result.error })
    }
    await refresh(); return { ok: true as const, imported, skipped, collisions, unresolved, failures }
  }, [add, allowWrite, companyAccountId, refresh])

  const byId = useMemo(() => new Map<string, Job>(jobs.map(job => [job.id, job])), [jobs])
  return { jobs, loading, error, refresh, add, update, remove, byId, readOnly: billing.readOnly, companyName: billing.companyName, getLegacyLocalJobCount, importLegacyLocalJobs }
}
