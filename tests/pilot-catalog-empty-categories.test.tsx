import React from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'
import { useCatalog } from '@/lib/store'

const state = vi.hoisted(() => ({ profile: {} as Record<string, unknown>, catalog: { frames: [], mats: [], glazing: [], printingMaterials: [], backers: [], settings: {} } as Record<string, unknown> }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === 'company_settings'
      ? { settings: { currencyCode: 'ZAR', taxRatePct: 15, ...state.profile } }
      : { catalog: structuredClone(state.catalog), revision: 1 }, error: null }) }
    return query
  },
  rpc: async (name: string, args: { p_catalog: Record<string, unknown> }) => {
    if (name !== 'update_company_catalog') throw new Error('Unexpected RPC')
    state.catalog = structuredClone(args.p_catalog)
    return { data: { catalog: state.catalog, revision: 2 }, error: null }
  },
} }))
const billing: BillingAccess = { companyAccountId: 'pilot', userId: 'owner', readOnly: false, hasFullAccess: true,
  canUsePremiumFeatures: true, isFounder: false, isPastDue: false, statusMessage: '' }
const wrapper = ({ children }: { children: React.ReactNode }) => <BillingAccessProvider value={billing}>{children}</BillingAccessProvider>
afterEach(cleanup)
beforeEach(() => {
  state.profile = {}
  state.catalog = { frames: [], mats: [], glazing: [], printingMaterials: [], backers: [], settings: {} }
})
it.each(['printingPerSqM', 'foamBackerPerSqM', 'labourBase', 'marginMultiplier'])('does not hide explicitly invalid or zero company %s behind catalogue defaults', async key => {
  state.profile = { [key]: '' }
  const hook = renderHook(useCatalog, { wrapper })
  await waitFor(() => expect(hook.result.current.loading || hook.result.current.settingsLoading).toBe(false))
  expect(hook.result.current.catalog.settings[key]).toBe('')
  hook.unmount()
  state.profile = { [key]: 0 }
  const reload = renderHook(useCatalog, { wrapper })
  await waitFor(() => expect(reload.result.current.loading || reload.result.current.settingsLoading).toBe(false))
  expect(reload.result.current.catalog.settings[key]).toBe(0)
})
it.each(['', null, -1, '12'])('preserves invalid legacy foam rate %s for validation rather than coercing it to free', async rate => {
  state.catalog = { frames: [], mats: [], glazing: [], printingMaterials: [], backers: [], settings: { foamBackerPerSqM: rate } }
  const hook = renderHook(useCatalog, { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(hook.result.current.catalog.settings.foamBackerPerSqM).toBe(rate)
})
it('does not manufacture a printing or foam material rate in a persisted catalogue with absent rates', async () => {
  state.catalog = { frames: [], mats: [], glazing: [], printingMaterials: [], backers: [], settings: {} }
  const hook = renderHook(useCatalog, { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(hook.result.current.catalog.settings.printingPerSqM).toBeUndefined()
  expect(hook.result.current.catalog.settings.foamBackerPerSqM).toBeUndefined()
})
it('keeps intentional empty categories through read, save and remount without sample products', async () => {
  const hook = renderHook(useCatalog, { wrapper })
  await waitFor(() => expect(hook.result.current.loading || hook.result.current.settingsLoading).toBe(false))
  const check = (catalog: ReturnType<typeof useCatalog>['catalog']) => {
    for (const key of ['frames', 'glazing', 'printingMaterials', 'backers'] as const) expect(catalog[key]).toEqual([])
    // The supported None sentinel is not a sample mat or a chargeable product.
    expect(catalog.mats.map(mat => mat.id)).toEqual(['mat0'])
  }
  check(hook.result.current.catalog)
  await act(async () => {
    expect((await hook.result.current.setCatalog(previous => ({ ...previous, settings: { ...previous.settings, marginMultiplier: 2 } }))).ok).toBe(true)
  })
  hook.unmount()
  const reload = renderHook(useCatalog, { wrapper })
  await waitFor(() => expect(reload.result.current.loading).toBe(false))
  check(reload.result.current.catalog)
})
