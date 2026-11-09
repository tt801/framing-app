// @vitest-environment node
// Static source assertions only. These do NOT execute PostgreSQL or certify RLS behavior.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COUNTRY_CODES } from '../src/lib/countries'

const sql = readFileSync(resolve(process.cwd(), 'migrations/20261109_scv22_central_supplier_management.sql'), 'utf8')
const harness = readFileSync(resolve(process.cwd(), 'tests/scv22-central-supplier-security.sql'), 'utf8')
const functions = [...sql.matchAll(/CREATE FUNCTION public\.(\w+)\([\s\S]*?\$\$([\s\S]*?)\$\$;/g)]

describe('SC-V2.2 static migration contract (not database execution)', () => {
  it('uses the exact unique SC-V2.1 canonical ISO country allowlist', () => {
    const list = sql.match(/'([A-Z]{2}(?: [A-Z]{2})+)', ' '/)?.[1].split(' ')
    expect(list).toEqual([...COUNTRY_CODES])
    expect(new Set(list).size).toBe(COUNTRY_CODES.length)
  })
  it('pins every definer search path and seals helpers with explicit grants', () => {
    expect(functions).toHaveLength(12)
    for (const [definition] of functions) expect(definition).toContain("SET search_path = ''")
    expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role;')
    const clientGrant = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION[^;]*TO authenticated;/g)].map(m => m[0]).join('\n')
    expect(clientGrant).not.toContain('public.scv22_')
    expect(clientGrant).toContain('TO authenticated;')
  })
  it('removes table and column bypasses without revoking service-role table access', () => {
    expect(sql).toContain('REVOKE ALL ON public.company_suppliers FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I)')
    expect(sql).toContain('DROP POLICY "Company supplier managers insert"')
    expect(sql).toContain('DROP POLICY "Company supplier managers update"')
    expect(sql).not.toMatch(/REVOKE[^;]*ON public\.company_suppliers[^;]*service_role/)
  })
  it('keeps protected commercial, historical and legacy settings tables out of DML', () => {
    expect(sql).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE|DROP TABLE)\s+public\.(?:supplier_products|company_product_overrides|company_settings|quotes|jobs|invoices|company_presets|company_catalog)\b/i)
    expect(sql).not.toMatch(/CREATE OR REPLACE/i)
    expect(sql).toContain('public.is_company_account_writable(p_company) IS DISTINCT FROM true')
    expect(sql).toContain('v_expected IS DISTINCT FROM v_row.revision')
    expect(sql).toContain('v_row.enabled IS DISTINCT FROM v_enabled')
    expect(sql).toContain('ORDER BY s.id FOR SHARE')
    expect(sql).toContain('FOR UPDATE')
  })
  it('keeps supplier projections on an explicit public field allowlist', () => {
    const projection = functions.find(f => f[1] === 'scv22_supplier')?.[2]
    expect(projection).toBeDefined()
    const fields = projection!.match(/RETURN jsonb_build_object\(([\s\S]*?)\);/)?.[1]
    expect(fields).toBeDefined()
    expect([...fields!.matchAll(/'([A-Za-z]+)'\s*,/g)].map(m => m[1])).toEqual(['kind', 'central', 'id', 'name', 'status', 'countries'])
    expect(sql).not.toContain('to_jsonb(s)')
    expect(sql).not.toContain('SELECT s.*')
  })
  it('projects incompatible names instead of filtering suppliers or aborting mutations', () => {
    const projection = functions.find(f => f[1] === 'scv22_display_name')?.[2]
    expect(projection).toContain('v_units+v_size>200')
    expect(projection).toContain('ascii(v_char)<32 OR ascii(v_char) BETWEEN 127 AND 159')
    expect(projection).toContain('Unnamed supplier')
    expect(sql).not.toContain('AND length(s.name)')
    expect(sql).toContain("THEN 'supplier-draft'")
    expect(sql).toContain('cs.revision NOT BETWEEN 1 AND 9007199254740991')
  })
  it('enforces country revision metadata with a trigger, not duplicate RPC increments', () => {
    const trigger = functions.find(f => f[1] === 'scv22_country_metadata')?.[2]
    expect(trigger).toContain('NEW.revision := OLD.revision + 1')
    expect(trigger).toContain('NEW.updated_at := OLD.updated_at')
    expect(trigger).toContain('clock_timestamp()')
    expect(trigger).toContain('NEW.write_expected_revision IS DISTINCT FROM OLD.revision')
    expect(trigger).toContain('NEW.write_expected_revision := NULL')
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.company_supplier_preferences')
    expect(sql).not.toContain('revision=revision+1,updated_at=now()')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.scv22_country_valid(text) TO service_role;')
  })
  it('returns exact country envelopes without exposing transient CAS evidence', () => {
    const read = functions.find(f => f[1] === 'company_operating_country')?.[2]
    expect(read).toBeDefined()
    const envelopes = [...read!.matchAll(/jsonb_build_object\(([^\n;]*?)\)/g)]
    expect(envelopes).toHaveLength(2)
    for (const [, fields] of envelopes) {
      expect([...fields.matchAll(/'([A-Za-z]+)'\s*,/g)].map(m => m[1]))
        .toEqual(['companyAccountId', 'countryCode', 'revision'])
    }
    const write = functions.find(f => f[1] === 'set_company_operating_country')?.[2]
    expect(write).toContain('RETURN public.company_operating_country(p_company_account_id)')
    expect(write).not.toContain('jsonb_build_object')
  })
  it('requires real nonempty history and checks discovery after privilege changes', () => {
    expect(harness).toContain("'company_presets'")
    expect(harness).not.toMatch(/['"]presets['"]|Optional legacy/)
    expect(harness).toContain('Required historical table missing')
    expect(harness).toContain('Required historical fixture missing')
    for (const table of ['quotes', 'jobs', 'invoices', 'company_presets']) {
      expect(harness).toContain(`INSERT INTO public.${table}`)
    }
    expect(harness).toContain('public.effective_company_supplier_products(')
    expect(harness).toContain('discovery restored after reactivation')
  })
})
