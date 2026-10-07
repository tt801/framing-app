-- Run ONLY against a disposable local database after the fixture, Block 6B
-- catalogue migration, and Block 2B migration. All inserted data rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %', message; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(query text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
  BEGIN EXECUTE query;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
  END;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Expected SQLSTATE %, got %: %', expected, actual, query;
  END IF;
END $$;
DO $$ BEGIN
  PERFORM pg_temp.assert_true((SELECT count(*) = 8 FROM pg_class
    WHERE oid IN (to_regclass('public.suppliers'),to_regclass('public.supplier_products'),
      to_regclass('public.supplier_product_aliases'),to_regclass('public.company_suppliers'),
      to_regclass('public.company_product_overrides'),to_regclass('public.supplier_feed_runs'),
      to_regclass('public.supplier_feed_rows'),to_regclass('public.supplier_product_cost_events'))), 'eight foundation tables');
  PERFORM pg_temp.assert_true(to_regclass('public.company_catalog') IS NOT NULL, 'existing catalogue retained');
  PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.supplier_products','SELECT')
    AND NOT has_table_privilege('authenticated','public.supplier_products','INSERT')
    AND NOT has_table_privilege('anon','public.supplier_products','SELECT')
    AND NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid='public.supplier_products'::regclass AND a.grantee=0), 'product table grants');
  PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.supplier_feed_rows','SELECT')
    AND NOT has_table_privilege('authenticated','public.supplier_feed_rows','INSERT')
    AND NOT has_table_privilege('anon','public.supplier_product_cost_events','SELECT'), 'operational grants');
  PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.company_product_overrides','DELETE')
    AND NOT has_table_privilege('authenticated','public.company_suppliers','DELETE'), 'client deletion denied');
  PERFORM pg_temp.assert_true((SELECT count(*) = 8 FROM pg_class WHERE relrowsecurity
    AND oid IN (to_regclass('public.suppliers'),to_regclass('public.supplier_products'),
      to_regclass('public.supplier_product_aliases'),to_regclass('public.company_suppliers'),
      to_regclass('public.company_product_overrides'),to_regclass('public.supplier_feed_runs'),
      to_regclass('public.supplier_feed_rows'),to_regclass('public.supplier_product_cost_events'))), 'RLS all tables');
  PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','public.block2b_protect_product()','EXECUTE')
    AND NOT has_function_privilege('anon','public.block2b_touch_row()','EXECUTE'), 'trigger functions not callable');
END $$;
-- The synthetic fixture does not provision Supabase's existing default grants.
GRANT SELECT ON public.company_catalog TO service_role;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-0000-0000-000000000001','one@example.invalid'),
 ('00000000-0000-0000-0000-000000000002','two@example.invalid'),
 ('00000000-0000-0000-0000-000000000003','manager@example.invalid'),
 ('00000000-0000-0000-0000-000000000004','staff@example.invalid');
INSERT INTO public.company_accounts(id,owner_user_id,plan_status) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','active'),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000002','active');
INSERT INTO public.company_members(company_account_id,user_id,role,status) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','owner','active'),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000002','owner','active'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000003','manager','active'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000004','staff','active');
INSERT INTO public.company_catalog(company_account_id,catalog) VALUES
 ('00000000-0000-0000-0000-000000000101','{"frames":[{"id":"legacy-stock-frame","pricePerMeter":5}],"stock":{"frames":[{"profileId":"legacy-stock-frame","qty":2}]}}');
-- The only operational write path tested is service_role, never a browser role.
SET LOCAL ROLE service_role;
INSERT INTO public.suppliers(id,name,slug,status) VALUES
 ('00000000-0000-0000-0000-000000000201','A','supplier-a','active'),
 ('00000000-0000-0000-0000-000000000202','B','supplier-b','active');
SELECT pg_temp.expect_error($q$INSERT INTO public.suppliers(name,slug) VALUES ('duplicate','supplier-a')$q$, '23505');
INSERT INTO public.supplier_products(id,supplier_id,source_product_key,supplier_sku,variant_key,category,supplier_description,wholesale_cost,cost_currency,cost_unit,cost_tax_basis)
VALUES ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','source-1','SKU-1','chop','frame','Frame one',5,'GBP','metre','exclusive');
INSERT INTO public.supplier_products(supplier_id,source_product_key,supplier_sku,variant_key,category,supplier_description)
VALUES ('00000000-0000-0000-0000-000000000201','source-2','sku-1','length','frame','Frame two'),
 ('00000000-0000-0000-0000-000000000202','source-1','SKU-1','chop','frame','Other supplier');
SELECT pg_temp.assert_true((SELECT id IS NOT NULL AND sku_normalized = 'sku-1'
  FROM public.supplier_products WHERE id = '00000000-0000-0000-0000-000000000301'), 'UUID and normalized SKU');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_products(supplier_id,source_product_key,category,supplier_description)
  VALUES ('00000000-0000-0000-0000-000000000201','source-1','frame','duplicate source')$q$, '23505');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_products(supplier_id,supplier_sku,variant_key,category,supplier_description)
  VALUES ('00000000-0000-0000-0000-000000000201','sku-1','chop','frame','duplicate sku/variant')$q$, '23505');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_products(supplier_id,category,supplier_description)
  VALUES ('00000000-0000-0000-0000-000000000299','frame','orphan')$q$, '23503');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_products(supplier_id,category,supplier_description,wholesale_cost,cost_currency,cost_unit,cost_tax_basis)
  VALUES ('00000000-0000-0000-0000-000000000201','mat','invalid',-1,'GBP','sheet','exclusive')$q$, '23514');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_products(supplier_id,category,supplier_description,wholesale_cost,cost_currency,cost_unit,cost_tax_basis)
  VALUES ('00000000-0000-0000-0000-000000000201','mat','not a number','NaN','GBP','sheet','exclusive')$q$, '23514');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_products(supplier_id,category,supplier_description,width_mm)
  VALUES ('00000000-0000-0000-0000-000000000201','frame','infinite width','Infinity')$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.supplier_products SET id = gen_random_uuid()
  WHERE id = '00000000-0000-0000-0000-000000000301'$q$, 'P0001');
SELECT pg_temp.expect_error($q$UPDATE public.supplier_products SET replacement_product_id = id
  WHERE id = '00000000-0000-0000-0000-000000000301'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.supplier_products SET replacement_product_id =
  (SELECT id FROM public.supplier_products WHERE supplier_id = '00000000-0000-0000-0000-000000000202' LIMIT 1)
  WHERE id = '00000000-0000-0000-0000-000000000301'$q$, '23503');
UPDATE public.supplier_products SET lifecycle = 'discontinued', availability = 'unavailable',
  replacement_product_id = (SELECT id FROM public.supplier_products WHERE source_product_key='source-2')
  WHERE id = '00000000-0000-0000-0000-000000000301';
SELECT pg_temp.assert_true((SELECT lifecycle = 'discontinued' AND replacement_product_id IS NOT NULL
  FROM public.supplier_products WHERE id='00000000-0000-0000-0000-000000000301'), 'discontinued still addressable');
SELECT pg_temp.expect_error($q$DELETE FROM public.supplier_products WHERE id='00000000-0000-0000-0000-000000000301'$q$, '42501');
UPDATE public.supplier_products SET source_product_key='new-source-1', supplier_sku='NEW-SKU'
  WHERE id='00000000-0000-0000-0000-000000000301';
INSERT INTO public.supplier_product_aliases(supplier_id,supplier_product_id,alias_kind,alias_value,variant_key)
VALUES ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','source_key','source-1',''),
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','sku','sku-1','chop');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.supplier_product_aliases
 WHERE supplier_product_id='00000000-0000-0000-0000-000000000301'), 'source/SKU aliases retain UUID');
SELECT pg_temp.expect_error($q$UPDATE public.supplier_product_aliases SET alias_value='edited'$q$, '42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_product_aliases(supplier_id,supplier_product_id,alias_kind,alias_value,variant_key)
 VALUES ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301','source_key','source-1','other-variant')$q$, '23505');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_product_aliases(supplier_id,supplier_product_id,alias_kind,alias_value)
 VALUES ('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000301','sku','wrong supplier')$q$, '23503');
INSERT INTO public.supplier_feed_runs(id,supplier_id,adapter_version,status) VALUES
 ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000201','test-v1','staged');
INSERT INTO public.supplier_feed_rows(feed_run_id,row_number,raw_record,proposed_product,validation_status,validation_errors)
VALUES ('00000000-0000-0000-0000-000000000401',1,'{"bad":"not a price"}',
 '{"wholesale_cost":"broken"}','invalid','["invalid cost"]');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.supplier_feed_rows WHERE validation_status='invalid'), 'malformed staged');
INSERT INTO public.supplier_product_cost_events(supplier_id,supplier_product_id,feed_run_id,event_key,old_cost,new_cost,new_currency,new_unit,new_tax_basis)
VALUES ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301',
 '00000000-0000-0000-0000-000000000401','feed:401:cost',5,6,'GBP','metre','exclusive');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_product_cost_events(supplier_id,supplier_product_id,feed_run_id,event_key,new_cost,new_currency,new_unit,new_tax_basis)
VALUES ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301',
'00000000-0000-0000-0000-000000000401','feed:401:cost',6,'GBP','metre','exclusive')$q$, '23505');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_product_cost_events(supplier_id,supplier_product_id,feed_run_id,event_key,new_cost,new_currency,new_unit,new_tax_basis)
 VALUES ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000301',
 '00000000-0000-0000-0000-000000000401','different-key',6,'GBP','metre','exclusive')$q$, '23505');
SELECT pg_temp.expect_error($q$UPDATE public.supplier_product_cost_events SET new_cost=0$q$, '42501');
SELECT pg_temp.expect_error($q$DELETE FROM public.supplier_product_cost_events$q$, '42501');
INSERT INTO public.company_suppliers(company_account_id,supplier_id,enabled) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201',true),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000201',true);
SELECT pg_temp.expect_error($q$INSERT INTO public.company_suppliers(company_account_id,supplier_id)
 VALUES ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201')$q$, '23505');
INSERT INTO public.company_product_overrides(company_account_id,supplier_id,supplier_product_id,
  excluded_override,stock_eligibility_override,effective_cost_override,cost_currency,cost_unit)
VALUES ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201',
 '00000000-0000-0000-0000-000000000301',false,false,0,'GBP','metre'),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000201',
 '00000000-0000-0000-0000-000000000301',true,true,9,'GBP','metre');
SELECT pg_temp.expect_error($q$INSERT INTO public.company_product_overrides(company_account_id,supplier_id,supplier_product_id)
 VALUES ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201',
 '00000000-0000-0000-0000-000000000301')$q$, '23505');
SELECT pg_temp.assert_true((SELECT excluded_override=false AND effective_cost_override=0
 FROM public.company_product_overrides WHERE company_account_id='00000000-0000-0000-0000-000000000101'), 'explicit false/zero');
SELECT pg_temp.assert_true((SELECT catalog #>> '{stock,frames,0,profileId}' = 'legacy-stock-frame'
 AND catalog #>> '{frames,0,pricePerMeter}' = '5' AND revision = 1
 FROM public.company_catalog WHERE company_account_id='00000000-0000-0000-0000-000000000101'), 'legacy catalogue intact');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.company_suppliers), 'owner sees only own supplier config');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND min(effective_cost_override)=0 FROM public.company_product_overrides), 'owner sees own override');
SELECT pg_temp.expect_error($q$SELECT * FROM public.supplier_products$q$, '42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_products(supplier_id,category,supplier_description)
VALUES ('00000000-0000-0000-0000-000000000201','frame','browser write')$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT * FROM public.supplier_feed_rows$q$, '42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.supplier_feed_rows(feed_run_id,raw_record)
 VALUES ('00000000-0000-0000-0000-000000000401','{}')$q$, '42501');
-- RLS hides the other tenant's UPDATE target: no row changes.
UPDATE public.company_product_overrides SET effective_cost_override=2, active_override=false
 WHERE company_account_id='00000000-0000-0000-0000-000000000102';
SELECT pg_temp.expect_error($q$INSERT INTO public.company_product_overrides(company_account_id,supplier_id,supplier_product_id)
 VALUES ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000201',
 '00000000-0000-0000-0000-000000000301')$q$, '42501');
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.company_product_overrides), 'manager sees own');
UPDATE public.company_product_overrides SET excluded_override=true
 WHERE company_account_id='00000000-0000-0000-0000-000000000101';
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.company_product_overrides), 'staff cannot read costs');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.company_suppliers), 'staff cannot read account reference');
SELECT pg_temp.expect_error($q$INSERT INTO public.company_suppliers(company_account_id,supplier_id)
 VALUES ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000202')$q$, '42501');
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.assert_true((SELECT count(*)=1 AND min(effective_cost_override)=9 FROM public.company_product_overrides), 'other owner sees only own');
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT * FROM public.company_product_overrides$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT * FROM public.supplier_feed_runs$q$, '42501');
RESET ROLE;
-- Table owners cannot bypass the append-only/no-hard-delete guards by a normal DML statement.
SELECT pg_temp.expect_error($q$DELETE FROM public.supplier_products WHERE id='00000000-0000-0000-0000-000000000301'$q$, 'P0001');
SELECT pg_temp.expect_error($q$UPDATE public.supplier_product_aliases SET alias_value='changed'$q$, 'P0001');
SELECT pg_temp.expect_error($q$DELETE FROM public.supplier_product_cost_events$q$, 'P0001');
SELECT pg_temp.assert_true((SELECT active_override IS NULL FROM public.company_product_overrides
 WHERE company_account_id='00000000-0000-0000-0000-000000000102'), 'cross-tenant update left unchanged');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.supplier_products WHERE id='00000000-0000-0000-0000-000000000301'), 'product survives discontinuation');
ROLLBACK;
\echo 'Block 2B disposable PostgreSQL assertions passed (transaction rolled back)'
