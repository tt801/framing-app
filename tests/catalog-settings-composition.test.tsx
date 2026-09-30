import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const { settingsRows, catalogRows, pending, supabaseMock } = vi.hoisted(() => {
  const settingsRows = new Map<string, Record<string, unknown>>()
  const catalogRows = new Map<string, Record<string, unknown>>()
  const pending = new Map<string, (value: unknown) => void>()
  const supabaseMock = {
    rpc: vi.fn(async (name: string, args: { p_company_account_id: string; p_catalog: Record<string, unknown> }) => {
      if (name !== 'update_company_catalog') throw new Error(`Unexpected RPC: ${name}`)
      catalogRows.set(args.p_company_account_id, args.p_catalog)
      return { data: { catalog: args.p_catalog, revision: 2 }, error: null }
    }),
    from: vi.fn((table: string) => {
      let company = ''
      let saved: Record<string, unknown> | null = null
      const query = {
        select: () => query,
        eq: (_field: string, value: string) => { company = value; return query },
        upsert: (row: Record<string, unknown>) => { saved = row; return query },
        single: async () => {
          if (table !== 'company_settings' || !saved) throw new Error(`Unexpected write: ${table}`)
          settingsRows.set(String(saved.company_account_id), saved.settings as Record<string, unknown>)
          return { data: saved, error: null }
        },
        maybeSingle: () => {
          if (table !== 'company_settings' && table !== 'company_catalog') throw new Error(`Unexpected read: ${table}`)
          const key = `${table}:${company}`
          if (company === 'company-b') return new Promise(resolve => { pending.set(key, resolve) })
          const row = table === 'company_settings'
            ? settingsRows.has(company) ? { settings: settingsRows.get(company) } : null
            : catalogRows.has(company) ? { catalog: catalogRows.get(company), revision: 1 } : null
          return Promise.resolve({ data: row, error: null })
        },
      }
      return query
    }),
  }
  return { settingsRows, catalogRows, pending, supabaseMock }
})
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))
import { useCatalog, type Catalog } from '@/lib/store'

let company = 'company-a'
const access = (id: string): BillingAccess => ({ readOnly: false, hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '', companyAccountId: id, companyName: id, userId: 'user' })
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access(company)}>{children}</BillingAccessProvider>
beforeEach(() => { company = 'company-a'; settingsRows.clear(); catalogRows.clear(); pending.clear(); localStorage.clear() })

describe('company-scoped catalog settings used by Visualizer pricing', () => {
  it('retains catalog pricing defaults when the company profile has only identity fields', async () => {
    settingsRows.set('company-a', { companyName: 'A Frames' })
    const { result } = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.settingsLoading).toBe(false))
    const settings = result.current.catalog.settings
    expect(settings).toMatchObject({ companyName: 'A Frames', unit: 'metric', labourBase: 120, printingPerSqM: 180, marginMultiplier: 1.25, themeColor: '#0F172A' })
    expect(Number(settings.labourBase) * Number(settings.marginMultiplier)).toBe(150)
  })

  it('preserves persisted custom pricing after save and remount, overlaid with authoritative company details', async () => {
    catalogRows.set('company-a', { frames: [], mats: [], glazing: [], settings: { labourBase: 220, printingPerSqM: 240, marginMultiplier: 1.6, themeColor: '#abcdef', companyName: 'Stale' } })
    settingsRows.set('company-a', { companyName: 'Authoritative', labourBase: 315, marginMultiplier: 1.8 })
    const first = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(first.result.current.catalog.settings.companyName).toBe('Authoritative'))
    expect(first.result.current.catalog.settings).toMatchObject({ labourBase: 315, printingPerSqM: 240, marginMultiplier: 1.8, themeColor: '#abcdef' })
    const saved = await first.result.current.saveSettings({ labourBase: 325, printingPerSqM: 260 })
    expect(saved.ok).toBe(true)
    await waitFor(() => expect(first.result.current.catalog.settings.labourBase).toBe(325))
    first.unmount()
    const second = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(second.result.current.catalog.settings.labourBase).toBe(325))
    expect(second.result.current.catalog.settings).toMatchObject({ companyName: 'Authoritative', printingPerSqM: 260, marginMultiplier: 1.8 })
  })

  it('keeps stored catalog pricing when changing products and reloading', async () => {
    catalogRows.set('company-a', { frames: [], mats: [], glazing: [], settings: { labourBase: 275, printingPerSqM: 330 } })
    const first = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(first.result.current.catalog.settings.labourBase).toBe(275))
    const saved = await first.result.current.setCatalog(prev => ({ ...prev, frames: [{ id: 'frame-a', name: 'Frame A', pricePerMeter: 10, faceWidthCm: 2, color: '#000' }] }))
    expect(saved.ok).toBe(true)
    first.unmount()
    const second = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(second.result.current.catalog.frames[0]?.id).toBe('frame-a'))
    expect(second.result.current.catalog.settings).toMatchObject({ labourBase: 275, printingPerSqM: 330 })
  })

  it('persists a settings-only catalog pricing change without writing to another company', async () => {
    catalogRows.set('company-a', { frames: [], mats: [], glazing: [], settings: { labourBase: 200, printingPerSqM: 260 } })
    catalogRows.set('company-b', { frames: [], mats: [], glazing: [], settings: { labourBase: 900 } })
    const first = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(first.result.current.catalog.settings.labourBase).toBe(200))
    const saved = await first.result.current.setCatalog((prev: Catalog) => ({ ...prev, settings: { ...prev.settings, labourBase: 275 } }))
    expect(saved).toMatchObject({ ok: true })
    expect(saved).not.toHaveProperty('unchanged', true)
    expect(catalogRows.get('company-a')?.settings).toMatchObject({ labourBase: 275 })
    expect(catalogRows.get('company-b')?.settings).toMatchObject({ labourBase: 900 })
    first.unmount()
    const second = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(second.result.current.catalog.settings.labourBase).toBe(275))
  })

  it('does not show prior-company profile or catalog settings during a company switch or after a late response', async () => {
    settingsRows.set('company-a', { companyName: 'Secret A', labourBase: 999 })
    catalogRows.set('company-a', { frames: [], mats: [], glazing: [], settings: { printingPerSqM: 777 } })
    const { result, rerender } = renderHook(() => useCatalog(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.catalog.settings.labourBase).toBe(999))
    await waitFor(() => expect(result.current.catalog.settings.printingPerSqM).toBe(777))
    company = 'company-b'
    rerender()
    expect(result.current.catalog.settings.companyName).not.toBe('Secret A')
    expect(result.current.catalog.settings.labourBase).not.toBe(999)
    expect(result.current.catalog.settings.printingPerSqM).not.toBe(777)
    await waitFor(() => expect(pending.has('company_settings:company-b') && pending.has('company_catalog:company-b')).toBe(true))
    await act(async () => {
      pending.get('company_settings:company-b')?.({ data: { settings: { companyName: 'B Frames', labourBase: 450 } }, error: null })
      pending.get('company_catalog:company-b')?.({ data: null, error: null })
    })
    await waitFor(() => expect(result.current.catalog.settings).toMatchObject({ companyName: 'B Frames', labourBase: 450, printingPerSqM: 180 }))
  })
})
