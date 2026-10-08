import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Guard the unchanged customer-facing projection; private Admin SELECT is a separate boundary.
const projection = readFileSync(new URL('../../migrations/20261007_block2c_effective_supplier_projection.sql', import.meta.url), 'utf8')
const json = projection.split('pg_catalog.jsonb_build_object(')[1]?.split('\n  )')[0] ?? ''
describe('Block 2C boundary remains fail-closed while Admin gets private cost metadata', () => {
  it('does not project private wholesale, account, or source fields', () => {
    for (const field of ['wholesale_cost', 'cost_currency', 'cost_unit', 'cost_tax_basis', 'cost_effective_at', 'effective_cost_override', 'selling_price_override', 'account_reference', 'source_metadata', 'image_asset_key_override']) {
      expect(json).not.toMatch(new RegExp(`'${field}'\\s*,`))
    }
  })
  it('always substitutes NULL for customer-facing image references', () => {
    for (const field of ['source_image_url', 'cached_asset_key', 'thumbnail_key', 'texture_key']) {
      expect(json).toMatch(new RegExp(`'${field}'\\s*,\\s*NULL::text`))
    }
  })
})
