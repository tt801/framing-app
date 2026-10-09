import { describe, expect, it } from 'vitest'
import { validateCandidate } from '../server/platform/supplierFeeds/validation.js'
import { initialFeedRetention } from '../server/platform/supplierFeeds/contracts.js'

const source = { supplierId: 'supplier-1', runId: 'run-1', sourceId: 'feed-1', adapter: { id: 'generic-test', version: '1' }, scopeId: 'main', item: { key: 'row-1', rowNumber: 1 } }
const candidate = { ...source, sourceProductKey: 'immutable-1', sourceProductKeyOrigin: 'supplier_provided', fields: { category: 'frame', supplierDescription: 'Timber', lifecycle: 'active', availability: 'available', supplierSku: 'SKU-1', widthMm: 20 }, cost: { amount: '5.25', currency: 'GBP', unit: 'metre', taxBasis: 'exclusive', effectiveAt: '2026-10-09T06:41:00+00:00' } }

describe('supplier-neutral candidate validation', () => {
  it('declares private 90-day diagnostic retention without expiring lightweight outcomes or canonical audit', () => {
    expect(initialFeedRetention).toEqual({ sourceArtifactDays: 90, privateStagingDays: 90, runOutcome: 'retain', canonicalAudit: 'retain' })
  })
  it('returns a typed candidate without deriving a customer selling price', () => {
    const result = validateCandidate(candidate)
    expect(result.errors).toEqual([])
    expect(result.value?.cost?.effectiveAt).toBe('2026-10-09T06:41:00.000Z')
    expect(result.value?.fields.widthMm).toBe(20)
    expect(result.value).not.toHaveProperty('sellingPrice')
  })
  it('preserves supplier-provided and adapter-derived identity origins', () => {
    expect(validateCandidate(candidate).value?.sourceProductKeyOrigin).toBe('supplier_provided')
    expect(validateCandidate({ ...candidate, sourceProductKeyOrigin: 'adapter_derived' }).value?.sourceProductKeyOrigin).toBe('adapter_derived')
  })
  it('rejects missing or unknown identity provenance rather than guessing from SKU', () => {
    for (const origin of [undefined, 'sku_fallback', '']) {
      const result = validateCandidate({ ...candidate, sourceProductKeyOrigin: origin })
      expect(result.value).toBeUndefined()
      expect(result.errors).toContainEqual(expect.objectContaining({ field: 'sourceProductKeyOrigin', code: 'unsafe_identity' }))
    }
  })
  it('rejects missing, whitespace, or control-character identities rather than using SKU', () => {
    for (const sourceProductKey of ['', ' key ', 'bad\nkey']) {
      const result = validateCandidate({ ...candidate, sourceProductKey })
      expect(result.errors).toContainEqual(expect.objectContaining({ field: 'sourceProductKey', code: 'unsafe_identity' }))
      expect(result.value).toBeUndefined()
    }
  })
  it('rejects incomplete private cost tuples and invalid currency, unit, basis or instant', () => {
    for (const cost of [
      { amount: '5.25' },
      { ...candidate.cost, amount: '-1' },
      { ...candidate.cost, currency: 'gbp' },
      { ...candidate.cost, unit: '' },
      { ...candidate.cost, taxBasis: 'maybe' },
      { ...candidate.cost, effectiveAt: '2026-10-09T06:41:00' },
      { ...candidate.cost, effectiveAt: '2026-02-31T06:41:00Z' },
    ]) {
      const result = validateCandidate({ ...candidate, cost })
      expect(result.errors.some(e => e.code === 'incomplete_cost')).toBe(true)
      expect(result.value).toBeUndefined()
    }
  })
  it('rejects malformed dimensions and required canonical fields', () => {
    for (const fields of [
      { ...candidate.fields, widthMm: -1 },
      { ...candidate.fields, widthMm: '20' },
      { ...candidate.fields, glazingUvPercent: 101 },
      { ...candidate.fields, category: 'unknown-category' },
      { ...candidate.fields, supplierDescription: '' },
    ]) expect(validateCandidate({ ...candidate, fields }).errors.length).toBeGreaterThan(0)
  })
  it('accepts private asset provenance but rejects malformed and credential-bearing references', () => {
    const asset = { sourceUrl: 'https://example.invalid/photo.png', attribution: 'supplier', rightsStatus: 'unknown', permittedUses: ['internal'], sourceUpdatedAt: '2026-10-09T00:00:00Z' }
    const valid = validateCandidate({ ...candidate, asset })
    expect(valid.errors).toEqual([])
    expect(valid.warnings).toContainEqual(expect.objectContaining({ code: 'asset_private' }))
    for (const bad of [
      { ...asset, sourceUrl: 'file:///etc/passwd' },
      { ...asset, sourceUrl: 'https://user:pass@example.invalid/photo.png' },
      { ...asset, sourceUrl: 'https://example.invalid/photo.png?token=secret' },
      { ...asset, rightsStatus: 'automatic_customer_display' },
      { ...asset, permittedUses: 'public' },
      { ...asset, sourceUpdatedAt: 'not-a-time' },
    ]) expect(validateCandidate({ ...candidate, asset: bad }).value).toBeUndefined()
  })
  it('does not admit arbitrary selling-price or legacy catalogue fields', () => {
    expect(validateCandidate({ ...candidate, fields: { ...candidate.fields, pricePerMeter: 10 } }).errors)
      .toContainEqual(expect.objectContaining({ field: 'fields.pricePerMeter', code: 'unknown_field' }))
  })
})
