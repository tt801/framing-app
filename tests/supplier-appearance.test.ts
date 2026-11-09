import { describe, expect, it } from 'vitest'
import { resolveEffectiveCatalogue, supplierEffectiveId } from '../src/lib/effectiveCatalogue'
import type { Catalog } from '../src/lib/store'
import type { EffectiveSupplierProduct, SafeSupplierRow } from '../src/lib/effectiveCatalogue'
import { resolveSupplierFrameAppearance } from '../src/lib/supplierAppearance'

const company = '00000000-0000-0000-0000-000000000001'
const supplier = '00000000-0000-0000-0000-000000000002'
const productId = '00000000-0000-0000-0000-000000000003'
const legacy = { frames: [], mats: [], glazing: [] } as unknown as Catalog
const row = (overrides: Partial<SafeSupplierRow> = {}): SafeSupplierRow => ({
  company_account_id: company, supplier_id: supplier, supplier_product_id: productId,
  supplier_name: 'Supplier', supplier_enabled: true, supplier_status: 'active', supplier_sku: 'SKU',
  supplier_description: 'Oak frame', display_description: null, category: 'frame',
  colour: '#AbC', finish: 'Satin', material: 'Oak', width_mm: 22, depth_mm: 30,
  rebate_width_mm: 5, rebate_depth_mm: 12, availability: 'available', lifecycle: 'active',
  replacement_product_id: null, active_override: null, excluded_override: null, description_override: null,
  ...overrides,
})
const catalogue = (source = row()) => resolveEffectiveCatalogue({ companyAccountId: company,
  legacyCompanyCatalog: legacy, supplierRows: [source] })
const product = () => catalogue().supplierProducts[0]

describe('supplier frame appearance', () => {
  it.each([null, undefined, 0, -1, NaN, Infinity, -Infinity, '22', '', {}, [], true, Number.MIN_VALUE]
    .map((value, index) => ({ value, index })))('rejects unavailable face width $index without inheriting prior width', ({ value }) => {
    const valid = resolveSupplierFrameAppearance({ companyAccountId: company, product: product() })
    expect(valid.status).toBe('available')
    const result = resolveSupplierFrameAppearance({ companyAccountId: company,
      product: { ...product(), dimensions: { ...product().dimensions, widthMm: value } } as EffectiveSupplierProduct })
    expect(result).toEqual({ status: 'unavailable', reason: 'face-width-unavailable', appearance: null,
      warnings: ['face-width-missing-or-invalid'], commerciallySelectable: false })
  })
  it.each([0.5, 22, 125])('converts finite positive width %s from millimetres to centimetres', widthMm => {
    const result = resolveSupplierFrameAppearance({ companyAccountId: company,
      product: { ...product(), dimensions: { ...product().dimensions, widthMm } } })
    if (result.status !== 'available') throw new Error('Expected positive face width')
    expect(result.appearance.faceWidthCm).toBe(widthMm / 10)
  })
  it.each([
    { lifecycle: 'discontinued' }, { lifecycle: 'superseded' }, { availability: 'unavailable' },
    { availability: 'unknown' }, { availability: 'limited' }, { active_override: false }, { excluded_override: true },
  ])('rejects a product not eligible for new selection (%j)', overrides => {
    const effective = catalogue(row(overrides))
    const result = resolveSupplierFrameAppearance({ companyAccountId: company, product: effective.supplierProducts[0] })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'not-eligible', appearance: null, commerciallySelectable: false })
    expect(effective.findProduct(supplierEffectiveId(productId))).toBeDefined()
  })
  it('does not trust an injected visible flag over lifecycle and availability', () => {
    const result = resolveSupplierFrameAppearance({ companyAccountId: company,
      product: { ...product(), lifecycle: 'discontinued', visibleForNewSelection: true } })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'not-eligible' })
  })
  it('rejects a resolved product belonging to another company without leaking its appearance', () => {
    const result = resolveSupplierFrameAppearance({ companyAccountId: '00000000-0000-0000-0000-000000000099', product: product() })
    expect(result).toEqual({ status: 'unavailable', reason: 'company-mismatch', appearance: null,
      warnings: [], commerciallySelectable: false })
  })
  it.each([{ supplier_enabled: false }, { supplier_status: 'paused' },
    { company_account_id: '00000000-0000-0000-0000-000000000099' }])('cannot resolve filtered access (%j)', overrides => {
    const result = resolveSupplierFrameAppearance({ companyAccountId: company,
      product: catalogue(row(overrides)).findProduct(supplierEffectiveId(productId)) })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'missing-product', appearance: null })
  })
  it('rejects non-frame and legacy products', () => {
    const mat = catalogue(row({ category: 'mat' })).supplierProducts[0]
    expect(resolveSupplierFrameAppearance({ companyAccountId: company, product: mat }))
      .toMatchObject({ status: 'unavailable', reason: 'not-supplier-frame' })
    expect(resolveSupplierFrameAppearance({ companyAccountId: company,
      product: { source: 'legacy', category: 'frame', commerciallySelectable: true } as never }))
      .toMatchObject({ status: 'unavailable', reason: 'not-supplier-frame' })
  })
  it.each([{ id: 'supplier:wrong' }, { supplierProductId: supplier }, { supplierId: 'invalid' }])('rejects mismatched or malformed supplier identity (%j)', overrides => {
    expect(resolveSupplierFrameAppearance({ companyAccountId: company, product: { ...product(), ...overrides } }))
      .toMatchObject({ status: 'unavailable', reason: 'invalid-identity', appearance: null })
  })
  it('never projects hostile financial or asset fields into appearance', () => {
    const input = Object.freeze({ ...product(), wholesale_cost: 15, selling_price_override: 30, pricePerMeter: 90,
      asset: { sourceUrl: 'private-url', key: 'private', thumbnailKey: 'private', textureKey: 'private' } })
    const result = resolveSupplierFrameAppearance({ companyAccountId: company, product: input as unknown as EffectiveSupplierProduct })
    if (result.status !== 'available') throw new Error('Expected appearance')
    expect(result.appearance.asset).toEqual({ sourceUrl: null, key: null, thumbnailKey: null, textureKey: null })
    for (const key of ['wholesale_cost', 'selling_price_override', 'pricePerMeter']) expect(result.appearance).not.toHaveProperty(key)
    expect(result.appearance.commerciallySelectable).toBe(false)
    expect(input.asset.key).toBe('private')
  })
  it.each([
    ['#123', '#112233'], ['#ABCDEF', '#abcdef'], [' #000000 ', '#000000'], ['#fff', '#ffffff'],
  ])('canonicalises supported hex %s', (colour, expected) => {
    const result = resolveSupplierFrameAppearance({ companyAccountId: company, product: { ...product(), colour } })
    expect(result.status).toBe('available')
    if (result.status !== 'available') throw new Error('Expected available appearance')
    expect(result.appearance).toMatchObject({ renderColour: expected, colourResolution: 'hex', approximateColour: false })
  })
  it.each([
    'Antique Gold', 'red', 'rgb(1,2,3)', '#12', '#1234', '#12345', '#12345678', '#ggg',
    'var(--colour)', 'url(https://example.invalid/private)', 'linear-gradient(red,blue)', 'inherit',
    '', ' ', null, undefined, {}, [], true, 123, 'x'.repeat(2001),
  ].map((value, index) => ({ value, index })))('uses an approximate neutral colour for unsupported input $index', ({ value }) => {
    const result = resolveSupplierFrameAppearance({ companyAccountId: company,
      product: { ...product(), colour: value } as EffectiveSupplierProduct })
    if (result.status !== 'available') throw new Error('Expected colour-only fallback')
    expect(result.appearance).toMatchObject({ renderColour: '#333333', colourResolution: 'neutral-fallback', approximateColour: true })
    expect(result.appearance.warnings).toContain('colour-missing-or-unsupported')
    expect(result.appearance.colourDescription).toBe(typeof value === 'string' && value.trim() && value.length <= 2000 ? value.trim() : null)
  })
  it('normalises malformed optional descriptions and measurements with warnings', () => {
    const result = resolveSupplierFrameAppearance({ companyAccountId: company, product: {
      ...product(), name: {}, supplierSku: [], finish: true, material: 17,
      dimensions: { widthMm: 22, depthMm: -1, rebateWidthMm: Infinity, rebateDepthMm: '12' },
    } as unknown as EffectiveSupplierProduct })
    if (result.status !== 'available') throw new Error('Expected optional metadata fallback')
    expect(result.appearance).toMatchObject({ displayName: 'Supplier frame', supplierSku: null,
      finishDescription: null, materialDescription: null, depthMm: null, rebateWidthMm: null, rebateDepthMm: null })
    expect(result.appearance.warnings).toEqual(expect.arrayContaining([
      'display-name-unavailable', 'sku-unavailable', 'finish-unavailable', 'material-unavailable',
      'depth-missing-or-invalid', 'rebate-width-missing-or-invalid', 'rebate-depth-missing-or-invalid',
    ]))
  })
  it('resolves authorised metadata and canonical colour without mutating the source', () => {
    const input = Object.freeze(product())
    Object.freeze(input.dimensions)
    Object.freeze(input.asset)
    const before = structuredClone(input)
    const result = resolveSupplierFrameAppearance({ companyAccountId: company, product: input })
    expect(result).toEqual({ status: 'available', appearance: {
      schemaVersion: 1, source: 'supplier', companyAccountId: company,
      effectiveProductId: supplierEffectiveId(productId), supplierId: supplier, supplierProductId: productId,
      displayName: 'Oak frame', supplierSku: 'SKU', colourDescription: '#AbC',
      finishDescription: 'Satin', materialDescription: 'Oak', renderColour: '#aabbcc',
      colourResolution: 'hex', approximateColour: false, faceWidthCm: 2.2,
      depthMm: 30, rebateWidthMm: 5, rebateDepthMm: 12,
      asset: { sourceUrl: null, key: null, thumbnailKey: null, textureKey: null },
      warnings: [], commerciallySelectable: false,
    } })
    expect(input).toEqual(before)
  })
})
