import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useBillingAccess } from '@/lib/billingAccess'
import { supabase } from '@/lib/supabase'
import { COUNTRY_CODES, countryDisplayName } from '@/lib/countries'
import { createSupplierManagementService, SupplierManagementServiceError } from '@/lib/supplierManagementService'
import type { CentralSupplier, CompanyOperatingCountry, CompanySupplierSelection } from '@/lib/supplierManagement'

const PAGE = 20, SCAN_PAGE = 100, MAX_OFFSET = 10000
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'
const field = 'rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:opacity-50'
type Query = { mode: 'recommended' | 'international'; search: string; offset: number }
type Snapshot = { country: CompanyOperatingCountry; selections: readonly CompanySupplierSelection[];
  complete: boolean; directory: readonly CentralSupplier[] }
type Issue = { message: string; denied: boolean }
const isDenied = (error: unknown) => error instanceof SupplierManagementServiceError && error.kind === 'denied'
function writeIssue(error: unknown): Issue {
  if (isDenied(error)) return { denied: true, message: 'Supplier management access denied. Reload and review your access.' }
  if (error instanceof SupplierManagementServiceError && error.kind === 'conflict') {
    return { denied: false, message: 'Supplier settings changed. Reload and review before another write.' }
  }
  if (!(error instanceof SupplierManagementServiceError) || error.writeOutcome === 'unknown') {
    return { denied: false, message: 'Write outcome unknown. Reload and review persisted settings before deciding whether to submit again.' }
  }
  return { denied: false, message: 'The change was not accepted. Reload and review before submitting again.' }
}

export default function SupplierManagementPanel() {
  const { companyAccountId, userId, readOnly } = useBillingAccess()
  if (!companyAccountId || !userId) return <p role="status">A signed-in user and company are required for supplier management.</p>
  if (!supabase) return <p role="status">The authenticated client is unavailable. Supplier management cannot load.</p>
  // A new identity gets a new component immediately, not after a data-clearing effect.
  return <ScopedPanel key={JSON.stringify([companyAccountId, userId])} company={companyAccountId} readOnly={readOnly} client={supabase} />
}

function ScopedPanel({ company, readOnly, client }: { company: string; readOnly: boolean; client: NonNullable<typeof supabase> }) {
  const service = useMemo(() => createSupplierManagementService((name, parameters) => client.rpc(name, { ...parameters })), [client])
  const [data, setData] = useState<Snapshot | null>(null)
  const [draftCountry, setDraftCountry] = useState('')
  const [search, setSearch] = useState('')
  const query = useRef<Query>({ mode: 'international', search: '', offset: 0 })
  const [view, setView] = useState<Query>(query.current)
  const [selectionPage, setSelectionPage] = useState(0)
  const [busy, setBusy] = useState<'load' | 'directory' | 'save' | null>('load')
  const phase = useRef<typeof busy>('load')
  const [issue, setIssue] = useState<Issue | null>(null)
  const [notice, setNotice] = useState('')
  const alive = useRef(false), epoch = useRef(0)
  const current = useCallback((token: number) => alive.current && epoch.current === token, [])
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current += 1 } }, [])

  const readSnapshot = useCallback(async (token: number): Promise<Snapshot | null> => {
    const requested = { ...query.current }
    const country = await service.operatingCountry(company)
    if (!current(token)) return null
    const selections: CompanySupplierSelection[] = [], seen = new Set<string>()
    let complete = false
    // A UI page is never evidence of absence. Scan every reachable RPC page;
    // a full final page at offset 10000 leaves absence explicitly unproven.
    for (let offset = 0; offset <= MAX_OFFSET; offset += SCAN_PAGE) {
      const page = await service.selections(company, { limit: SCAN_PAGE, offset })
      if (!current(token)) return null
      for (const row of page) {
        if (seen.has(row.supplier.id)) throw new Error('Selection pages changed')
        seen.add(row.supplier.id); selections.push(row)
      }
      if (page.length < SCAN_PAGE) { complete = true; break }
    }
    const directory = requested.mode === 'recommended' && !country.countryCode ? []
      : await service.directory(company, { ...requested, limit: PAGE })
    return current(token) ? { country, selections, complete, directory } : null
  }, [company, current, service])
  const apply = useCallback((next: Snapshot, resetCountryDraft: boolean) => {
    setData(next)
    if (resetCountryDraft) setDraftCountry(next.country.countryCode ?? '')
    setSelectionPage(page => Math.min(page, Math.max(0, Math.ceil(next.selections.length / PAGE) - 1)))
    setIssue(null)
  }, [])
  const reload = useCallback(async () => {
    if (!alive.current || phase.current === 'save') return
    const token = ++epoch.current
    phase.current = 'load'; setBusy('load'); setData(null); setIssue(null); setNotice('')
    try {
      const next = await readSnapshot(token)
      if (next && current(token)) { apply(next, true); setNotice('Reloaded. Review current values before submitting a change.') }
    } catch (error) {
      if (current(token)) setIssue({ denied: isDenied(error), message: isDenied(error)
        ? 'Supplier management access denied. Reload and review your access.' : 'Could not load supplier management. Reload and review.' })
    } finally { if (current(token)) { phase.current = null; setBusy(null) } }
  }, [apply, current, readSnapshot])
  useEffect(() => { void reload() }, [reload])

  async function browse(next: Query) {
    if (!data || issue || phase.current === 'save' || phase.current === 'load' || !alive.current) return
    if (next.mode === 'recommended' && !data.country.countryCode) return
    query.current = next; setView(next)
    const token = ++epoch.current
    phase.current = 'directory'; setBusy('directory'); setNotice('')
    setData(previous => previous ? { ...previous, directory: [] } : previous)
    try {
      const directory = await service.directory(company, { ...next, limit: PAGE })
      if (current(token)) setData(previous => previous ? { ...previous, directory } : previous)
    } catch (error) {
      if (current(token)) setIssue({ denied: isDenied(error), message: isDenied(error)
        ? 'Supplier management access denied. Reload and review your access.' : 'Could not load the supplier directory. Reload and review.' })
    } finally { if (current(token)) { phase.current = null; setBusy(null) } }
  }
  const canWrite = Boolean(data && !readOnly && !busy && !issue)
  const renderedEpoch = epoch.current
  async function write(operation: () => Promise<unknown>, resetCountryDraft = false) {
    // Synchronous guard closes the gap before React paints disabled buttons.
    // Billing and lifecycle flags restrict UI actions; only the database authorizes.
    if (!canWrite || phase.current !== null || !alive.current || renderedEpoch !== epoch.current) return
    const token = ++epoch.current
    phase.current = 'save'; setBusy('save'); setNotice('')
    try {
      await operation()
      if (!current(token)) return
      setNotice('Change confirmed.')
      try {
        const next = await readSnapshot(token)
        if (next && current(token)) apply(next, resetCountryDraft)
      } catch (error) {
        if (current(token)) setIssue({ denied: isDenied(error), message: 'Change confirmed, but refresh failed. Reload and review before another change.' })
      }
    } catch (error) { if (current(token)) setIssue(writeIssue(error)) }
    finally { if (current(token)) { phase.current = null; setBusy(null) } }
  }
  function changeSupplier(selection: CompanySupplierSelection, enabled: boolean) {
    if (selection.supplier.kind !== 'central' || (enabled && !selection.canEnable)) return
    void write(() => service.setSelections(company, [{ action: 'set-enabled', companyAccountId: company,
      supplier: { kind: 'central', id: selection.supplier.id }, enabled, expectedRevision: selection.revision }], [selection]))
  }
  function enableDirectory(supplier: CentralSupplier) {
    if (!data) return
    const existing = data.selections.find(row => row.supplier.id === supplier.id)
    if (!existing && !data.complete) return
    changeSupplier(existing ?? { companyAccountId: company, supplier, enabled: false, revision: null,
      availability: 'disabled', canEnable: supplier.status === 'active' }, true)
  }
  const browsingDisabled = !data || Boolean(issue) || busy === 'load' || busy === 'save'
  const selected = data?.selections.slice(selectionPage * PAGE, (selectionPage + 1) * PAGE) ?? []
  return <div className="space-y-6" aria-busy={busy !== null}>
    <header className="space-y-2">
      <h2 className="text-lg font-semibold">Suppliers</h2>
      <p className="text-sm text-slate-600">Central suppliers are platform-managed. Enablement grants no product pricing or image-use rights.</p>
      <button type="button" className={button} disabled={busy !== null} onClick={() => void reload()}>Reload and review</button>
    </header>
    {readOnly && <p className="text-sm text-slate-600">This account is read-only. Supplier changes are disabled.</p>}
    {busy && <p role="status">{busy === 'save' ? 'Saving and refreshing supplier settings…' : 'Loading supplier management…'}</p>}
    {notice && <p role="status">{notice}</p>}
    {issue && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{issue.message}</p>}
    {data && !issue?.denied && <>
      <section aria-label="Operating country settings" className="space-y-3">
        <h3 className="font-semibold">Operating country</h3>
        <p>Saved country: {data.country.countryCode ? `${countryDisplayName(data.country.countryCode)} (${data.country.countryCode})` : 'Not set'}</p>
        <p className="text-sm text-slate-600">Recommendations require a saved operating country. Unsaved changes, addresses, currency and legacy settings are never used.</p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void write(() => service.setOperatingCountry(company, draftCountry || null, data.country.revision), true) }}>
          <label className="grid gap-1">Operating country
            <select className={field} value={draftCountry} disabled={!canWrite} onChange={event => setDraftCountry(event.target.value)}>
              <option value="">Not set (clear country)</option>
              {COUNTRY_CODES.map(code => <option key={code} value={code}>{countryDisplayName(code)} ({code})</option>)}
            </select>
          </label>
          <button className={button} type="submit" disabled={!canWrite || draftCountry === (data.country.countryCode ?? '')}>Save operating country</button>
        </form>
      </section>
      <section aria-label="Supplier directory" className="space-y-3">
        <h3 className="font-semibold">Active supplier directory</h3>
        <label className="grid gap-1">Supplier directory view
          <select className={field} value={view.mode} disabled={browsingDisabled}
            onChange={event => void browse({ ...view, mode: event.target.value as Query['mode'], offset: 0 })}>
            <option value="international">All active suppliers</option>
            <option value="recommended" disabled={!data.country.countryCode}>Recommended</option>
          </select>
        </label>
        <form className="flex flex-wrap gap-3" onSubmit={event => { event.preventDefault(); void browse({ ...view, search, offset: 0 }) }}>
          <label className="grid gap-1">Search suppliers<input className={field} value={search} maxLength={100}
            disabled={browsingDisabled} onChange={event => setSearch(event.target.value)} /></label>
          <button className={button} type="submit" disabled={browsingDisabled}>Search directory</button>
        </form>
        {!data.complete && <p role="status">Cannot establish absence beyond the selection pagination limit. Enable actions for unlisted relationships are blocked; loaded existing relationships remain manageable.</p>}
        {!busy && data.directory.length === 0 && <p>No active suppliers match this view. Recommendations require a saved country.</p>}
        <ul className="space-y-2">{data.directory.map(supplier => {
          const existing = data.selections.find(row => row.supplier.id === supplier.id)
          return <li key={supplier.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
            <span>{supplier.name}</span>
            <button type="button" className={button} aria-label={`${existing?.enabled ? 'Enabled' : 'Enable'} ${supplier.name}`}
              disabled={!canWrite || existing?.enabled || (!existing && !data.complete)} onClick={() => enableDirectory(supplier)}>
              {existing?.enabled ? 'Enabled' : 'Enable'}
            </button>
          </li>
        })}</ul>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={button} disabled={browsingDisabled || view.offset === 0}
            onClick={() => void browse({ ...view, offset: view.offset - PAGE })}>Previous directory page</button>
          <span>Directory page {Math.floor(view.offset / PAGE) + 1}</span>
          <button type="button" className={button} disabled={browsingDisabled || busy === 'directory' || data.directory.length < PAGE || view.offset + PAGE > MAX_OFFSET}
            onClick={() => void browse({ ...view, offset: view.offset + PAGE })}>Next directory page</button>
        </div>
        {view.offset + PAGE > MAX_OFFSET && <p>Directory pagination limit reached. Refine your search.</p>}
      </section>
      <section aria-label="Existing supplier selections" className="space-y-3">
        <h3 className="font-semibold">Existing supplier selections</h3>
        {data.selections.length === 0 && <p>No supplier relationships are configured.</p>}
        <ul className="space-y-2">{selected.map(row => <li key={row.supplier.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
          <div><span>{row.supplier.name}</span><p className="text-sm text-slate-600">{row.enabled ? 'Enabled' : 'Disabled'} · {row.supplier.status} · Revision {row.revision}</p></div>
          <button type="button" className={button} aria-label={`${row.enabled ? 'Disable' : 'Enable'} ${row.supplier.name}`}
            disabled={!canWrite || (!row.enabled && !row.canEnable)} onClick={() => changeSupplier(row, !row.enabled)}>{row.enabled ? 'Disable' : 'Enable'}</button>
        </li>)}</ul>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={button} disabled={Boolean(busy) || selectionPage === 0} onClick={() => setSelectionPage(page => page - 1)}>Previous selections page</button>
          <span>Selections page {selectionPage + 1}</span>
          <button type="button" className={button} disabled={Boolean(busy) || (selectionPage + 1) * PAGE >= data.selections.length} onClick={() => setSelectionPage(page => page + 1)}>Next selections page</button>
        </div>
      </section>
    </>}
  </div>
}
