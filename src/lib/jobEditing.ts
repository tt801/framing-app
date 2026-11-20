import type { Customer } from './customers'
import type { Job, JobChecklistItem } from './jobs'
import { isRecord } from './persistedRows'
import { matSides, matGeometry, restoreMatBorders, MAT_GEOMETRY_VERSION, type MatBorders } from './matGeometry'
import { visualizerScene, decodeVisualizerPreset, type DesignOpening, type VisualizerDesign } from './visualizerScene'

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
    ...matSides.map(side => ({ key: `mat${index}${side[0].toUpperCase() + side.slice(1)}`, label: `Mat ${index} ${side} (cm)`, kind: 'number' as const,
      paths: [`details.mats.mat${index}.borders.${side}`, `mats.mat${index}.borders.${side}`] })),
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
  checklist: JobChecklistItem[]; spec: Record<string, string>; matMeasurementNote?: string
}
function jobMatState(job: Partial<Job>) {
  const mats = { ...(isRecord(job.mats) ? job.mats : {}), ...(isRecord(savedJobDetails(job).mats) ? savedJobDetails(job).mats as Data : {}) }
  const active = [1, 2, 3].map(i => typeof mats[`hasMat${i}`] === 'boolean' ? Boolean(mats[`hasMat${i}`]) : isRecord(mats[`mat${i}`]))
  return { mats, active, restored: restoreMatBorders(mats, active) }
}
export function jobDetailsDraft(job: Partial<Job> = {}): JobDetailsDraft {
  const saved = { ...job, details: savedJobDetails(job) }
  const spec = Object.fromEntries(workshopFields.map(field => {
    const value = field.paths.map(path => get(saved, path)).find(value => value !== undefined && value !== null)
    return [field.key, field.kind === 'state' ? value === true ? 'on' : value === false ? 'off' : ''
      : typeof value === 'string' || typeof value === 'number' ? String(value) : '']
  }))
  const { mats, restored } = jobMatState(job)
  if (mats.geometryVersion !== undefined && !restored.issue) {
    restored.borders.forEach((b, slot) => {
      spec[`mat${slot + 1}Border`] = ''
      for (const side of matSides) spec[`mat${slot + 1}${side[0].toUpperCase() + side.slice(1)}`] = String(b[side])
    })
  }
  return { matMeasurementNote: restored.issue || (mats.geometryVersion !== undefined ? 'Incremental sides: Mat 1 from artwork/layout opening; Mat 2 from Mat 1 inner edge; Mat 3 from Mat 2 inner edge.' : undefined),
    customerId: job.customerId ?? job.customer?.id ?? '', description: job.description ?? '',
    workInstructions: job.workInstructions ?? '', jobType: job.jobType ?? 'customer',
    dueDate: (job.dueDate ?? job.dueDateISO ?? '').split('T')[0], notes: job.notes ?? '',
    checklist: copy(job.checklist ?? []), spec }
}
/** Avoid competing scalar and physical side controls in workshop editing. */
export function visibleWorkshopFields(draft: JobDetailsDraft) {
  return workshopFields.filter(field => {
    const match = /^mat([123])(Border|Top|Bottom|Left|Right)$/.exec(field.key)
    if (!match) return !(draft.matMeasurementNote && ['visibleWidth', 'visibleHeight'].includes(field.key))
    const physical = ['Top', 'Bottom', 'Left', 'Right'].some(side => draft.spec[`mat${match[1]}${side}`] !== '')
    return match[2] === 'Border' ? !physical : physical
  })
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
      const matSide = /^mat([123])(Top|Bottom|Left|Right)$/.exec(field.key)
      if (matSide) {
        set(result, `details.mats.mat${matSide[1]}.borderCm`, undefined)
        set(result, `mats.mat${matSide[1]}.borderCm`, undefined)
      }
      // Remove stale equivalent aliases so clearing a value cannot reveal an older fallback.
      for (const path of field.paths) set(result, path, undefined)
      if (value !== undefined) set(result, field.paths[0], value)
    }
    const geometryChanged = changedFields.some(field => /^mat[123](State|Border|Top|Bottom|Left|Right)$/.test(field.key) || ['artWidth', 'artHeight', 'faceWidth'].includes(field.key))
    const oldGeometry = jobMatState(current ?? {})
    const workspaceSnapshot = savedJobDetails(current ?? {}).visualizerDesign
    if (geometryChanged && isRecord(workspaceSnapshot) && workspaceSnapshot.version === 2 && workspaceSnapshot.mode === 'pro' && isRecord(workspaceSnapshot.pro) && workspaceSnapshot.pro.legacy !== undefined)
      throw new Error('Historical Pro workspace needs explicit review and adoption before geometry edits.')
    if (oldGeometry.mats.mode === 'pro' && oldGeometry.mats.layoutModel === 'single-board-v1' && changedFields.some(field => /^mat[23]/.test(field.key)))
      throw new Error('Decorative mats are inactive in Pro; retain their Basic settings unchanged.')
    if (geometryChanged && savedJobDetails(current ?? {}).visualizerDesign !== undefined) {
      const decoded = decodeVisualizerPreset(savedJobDetails(current ?? {}))
      if (decoded.issue) throw new Error(decoded.issue)
    }
    if (oldGeometry.mats.geometryVersion !== undefined && changedFields.some(field => ['visibleWidth', 'visibleHeight'].includes(field.key)))
      throw new Error('Internal dimensions are derived from the artwork/layout and incremental mats; edit those measurements instead.')
    if (geometryChanged && oldGeometry.restored.issue) throw new Error(oldGeometry.restored.issue)
    if (geometryChanged && oldGeometry.mats.geometryVersion !== undefined) {
      const mats = { ...oldGeometry.mats, ...(isRecord(result.details.mats) ? result.details.mats : {}) }
      const increments: MatBorders[] = [1, 2, 3].map(i => Object.fromEntries(matSides.map(side => {
        const raw = draft.spec[`mat${i}${side[0].toUpperCase() + side.slice(1)}`]
        if (raw === '' || raw === undefined) throw new Error('Incremental mat measurements must be complete; review all four sides.')
        return [side, Number(raw)]
      })) as MatBorders)
      const active = [1, 2, 3].map((i, slot) => draft.spec[`mat${i}State`] === 'on' || (draft.spec[`mat${i}State`] === '' && oldGeometry.active[slot]))
      const dims = isRecord(result.details.dims) ? result.details.dims : {}
      const art = isRecord(dims.art) ? dims.art : {}
      const width = Number(art.widthCm), height = Number(art.heightCm)
      const face = Number(dims.frameFaceWidthCm ?? get(result as Data, 'frame.faceWidthCm'))
      // Keep saved opening space and its anchor; border edits only change the display transform.
      const oldTotal = matGeometry(width, height, face, oldGeometry.restored.borders, oldGeometry.active).total
      const origin = isRecord(mats.proOrigin) ? mats.proOrigin : { x: oldTotal.left, y: oldTotal.top }
      const openings = Array.isArray(mats.openings) ? mats.openings.filter(isRecord) : []
      const geometry = visualizerScene({ mode: mats.mode === 'pro' ? 'pro' : 'basic', layoutModel: mats.layoutModel === 'single-board-v1' ? 'single-board-v1' : mats.layoutModel === 'shared-group-v1' ? 'shared-group-v1' : 'legacy-individual-v1',
        width, height, face, borders: increments, active, origin: { x: Number(origin.x), y: Number(origin.y) }, openings: openings as unknown as DesignOpening[] })
      if (geometry.issue) throw new Error('Saved dimensions need review before changing mat geometry.')
      mats.geometryVersion = MAT_GEOMETRY_VERSION
      mats.borders = increments
      if (mats.mode === 'pro') mats.proOrigin = origin
      increments.forEach((b, slot) => {
        const key = `mat${slot + 1}`
        mats[`hasMat${slot + 1}`] = active[slot]
        if (isRecord(mats[key]) || active[slot]) {
          const material = { ...(isRecord(mats[key]) ? mats[key] as Data : {}), borders: { ...b } }
          delete (material as Data).borderCm
          mats[key] = material
        }
      })
      if (result.details.visualizerDesign !== undefined) {
        const design = copy(result.details.visualizerDesign as VisualizerDesign)
        if (design.mode === "pro") design.pro.layout = { widthCm: width, heightCm: height }
        else { design.basic.widthCm = width; design.basic.heightCm = height }
        if (mats.mode === 'pro') design.pro.origin = { x: Number(origin.x), y: Number(origin.y) }
        design.mats = design.mats.map((slot, i) => {
          if (design.mode === 'pro' && design.layoutModel === 'single-board-v1' && i > 0) return slot;
          const cached = isRecord(mats[`mat${i + 1}`]) ? mats[`mat${i + 1}`] as Data : {}
          const materialId = !active[i] ? 'mat0' : slot.materialId !== 'mat0' ? slot.materialId : cached.id
          if (typeof materialId !== 'string' || !materialId || (active[i] && materialId === 'mat0')) throw new Error('Mat material identity needs review before enabling this slot.')
          if (mats[`selectedMat${i + 1}`] !== undefined) mats[`selectedMat${i + 1}`] = materialId
          return { ...slot, borders: { ...increments[i] }, materialId }
        })
        if (design.version === 2) {
          if (design.mode === 'basic') design.basic.mats = copy(design.mats)
          else design.pro.mat = copy(design.mats[0])
        }
        result.details.visualizerDesign = design
        result.visualizerDesign = copy(design)
      }
      result.details.mats = mats
      result.mats = copy(mats)
      dims.visible = { widthCm: geometry.internal.width, heightCm: geometry.internal.height }
      dims.external = { widthCm: geometry.external.width, heightCm: geometry.external.height }
      result.details.dims = dims
      // Keep legacy dimension aliases coherent without touching any commercial fields.
      result.dims = { ...(isRecord(result.dims) ? result.dims : {}), ...copy(dims), visWcm: geometry.internal.width, visHcm: geometry.internal.height }
      result.artwork = { ...(isRecord(result.artwork) ? result.artwork : {}), visibleWidthCm: geometry.internal.width, visibleHeightCm: geometry.internal.height }
    }
    result.detailsJson = JSON.stringify(result.details)
  }
  return result
}
