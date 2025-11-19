// src/lib/jobs.ts
import { useEffect, useMemo, useState } from 'react'

export type JobStatus = 'new' | 'in_progress' | 'on_hold' | 'done' | 'cancelled'

export type Job = {
  id: string
  refNo?: number                      // numeric job reference, shown to users
  createdAt: string
  dueDateISO?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  status: JobStatus
  assignedTo?: string                 // ← NEW: who the job is assigned to (name/email)

  // links
  invoiceId?: string
  quoteId?: string

  // customer
  customer: {
    id?: string
    firstName?: string
    lastName?: string
    email?: string
    phone?: string
    company?: string
    // address?: string  // add if you store it
  }

  // artwork / print
  artwork: {
    title?: string
    artist?: string
    source?: 'uploaded' | 'url' | 'scan' | 'customerProvided' | 'print'
    print?: {
      paper?: string
      dpi?: number
      widthCm?: number
      heightCm?: number
      colorProfile?: string
      notes?: string
    }
    // previewDataUrl?: string // add if you store it
  }

  // frame build
  frame: {
    profile?: string
    color?: string
    finish?: string
    lengthAllowanceMm?: number
    innerWidthCm?: number
    innerHeightCm?: number
    mouldingPerimeterM?: number
    hangingHardware?: string
    glazing?: string
    backing?: string
    spacers?: string
    mat?: {
      topColor?: string
      bottomColor?: string
      openingWidthCm?: number
      openingHeightCm?: number
      borderTopCm?: number
      borderBottomCm?: number
      borderLeftCm?: number
      borderRightCm?: number
    }
  }

  // operations
  checklist: Array<{
    key: string
    label: string
    done: boolean
  }>

  notes?: string
}

const JOBS_KEY = 'jobs_v1'
const JOBS_REF_COUNTER_KEY = 'jobs_ref_counter_v1'

// ---------- storage helpers ----------
function readJobsRaw(): Job[] {
  try { return JSON.parse(localStorage.getItem(JOBS_KEY) || '[]') } catch { return [] }
}
function writeJobs(jobs: Job[]) {
  localStorage.setItem(JOBS_KEY, JSON.stringify(jobs))
}

// numeric reference counter: starts at 1000, first assignment yields 1001
function readRefCounter(): number {
  const raw = localStorage.getItem(JOBS_REF_COUNTER_KEY)
  const n = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) ? n : 1000
}
function writeRefCounter(n: number) {
  localStorage.setItem(JOBS_REF_COUNTER_KEY, String(n))
}
function nextRefNo(): number {
  const curr = readRefCounter()
  const next = curr + 1
  writeRefCounter(next)
  return next
}

// ---------- migration on load ----------
// Ensures each job has a numeric refNo; syncs the counter to the max used.
function migrateJobs(jobsIn: Job[]): Job[] {
  let changed = false
  let maxSeen = 1000

  const migrated = (jobsIn || []).map((j) => {
    const out = { ...j }
    // Determine candidate numeric value from either refNo or id (if numeric)
    const idNum = parseInt(String(out.id ?? ''), 10)
    const candidate = Number.isFinite(out.refNo) ? (out.refNo as number)
                    : Number.isFinite(idNum) ? idNum
                    : undefined

    if (candidate == null) {
      // No numeric info: assign later after we know the counter
      return out
    } else {
      if (!Number.isFinite(out.refNo)) {
        out.refNo = candidate
        changed = true
      }
      maxSeen = Math.max(maxSeen, candidate)
      return out
    }
  })

  // Set the counter at least to the highest seen
  const currCounter = readRefCounter()
  const targetCounter = Math.max(currCounter, maxSeen)
  if (targetCounter !== currCounter) writeRefCounter(targetCounter)

  // Second pass: for any job still missing refNo, assign a fresh number and (optionally) fix id if non-numeric
  const withAssigned = migrated.map((j) => {
    if (!Number.isFinite(j.refNo)) {
      const newNo = nextRefNo()
      const out = { ...j, refNo: newNo }
      // If id was non-numeric or missing, set it to the refNo string for consistency
      const idNum = parseInt(String(out.id ?? ''), 10)
      if (!out.id || !Number.isFinite(idNum)) {
        out.id = String(newNo)
      }
      changed = true
      return out
    }
    // Also ensure id exists; if missing, set from refNo
    if (!j.id && Number.isFinite(j.refNo)) {
      changed = true
      return { ...j, id: String(j.refNo) }
    }
    return j
  })

  if (changed) writeJobs(withAssigned)
  return withAssigned
}

export function useJobs() {
  // initialize with migrated jobs
  const [jobs, setJobs] = useState<Job[]>(() => migrateJobs(readJobsRaw()))

  // persist on change
  useEffect(() => { writeJobs(jobs) }, [jobs])

  // Keep the counter in sync if jobs are externally imported with higher numbers
  useEffect(() => {
    const maxRef = jobs.reduce((m, j) => Math.max(m,
      Number.isFinite(j.refNo as number) ? (j.refNo as number)
      : (Number.isFinite(parseInt(String(j.id), 10)) ? parseInt(String(j.id), 10) : 0)
    ), 1000)
    const curr = readRefCounter()
    if (maxRef > curr) writeRefCounter(maxRef)
  }, [jobs])

  // Add accepts objects that might be missing id/refNo; we’ll assign them.
  const add = (j: Partial<Job> & { id?: string }) =>
    setJobs((arr) => {
      // Determine/assign numeric ref
      const hasRef = Number.isFinite(j?.refNo as number)
      const refNo = hasRef ? (j!.refNo as number) : nextRefNo()

      // id: keep if numeric string or set to refNo
      let id = j.id
      const idNum = parseInt(String(id ?? ''), 10)
      if (!id || !Number.isFinite(idNum)) id = String(refNo)

      // createdAt default if missing
      const createdAt = j.createdAt ?? new Date().toISOString()

      const newJob: Job = {
        // required
        id,
        refNo,
        createdAt,
        status: (j.status as JobStatus) || 'new',

        // carry everything else through
        dueDateISO: j.dueDateISO,
        priority: j.priority ?? 'normal',
        invoiceId: j.invoiceId,
        quoteId: j.quoteId,

        customer: j.customer || {},
        artwork: j.artwork || {},
        frame: j.frame || {},
        checklist: Array.isArray(j.checklist) ? j.checklist : [],

        notes: j.notes,
        assignedTo: j.assignedTo,     // ← NEW: persist who it's assigned to
      }

      return [newJob, ...arr]
    })

  const update = (partial: Partial<Job> & { id: string }) =>
    setJobs((arr) => arr.map(j => j.id === partial.id ? { ...j, ...partial } : j))

  const remove = (id: string) =>
    setJobs((arr) => arr.filter(j => j.id !== id))

  const byId = useMemo(() => new Map<string, Job>(jobs.map(j => [j.id, j])), [jobs])

  return { jobs, add, update, remove, byId }
}
