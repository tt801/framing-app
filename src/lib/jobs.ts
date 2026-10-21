import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useBillingAccess, useBillingWriteGuard } from '@/lib/billingAccess'
import { isRecord } from './persistedRows'
import { rowToQuote } from './quotes'
import { jobFromQuote } from './quoteJobLinkage'
import { buildJobDetails, jobDetailsDraft, type JobDetailsDraft } from './jobEditing'
import type { Customer } from './customers'

export type JobStatus = 'new' | 'in_progress' | 'on_hold' | 'done' | 'cancelled' | string
export type JobChecklistItem =
  | { id: string; text: string; done?: boolean; [key: string]: unknown }
  | { key: string; label: string; done: boolean; [key: string]: unknown }
export type Job = {
  id: string; refNo?: number; createdAt: string; updatedAt?: string; dueDateISO?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent' | string; status: JobStatus; assignedTo?: string
  customerId?: string; invoiceId?: string; quoteId?: string; customer: Record<string, any>
  artwork: Record<string, any>; frame: Record<string, any>
  checklist: JobChecklistItem[]; notes?: string; [key: string]: any
  description?: string; workInstructions?: string; jobType?: string; dueDate?: string
}
export type JobOpResult = { ok: true; job: Job } | { ok: false; error: string }
const LEGACY_STORAGE_KEY = 'jobs_v1'
function safeParse<T>(raw: string | null): T | null { try { return raw ? JSON.parse(raw) as T : null } catch { return null } }
function loadLegacyJobs(): Job[] { return typeof window === 'undefined' ? [] : safeParse<Job[]>(localStorage.getItem(LEGACY_STORAGE_KEY)) || [] }
export function getLegacyLocalJobCount() { return loadLegacyJobs().length }
type JobRow = { id: string; ref_no: number; payload: unknown; customer_id: string | null; quote_id: string | null; invoice_id: string | null; created_at?: string; updated_at: string }
const isChecklistItem = (value: unknown): value is JobChecklistItem => {
  if (!isRecord(value)) return false
  if (typeof value.id === 'string' && value.id.length > 0 && typeof value.text === 'string' && value.text.length > 0)
    return value.done === undefined || typeof value.done === 'boolean'
  return typeof value.key === 'string' && value.key.length > 0 &&
    typeof value.label === 'string' && value.label.length > 0 && typeof value.done === 'boolean'
}
export const rowToJob = (row: JobRow): Job | null => {
  const payload = row.payload
  if (!isRecord(payload)) return null
  const createdAt = typeof payload.createdAt === 'string' && payload.createdAt ? payload.createdAt : row.created_at || row.updated_at
  const structures = [payload.customer, payload.artwork, payload.frame]
  if (!createdAt || structures.some(value => value !== undefined && !isRecord(value))) return null
  const rawChecklist = payload.checklist === undefined ? [] : payload.checklist
  if (!Array.isArray(rawChecklist)) return null
  const checklist: Job['checklist'] = []
  for (const item of rawChecklist) {
    if (!isChecklistItem(item)) return null
    checklist.push(item)
  }
  return {
    ...payload, id: row.id, refNo: row.ref_no, createdAt, updatedAt: row.updated_at,
    status: typeof payload.status === 'string' ? payload.status : 'new',
    customer: isRecord(payload.customer) ? payload.customer : {},
    artwork: isRecord(payload.artwork) ? payload.artwork : {},
    frame: isRecord(payload.frame) ? payload.frame : {}, checklist,
    customerId: row.customer_id || (typeof payload.customerId === 'string' ? payload.customerId : undefined),
    quoteId: row.quote_id || (typeof payload.quoteId === 'string' ? payload.quoteId : undefined),
    invoiceId: row.invoice_id || (typeof payload.invoiceId === 'string' ? payload.invoiceId : undefined),
  }
}
const message = (error: any, fallback: string) => error?.message || fallback

export function useJobs() {
  const billing = useBillingAccess(); const allowWrite = useBillingWriteGuard(); const companyAccountId = billing.companyAccountId
  const [jobs, setJobs] = useState<Job[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const requestIdRef = useRef(0)
  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!supabase || !companyAccountId) { setJobs([]); setError(null); setLoading(false); return }
    setJobs([]); setLoading(true)
    const { data, error: fetchError } = await supabase.from('jobs').select('id, ref_no, payload, customer_id, quote_id, invoice_id, created_at, updated_at').eq('company_account_id', companyAccountId).order('created_at', { ascending: false })
    if (requestIdRef.current !== requestId) return
    if (fetchError) { setJobs([]); setError(fetchError.message); setLoading(false); return }
    const mapped = ((data || []) as JobRow[]).map(rowToJob)
    setJobs(mapped.filter((job): job is Job => job !== null)); setError(mapped.includes(null) ? 'Some saved jobs have incomplete data and were not shown.' : null); setLoading(false)
  }, [companyAccountId])
  useEffect(() => { void refresh() }, [refresh])

  const add = useCallback(async (input: Partial<Job>): Promise<JobOpResult> => {
    if (!allowWrite('create jobs')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const requestId = requestIdRef.current
    const { __payload, ...fields } = input as Partial<Job> & { __payload?: Record<string, any> }
    const payload = { ...(__payload || fields), id: input.id || Math.random().toString(36).slice(2, 10), createdAt: input.createdAt || new Date().toISOString() }
    const { data, error: createError } = await supabase.rpc('create_job', { p_id: payload.id, p_company_account_id: companyAccountId, p_payload: payload, p_customer_id: input.customerId || input.customer?.id || null, p_quote_id: input.quoteId || null, p_invoice_id: input.invoiceId || null, p_ref_no: input.refNo || null })
    if (createError || !data) return { ok: false, error: message(createError, 'Could not save job') }
    if (requestId !== requestIdRef.current) return { ok: false, error: 'Company changed. Reload the original company to view the saved Job.' }
    const job = rowToJob(data as JobRow); if (!job) return { ok: false, error: 'Saved job has incomplete data' }; setJobs(prev => [job, ...prev.filter(row => row.id !== job.id)]); return { ok: true, job }
  }, [allowWrite, companyAccountId])

  const intakeCustomers = useCallback(async (customerId: string): Promise<Customer[]> => {
    if (!customerId) return []
    if (!supabase || !companyAccountId) throw new Error('No active company account')
    const { data, error } = await supabase.from('customers').select('id, first_name, last_name, email, phone, company_name, notes')
      .eq('id', customerId).eq('company_account_id', companyAccountId).single()
    if (error || !data) throw new Error('Select an existing customer in this company.')
    return [{ id: data.id, firstName: data.first_name, lastName: data.last_name, email: data.email,
      phone: data.phone ?? '', company: data.company_name ?? '', notes: data.notes ?? '' }]
  }, [companyAccountId])

  const createIntake = useCallback(async (draft: JobDetailsDraft): Promise<JobOpResult> => {
    if (!allowWrite('create jobs')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const requestId = requestIdRef.current
    try {
      const customers = await intakeCustomers(draft.customerId)
      const payload = buildJobDetails(draft, customers)
      if (requestId !== requestIdRef.current) return { ok: false, error: 'Company changed. Reopen Job intake.' }
      return await add(payload)
    } catch (error) { return { ok: false, error: message(error, 'Could not create Job') } }
  }, [add, allowWrite, companyAccountId, intakeCustomers])

  const updateDetails = useCallback(async (id: string, draft: JobDetailsDraft, expectedUpdatedAt?: string): Promise<JobOpResult> => {
    if (!allowWrite('edit jobs')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const requestId = requestIdRef.current
    try {
      const { data: source, error: fetchError } = await supabase.from('jobs').select('*')
        .eq('id', id).eq('company_account_id', companyAccountId).single()
      if (fetchError || !source) return { ok: false, error: 'Job not found in this company' }
      const current = rowToJob(source)
      if (!current || !expectedUpdatedAt || current.updatedAt !== expectedUpdatedAt)
        return { ok: false, error: 'Job changed. Reload before editing its details.' }
      if (requestId !== requestIdRef.current) return { ok: false, error: 'Company changed. Reopen Job details.' }
      if (JSON.stringify(draft) === JSON.stringify(jobDetailsDraft(current))) return { ok: true, job: current }
      const customers = current.quoteId || current.invoiceId ? [] : await intakeCustomers(draft.customerId)
      const payload = buildJobDetails(draft, customers, current)
      if (requestId !== requestIdRef.current) return { ok: false, error: 'Company changed. Reopen Job details.' }
      const { data, error: saveError } = await supabase.from('jobs')
        .update({ customer_id: payload.customerId || null, payload })
        .eq('id', id).eq('company_account_id', companyAccountId).eq('updated_at', expectedUpdatedAt).select('*').single()
      if (saveError || !data) return { ok: false, error: message(saveError, 'Job changed. Reload before saving.') }
      if (requestId !== requestIdRef.current) return { ok: false, error: 'Company changed. Reload the original company to view the saved Job.' }
      const job = rowToJob(data)
      if (!job) return { ok: false, error: 'Saved Job has incomplete data' }
      setJobs(previous => previous.map(existing => existing.id === id ? job : existing))
      return { ok: true, job }
    } catch (error) { return { ok: false, error: message(error, 'Could not save Job details') } }
  }, [allowWrite, companyAccountId, intakeCustomers])

  const createFromQuote = useCallback(async (quoteId: string): Promise<JobOpResult> => {
    if (!allowWrite('create jobs')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const requestId = requestIdRef.current
    try {
      const { data: source, error: sourceError } = await supabase.from('quotes').select('id, customer_id, payload')
        .eq('id', quoteId).eq('company_account_id', companyAccountId).single()
      if (sourceError || !source) return { ok: false, error: 'Quote not found in this company' }
      const quote = rowToQuote(source)
      if (!quote || !source.customer_id || source.customer_id !== quote.customerId)
        return { ok: false, error: 'The quote customer is missing or no longer linked' }
      const { data: existing, error: lookupError } = await supabase.from('jobs').select('*')
        .eq('company_account_id', companyAccountId).eq('quote_id', quoteId)
      if (lookupError) return { ok: false, error: lookupError.message }
      if (existing && existing.length > 1) return { ok: false, error: 'This quote has multiple linked jobs. Open Jobs to review them.' }
      let row = existing?.[0]
      if (!row) {
        const payload = jobFromQuote(quote)
        if (requestId !== requestIdRef.current) return { ok: false, error: 'Company changed. Try again.' }
        const { data, error: createError } = await supabase.rpc('create_job', {
          p_id: payload.id, p_company_account_id: companyAccountId, p_payload: payload,
          p_customer_id: quote.customerId, p_quote_id: quoteId, p_invoice_id: null, p_ref_no: null,
        })
        if (createError?.code === '23505') {
          // A concurrent conversion can only win this existing primary key once.
          const retry = await supabase.from('jobs').select('*').eq('id', payload.id)
            .eq('company_account_id', companyAccountId).eq('quote_id', quoteId).single()
          if (retry.error || !retry.data) return { ok: false, error: 'Job creation conflicted. Reload and try again.' }
          row = retry.data
        } else {
          if (createError || !data) return { ok: false, error: message(createError, 'Could not create job') }
          row = data
        }
      }
      if (row.customer_id !== source.customer_id || row.quote_id !== quoteId)
        return { ok: false, error: 'The linked job no longer matches this quote and customer' }
      const job = rowToJob(row)
      if (!job) return { ok: false, error: 'Saved job has incomplete data' }
      if (requestId !== requestIdRef.current) return { ok: false, error: 'Company changed. Reload to view the saved job.' }
      setJobs(prev => [job, ...prev.filter(saved => saved.id !== job.id)])
      return { ok: true, job }
    } catch (error) { return { ok: false, error: message(error, 'Could not create job from quote') } }
  }, [allowWrite, companyAccountId])

  const linkInvoiceFromQuote = useCallback(async (quoteId: string, invoiceId: string): Promise<JobOpResult> => {
    if (!allowWrite('link invoices')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const requestId = requestIdRef.current
    try {
      const { data: quote, error: quoteError } = await supabase.from('quotes').select('id, customer_id')
        .eq('id', quoteId).eq('company_account_id', companyAccountId).single()
      if (quoteError || !quote || !quote.customer_id)
        return { ok: false, error: 'The source quote or its customer is no longer linked' }
      const { data: invoice, error: invoiceError } = await supabase.from('invoices').select('id, quote_id, customer_id')
        .eq('id', invoiceId).eq('company_account_id', companyAccountId).single()
      if (invoiceError || !invoice || invoice.quote_id !== quoteId || invoice.customer_id !== quote.customer_id)
        return { ok: false, error: 'Invoice does not belong to this quote and company' }
      const { data: row, error: lookupError } = await supabase.from('jobs').select('*')
        .eq('company_account_id', companyAccountId).eq('quote_id', quoteId).single()
      if (lookupError || !row || row.customer_id !== invoice.customer_id)
        return { ok: false, error: 'The linked job is missing, ambiguous, or has a different customer' }
      if (row.invoice_id && row.invoice_id !== invoiceId)
        return { ok: false, error: 'This job already has a different invoice' }
      let saved = row
      if (row.invoice_id !== invoiceId) {
        const current = rowToJob(row)
        if (!current) return { ok: false, error: 'Saved job has incomplete data' }
        if (requestId !== requestIdRef.current) return { ok: false, error: 'Company changed. Try again.' }
        const { data, error: linkError } = await supabase.from('jobs')
          .update({ invoice_id: invoiceId, payload: { ...current, invoiceId } })
          .eq('id', row.id).eq('company_account_id', companyAccountId).eq('quote_id', quoteId)
          .eq('updated_at', row.updated_at).select('*').single()
        if (linkError || !data) return { ok: false, error: message(linkError, 'Job changed. Retry the invoice link.') }
        saved = data
      }
      const job = rowToJob(saved)
      if (!job) return { ok: false, error: 'Saved job has incomplete data' }
      if (requestId !== requestIdRef.current) return { ok: false, error: 'Company changed. Reload to view the saved link.' }
      setJobs(prev => prev.map(current => current.id === job.id ? job : current))
      return { ok: true, job }
    } catch (error) { return { ok: false, error: message(error, 'Could not link the invoice') } }
  }, [allowWrite, companyAccountId])

  const update = useCallback(async (patch: Partial<Job> & { id: string }): Promise<JobOpResult> => {
    if (!allowWrite('edit jobs')) return { ok: false, error: 'Read-only account' }
    if (!supabase || !companyAccountId) return { ok: false, error: 'No active company account' }
    const current = jobs.find(job => job.id === patch.id); if (!current) return { ok: false, error: 'Job not found' }
    const merged = { ...current, ...patch, id: current.id, refNo: current.refNo }
    let query = supabase.from('jobs').update({ ref_no: merged.refNo, customer_id: merged.customerId || merged.customer?.id || null, quote_id: merged.quoteId || null, invoice_id: merged.invoiceId || null, payload: merged }).eq('id', patch.id).eq('company_account_id', companyAccountId)
    if (current.updatedAt) query = query.eq('updated_at', current.updatedAt)
    const { data, error: updateError } = await query.select('id, ref_no, payload, customer_id, quote_id, invoice_id, created_at, updated_at').single()
    if (updateError || !data) return { ok: false, error: message(updateError, 'Job changed or no longer exists') }
    const job = rowToJob(data as JobRow); if (!job) return { ok: false, error: 'Saved job has incomplete data' }; setJobs(prev => prev.map(row => row.id === job.id ? job : row)); return { ok: true, job }
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
      if (result.ok === true) { imported++; idSet.add(result.job.id); if (result.job.refNo != null) refSet.add(result.job.refNo) } else if (result.ok === false) failures.push({ id: legacyJob.id, reason: result.error })
    }
    await refresh(); return { ok: true as const, imported, skipped, collisions, unresolved, failures }
  }, [add, allowWrite, companyAccountId, refresh])

  const byId = useMemo(() => new Map<string, Job>(jobs.map(job => [job.id, job])), [jobs])
  return { jobs, loading, error, refresh, add, createIntake, updateDetails, createFromQuote, linkInvoiceFromQuote, update, remove, byId, readOnly: billing.readOnly, companyAccountId, companyName: billing.companyName, getLegacyLocalJobCount, importLegacyLocalJobs }
}
