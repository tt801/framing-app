import { describe, expect, it } from 'vitest'
import { resolveEffectiveCatalogue, supplierEffectiveId, isSupplierProductId } from '../src/lib/effectiveCatalogue'
import type { SafeSupplierRow } from '../src/lib/effectiveCatalogue'
import type { Catalog } from '../src/lib/store'
import { priceVisualiser, toVisualiserQuote, toVisualiserJobCosts, toVisualiserInvoice } from '../src/lib/pricing'

const company = '00000000-0000-0000-0000-000000000001'
const supplier = '00000000-0000-0000-0000-000000000002'
const product = '00000000-0000-0000-0000-000000000003'
const legacy: Catalog = {
  frames: [{ id: 'fr1', name: 'Manual', pricePerMeter: 8, faceWidthCm: 2 }],
  mats: [{ id: 'mat0', name: 'No mat', pricePerSqM: 0, color: 'transparent' }],
  glazing: [{ id: 'gl1', name: 'Glass', pricePerSqM: 4 }],
  printingMaterials: [], backers: [],
  settings: { unit: 'metric', currencyCode: 'GBP', currencySymbol: '£', themeColor: '#000', labourBase: 5,
    printingPerSqM: 3, marginMultiplier: 1.25 },
  stock: { frames: [{ profileId: 'fr1', metersAvailable: 2 }] },
}
const row = (overrides: Partial<SafeSupplierRow> = {}): SafeSupplierRow => ({
  company_account_id: company, supplier_id: supplier, supplier_product_id: product,
  supplier_name: 'Supplier', supplier_enabled: true, supplier_status: 'active',
  supplier_description: 'Frame', display_description: 'Frame', supplier_sku: 'SKU', category: 'frame',
  lifecycle: 'active', availability: 'available', replacement_product_id: null,
  excluded_override: null, active_override: null, description_override: null,
  ...overrides,
})

describe('effective company catalogue', () => {
  it('preserves zero-supplier catalogue and settings without adding demo products', () => {
    const effective = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy, supplierRows: [] })
    expect(effective.legacyCatalog).toBe(legacy)
    expect(effective.legacyCatalog).toEqual(legacy)
    expect(effective.supplierProducts).toEqual([])
    expect(effective.legacyCatalog.stock).toBe(legacy.stock)
  })
  it('discovers an authorized supplier product by immutable namespaced ID, never as a priced legacy frame', () => {
    const result = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy,
      supplierRows: [row({ width_mm: 22 })] })
    expect(result.supplierProducts[0]).toMatchObject({ id: supplierEffectiveId(product), supplierProductId: product,
      source: 'supplier', name: 'Frame', commerciallySelectable: false })
    expect(result.legacyCatalog.frames).toEqual(legacy.frames)
    expect(result.supplierProducts[0]).not.toHaveProperty('pricePerMeter')
  })
  it('ignores disabled and foreign-company rows, including their private overrides', () => {
    const result = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy,
      supplierRows: [row({ supplier_enabled: false }), row({ company_account_id: '00000000-0000-0000-0000-000000000099', description_override: 'Foreign' })] })
    expect(result.supplierProducts).toEqual([])
    expect(result.discovery.map(p => p.id)).toEqual(['fr1', 'mat0', 'gl1'])
  })
  it('retains excluded and discontinued IDs for references without offering them for new selection', () => {
    const excluded = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy,
      supplierRows: [row({ excluded_override: true, description_override: 'Custom', image_asset_key_override: 'company-image' } as Partial<SafeSupplierRow>)] })
    expect(excluded.findProduct(supplierEffectiveId(product))).toMatchObject({ name: 'Custom', visibleForNewSelection: false,
      asset: { key: null } })
    expect(excluded.discovery.some(p => p.id === supplierEffectiveId(product))).toBe(false)
    const discontinued = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy,
      supplierRows: [row({ lifecycle: 'discontinued', replacement_product_id: '00000000-0000-0000-0000-000000000004' })] })
    expect(discontinued.findProduct(supplierEffectiveId(product))).toMatchObject({ lifecycle: 'discontinued',
      replacementProductId: '00000000-0000-0000-0000-000000000004', commerciallySelectable: false })
    expect(discontinued.findProduct(supplierEffectiveId('00000000-0000-0000-0000-000000000004'))).toBeUndefined()
    expect(discontinued.findProduct('supplier:00000000-0000-0000-0000-000000000099')).toBeUndefined()
  })
  it('does not turn wholesale or explicit selling overrides into compatible Visualiser inputs', () => {
    const unsafe = row({ width_mm: null, availability: 'available',
      selling_price_override: 50, wholesale_cost: 10 } as Partial<SafeSupplierRow>)
    const effective = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy, supplierRows: [unsafe] })
    expect(effective.findProduct(supplierEffectiveId(product))).toMatchObject({ commerciallySelectable: false,
      dimensions: { widthMm: null } })
    expect(effective.supplierProducts[0]).not.toHaveProperty('pricePerMeter')
    expect(effective.supplierProducts[0]).not.toHaveProperty('wholesale_cost')
    expect(effective.supplierProducts[0]).not.toHaveProperty('selling_price_override')
  })
  it('keeps manual namespace conflicts and mat0 instead of re-keying legacy products', () => {
    const id = supplierEffectiveId(product)
    const conflicted: Catalog = { ...legacy, frames: [{ ...legacy.frames[0], id }] }
    const effective = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: conflicted,
      supplierRows: [row({ category: 'mat' })] })
    expect(effective.supplierProducts).toEqual([])
    expect(effective.findProduct(id)?.source).toBe('legacy')
    expect(effective.discovery.filter(p => p.id === 'mat0')).toHaveLength(1)
    expect(isSupplierProductId(id)).toBe(true)
    expect(isSupplierProductId('mat0')).toBe(false)
  })
  it('does not inject demo entries into deliberately empty product arrays', () => {
    const empty: Catalog = { ...legacy, frames: [], mats: [{ ...legacy.mats[0] }], glazing: [], printingMaterials: [] }
    const effective = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: empty, supplierRows: [] })
    expect(effective.legacyCatalog.frames).toEqual([])
    expect(effective.legacyCatalog.glazing).toEqual([])
    expect(effective.discovery.map(p => p.id)).toEqual(['mat0'])
  })
  it('blocks unresolved supplier preset references rather than substituting another product', () => {
    const effective = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy,
      supplierRows: [row({ lifecycle: 'discontinued' })] })
    expect(effective.selectionIssue([supplierEffectiveId(product)])).toMatch(/no longer selectable/i)
    expect(effective.selectionIssue(['supplier:00000000-0000-0000-0000-000000000099'])).toMatch(/unavailable/i)
    expect(effective.selectionIssue(['fr1', 'mat0', 'gl1'])).toBeNull()
    const conflicted: Catalog = { ...legacy, frames: [{ ...legacy.frames[0], id: supplierEffectiveId(product) }] }
    expect(resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: conflicted,
      supplierRows: [] }).selectionIssue([supplierEffectiveId(product)])).toBeNull()
  })
  it('does not mutate shared supplier data when applying a company override', () => {
    const central = row({ description_override: 'Company name', image_asset_key_override: 'custom-key' } as Partial<SafeSupplierRow>)
    const original = structuredClone(central)
    const effective = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy, supplierRows: [central] })
    expect(effective.findProduct(supplierEffectiveId(product))).toMatchObject({ name: 'Company name', asset: { key: null } })
    expect(central).toEqual(original)
  })
  it('distinguishes unavailable from excluded and never treats active true as a price', () => {
    const effective = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy,
      supplierRows: [row({ availability: 'unavailable', active_override: true, excluded_override: false })] })
    expect(effective.findProduct(supplierEffectiveId(product))).toMatchObject({
      availability: 'unavailable', visibleForNewSelection: false, commerciallySelectable: false,
    })
  })
  it('never exposes injected central asset references without a documented browser-use grant', () => {
    const effective = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy,
      supplierRows: [row({ source_image_url: 'https://example.invalid/a', cached_asset_key: 'a',
        thumbnail_key: 'thumb', texture_key: 'texture', image_asset_key_override: 'company-key' } as Partial<SafeSupplierRow>)] })
    expect(effective.supplierProducts[0].asset).toMatchObject({
      sourceUrl: null, key: null, thumbnailKey: null, textureKey: null,
    })
  })
  it('preserves zero-supplier pricing and Quote/Job/Invoice commercial snapshots', () => {
    const effective = resolveEffectiveCatalogue({ companyAccountId: company, legacyCompanyCatalog: legacy, supplierRows: [] })
    const input = { artWcm: 30, artHcm: 40, borderCm: 0, frame: legacy.frames[0], mats: [],
      glazing: legacy.glazing[0], print: null, backer: null, labourBase: legacy.settings.labourBase,
      marginMultiplier: legacy.settings.marginMultiplier, taxRatePct: 0, currencyCode: 'GBP' }
    const before = priceVisualiser(input)
    const after = priceVisualiser({ ...input, frame: effective.legacyCatalog.frames[0], glazing: effective.legacyCatalog.glazing[0] })
    expect(after).toEqual(before)
    expect(toVisualiserQuote(after)).toEqual(toVisualiserQuote(before))
    expect(toVisualiserJobCosts(after)).toEqual(toVisualiserJobCosts(before))
    expect(toVisualiserInvoice(after).pricingSnapshot).toEqual(toVisualiserInvoice(before).pricingSnapshot)
  })
})
