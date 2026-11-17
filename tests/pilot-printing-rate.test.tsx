import React from 'react'
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useCatalog, type Catalog } from '@/lib/store'
import Admin from '@/pages/Admin'

const state = vi.hoisted(() => ({ catalog: null as Catalog | null }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === 'company_settings'
        ? { settings: { currencyCode: 'ZAR', currencySymbol: 'R', taxRatePct: 15 } }
        : state.catalog ? { catalog: structuredClone(state.catalog), revision: 1 } : null, error: null }),
    }
    return query
  },
  rpc: async (name: string, args: { p_catalog: Catalog }) => {
    if (name !== 'update_company_catalog') throw new Error(`Unexpected RPC ${name}`)
    state.catalog = structuredClone(args.p_catalog)
    return { data: { catalog: state.catalog, revision: 2 }, error: null }
  },
} }))
const access: BillingAccess = { companyAccountId: 'pilot-company', userId: 'pilot-owner', readOnly: false,
  hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '' }
const Wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={access}>{children}</BillingAccessProvider>
beforeEach(() => { localStorage.clear(); state.catalog = null })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it.each([0, 7, undefined])('edits canonical printing rate %s without promoting purchase cost, and retains it on reload', async canonical => {
  const initial = renderHook(useCatalog, { wrapper: Wrapper })
  await waitFor(() => expect(initial.result.current.loading).toBe(false))
  state.catalog = { ...initial.result.current.catalog, printingMaterials: [
    { id: 'print', name: 'Pilot paper', pricePerSqM: canonical, costPerSqm: 99 } as Catalog['printingMaterials'][number],
  ] }
  initial.unmount()
  const view = render(<Admin />, { wrapper: Wrapper })
  await screen.findByRole('heading', { name: 'Settings' })
  fireEvent.click(screen.getByRole('button', { name: 'Printing' }))
  const row = (await screen.findByDisplayValue('Pilot paper')).closest('tr')!
  const rate = within(row).getAllByRole('spinbutton')[0] as HTMLInputElement
  expect(rate.value).toBe(String(canonical ?? ''))
  fireEvent.change(rate, { target: { value: '25' } })
  await waitFor(() => expect(state.catalog!.printingMaterials[0]).toMatchObject({ pricePerSqM: 25, costPerSqm: 99 }))
  view.unmount()
  const reader = renderHook(useCatalog, { wrapper: Wrapper })
  await waitFor(() => expect(reader.result.current.catalog.printingMaterials[0]?.pricePerSqM).toBe(25))
})
