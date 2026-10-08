-- Disposable PostgreSQL only, after block2b-supplier-fixture.sql, Block 6B,
-- Block 2B, and Block 2C projection migration. Test data rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_ok(ok boolean, reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %', reason; END IF; END $$;
CREATE FUNCTION pg_temp.expect_denied(query text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE code text;
BEGIN
 BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE; END;
 IF code IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Expected privilege denial, got %', code; END IF;
END $$;
CREATE FUNCTION pg_temp.expect_null_rejected(query text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE code text;
BEGIN
 BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE; END;
 IF code IS DISTINCT FROM '23502' THEN RAISE EXCEPTION 'Expected NOT NULL rejection, got %', code; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_assets_hidden(company_id uuid, reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE product jsonb;
BEGIN
 SELECT p INTO product FROM public.effective_company_supplier_products(company_id) AS p;
 PERFORM pg_temp.assert_ok(product IS NOT NULL
   AND product->>'source_image_url' IS NULL AND product->>'cached_asset_key' IS NULL
   AND product->>'thumbnail_key' IS NULL AND product->>'texture_key' IS NULL
   AND NOT (product ? 'image_asset_key_override'), reason);
END $$;
SELECT pg_temp.assert_ok(NOT has_function_privilege('anon','public.effective_company_supplier_products(uuid)','EXECUTE')
 AND has_function_privilege('authenticated','public.effective_company_supplier_products(uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.effective_company_supplier_products(uuid)','EXECUTE'), 'RPC EXECUTE grants');
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-0000-0000-000000000001','one@example.invalid'),
 ('00000000-0000-0000-0000-000000000002','two@example.invalid'),
 ('00000000-0000-0000-0000-000000000003','staff@example.invalid'),
 ('00000000-0000-0000-0000-000000000004','manager@example.invalid'),
 ('00000000-0000-0000-0000-000000000005','inactive@example.invalid');
INSERT INTO public.company_accounts(id,owner_user_id,plan_status) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','active'),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000002','active');
INSERT INTO public.company_members(company_account_id,user_id,role,status) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000003','staff','active'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000004','manager','active'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000005','staff','inactive');
INSERT INTO public.suppliers(id,name,slug,status) VALUES
 ('00000000-0000-0000-0000-000000000201','Approved','approved','active'),
 ('00000000-0000-0000-0000-000000000202','Disabled','disabled','active');
INSERT INTO public.supplier_products(id,supplier_id,category,supplier_description,wholesale_cost,cost_currency,cost_unit,cost_tax_basis)
VALUES ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201',
 'frame','Product A',19,'GBP','metre','exclusive'),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000202',
 'frame','Product B',20,'GBP','metre','exclusive');
UPDATE public.supplier_products SET source_image_url = 'https://example.invalid/private.jpg',
  cached_asset_key = 'private-key', thumbnail_key = 'private-thumb', texture_key = 'private-texture',
  image_rights_status = 'permitted', image_permitted_uses = '{}'::jsonb
  WHERE id = '00000000-0000-0000-0000-000000000301';
UPDATE public.suppliers SET asset_rights_status = 'permitted' WHERE id = '00000000-0000-0000-0000-000000000201';
INSERT INTO public.company_suppliers(company_account_id,supplier_id,enabled,account_reference) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201',true,'PRIVATE-A'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000202',false,'PRIVATE-B'),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000201',true,'PRIVATE-C');
INSERT INTO public.company_product_overrides(company_account_id,supplier_id,supplier_product_id,
 description_override,image_asset_key_override,effective_cost_override,cost_currency,cost_unit,selling_price_override,selling_currency,selling_unit)
VALUES ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201',
 '00000000-0000-0000-0000-000000000301','A-only description','company-private-key',17,'GBP','metre',99,'GBP','metre'),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000201',
 '00000000-0000-0000-0000-000000000301','B-only description','company-B-key',12,'GBP','metre',88,'GBP','metre');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_ok((SELECT count(*) = 0 FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000101')), 'authenticated without JWT denied');
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_ok((SELECT count(*) = 1 FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000101')), 'enabled supplier only');
SELECT pg_temp.assert_ok((SELECT bool_and(product->>'description_override'='A-only description'
  AND product->>'supplier_product_id'='00000000-0000-0000-0000-000000000301'
  AND product->>'company_account_id'='00000000-0000-0000-0000-000000000101'
  AND product->>'source_image_url' IS NULL AND product->>'cached_asset_key' IS NULL
  AND product->>'thumbnail_key' IS NULL AND product->>'texture_key' IS NULL
  AND NOT (product ? 'image_asset_key_override')
  AND NOT (product ?| ARRAY['wholesale_cost','effective_cost_override','cost_currency','cost_unit',
    'selling_price_override','selling_currency','selling_unit','account_reference','source_metadata','feed_run_id']))
 FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000101') AS product), 'safe projection excludes costs and private metadata');
-- Block 2B defines no affirmative browser-use vocabulary: even all-permitted rights
-- with an empty or unrecognized permitted-use object cannot release references.
SELECT pg_temp.assert_assets_hidden('00000000-0000-0000-0000-000000000101', 'both rights permitted, browser use not established');
RESET ROLE;
UPDATE public.suppliers SET asset_rights_status = 'restricted' WHERE id = '00000000-0000-0000-0000-000000000201';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_assets_hidden('00000000-0000-0000-0000-000000000101', 'supplier rights not permitted');
RESET ROLE;
UPDATE public.suppliers SET asset_rights_status = 'permitted' WHERE id = '00000000-0000-0000-0000-000000000201';
UPDATE public.supplier_products SET image_rights_status = 'restricted'
 WHERE id = '00000000-0000-0000-0000-000000000301';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_assets_hidden('00000000-0000-0000-0000-000000000101', 'product image rights not permitted');
RESET ROLE;
UPDATE public.supplier_products SET image_rights_status = 'permitted',
 image_permitted_uses = '{"unrecognised_use":true}'::jsonb
 WHERE id = '00000000-0000-0000-0000-000000000301';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_assets_hidden('00000000-0000-0000-0000-000000000101', 'unknown permission key cannot grant browser use');
RESET ROLE;
UPDATE public.supplier_products SET image_permitted_uses = '{"unrecognised_use":false}'::jsonb
 WHERE id = '00000000-0000-0000-0000-000000000301';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_assets_hidden('00000000-0000-0000-0000-000000000101', 'explicitly false/unrecognised use cannot grant browser use');
RESET ROLE;
SELECT pg_temp.expect_null_rejected($q$UPDATE public.suppliers SET asset_rights_status = NULL
 WHERE id = '00000000-0000-0000-0000-000000000201'$q$);
SELECT pg_temp.expect_null_rejected($q$UPDATE public.supplier_products SET image_rights_status = NULL
 WHERE id = '00000000-0000-0000-0000-000000000301'$q$);
SELECT pg_temp.expect_null_rejected($q$UPDATE public.supplier_products SET image_permitted_uses = NULL
 WHERE id = '00000000-0000-0000-0000-000000000301'$q$);
UPDATE public.suppliers SET asset_rights_status = 'unknown' WHERE id = '00000000-0000-0000-0000-000000000201';
UPDATE public.supplier_products SET image_rights_status = 'unknown', image_permitted_uses = '{}'::jsonb
 WHERE id = '00000000-0000-0000-0000-000000000301';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_assets_hidden('00000000-0000-0000-0000-000000000101', 'unknown/default rights hidden; NULL rights rejected by schema');
SELECT pg_temp.assert_ok((SELECT count(*) = 0 FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000102')), 'other tenant denied');
SELECT pg_temp.expect_denied($q$SELECT * FROM public.supplier_products$q$);
SELECT pg_temp.expect_denied($q$UPDATE public.supplier_products SET supplier_description = 'tampered'$q$);
SELECT pg_temp.expect_denied($q$SELECT * FROM public.suppliers$q$);
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert_ok((SELECT count(*) = 1 FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000101')), 'active staff may discover safe projection');
SELECT pg_temp.assert_ok((SELECT count(*) = 0 FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000102')), 'staff cannot access other tenant');
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert_ok((SELECT count(*) = 1 FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000101')), 'active manager can read');
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
SELECT pg_temp.assert_ok((SELECT count(*) = 0 FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000101')), 'inactive member denied');
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SELECT pg_temp.assert_ok((SELECT product->>'description_override' = 'B-only description'
 FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000102') AS product), 'company B only sees own override');
SET LOCAL ROLE anon;
SELECT pg_temp.expect_denied($q$SELECT * FROM public.effective_company_supplier_products('00000000-0000-0000-0000-000000000101')$q$);
RESET ROLE;
ROLLBACK;
\echo 'Block 2C projection assertions passed (transaction rolled back)'
