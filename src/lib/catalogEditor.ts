import { useEffect, useRef, useState } from 'react'
import type { Catalog } from './store'

const productKeys = ['frames', 'mats', 'glazing', 'printingMaterials', 'backers'] as const
type Product = { id?: string; [key: string]: unknown }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const conflict = () => new Error('Catalogue changed elsewhere in a product you edited. Your draft is retained; resolve the conflicting change before retrying.')

// Reapply only local product/field changes. Never overwrite unrelated remote edits
// or automatically resolve two writers changing the same field differently.
export function rebaseCatalogEdits(base: Catalog, draft: Catalog, remote: Catalog): Catalog {
  const merged = { ...remote }
  for (const key of productKeys) {
    const before = (base[key] || []) as unknown as Product[]
    const local = (draft[key] || []) as unknown as Product[]
    const current = (remote[key] || []) as unknown as Product[]
    if (equal(before, local)) continue
    if ([before, local, current].some(rows => rows.some(row => !row.id) || new Set(rows.map(row => row.id)).size !== rows.length)) {
      if (!equal(before, current)) throw conflict()
      Object.assign(merged, { [key]: local }); continue
    }
    const original = new Map(before.map(row => [row.id, row]))
    const edited = new Map(local.map(row => [row.id, row]))
    const remaining = new Map(current.map(row => [row.id, row]))
    for (const old of before) {
      const next = edited.get(old.id)
      const saved = remaining.get(old.id)
      if (equal(old, next)) continue
      if (!next) {
        if (saved && !equal(saved, old)) throw conflict()
        remaining.delete(old.id); continue
      }
      if (!saved) throw conflict()
      const row = { ...saved }
      for (const field of new Set([...Object.keys(old), ...Object.keys(next)])) {
        if (equal(old[field], next[field])) continue
        if (!equal(saved[field], old[field]) && !equal(saved[field], next[field])) throw conflict()
        if (field in next) row[field] = next[field]
        else delete row[field]
      }
      remaining.set(old.id, row)
    }
    for (const row of local) {
      if (original.has(row.id)) continue
      const saved = remaining.get(row.id)
      if (saved && !equal(saved, row)) throw conflict()
      remaining.set(row.id, row)
    }
    Object.assign(merged, { [key]: [...remaining.values()] })
  }
  return merged
}

type SaveResult = { ok: boolean; error?: string; catalog?: Catalog }
type Source = {
  catalog: Catalog; companyAccountId: string | null; loading: boolean
  setCatalog: (updater: (previous: Catalog) => Catalog) => Promise<SaveResult>
  refreshCatalog: () => Promise<SaveResult>
}
type Draft = { company: string | null; generation: number; base: Catalog; value: Catalog; version: number; error: string | null }
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not save catalogue'

export function useCatalogEditor(source: Source) {
  const { catalog, companyAccountId, loading, setCatalog, refreshCatalog } = source
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const flight = useRef<object | null>(null)
  const context = useRef({ company: companyAccountId, generation: 0 })
  if (context.current.company !== companyAccountId) {
    context.current = { company: companyAccountId, generation: context.current.generation + 1 }
    flight.current = null
  }
  const scope = context.current
  const current = draft && draft.company === companyAccountId && draft.generation === scope.generation ? draft : null
  useEffect(() => () => { context.current = { ...context.current, generation: context.current.generation + 1 } }, [])

  useEffect(() => {
    if (!current || current.error || loading || flight.current) return
    const timer = window.setTimeout(() => {
      const token = {}; flight.current = token; setBusy(true)
      void (async () => {
        try {
          const result = await setCatalog(previous => rebaseCatalogEdits(current.base, current.value, previous))
          if (context.current !== scope || flight.current !== token) return
          if (!result.ok || !result.catalog) throw new Error(result.error || 'Could not save catalogue')
          setDraft(latest => {
            if (!latest || latest.company !== scope.company || latest.generation !== scope.generation) return latest
            if (latest.version === current.version) return null
            try {
              return { ...latest, base: result.catalog!, value: rebaseCatalogEdits(current.value, latest.value, result.catalog!), error: null }
            } catch (error) {
              return { ...latest, error: message(error) }
            }
          })
        } catch (error) {
          if (context.current === scope) setDraft(latest => latest && ({ ...latest, error: message(error) }))
        } finally {
          if (context.current === scope && flight.current === token) { flight.current = null; setBusy(false) }
        }
      })()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [current, loading, setCatalog, scope])

  const update = (partial: Partial<Catalog>) => {
    if (loading && !current) return
    setDraft(previous => {
      const existing = previous && previous.company === companyAccountId && previous.generation === scope.generation ? previous : null
      return { company: companyAccountId, generation: scope.generation, base: existing?.base || catalog,
        value: { ...(existing?.value || catalog), ...partial }, version: (existing?.version || 0) + 1, error: existing?.error || null }
    })
  }
  const retry = async () => {
    if (flight.current || !current) return
    const token = {}; flight.current = token; setBusy(true)
    try {
      const result = await refreshCatalog()
      if (context.current !== scope) return
      if (!result.ok) throw new Error(result.error || 'Could not reload catalogue')
      setDraft(latest => latest && ({ ...latest, error: null }))
    } catch (error) {
      if (context.current === scope) setDraft(latest => latest && ({ ...latest, error: message(error) }))
    } finally {
      if (context.current === scope && flight.current === token) { flight.current = null; setBusy(false) }
    }
  }
  return { catalog: current ? { ...catalog, ...Object.fromEntries(productKeys.map(key => [key, current.value[key]])) } : catalog,
    update, retry, error: current?.error, pending: Boolean(current), saving: busy && Boolean(current) }
}
