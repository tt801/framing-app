import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const sql = readFileSync(new URL('../../migrations/20261008_block2d_supplier_cost_audit.sql', import.meta.url), 'utf8')

describe('additive supplier cost-audit migration contract', () => {
  it('audits all five tuple components through an AFTER UPDATE row trigger', () => {
    expect(sql).toMatch(/AFTER UPDATE ON public\.supplier_products/)
    for (const key of ['wholesale_cost', 'cost_currency', 'cost_unit', 'cost_tax_basis', 'cost_effective_at']) {
      expect(sql).toContain(`OLD.${key}`)
      expect(sql).toContain(`NEW.${key}`)
    }
    expect(sql).toMatch(/IS DISTINCT FROM/)
    expect(sql).toMatch(/INSERT INTO public\.supplier_product_cost_events/)
  })
  it('uses an invoker-only service-role RPC and a locked optimistic version check', () => {
    expect(sql).toMatch(/CREATE FUNCTION public\.block2d_update_supplier_product/)
    expect(sql).toMatch(/SECURITY INVOKER/)
    expect(sql).toMatch(/FOR UPDATE/)
    expect(sql).toMatch(/p_expected_updated_at/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.block2d_update_supplier_product.*TO service_role/s)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.block2d_update_supplier_product.*FROM PUBLIC, anon, authenticated/s)
  })
  it('does not weaken alias/cost-event append-only protections or customer table grants', () => {
    expect(sql).not.toMatch(/(DROP TRIGGER block2b_(cost_event|alias)_guard|GRANT (UPDATE|DELETE) ON public\.supplier_product_cost_events|GRANT .* ON public\.supplier_products TO authenticated)/)
  })
})
