// src/pages/Admin.tsx
import React, { useRef, useState } from 'react'
import { useCatalog, newFrame, newMat, newGlazing, newPrintingMaterial } from '../lib/store'
import type { Frame, Mat, Glazing, PrintingMaterial } from '../lib/store'

export default function AdminPage() {
  const { catalog, setCatalog, exportJSON, importJSON, resetCatalog } = useCatalog()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [active, setActive] = useState<'company' | 'settings' | 'frames' | 'mats' | 'glazing' | 'print'>('company')

  const n = (v: any, fallback = 0) => {
    const x = typeof v === 'string' ? parseFloat(v) : Number(v)
    return Number.isFinite(x) ? x : fallback
  }

  const onLogoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const dataUrl = await fileToDataUrl(f)
    setCatalog(prev => ({
      ...prev,
      settings: { ...prev.settings, companyLogoDataUrl: dataUrl }
    }))
  }

  const removeLogo = () => {
    setCatalog(prev => ({
      ...prev,
      settings: { ...prev.settings, companyLogoDataUrl: '' }
    }))
  }

  const onImportClick = () => fileRef.current?.click()
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      await importJSON(f)
      alert('Catalog imported.')
    } catch (err: any) {
      alert(`Import failed: ${err?.message || err}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Admin</h1>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={onImportFile}
          />
          <button onClick={onImportClick} className="rounded border px-3 py-2 text-sm hover:bg-black hover:text-white">
            Import JSON
          </button>
          <button onClick={exportJSON} className="rounded border px-3 py-2 text-sm hover:bg-black hover:text-white">
            Export JSON
          </button>
          <button
            onClick={() => { if (confirm('Reset catalog to defaults?')) resetCatalog() }}
            className="rounded border px-3 py-2 text-sm hover:bg-black hover:text-white"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 text-sm">
        <Tab label="Company" active={active==='company'} onClick={() => setActive('company')} />
        <Tab label="Settings" active={active==='settings'} onClick={() => setActive('settings')} />
        <Tab label="Frames"   active={active==='frames'}   onClick={() => setActive('frames')} />
        <Tab label="Mats"     active={active==='mats'}     onClick={() => setActive('mats')} />
        <Tab label="Glazing"  active={active==='glazing'}  onClick={() => setActive('glazing')} />
        <Tab label="Printing Materials" active={active==='print'} onClick={() => setActive('print')} />
      </div>

      {/* Panels */}
      {active === 'company' && (
        <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 space-y-4">
          <h2 className="text-base font-semibold">Company</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Company name"
              value={catalog.settings.companyName || ''}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, companyName: v } }))}
            />
            <TextInput
              label="Email"
              value={catalog.settings.companyEmail || ''}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, companyEmail: v } }))}
            />
            <TextInput
              label="Phone"
              value={catalog.settings.companyPhone || ''}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, companyPhone: v } }))}
            />
            <TextInput
              label="Address"
              value={catalog.settings.companyAddress || ''}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, companyAddress: v } }))}
            />
          </div>

          {/* Logo */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium mb-1">Logo (PNG/JPG)</label>
              <div className="flex items-center gap-2">
                <input type="file" accept="image/*" onChange={onLogoPick} />
                {catalog.settings.companyLogoDataUrl && (
                  <button onClick={removeLogo} className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white">Remove</button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Stored as a data-URL in settings. Used on invoice PDFs.
              </p>
            </div>
            {catalog.settings.companyLogoDataUrl && (
              <div>
                <div className="text-xs font-medium mb-1">Preview</div>
                <img
                  src={catalog.settings.companyLogoDataUrl}
                  alt="logo"
                  className="h-16 w-auto rounded border"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {active === 'settings' && (
        <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 space-y-6">
          <h2 className="text-base font-semibold">Settings</h2>

          {/* Unit & Currency */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium mb-1">Unit</label>
              <select
                className="w-full rounded border px-3 py-2 text-sm bg-white"
                value={catalog.settings.unit}
                onChange={e => setCatalog(p => ({ ...p, settings: { ...p.settings, unit: (e.target.value as 'metric'|'imperial') } }))}
              >
                <option value="metric">Metric (cm / m²)</option>
                <option value="imperial">Imperial (in)</option>
              </select>
            </div>
            <TextInput
              label="Currency symbol"
              value={catalog.settings.currencySymbol}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, currencySymbol: v } }))}
            />
            <TextInput
              label="Currency code"
              value={catalog.settings.currencyCode}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, currencyCode: v.toUpperCase() } }))}
              placeholder="e.g. ZAR, USD, GBP"
            />
          </div>

          {/* Invoice settings */}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Invoice prefix"
              value={catalog.settings.invoicePrefix || ''}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, invoicePrefix: v } }))}
            />
            <NumberInput
              label="Invoice start number"
              value={catalog.settings.invoiceStartNumber ?? 1000}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, invoiceStartNumber: Math.max(1, Number(v) || 1) } }))}
              step={1}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Tax/VAT number"
              value={catalog.settings.taxNumber || ''}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, taxNumber: v } }))}
            />
            <NumberInput
              label="Payment terms (days)"
              value={catalog.settings.paymentTermsDays ?? 14}
              onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, paymentTermsDays: Math.max(0, Number(v) || 0) } }))}
              step={1}
            />
          </div>

          <TextInput
            label="Bank details"
            value={catalog.settings.bankDetails || ''}
            onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, bankDetails: v } }))}
            placeholder="e.g. Bank, Account name, Number, Branch"
          />

          <TextInput
            label="Invoice footer note"
            value={catalog.settings.invoiceFooterNote || ''}
            onChange={v => setCatalog(p => ({ ...p, settings: { ...p.settings, invoiceFooterNote: v } }))}
            placeholder="e.g. Thank you for your business."
          />

          {/* NEW: Foam board backer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NumberInput
              label="Foam board backer (per m²)"
              value={Number((catalog.settings as any).foamBackerPerSqM ?? 0)}
              onChange={v => setCatalog(prev => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  foamBackerPerSqM: Number.isFinite(n(v)) ? n(v) : 0,
                }
              }))}
              step={0.01}
              placeholder="e.g. 120.00"
              help="Backer is charged by visible area (same footprint as glazing)."
            />
            <div>
              <label className="block text-xs font-medium mb-1">Theme color</label>
              <input
                type="color"
                value={catalog.settings.themeColor}
                onChange={e => setCatalog(p => ({ ...p, settings: { ...p.settings, themeColor: e.target.value } }))}
                className="h-10 w-16 rounded border p-1"
              />
            </div>
          </div>
        </section>
      )}

      {active === 'frames' && (
        <CatalogTable
          title="Frames"
          columns={[
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'pricePerMeter', label: 'Price / m', type: 'number' },
            { key: 'faceWidthCm', label: 'Face (cm)', type: 'number' },
            { key: 'color', label: 'Color', type: 'color' },
          ]}
          rows={catalog.frames}
          onChange={(idx, key, val) => {
            setCatalog(prev => {
              const next = [...prev.frames]
              const row = { ...next[idx], [key]: key === 'pricePerMeter' || key === 'faceWidthCm' ? n(val) : val }
              next[idx] = row
              return { ...prev, frames: next }
            })
          }}
          onAdd={() => setCatalog(prev => ({ ...prev, frames: [newFrame(), ...prev.frames] }))}
          onDelete={(idx) =>
            setCatalog(prev => ({ ...prev, frames: prev.frames.filter((_, i) => i !== idx) }))
          }
        />
      )}

      {active === 'mats' && (
        <CatalogTable
          title="Mats"
          note="Tip: 'mat0' is reserved for 'No mat'. Don’t delete it."
          columns={[
            { key: 'id', label: 'ID', type: 'text', readOnly: true },
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'pricePerSqM', label: 'Price / m²', type: 'number' },
            { key: 'color', label: 'Color', type: 'colorOrText' },
          ]}
          rows={catalog.mats}
          onChange={(idx, key, val) => {
            setCatalog(prev => {
              const next = [...prev.mats]
              // protect mat0 id
              if (key === 'id' && next[idx].id === 'mat0') return prev
              const value =
                key === 'pricePerSqM' ? n(val) :
                key === 'color' ? (val || 'transparent') :
                val
              next[idx] = { ...next[idx], [key]: value }
              return { ...prev, mats: next }
            })
          }}
          onAdd={() => setCatalog(prev => ({ ...prev, mats: [newMat(), ...prev.mats] }))}
          onDelete={(idx) =>
            setCatalog(prev => {
              const row = prev.mats[idx]
              if (row?.id === 'mat0') return prev // keep "No mat"
              return { ...prev, mats: prev.mats.filter((_, i) => i !== idx) }
            })
          }
        />
      )}

      {active === 'glazing' && (
        <CatalogTable
          title="Glazing"
          columns={[
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'pricePerSqM', label: 'Price / m²', type: 'number' },
          ]}
          rows={catalog.glazing}
          onChange={(idx, key, val) => {
            setCatalog(prev => {
              const next = [...prev.glazing]
              next[idx] = { ...next[idx], [key]: key === 'pricePerSqM' ? n(val) : val }
              return { ...prev, glazing: next }
            })
          }}
          onAdd={() => setCatalog(prev => ({ ...prev, glazing: [newGlazing(), ...prev.glazing] }))}
          onDelete={(idx) =>
            setCatalog(prev => ({ ...prev, glazing: prev.glazing.filter((_, i) => i !== idx) }))
          }
        />
      )}

      {active === 'print' && (
        <CatalogTable
          title="Printing Materials"
          columns={[
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'pricePerSqM', label: 'Price / m²', type: 'number' },
          ]}
          rows={catalog.printingMaterials || []}
          onChange={(idx, key, val) => {
            setCatalog(prev => {
              const list = prev.printingMaterials ? [...prev.printingMaterials] : []
              list[idx] = { ...list[idx], [key]: key === 'pricePerSqM' ? n(val) : val }
              return { ...prev, printingMaterials: list }
            })
          }}
          onAdd={() => setCatalog(prev => ({
            ...prev,
            printingMaterials: [newPrintingMaterial(), ...(prev.printingMaterials || [])]
          }))}
          onDelete={(idx) =>
            setCatalog(prev => {
              const list = prev.printingMaterials ? [...prev.printingMaterials] : []
              return { ...prev, printingMaterials: list.filter((_, i) => i !== idx) }
            })
          }
        />
      )}
    </div>
  )
}

/* -------------------------------
   Small UI helpers
---------------------------------- */

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1 border text-sm ${
        active ? 'bg-black text-white border-black' : 'bg-white hover:bg-black/5 border-slate-300'
      }`}
    >
      {label}
    </button>
  )
}

function TextInput({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}</label>
      <input
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

function NumberInput({
  label, value, onChange, step = 0.01, placeholder, help,
}: {
  label: string
  value: number
  onChange: (v: string) => void
  step?: number
  placeholder?: string
  help?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}</label>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        placeholder={placeholder}
      />
      {help && <p className="mt-1 text-xs text-slate-600">{help}</p>}
    </div>
  )
}

type Column =
  | { key: keyof Frame, label: string, type: 'text' | 'number' | 'color', readOnly?: boolean }
  | { key: keyof Mat, label: string, type: 'text' | 'number' | 'color' | 'colorOrText', readOnly?: boolean }
  | { key: keyof Glazing, label: string, type: 'text' | 'number', readOnly?: boolean }
  | { key: keyof PrintingMaterial, label: string, type: 'text' | 'number', readOnly?: boolean }

function CatalogTable<T extends Record<string, any>>({
  title, note, columns, rows, onChange, onAdd, onDelete,
}: {
  title: string
  note?: string
  columns: Column[]
  rows: T[]
  onChange: (index: number, key: string, value: any) => void
  onAdd: () => void
  onDelete: (index: number) => void
}) {
  return (
    <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <button onClick={onAdd} className="rounded border px-3 py-2 text-sm hover:bg-black hover:text-white">Add</button>
      </div>
      {note && <p className="text-xs text-slate-600">{note}</p>}
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b">
              {columns.map(col => (
                <th key={String(col.key)} className="px-3 py-2 text-left">{col.label}</th>
              ))}
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b">
                {columns.map(col => (
                  <td key={String(col.key)} className="px-3 py-1.5">
                    {col.readOnly ? (
                      <div className="text-slate-600 text-xs">{String(row[col.key] ?? '')}</div>
                    ) : col.type === 'number' ? (
                      <input
                        type="number"
                        className="w-full rounded border px-2 py-1 text-sm"
                        value={row[col.key] ?? 0}
                        onChange={e => onChange(idx, String(col.key), e.target.value)}
                      />
                    ) : col.type === 'color' ? (
                      <input
                        type="color"
                        className="h-8 w-12 rounded border"
                        value={row[col.key] || '#000000'}
                        onChange={e => onChange(idx, String(col.key), e.target.value)}
                      />
                    ) : col.type === 'colorOrText' ? (
                      <div className="flex items-center gap-2">
                        <input
                          className="w-full rounded border px-2 py-1 text-sm"
                          value={row[col.key] ?? ''}
                          onChange={e => onChange(idx, String(col.key), e.target.value)}
                          placeholder="hex (e.g. #EFEDE6) or 'transparent'"
                        />
                      </div>
                    ) : (
                      <input
                        className="w-full rounded border px-2 py-1 text-sm"
                        value={row[col.key] ?? ''}
                        onChange={e => onChange(idx, String(col.key), e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right">
                  <button
                    onClick={() => onDelete(idx)}
                    className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td className="px-3 py-6 text-slate-500" colSpan={columns.length + 1}>No rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* utils */
async function fileToDataUrl(file: File): Promise<string> {
  const b = await file.arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(b)))
  return `data:${file.type};base64,${base64}`
}
