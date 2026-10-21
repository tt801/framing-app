import type { Customer } from './customers'
import type { Job, JobChecklistItem } from './jobs'
import { isRecord } from './persistedRows'

type Data = Record<string, unknown>
type WorkshopField = { key: string; label: string; kind: 'text' | 'number' | 'state'; paths: string[] }
export const workshopFields: WorkshopField[] = [
  { key: 'artWidth', label: 'Artwork width (cm)', kind: 'number', paths: ['details.dims.art.widthCm', 'dims.art.widthCm', 'artwork.widthCm', 'artWcm'] },
  { key: 'artHeight', label: 'Artwork height (cm)', kind: 'number', paths: ['details.dims.art.heightCm', 'dims.art.heightCm', 'artwork.heightCm', 'artHcm'] },
  { key: 'visibleWidth', label: 'Visible width (cm)', kind: 'number', paths: ['details.dims.visible.widthCm', 'dims.visible.widthCm', 'visibleWcm', 'artwork.visibleWidthCm'] },
  { key: 'visibleHeight', label: 'Visible height (cm)', kind: 'number', paths: ['details.dims.visible.heightCm', 'dims.visible.heightCm', 'visibleHcm', 'artwork.visibleHeightCm'] },
  { key: 'frameName', label: 'Frame name', kind: 'text', paths: ['details.frame.name', 'frame.name', 'frameName', 'frame.profile'] },
  { key: 'faceWidth', label: 'Frame face width (cm)', kind: 'number', paths: ['details.dims.frameFaceWidthCm', 'dims.frameFaceWidthCm', 'details.frame.faceWidthCm', 'frame.faceWidthCm', 'faceWidthCm'] },
  { key: 'glazingName', label: 'Glazing name', kind: 'text', paths: ['details.glazing.name', 'glazing.name', 'glazingName', 'frame.glazing'] },
  ...[1, 2, 3].flatMap(index => [
    { key: `mat${index}State`, label: `Mat ${index} state`, kind: 'state' as const, paths: [`details.mats.hasMat${index}`, `mats.hasMat${index}`, `hasMat${index}`] },
    { key: `mat${index}Name`, label: `Mat ${index} name`, kind: 'text' as const, paths: [`details.mats.mat${index}.name`, `mats.mat${index}.name`] },
    { key: `mat${index}Border`, label: `Mat ${index} border (cm)`, kind: 'number' as const, paths: [`details.mats.mat${index}.borderCm`, `mats.mat${index}.borderCm`] },
  ]),
  { key: 'printing', label: 'Printing state', kind: 'state', paths: ['details.printing.include', 'printing.include'] },
  { key: 'backer', label: 'Foam/backer state', kind: 'state', paths: ['details.backer.include', 'backer.include'] },
]

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function merge(base: Data, next: Data): Data {
  const result = { ...base }
  for (const [key, value] of Object.entries(next))
    result[key] = isRecord(value) && isRecord(result[key]) ? merge(result[key], value) : value
  return result
}
export function savedJobDetails(job: Partial<Job>): Data {
  let legacy: Data = {}
  try { if (typeof job.detailsJson === 'string') { const parsed: unknown = JSON.parse(job.detailsJson); if (isRecord(parsed)) legacy = parsed } } catch { /* Missing legacy data remains unknown. */ }
  return merge(legacy, isRecord(job.details) ? job.details : {})
}
function get(root: Data, path: string): unknown {
  let value: unknown = root
  for (const key of path.split('.')) value = isRecord(value) ? value[key] : undefined
  return value
}
function set(root: Data, path: string, value: unknown) {
  const parts = path.split('.'); const leaf = parts.pop()!
  let parent = root
  for (const key of parts) {
    if (!isRecord(parent[key])) { if (value === undefined) return; parent[key] = {} }
    parent = parent[key] as Data
  }
  if (value === undefined) delete parent[leaf]
  else parent[leaf] = value
}
export type JobDetailsDraft = {
  customerId: string; description: string; workInstructions: string; jobType: string; dueDate: string; notes: string
  checklist: JobChecklistItem[]; spec: Record<string, string>
}
export function jobDetailsDraft(job: Partial<Job> = {}): JobDetailsDraft {
  const saved = { ...job, details: savedJobDetails(job) }
  const spec = Object.fromEntries(workshopFields.map(field => {
    const value = field.paths.map(path => get(saved, path)).find(value => value !== undefined && value !== null)
    return [field.key, field.kind === 'state' ? value === true ? 'on' : value === false ? 'off' : ''
      : typeof value === 'string' || typeof value === 'number' ? String(value) : '']
  }))
  return { customerId: job.customerId ?? job.customer?.id ?? '', description: job.description ?? '',
    workInstructions: job.workInstructions ?? '', jobType: job.jobType ?? 'customer',
    dueDate: (job.dueDate ?? job.dueDateISO ?? '').split('T')[0], notes: job.notes ?? '',
    checklist: copy(job.checklist ?? []), spec }
}
export function buildJobDetails(draft: JobDetailsDraft, customers: Customer[], current?: Partial<Job>): Partial<Job> {
  if (!draft.description.trim() && !draft.workInstructions.trim()) throw new Error('Enter a meaningful description or work instructions.')
  const original = jobDetailsDraft(current)
  const linked = Boolean(current?.quoteId || current?.invoiceId)
  if (linked && draft.customerId !== original.customerId) throw new Error('A commercially linked Job customer cannot be reassigned.')
  const customer = customers.find(customer => customer.id === draft.customerId)
  if (!linked && (draft.customerId ? !customer : draft.jobType !== 'internal')) throw new Error('Select an existing customer in this company, or explicitly classify the Job as Internal.')
  if (draft.dueDate) {
    const date = new Date(`${draft.dueDate}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== draft.dueDate)
      throw new Error('Enter a valid due date.')
  }
  const result: Partial<Job> = copy(current ?? { status: 'new', customer: {}, artwork: {}, frame: {}, checklist: [] })
  result.description = draft.description; result.workInstructions = draft.workInstructions; result.jobType = draft.jobType
  result.notes = draft.notes
  if (!current || draft.dueDate !== original.dueDate) {
    result.dueDate = draft.dueDate || undefined
    if ('dueDateISO' in result) result.dueDateISO = draft.dueDate || undefined
  }
  result.checklist = copy(draft.checklist)
  for (const item of result.checklist) {
    const label = 'text' in item ? item.text : item.label
    if (typeof label !== 'string' || !label.trim()) throw new Error('Checklist items must have text.')
  }
  if (!linked && (!current || draft.customerId !== original.customerId)) {
    result.customerId = customer?.id; result.customer = customer ? copy(customer) : {}
    result.customerSnapshot = customer ? copy(customer) : undefined
  }
  const changedFields = workshopFields.filter(field => draft.spec[field.key] !== original.spec[field.key])
  if (changedFields.length) {
    result.details = copy(savedJobDetails(result))
    for (const field of changedFields) {
      const raw = draft.spec[field.key] ?? ''
      if (field.kind === 'number' && raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) throw new Error('Workshop measurements must be finite and non-negative.')
      if (field.kind === 'state' && !['', 'on', 'off'].includes(raw)) throw new Error('Invalid workshop option state.')
      const value = raw === '' ? undefined : field.kind === 'number' ? Number(raw) : field.kind === 'state' ? raw === 'on' : raw
      // Remove stale equivalent aliases so clearing a value cannot reveal an older fallback.
      for (const path of field.paths) set(result, path, undefined)
      if (value !== undefined) set(result, field.paths[0], value)
    }
    result.detailsJson = JSON.stringify(result.details)
  }
  return result
}
