import React from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import VisualizerApp from '@/VisualizerApp'
import { useToast } from '@/lib/toast'
import type { Catalog } from '@/lib/store'
import type { CommercialSnapshot, toVisualiserQuote, toVisualiserInvoice } from '@/lib/pricing'
import type { Quote } from '@/lib/quotes'
import type { Job } from '@/lib/jobs'
import type { Invoice } from '@/lib/invoices'
import { exportQuotePDF } from '@/lib/pdf/quotePdf'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
import { exportJobCardPDF } from '@/lib/pdf/jobCardPdf'
import { invoiceFromQuote } from '@/lib/commercialDocuments'
import { jobSpecificationFields } from '@/lib/jobSpecification'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

type CapturedQuote = Omit<Partial<Quote>, 'items'> & ReturnType<typeof toVisualiserQuote> & {
  jobSpecification: { details: Record<string, unknown> }
}
type CapturedJob = Partial<Job> & { details: Record<string, unknown>; pricingSnapshot: CommercialSnapshot }
type CapturedInvoice = Partial<Invoice> & ReturnType<typeof toVisualiserInvoice>
type PresetProps = {
  currentState: Record<string, unknown>
  onApply: (preset: { state: Record<string, unknown> }) => void
}

const state = vi.hoisted(() => ({ catalog: null as Catalog | null, preset: {} as Record<string, unknown>, current: {} as Record<string, unknown>,
  quotes: [] as CapturedQuote[], jobs: [] as CapturedJob[], invoices: [] as CapturedInvoice[], supplierProducts: [] as object[] }))
vi.mock('@/lib/store', () => ({ useCatalog: () => ({ catalog: state.catalog, loading: false, settingsLoading: false }) }))
vi.mock('@/lib/quotes', () => ({ useQuotes: () => ({ quotes: [], add: async (payload: CapturedQuote) => { state.quotes.push(payload); return { ok: true, quote: payload } } }) }))
vi.mock('@/lib/jobs', () => ({ useJobs: () => ({ add: async (payload: CapturedJob) => { state.jobs.push(payload); return { ok: true, job: { ...payload, id: 'j' } } } }) }))
vi.mock('@/lib/invoices', () => ({ useInvoices: () => ({ addInvoice: async (payload: CapturedInvoice) => { state.invoices.push(payload); return { ok: true, invoice: { ...payload, id: 'i' } } } }) }))
const customers = [{ id: 'c', firstName: 'Test', lastName: 'Customer', email: 'test@example.invalid' }]
vi.mock('@/lib/customers', async original => ({ ...await original<typeof import('@/lib/customers')>(), useCustomers: () => ({ customers, add: vi.fn() }) }))
vi.mock('@/lib/layout', () => ({ useLayout: () => ({ layoutMode: 'fixed' }) }))
vi.mock('@/lib/billingAccess', () => ({ useBillingAccess: () => ({ readOnly: false }) }))
vi.mock('@/components/RoomMockup', () => ({ default: () => null }))
vi.mock('@/components/PresetControls', () => ({ default: ({ currentState, onApply }: PresetProps) => {
  state.current = currentState
  return <button onClick={() => onApply({ state: state.preset })}>Apply test preset</button>
} }))
vi.mock('@/lib/effectiveSupplierAccess', () => ({ useEffectiveCompanyCatalogue: () => ({ supplierProducts: state.supplierProducts, selectionIssue: () => null }) }))
beforeEach(() => {
  state.quotes = []; state.jobs = []; state.invoices = []; state.preset = {}; state.supplierProducts = []; window.location.hash = ''
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  state.catalog = { frames: [{ id: 'f', name: 'Oak', pricePerMeter: 10, faceWidthCm: 2 }],
    mats: [{ id: 'mat0', name: 'No mat', pricePerSqM: 0 }, { id: 'm', name: 'White mat', pricePerSqM: 5 }],
    glazing: [{ id: 'g', name: 'UV glass', pricePerSqM: 8 }], printingMaterials: [{ id: 'p', name: 'Rag paper', pricePerSqM: 50 }],
    backers: [{ id: 'b1', name: 'MDF', pricePerSqM: 20 }, { id: 'b2', name: 'Conservation board', pricePerSqM: 40 }],
    settings: { currencyCode: 'GBP', currencySymbol: '£', marginMultiplier: 1.25, labourBase: 10, printingPerSqM: 100, foamBackerPerSqM: 15, taxRatePct: 20, taxLabel: 'VAT' } } as Catalog
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const toast of useToast.getState().toasts) useToast.getState().remove(toast.id) })
const apply = () => fireEvent.click(screen.getByRole('button', { name: 'Apply test preset' }))
const create = async () => {
  fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'c' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Quote + Invoice + Job' }))
  await waitFor(() => expect(state.invoices).toHaveLength(1))
}
const fullPreset = () => ({ frame: { id: 'f' }, mats: { selectedMat1: 'm', mat1BorderCm: 5 }, glazing: { id: 'g' },
  printing: { includePrint: true, printMaterialId: 'p' }, backer: { includeBacker: true, materialId: 'b2' } })

it('does not render discovered supplier products or their technical status', () => {
  state.supplierProducts = [{ id: 'supplier:test', name: 'Synthetic discovery product', supplierName: 'Synthetic supplier',
    lifecycle: 'active', availability: 'unknown', visibleForNewSelection: false, commerciallySelectable: false }]
  render(<VisualizerApp />)
  expect(document.body.textContent).not.toMatch(/Supplier catalogue|discovery only|not priceable|Synthetic discovery product|Synthetic supplier/)
})

it.each(['frame', 'mat', 'glazing', 'printing', 'backer'])(
  'preserves a saved supplier %s reference as a disabled neutral option without substitution', category => {
    const id = 'supplier:00000000-0000-0000-0000-000000000003'
    const product = { id, name: 'Unpriceable supplier product', pricePerMeter: 99, pricePerSqM: 99, faceWidthCm: 2 }
    const lists = { frame: state.catalog!.frames, mat: state.catalog!.mats, glazing: state.catalog!.glazing,
      printing: state.catalog!.printingMaterials!, backer: state.catalog!.backers! }
    lists[category as keyof typeof lists].push(product)
    render(<VisualizerApp />)
    expect(screen.queryByRole('option', { name: 'Unpriceable supplier product' })).toBeNull()
    state.preset = category === 'mat' ? { mats: { selectedMat1: id } } : category === 'printing'
      ? { printing: { includePrint: true, printMaterialId: id } } : category === 'backer'
      ? { backer: { includeBacker: true, materialId: id } } : { [category]: { id } }
    apply()
    const option = screen.getByRole('option', { name: /Unavailable/ }) as HTMLOptionElement
    expect(option.disabled).toBe(true)
    expect(option.selected).toBe(true)
    expect((option.parentElement as HTMLSelectElement).value).toBe(id)
    expect(document.body.textContent).not.toMatch(/not priceable|Supplier reference|Unpriceable supplier product/)
    fireEvent.click(screen.getByRole('button', { name: 'Create Quote + Invoice + Job' }))
    expect(state.quotes).toHaveLength(0); expect(state.invoices).toHaveLength(0); expect(state.jobs).toHaveLength(0)
  })

it.each([0, 1, 2, 3, 4, 5, 6, 7])('reconciles every displayed selling component, subtotal and tax for mat mask %s', async mask => {
  // Fractional rates exercise the engine's rounding allocation, including labour.
  state.catalog!.settings.marginMultiplier = 1.0625
  state.catalog!.settings.labourBase = 10.123
  state.catalog!.frames[0].pricePerMeter = 10.019
  state.catalog!.mats.push({ id: 'm2', name: 'Blue mat', pricePerSqM: 11.111 }, { id: 'm3', name: 'Red mat', pricePerSqM: 17.777 })
  render(<VisualizerApp />)
  state.preset = { ...fullPreset(), mats: { selectedMat1: mask & 1 ? 'm' : 'mat0', selectedMat2: mask & 2 ? 'm2' : 'mat0',
    selectedMat3: mask & 4 ? 'm3' : 'mat0', mat1BorderCm: 5, mat2BorderCm: 2, mat3BorderCm: 1 } }
  apply()
  await create()
  const snapshot = state.quotes[0].pricingSnapshot!
  const format = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP' }).format(n)
  const shown = (label: string) => screen.getByText(label, { selector: 'span' }).nextElementSibling!.textContent!
  let matIndex = 0
  const rows: Array<[string, string]> = [['Frame', 'frame'], ['Glazing', 'glazing'],
    ...[1, 2, 3].filter(slot => mask & (1 << (slot - 1))).map(slot => [`Mat ${slot}`, `mat${++matIndex}`] as [string, string]),
    ['Printing', 'print'], ['Backer', 'backer'], ['Labour', 'labour']]
  let displayedCents = 0
  for (const [label, key] of rows) {
    const amount = shown(label)
    expect(amount).toBe(format(snapshot.items.find(line => line.key === key)!.lineTotal))
    displayedCents += Math.round(Number(amount.replace(/[^0-9.-]/g, '')) * 100)
  }
  expect(displayedCents).toBe(Math.round(snapshot.subtotal * 100))
  expect(shown('Subtotal')).toBe(format(snapshot.subtotal))
  expect(shown('Tax')).toBe(format(snapshot.tax))
  expect(shown('Total')).toBe(format(snapshot.total))
  expect(Math.round(snapshot.subtotal * 100) + Math.round(snapshot.tax * 100)).toBe(Math.round(snapshot.total * 100))
  expect(state.jobs[0].details.internalCosts).toBeTruthy()
})

it('displays the 400 × 300 mm backing selling amount of £12.00 without changing its saved base amount', async () => {
  state.catalog.backers[0].pricePerSqM = 80
  render(<VisualizerApp />)
  state.preset = { backer: { includeBacker: true, materialId: 'b1' } }; apply()
  expect(screen.getByText('Backer').parentElement!.textContent).toBe('Backer£12.00')
  await create()
  expect(state.quotes[0].pricingSnapshot.items.find((line: CommercialSnapshot['items'][number]) => line.key === 'backer')).toMatchObject({
    qty: 0.12, rawAmount: 9.6, unitPrice: 100, lineTotal: 12,
  })
  expect(state.jobs[0].details.internalCosts).toMatchObject({ backerCost: 9.6, labourBase: 10 })
  expect(screen.getByText('Labour', { selector: 'span' }).nextElementSibling!.textContent).toBe('£12.50')
})

it('selects configured backing and carries all five material rates, identities and quantities to every creation route', async () => {
  render(<VisualizerApp />)
  state.preset = fullPreset(); apply()
  expect((screen.getByLabelText('Backing material') as HTMLSelectElement).value).toBe('b2')
  expect(state.current.backer).toEqual({ includeBacker: true, materialId: 'b2' })
  fireEvent.change(screen.getByLabelText('Backing material'), { target: { value: 'b1' } })
  fireEvent.change(screen.getByLabelText('Backing material'), { target: { value: 'b2' } })
  await create()
  const snapshot: CommercialSnapshot = state.quotes[0].pricingSnapshot
  expect(snapshot).toEqual(state.jobs[0].pricingSnapshot)
  expect(snapshot).toEqual(state.invoices[0].pricingSnapshot)
  for (const [key, productId, qty, unitPrice] of [['frame', 'f', 1.8, 12.5], ['mat1', 'm', 0.2, 6.25], ['glazing', 'g', 0.2, 10], ['print', 'p', 0.12, 62.5], ['backer', 'b2', 0.2, 50]] as const)
    expect(snapshot.items.find(line => line.key === key)).toMatchObject({ productId, qty, unitPrice })
  expect(state.jobs[0].details.backer).toMatchObject({ include: true, materialId: 'b2', materialName: 'Conservation board' })
  expect(state.quotes[0].jobSpecification.details.backer).toEqual(state.jobs[0].details.backer)
  for (const document of [state.quotes[0], state.invoices[0]])
    expect(document.items.find(item => item.productId === 'b2')).toMatchObject({ qty: 0.2, unitPrice: 50, total: 10 })
})

it('preserves an old foam-only preset as legacy foam even when configured boards exist', async () => {
  render(<VisualizerApp />)
  state.preset = { backer: { includeBacker: true } }; apply()
  expect((screen.getByLabelText('Backing material') as HTMLSelectElement).value).toBe('__legacy_foam__')
  await create()
  expect(state.jobs[0].details.backer).toMatchObject({ materialId: '__legacy_foam__', materialName: 'Foam board backer (legacy)' })
  expect(state.invoices[0].pricingSnapshot.items.find(item => item.key === 'backer')).toMatchObject({ productId: '__legacy_foam__', qty: 0.12, unitPrice: 18.75 })
})

it('uses the selected backing on individual Quote, Job and Invoice actions and preset round trips', async () => {
  const view = render(<VisualizerApp />)
  state.preset = fullPreset(); apply()
  fireEvent.change(screen.getByLabelText('Backing material'), { target: { value: 'b1' } })
  const savedPreset = JSON.parse(JSON.stringify(state.current))
  view.unmount()
  render(<VisualizerApp />)
  state.preset = savedPreset; apply()
  expect((screen.getByLabelText('Backing material') as HTMLSelectElement).value).toBe('b1')
  fireEvent.change(screen.getByText('Existing customer').parentElement!.querySelector('select')!, { target: { value: 'c' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
  await waitFor(() => expect(state.quotes).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'Add to Jobs' }))
  await waitFor(() => expect(state.jobs).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'Add to Invoices' }))
  await waitFor(() => expect(state.invoices).toHaveLength(1))
  for (const doc of [state.quotes[0], state.jobs[0], state.invoices[0]])
    expect(doc.pricingSnapshot.items.find(line => line.key === 'backer')).toMatchObject({ productId: 'b1', description: 'MDF', qty: 0.2, unitPrice: 25, lineTotal: 5 })
})

it.each(['printing', 'backer'])('accepts an explicit zero %s fallback without substituting a configured product', async category => {
  state.catalog.settings.printingPerSqM = 0; state.catalog.settings.foamBackerPerSqM = 0
  render(<VisualizerApp />)
  state.preset = category === 'printing' ? { printing: { includePrint: true } } : { backer: { includeBacker: true } }; apply()
  expect(screen.queryByRole('alert')).toBeNull()
  await create()
  expect(state.invoices[0].pricingSnapshot.items.find(line => line.key === (category === 'printing' ? 'print' : 'backer'))).toMatchObject({ lineTotal: 0 })
})

it('prints the saved backing identity and selling agreement after catalogue/settings changes and Quote conversion', async () => {
  render(<VisualizerApp />)
  state.preset = fullPreset(); apply(); await create()
  const quote = JSON.parse(JSON.stringify(state.quotes[0]))
  const job = JSON.parse(JSON.stringify(state.jobs[0]))
  const invoice = JSON.parse(JSON.stringify(state.invoices[0]))
  const before = JSON.stringify({ quote, job, invoice })
  state.catalog.backers = []; state.catalog.printingMaterials = []
  state.catalog.settings.marginMultiplier = 9; state.catalog.settings.taxRatePct = 0
  expect(jobSpecificationFields(job).find(field => field.label === 'Foam/backer')?.value).toContain('Conservation board')
  expect(jobSpecificationFields(job).find(field => field.label === 'Printing')?.value).toContain('Rag paper')
  const converted = invoiceFromQuote(quote)
  expect(converted.items.find(item => item.productId === 'b2')).toMatchObject({ qty: 0.2, unitPrice: 50, total: 10 })
  expect(converted.pricingSnapshot).toEqual(quote.pricingSnapshot)
  const settings = { companyName: 'Test Frames', currencyCode: 'USD', taxRatePct: 0 }
  const docs = [await exportQuotePDF({ quote: { ...quote, dateISO: '2026-01-01' }, customer: {}, settings, download: false }),
    await exportInvoicePDF({ invoice: { ...invoice, id: 'i', number: 'INV-1' }, settings, download: false }),
    await exportInvoicePDF({ invoice: { ...converted, id: 'i2', number: 'INV-2' }, settings, download: false }),
    await exportJobCardPDF({ job, settings, download: false })]
  for (const [index, doc] of docs.entries()) {
    const parsed = await pdfjs.getDocument({ data: new Uint8Array(doc.output('arraybuffer')) }).promise
    let text = ''
    for (let page = 1; page <= parsed.numPages; page++)
      text += (await (await parsed.getPage(page)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')
    await parsed.destroy()
    expect(text).toContain('Conservation board')
    expect(text).toContain('Rag paper')
    if (index < 3) for (const expected of ['0.2 m²', '£50.00/m²', '£10.00', 'VAT (20.00%)']) expect(text).toContain(expected)
    expect(text).not.toContain('$')
  }
  expect(JSON.stringify({ quote, job, invoice })).toBe(before)
})

it.each(['f', 'm', 'g', 'p', 'b2'])('accepts explicitly zero-priced %s without additional flags', async id => {
  const products = [...state.catalog.frames, ...state.catalog.mats, ...state.catalog.glazing, ...state.catalog.printingMaterials, ...state.catalog.backers]
  const product = products.find(item => item.id === id)!
  Object.assign(product, { pricePerMeter: 0, pricePerSqM: 0, costPerSqm: 99 })
  render(<VisualizerApp />)
  state.preset = fullPreset(); apply()
  expect(screen.queryByRole('alert')).toBeNull()
  await create()
  expect(state.quotes[0].pricingSnapshot.items.find((line: CommercialSnapshot['items'][number]) => line.productId === id)).toMatchObject({ lineTotal: 0, unitPrice: 0 })
})

it.each(['frame', 'mat', 'glazing', 'printing', 'backer'])('does not silently substitute a deleted %s preset selection', category => {
  render(<VisualizerApp />)
  state.preset = fullPreset()
  const section = category === 'mat' ? 'mats' : category
  state.preset[section] = category === 'mat' ? { selectedMat1: 'deleted' } : category === 'printing'
    ? { includePrint: true, printMaterialId: 'deleted' } : category === 'backer'
      ? { includeBacker: true, materialId: 'deleted' } : { id: 'deleted' }
  apply()
  expect(screen.getByRole('alert').textContent).toMatch(/select|unavailable/i)
  const unavailable = screen.getByRole('option', { name: /Unavailable/ }) as HTMLOptionElement
  expect((unavailable.parentElement as HTMLSelectElement).value).toBe('deleted')
  fireEvent.click(screen.getByRole('button', { name: 'Create Quote + Invoice + Job' }))
  expect(state.quotes).toHaveLength(0); expect(state.jobs).toHaveLength(0); expect(state.invoices).toHaveLength(0)
})

it('blocks a supplier backing reference even with injected positive pricing and no discovery-hook warning', () => {
  const supplierId = 'supplier:00000000-0000-0000-0000-000000000003'
  state.catalog.backers.push({ id: supplierId, name: 'Injected supplier', pricePerSqM: 20 })
  render(<VisualizerApp />)
  state.preset = { backer: { includeBacker: true, materialId: supplierId } }; apply()
  fireEvent.click(screen.getByRole('button', { name: 'Create Quote + Invoice + Job' }))
  expect(screen.getByRole('alert').textContent).toBe('Pricing is unavailable for this selection. Please choose another material or ask a staff member.')
  expect(state.invoices).toHaveLength(0)
})

it('keeps selectors and pricing customer-safe while preserving sub-cent rates internally', async () => {
  state.catalog.settings.marginMultiplier = 1.0625
  state.catalog.printingMaterials[0].pricePerSqM = 0.00390625
  render(<VisualizerApp />)
  state.preset = fullPreset(); apply()
  expect(screen.getByRole('option', { name: 'Rag paper' }).textContent).toBe('Rag paper')
  expect(document.body.textContent).not.toMatch(/base (?:cost|rate|amount)|purchase cost|multiplier|markup|margin|Admin currency|0\.00390625|0\.004150390625|1\.0625/i)
  expect(screen.getByText('Currency: GBP')).toBeTruthy()
  await create()
  expect(state.quotes[0].pricingSnapshot!.items.find((line: CommercialSnapshot['items'][number]) => line.key === 'print')!.unitPrice).toBe(0.004150390625)
})

it.each(['frame', 'glazing', 'mat', 'printing', 'backing', 'labour', 'multiplier', 'tax'])(
  'does not disclose internal configuration for invalid %s pricing, including action feedback', async kind => {
    if (kind === 'frame') state.catalog!.frames[0].pricePerMeter = NaN
    if (kind === 'glazing') state.catalog!.glazing[0].pricePerSqM = -1
    if (kind === 'mat') state.catalog!.mats[1].pricePerSqM = undefined
    if (kind === 'printing') state.catalog!.printingMaterials![0].pricePerSqM = NaN
    if (kind === 'backing') state.catalog!.backers![1].pricePerSqM = -1
    if (kind === 'labour') state.catalog!.settings.labourBase = -1
    if (kind === 'multiplier') state.catalog!.settings.marginMultiplier = 0
    if (kind === 'tax') state.catalog!.settings.taxRatePct = -1
    render(<VisualizerApp />)
    state.preset = fullPreset(); apply()
    expect(screen.getByRole('alert').textContent).toBe('Pricing is unavailable for this selection. Please choose another material or ask a staff member.')
    expect(document.body.textContent).not.toMatch(/base (?:cost|rate|amount|material)|purchase cost|multiplier|markup|margin|Admin review/i)
    fireEvent.click(screen.getByRole('button', { name: 'Create Quote + Invoice + Job' }))
    expect(window.alert).toHaveBeenCalledWith('Pricing is unavailable for this selection. Please choose another material or ask a staff member.')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Quotes' }))
    await waitFor(() => expect(useToast.getState().toasts.some((toast: { message: string }) => /Pricing is unavailable/.test(toast.message))).toBe(true))
    expect(state.quotes).toHaveLength(0)
    expect(state.invoices).toHaveLength(0)
    expect(state.jobs).toHaveLength(0)
  })
