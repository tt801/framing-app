import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../migrations/20261012_block2d_initial_cost_event_on_insert.sql', import.meta.url), 'utf8')

describe('Block 2D initial-cost baseline hardening migration contract', () => {
  it('extends the cost-audit trigger to INSERT + UPDATE', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS block2d_product_cost_audit ON public\.supplier_products;/)
    expect(sql).toMatch(/CREATE TRIGGER block2d_product_cost_audit AFTER INSERT OR UPDATE ON public\.supplier_products/)
  })

  it('records baseline create provenance and keeps update provenance paths', () => {
    expect(sql).toMatch(/IF TG_OP = 'INSERT' THEN/)
    expect(sql).toMatch(/fr\.proposed_action = 'create'/)
    expect(sql).toMatch(/reason\s*=\s*'supplier feed canonical cost create'|supplier feed canonical cost create/)
    expect(sql).toMatch(/supplier feed canonical cost update/)
    expect(sql).toMatch(/old_cost, new_cost/)
    expect(sql).toMatch(/old_effective_at, source_effective_at/)
  })

  it('establishes and restores feed context for block2e create inserts', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.block2e_apply_row\(p_run_id uuid,p_row_id uuid,p_fingerprint text\)/)
    expect(sql).toMatch(/PERFORM pg_catalog\.set_config\('app\.block2e_feed_run_id',p_run_id::text,true\);/)
    expect(sql).toMatch(/PERFORM pg_catalog\.set_config\('app\.block2e_feed_row_id',p_row_id::text,true\);/)
    expect(sql).toMatch(/INSERT INTO public\.supplier_products\(/)
    expect(sql).toMatch(/PERFORM pg_catalog\.set_config\('app\.block2e_feed_run_id',COALESCE\(v_old_run,''\),true\);/)
    expect(sql).toMatch(/PERFORM pg_catalog\.set_config\('app\.block2e_feed_row_id',COALESCE\(v_old_row,''\),true\);/)
  })
})
