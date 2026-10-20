import React from 'react'
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useCatalog, type Catalog } from '@/lib/store'
import { priceVisualiser } from '@/lib/pricing'
import Admin from '@/pages/Admin'

const state = vi.hoisted(() => ({ catalog: null as Catalog | null }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    let saved: { catalog: Catalog } | undefined
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === 'company_settings'
        ? { settings: { companyName: 'UAT Frames', currencyCode: 'GBP', currencySymbol: '£', taxRatePct: 15 } }
        : state.catalog ? { catalog: structuredClone(state.catalog), revision: 1 } : null, error: null }),
      insert: (row: { catalog: Catalog }) => { saved = row; return query },
      single: async () => { state.catalog = structuredClone(saved!.catalog); return { data: { catalog: state.catalog, revision: 1 }, error: null } },
    }
    return query
  },
  rpc: async (name: string, args: { p_catalog: Catalog }) => {
    if (name !== 'update_company_catalog') throw new Error(`Unexpected RPC ${name}`)
    state.catalog = structuredClone(args.p_catalog)
    return { data: { catalog: state.catalog, revision: 2 }, error: null }
  },
} }))
const access: BillingAccess = { companyAccountId: 'company-a', userId: 'owner-a', companyName: 'UAT Frames', readOnly: false,
  hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '' }
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access}>{children}</BillingAccessProvider>
beforeEach(() => { localStorage.clear(); state.catalog = null })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('carries a manually Admin-created £8/m² glazing through persistence/reload into the £2 selling line', async () => {
  const view = render(<Admin />, { wrapper: Wrapper })
  await screen.findByRole('heading', { name: 'Settings' })
  fireEvent.click(screen.getByRole('button', { name: 'Glazing' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add glazing' }))
  await screen.findByDisplayValue('New glazing')
  const row = screen.getByDisplayValue('New glazing').closest('tr')!
  // The first numeric control is the manual material rate, not the unused markup field.
  fireEvent.change(within(row).getAllByRole('spinbutton')[0], { target: { value: '8' } })
  await waitFor(() => expect(state.catalog!.glazing[0].pricePerSqM).toBe(8))
  expect(state.catalog!.glazing[0]).not.toHaveProperty('costPerSqm')
  view.unmount()
  const reader = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.catalog.glazing[0]?.pricePerSqM).toBe(8))
  const catalog = reader.result.current.catalog
  const snapshot = priceVisualiser({ artWcm: 40, artHcm: 30, borderCm: 5,
    frame: { id: 'f', name: 'UAT Frame', pricePerMeter: 10 }, mats: [{ id: 'm', name: 'UAT Mat', pricePerSqM: 5 }],
    glazing: catalog.glazing[0], print: null, backer: null, labourBase: catalog.settings.labourBase,
    marginMultiplier: catalog.settings.marginMultiplier, taxRatePct: catalog.settings.taxRatePct,
    currencyCode: catalog.settings.currencyCode, currencySymbol: catalog.settings.currencySymbol, taxLabel: catalog.settings.taxLabel })
  expect(snapshot.items.find(line => line.key === 'glazing')).toMatchObject({ rawAmount: 1.6, lineTotal: 2 })
  expect(snapshot).toMatchObject({ subtotal: 175.75, tax: 26.36, total: 202.11 })
})

it.each([0, 7, undefined])('preserves canonical rate %s without promoting or overwriting historical cost metadata', async canonical => {
  const initial = renderHook(() => useCatalog(), { wrapper: Wrapper })
  await waitFor(() => expect(initial.result.current.loading).toBe(false))
  state.catalog = { ...initial.result.current.catalog, glazing: [{ id: 'g', name: 'Existing', pricePerSqM: canonical, costPerSqm: 3 } as Catalog['glazing'][number]] }
  initial.unmount()
  render(<Admin />, { wrapper: Wrapper })
  await screen.findByRole('heading', { name: 'Settings' })
  fireEvent.click(screen.getByRole('button', { name: 'Glazing' }))
  const row = (await screen.findByDisplayValue('Existing')).closest('tr')!
  const rate = within(row).getAllByRole('spinbutton')[0] as HTMLInputElement
  expect(rate.value).toBe(String(canonical ?? ''))
  fireEvent.change(rate, { target: { value: '8' } })
  await waitFor(() => expect(state.catalog!.glazing[0]).toMatchObject({ pricePerSqM: 8, costPerSqm: 3 }))
})
