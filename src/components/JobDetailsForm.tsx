import React, { useEffect, useRef, useState } from 'react'
import type { Customer } from '@/lib/customers'
import type { Job, JobOpResult } from '@/lib/jobs'
import { buildJobDetails, jobDetailsDraft, workshopFields, type JobDetailsDraft } from '@/lib/jobEditing'
import { makeCompanyChecklist } from '@/lib/jobChecklist'

type Props = {
  job?: Job; customers: Customer[]; checklistTemplate?: unknown; disabled?: boolean
  onSave: (draft: JobDetailsDraft) => Promise<JobOpResult>; onCancel: () => void; onSaved: (job: Job) => void
}
export default function JobDetailsForm({ job, customers, checklistTemplate, disabled, onSave, onCancel, onSaved }: Props) {
  const [initial] = useState(() => ({ ...jobDetailsDraft(job), ...(!job ? { checklist: makeCompanyChecklist(checklistTemplate) } : {}) }))
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  const dialog = useRef<HTMLDivElement>(null)
  const linked = Boolean(job?.quoteId || job?.invoiceId)
  useEffect(() => {
    mounted.current = true
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { mounted.current = false; previous?.focus() }
  }, [])
  const change = (key: keyof JobDetailsDraft, value: string) => setDraft(previous => ({ ...previous, [key]: value }))
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending.current || disabled) return
    if (job && JSON.stringify(initial) === JSON.stringify(draft)) { onCancel(); return }
    try { buildJobDetails(draft, customers, job) } catch (error) { setError(error instanceof Error ? error.message : 'Invalid job details'); return }
    pending.current = true; setSaving(true); setError('')
    try {
      const result = await onSave(draft)
      if (!mounted.current) return
      if (result.ok === false) setError(result.error)
      else onSaved(result.job)
    } catch { if (mounted.current) setError('Could not save Job details. Your draft has been retained.') }
    finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  return <div className="fixed inset-0 z-50 bg-black/40 p-3 sm:p-6 overflow-auto flex items-start justify-center">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="job-details-title" tabIndex={-1}
      className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl" onKeyDown={event => {
        if (event.key === 'Escape' && !pending.current) { event.preventDefault(); onCancel() }
        if (event.key === 'Tab') {
          const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
          if (!elements?.length) return
          const first = elements[0], last = elements[elements.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
      }}>
      <h2 id="job-details-title" className="text-lg font-semibold mb-2">{job ? 'Edit Job Details' : 'New Job'}</h2>
      <p className="text-sm text-slate-600 mb-4">Workshop changes do not reprice a quote or invoice. Blank specification fields mean Not recorded.</p>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={saving || disabled} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm">Job type<select className="block w-full border rounded-lg p-2" value={draft.jobType} onChange={e => change('jobType', e.target.value)}>
              {![ 'customer', 'framing', 'repair', 'rework', 'internal', 'other' ].includes(draft.jobType) && <option value={draft.jobType}>{draft.jobType}</option>}
              <option value="customer">Customer work</option><option value="framing">Framing</option><option value="repair">Repair</option>
              <option value="rework">Rework</option><option value="internal">Internal</option><option value="other">Other customer work</option>
            </select></label>
            <label className="text-sm">Customer<select className="block w-full border rounded-lg p-2" disabled={linked} value={draft.customerId} onChange={e => change('customerId', e.target.value)}>
              <option value="">{draft.jobType === 'internal' ? 'No customer — Internal work' : 'Select an existing customer'}</option>
              {linked && draft.customerId && !customers.some(c => c.id === draft.customerId) && <option value={draft.customerId}>Saved linked customer</option>}
              {customers.map(customer => <option key={customer.id} value={customer.id}>{[customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.company}</option>)}
            </select></label>
          </div>
          {draft.jobType === 'internal' && <p className="text-sm text-blue-700">Internal Job — a customer is optional. No dummy customer will be created.</p>}
          {linked && <p className="text-xs text-slate-500">Customer, source quote and commercial agreement are protected.</p>}
          <label className="block text-sm">Description / work summary<textarea className="block w-full border rounded-lg p-2" value={draft.description} onChange={e => change('description', e.target.value)} /></label>
          <label className="block text-sm">Work instructions<textarea className="block w-full border rounded-lg p-2" value={draft.workInstructions} onChange={e => change('workInstructions', e.target.value)} /></label>
          <label className="block text-sm">Due date<input type="date" className="block border rounded-lg p-2" value={draft.dueDate} onChange={e => change('dueDate', e.target.value)} /></label>
          <label className="block text-sm">Notes<textarea className="block w-full border rounded-lg p-2" value={draft.notes} onChange={e => change('notes', e.target.value)} /></label>
          <details><summary className="cursor-pointer font-medium">Workshop / framing specification (optional)</summary>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">{workshopFields.map(field => <label key={field.key} className="text-sm">{field.label}
              {field.kind === 'state' ? <select className="block w-full border rounded-lg p-2" value={draft.spec[field.key]} onChange={e => setDraft(previous => ({ ...previous, spec: { ...previous.spec, [field.key]: e.target.value } }))}>
                <option value="">Not recorded</option><option value="on">On / included</option><option value="off">{field.key.startsWith('mat') ? 'None' : 'Off'}</option>
              </select> : <input className="block w-full border rounded-lg p-2" type={field.kind === 'number' ? 'number' : 'text'} min={field.kind === 'number' ? '0' : undefined} step="any" placeholder="Not recorded" value={draft.spec[field.key]}
                onChange={e => setDraft(previous => ({ ...previous, spec: { ...previous.spec, [field.key]: e.target.value } }))} />}
            </label>)}</div>
          </details>
          <section aria-label="Edit checklist" className="space-y-2">
            <h3 className="font-medium">Checklist</h3>
            <p className="text-xs text-slate-500">Using the company checklist replaces this draft list. Nothing is saved until you submit.</p>
            <button type="button" className="border rounded-lg px-3 py-1" onClick={() => setDraft(previous => ({ ...previous, checklist: makeCompanyChecklist(checklistTemplate) }))}>Use company checklist</button>
            {draft.checklist.map((item, index) => <div className="flex gap-2 items-center" key={'id' in item ? String(item.id) : String(item.key)}>
              <input type="checkbox" aria-label={`Checklist done ${index + 1}`} checked={Boolean(item.done)} onChange={e => setDraft(previous => ({ ...previous, checklist: previous.checklist.map((row, i) => i === index ? { ...row, done: e.target.checked } : row) }))} />
              <input className="border rounded-lg p-2 flex-1 min-w-0" aria-label={`Checklist item ${index + 1}`} value={String('text' in item ? item.text : item.label)} onChange={e => setDraft(previous => ({ ...previous, checklist: previous.checklist.map((row, i) => i === index ? 'text' in row ? { ...row, text: e.target.value } : { ...row, label: e.target.value } : row) }))} />
              <button type="button" className="text-rose-700" aria-label={`Remove checklist item ${index + 1}`} onClick={() => setDraft(previous => ({ ...previous, checklist: previous.checklist.filter((_, i) => i !== index) }))}>Remove</button>
            </div>)}
            <button type="button" className="border rounded-lg px-3 py-1" onClick={() => setDraft(previous => ({ ...previous, checklist: [...previous.checklist, { id: crypto.randomUUID(), text: '', done: false }] }))}>Add checklist item</button>
          </section>
        </fieldset>
        {error && <p role="alert" className="text-rose-700 my-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button type="button" className="border rounded-lg px-4 py-2" disabled={saving} onClick={onCancel}>Cancel</button>
          <button type="submit" className="bg-slate-900 text-white rounded-lg px-4 py-2 disabled:opacity-50" disabled={saving || disabled}>{saving ? 'Saving…' : job ? 'Save Job Details' : 'Create Job'}</button>
        </div>
      </form>
    </div>
  </div>
}
