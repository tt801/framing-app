-- REVIEW ONLY: NOT EXECUTED. Disposable PostgreSQL, NEVER hosted/Sandbox/Production.
-- Prerequisites: supplier fixture + actual settings/catalogue/customer/quote/invoice/job/
-- company_presets source schemas and their trigger dependencies, Block 2B/2C, SC-V2.2.
-- Full history is REQUIRED, not an optional reduced-schema pass. Minimal fixture Auth/writability
-- is synthetic; also repeat on a representative provider-initialized schema before release.
-- Execute with psql ON_ERROR_STOP only after separate authorization. Rollback all fixtures.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_ok(ok boolean, reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',reason; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(query text, expected_code text, expected_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE code text; message text;
BEGIN
  BEGIN EXECUTE query;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,message=MESSAGE_TEXT; END;
  IF code IS DISTINCT FROM expected_code OR (expected_message IS NOT NULL AND message IS DISTINCT FROM expected_message) THEN
    RAISE EXCEPTION 'ASSERT: expected % / %, got % / %',expected_code,expected_message,code,message;
  END IF;
END $$;
CREATE FUNCTION pg_temp.command(supplier uuid, enabled boolean, revision bigint DEFAULT NULL,
  company uuid DEFAULT '11111111-1111-4111-8111-111111111111') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('action','set-enabled','companyAccountId',company,
    'supplier',jsonb_build_object('kind','central','id',supplier),'enabled',enabled,'expectedRevision',revision)
$$;
-- Owner-only probes use the same vectors as the TypeScript name-projection tests.
SELECT pg_temp.assert_ok(public.scv22_display_name(repeat(chr(128512),101))=repeat(chr(128512),100),'UTF-16 bounded astral prefix');
SELECT pg_temp.assert_ok(public.scv22_display_name(repeat('x',199)||chr(128512)||'tail')=repeat('x',199),'never split surrogate pair');
SELECT pg_temp.assert_ok(public.scv22_display_name('A'||chr(10)||'B'||chr(127)||'C')='A B C','deterministic control replacement');
SELECT pg_temp.assert_ok(public.scv22_display_name('A'||chr(133)||'B'||chr(159)||'C')='A B C','C1 control replacement');
SELECT pg_temp.assert_ok(public.scv22_display_name(chr(160))='Unnamed supplier','empty sanitized fallback');
SELECT pg_temp.expect_error($q$SELECT public.scv22_supplier('00000000-0000-0000-0000-000000000000','Name','active',ARRAY['GB'])$q$,'22023','Supplier unavailable');
SELECT pg_temp.assert_ok(public.scv22_supplier('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',chr(160)||'Name'||chr(160),'active',ARRAY['GB'])->>'name'='Name','SC-V2.1 trim normalization');
SELECT pg_temp.assert_ok(public.scv22_coverage(ARRAY[['GB'],['US']]) IS NULL,'multidimensional coverage unspecified');
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['quotes','jobs','invoices','company_presets','company_catalog','company_settings'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Required historical table missing: %',t; END IF;
  END LOOP;
END $$;
INSERT INTO auth.users(id,email) VALUES
 ('10000000-0000-4000-8000-000000000001','owner-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','owner-b@example.invalid'),
 ('10000000-0000-4000-8000-000000000003','manager@example.invalid'),
 ('10000000-0000-4000-8000-000000000004','staff@example.invalid'),
 ('10000000-0000-4000-8000-000000000005','inactive@example.invalid');
INSERT INTO public.company_accounts(id,owner_user_id,plan_status) VALUES
 ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','active'),
 ('22222222-2222-4222-8222-222222222222','10000000-0000-4000-8000-000000000002','active');
INSERT INTO public.company_members(company_account_id,user_id,role,status) VALUES
 ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000003','manager','active'),
 ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000004','staff','active'),
 ('11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000005','manager','inactive');
INSERT INTO public.suppliers(id,name,slug,status,countries,source_metadata) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','SCV22 GB','scv22-gb','active',ARRAY['GB'],'{"private":"hidden"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','SCV22 US','scv22-us','active',ARRAY['US'],'{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','SCV22 unknown'||repeat('x',250)||chr(10),'scv22-unknown','active',ARRAY['GB','ZZ'],'{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','SCV22 paused'||repeat(chr(128512),200)||chr(127),'scv22-paused','paused','{}','{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','SCV22 retired','scv22-retired','retired','{}','{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','SCV22 draft','scv22-draft','draft','{}','{}');
INSERT INTO public.company_suppliers(company_account_id,supplier_id,enabled,account_reference) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',true,'PRIVATE'),
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',true,'PRIVATE'),
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',true,'PRIVATE-DRAFT'),
 ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,'PRIVATE-B');
INSERT INTO public.supplier_products(id,supplier_id,category,supplier_description,wholesale_cost,cost_currency,cost_unit,cost_tax_basis)
 VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','frame','Historical product',19,'GBP','metre','exclusive'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','frame','Discovery product',23,'GBP','metre','exclusive');
INSERT INTO public.company_product_overrides(company_account_id,supplier_id,supplier_product_id,selling_price_override)
 VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',NULL);
INSERT INTO public.supplier_product_cost_events(supplier_id,supplier_product_id,event_key,new_cost,new_currency,new_unit,new_tax_basis,reason)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','scv22-history',19,'GBP','metre','exclusive','Synthetic historical fixture');
-- Representative saved documents: identity, commercial snapshot and saved design state.
INSERT INTO public.quotes(id,company_account_id,payload) VALUES
 ('scv22-history-quote','11111111-1111-4111-8111-111111111111',
 '{"status":"accepted","total":123.45,"items":[{"supplierId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4","supplierProductId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","description":"Original saved moulding","unitPrice":41.15,"quantity":3}],"design":{"frameWidth":4,"colour":"#333333"}}');
INSERT INTO public.invoices(id,company_account_id,quote_id,invoice_number,payload) VALUES
 ('scv22-history-invoice','11111111-1111-4111-8111-111111111111','scv22-history-quote','SCV22-HISTORY',
 '{"number":"SCV22-HISTORY","total":123.45,"payments":[{"id":"saved-payment","amount":50}],"items":[{"description":"Original saved moulding","supplierId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4","unitPrice":41.15}]}');
INSERT INTO public.jobs(id,company_account_id,ref_no,quote_id,invoice_id,payload) VALUES
 ('scv22-history-job','11111111-1111-4111-8111-111111111111',987654,'scv22-history-quote','scv22-history-invoice',
 '{"status":"in-progress","supplierId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4","specification":{"frame":"Original saved moulding","width":4},"savedDesign":{"colour":"#333333","frameId":"saved-frame"}}');
INSERT INTO public.company_presets(id,company_account_id,name,state) VALUES
 ('scv22-history-preset','11111111-1111-4111-8111-111111111111','Saved supplier design',
 '{"frameId":"saved-frame","supplierId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4","supplierProductId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","frameWidth":4,"appearance":{"colour":"#333333","name":"Original saved moulding"}}');
INSERT INTO public.company_catalog(company_account_id,catalog) VALUES
 ('11111111-1111-4111-8111-111111111111','{"frames":[{"id":"saved-frame","pricePerMeter":41.15}],"stock":{"frames":[]}}');
INSERT INTO public.company_settings(company_account_id,settings) VALUES
 ('11111111-1111-4111-8111-111111111111','{"country":"South Africa","currencyCode":"ZAR","addressLine1":"Historical address"}');
CREATE TEMP TABLE scv22_original_names AS SELECT id,name FROM public.suppliers;
-- Full-row fingerprints include payload/state, timestamps and revisions. No optional skips.
CREATE TEMP TABLE scv22_before(table_name text PRIMARY KEY, fingerprint text);
DO $$ DECLARE t text; h text; n bigint; BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_products','company_product_overrides','supplier_product_cost_events',
    'company_catalog','quotes','jobs','invoices','company_presets','company_settings'] LOOP
      IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Required historical table missing: %',t; END IF;
      EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;
      IF n=0 THEN RAISE EXCEPTION 'Required historical fixture missing: %',t; END IF;
      EXECUTE format('SELECT md5(coalesce(string_agg(j, %L ORDER BY j), %L)) FROM (SELECT to_jsonb(t)::text j FROM public.%I t) x','','',t) INTO h;
      INSERT INTO scv22_before VALUES(t,h);

  END LOOP;
END $$;
-- Privilege inventory includes column grants; service-role compatibility remains intact.
CREATE FUNCTION pg_temp.assert_history() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; h text;
BEGIN
  PERFORM pg_temp.assert_ok((SELECT count(*)=9 FROM pg_temp.scv22_before),'complete required history inventory');
  FOR r IN SELECT * FROM pg_temp.scv22_before LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(j, %L ORDER BY j), %L)) FROM (SELECT to_jsonb(t)::text j FROM public.%I t) x','','',r.table_name) INTO h;
    PERFORM pg_temp.assert_ok(h IS NOT DISTINCT FROM r.fingerprint,'unchanged protected table '||r.table_name);
  END LOOP;
END $$;
DO $$ DECLARE r text; privilege text; c record; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      PERFORM pg_temp.assert_ok(NOT has_table_privilege(r,'public.company_suppliers',privilege),'no direct table '||r||' '||privilege);
    END LOOP;
    FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='public.company_suppliers'::regclass AND attnum>0 AND NOT attisdropped LOOP
      FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        PERFORM pg_temp.assert_ok(NOT has_column_privilege(r,'public.company_suppliers',c.attname,privilege),'no column bypass');
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
    PERFORM pg_temp.assert_ok(has_table_privilege('service_role','public.company_suppliers',privilege),'platform table privilege retained '||privilege);
  END LOOP;
  PERFORM pg_temp.assert_ok(NOT has_function_privilege('authenticated','public.scv22_lock_manager(uuid)','EXECUTE'),'helper sealed');
  PERFORM pg_temp.assert_ok(NOT has_function_privilege('authenticated','public.scv22_display_name(text)','EXECUTE'),'display helper sealed');
  PERFORM pg_temp.assert_ok(NOT has_function_privilege('service_role','public.scv22_country_metadata()','EXECUTE'),'trigger helper sealed');
  PERFORM pg_temp.assert_ok(has_function_privilege('service_role','public.scv22_country_valid(text)','EXECUTE'),'direct writer can evaluate country CHECK');
  PERFORM pg_temp.assert_ok(NOT has_table_privilege('service_role','public.company_supplier_preferences','DELETE'),'country deletion not granted by provider defaults');
  PERFORM pg_temp.assert_ok(NOT has_function_privilege('anon','public.subscriber_supplier_directory(uuid,text,text,integer,integer)','EXECUTE'),'anon RPC sealed');
END $$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_ok(current_user='authenticated','real client role');
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM public.effective_company_supplier_products('11111111-1111-4111-8111-111111111111')),'discovery still callable after direct privileges removed');
SELECT pg_temp.expect_error('SELECT * FROM public.suppliers','42501');
SELECT pg_temp.expect_error('UPDATE public.company_suppliers SET enabled=false','42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.company_suppliers(company_account_id,supplier_id) VALUES('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$q$,'42501');
SELECT pg_temp.expect_error('DELETE FROM public.company_suppliers','42501');
SELECT pg_temp.expect_error('UPDATE public.company_supplier_preferences SET operating_country_code=''ZA''','42501');
SELECT pg_temp.assert_ok(public.company_operating_country('11111111-1111-4111-8111-111111111111')->'countryCode'='null'::jsonb,'missing country has no default');
SELECT pg_temp.assert_ok((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(public.company_operating_country('11111111-1111-4111-8111-111111111111')) k)
 =ARRAY['companyAccountId','countryCode','revision'],'country response exact field allowlist');
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111','recommended','SCV22')),'missing country has no recommendations');
SELECT pg_temp.assert_ok((SELECT count(*)=3 FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111','international','SCV22')),'pre-enable international directory active only');
SELECT pg_temp.assert_ok((SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(d) k)=ARRAY['countries','id','kind','name','status'])
 FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111','international','SCV22') d),'exact directory allowlist');
SELECT pg_temp.assert_ok((SELECT d->'countries'='null'::jsonb FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111','international','SCV22 unknown') d),'partly invalid coverage unspecified');
SELECT pg_temp.assert_ok((SELECT d->>'name'='SCV22 unknown'||repeat('x',187) AND d->>'id'='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3' AND d->>'status'='active'
 FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111','international','SCV22 unknown') d),'long raw name projected without losing identity or eligibility');
SELECT pg_temp.expect_error($q$SELECT * FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111','international','',101)$q$,'22023','Invalid supplier request');
SELECT pg_temp.assert_ok((SELECT count(*)=1 FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111','international','SCV22',1,1)),'bounded second page');
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111','international','%')),'search is literal not wildcard');
SELECT public.set_company_operating_country('11111111-1111-4111-8111-111111111111','GB',NULL);
SELECT pg_temp.assert_ok((SELECT count(*)=1 FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111','recommended','SCV22')),'GB recommendation');
SELECT public.set_company_operating_country('11111111-1111-4111-8111-111111111111','GB',1);
SELECT pg_temp.assert_ok(public.company_operating_country('11111111-1111-4111-8111-111111111111')->>'revision'='1','country no-op stable');
DO $$ DECLARE c text; BEGIN
  FOREACH c IN ARRAY ARRAY['ZZ','UK','gb','South Africa',' GB',''] LOOP
    PERFORM pg_temp.expect_error(format('SELECT public.set_company_operating_country(%L,%L,1)','11111111-1111-4111-8111-111111111111',c),'22023','Invalid operating country');
  END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT public.set_company_operating_country('11111111-1111-4111-8111-111111111111','US',2)$q$,'40001','Country revision conflict');
-- Retained paused/retired rows and explicit enabled/effective distinction.
SELECT pg_temp.assert_ok((SELECT count(*)=3 FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111')),'retained central relationships');
SELECT pg_temp.assert_ok((SELECT x->>'availability'='supplier-draft' AND x->>'canEnable'='false' AND x->>'enabled'='true'
 FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111') x WHERE x->'supplier'->>'status'='draft'),'existing draft visible but unavailable');
SELECT pg_temp.assert_ok((SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k)=ARRAY['availability','canEnable','companyAccountId','enabled','revision','supplier'])
 FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111') x),'exact relationship allowlist');
SELECT pg_temp.assert_ok((SELECT x->>'availability'='supplier-paused' AND x->>'enabled'='true' AND x->>'canEnable'='false'
 FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111') x WHERE x->'supplier'->>'status'='paused'),'configured versus effective');
-- Create, replay without needless update, stale rejection, disable, reactivate.
DO $$ DECLARE bad jsonb; BEGIN
  FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'{}'::jsonb,'[]'::jsonb,'[null]'::jsonb,
    jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true)||'{"price":1}'::jsonb),
    jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true)||'{"action":"toggle"}'::jsonb),
    jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true)||'{"expectedRevision":0}'::jsonb),
    jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true)||'{"enabled":"true"}'::jsonb),
    jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true)||'{"supplier":{"kind":"private","id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"}}'::jsonb),
    jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true)||'{"supplier":{"kind":"central","id":"bad"}}'::jsonb),
    jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true)-'expectedRevision'),
    jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,NULL,'22222222-2222-4222-8222-222222222222'))
  )) LOOP
    PERFORM pg_temp.expect_error(format('SELECT * FROM public.set_company_central_suppliers(%L,%L::jsonb)',
      '11111111-1111-4111-8111-111111111111',bad::text),'22023','Invalid supplier command');
  END LOOP;
END $$;
SELECT pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,1)))$q$,'40001','Supplier revision conflict');
SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',false)));
SELECT pg_temp.assert_ok((SELECT count(*)=3 FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111')),'absent disable creates no relationship');
SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true)));
SELECT pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true)))$q$,'40001','Supplier revision conflict');
SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,1)));
SELECT pg_temp.assert_ok((SELECT x->>'revision'='1' FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111') x WHERE x->'supplier'->>'id'='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),'idempotent revision');
SELECT pg_temp.assert_ok((SELECT count(*)=1 FROM public.effective_company_supplier_products('11111111-1111-4111-8111-111111111111')),'enabled discovery only');
SELECT pg_temp.assert_ok((SELECT bool_and(NOT (p ?| ARRAY['wholesale_cost','source_metadata','account_reference','selling_price_override','effective_cost_override'])
 AND p->'source_image_url'='null'::jsonb AND p->'cached_asset_key'='null'::jsonb AND p->'texture_key'='null'::jsonb)
 FROM public.effective_company_supplier_products('11111111-1111-4111-8111-111111111111') p),'discovery costs and assets remain withheld');
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM public.effective_company_supplier_products('22222222-2222-4222-8222-222222222222')),'foreign discovery remains empty');
SELECT pg_temp.assert_history();
SELECT pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',false,2)))$q$,'40001','Supplier revision conflict');
SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',false,1)));
SELECT pg_temp.assert_ok((SELECT count(*)=0 FROM public.effective_company_supplier_products('11111111-1111-4111-8111-111111111111')),'disabled discovery empty');
SELECT pg_temp.assert_history();
SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,2)));
SELECT pg_temp.assert_ok((SELECT count(*)=1 FROM public.effective_company_supplier_products('11111111-1111-4111-8111-111111111111')),'discovery restored after reactivation');
SELECT pg_temp.assert_history();
-- First command changes A, second hits paused supplier: statement must roll back A.
SELECT pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',false,3),pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',true,1)))$q$,'22023','Supplier unavailable');
SELECT pg_temp.assert_ok((SELECT x->>'revision'='3' AND x->>'enabled'='true' FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111') x WHERE x->'supplier'->>'id'='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),'atomic rollback after earlier command');
SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',false,1),pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',false,1)));
SELECT pg_temp.assert_ok((SELECT count(*)=2 FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111') x WHERE x->>'availability'='disabled'),'disabled paused and retired relationships retained');
SELECT pg_temp.assert_history();
SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',false,1)));
SELECT pg_temp.assert_ok((SELECT x->>'enabled'='false' AND x->>'revision'='2' AND x->'supplier'->>'status'='draft'
 FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111') x WHERE x->'supplier'->>'id'='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),'draft disable retains identity');
SELECT pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',true,1)))$q$,'22023','Supplier unavailable');
SELECT pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',true)))$q$,'22023','Supplier unavailable');
SELECT pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',true,3),pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',false,3)))$q$,'22023','Invalid supplier command');
SELECT public.set_company_operating_country('11111111-1111-4111-8111-111111111111','US',1);
SELECT public.set_company_operating_country('11111111-1111-4111-8111-111111111111',NULL,2);
SELECT pg_temp.assert_ok((SELECT x->>'enabled'='true' FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111') x WHERE x->'supplier'->>'id'='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),'country changes preserve selection');
-- Both tenant directions: foreign reads/writes denied, not empty success.
SELECT pg_temp.expect_error($q$SELECT * FROM public.company_central_suppliers('22222222-2222-4222-8222-222222222222')$q$,'42501','Supplier management denied');
SELECT pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('22222222-2222-4222-8222-222222222222','[]')$q$,'42501','Supplier management denied');
SET LOCAL request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_ok((SELECT count(*)=1 FROM public.company_central_suppliers('22222222-2222-4222-8222-222222222222')),'B sees only B');
SELECT pg_temp.expect_error($q$SELECT * FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111')$q$,'42501','Supplier management denied');
-- Active manager can write; staff and inactive manager cannot read management or write.
SET LOCAL request.jwt.claim.sub='10000000-0000-4000-8000-000000000003';
SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111',jsonb_build_array(pg_temp.command('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',true)));
SELECT pg_temp.assert_ok((SELECT x->>'enabled'='true' AND x->>'revision'='1' FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111') x
 WHERE x->'supplier'->>'id'='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),'manager supplier write persisted');
SELECT public.set_company_operating_country('11111111-1111-4111-8111-111111111111','GB',3);
SELECT pg_temp.assert_ok(public.company_operating_country('11111111-1111-4111-8111-111111111111')->>'countryCode'='GB','manager country write readback');
RESET ROLE;
UPDATE public.company_members SET status='inactive' WHERE user_id='10000000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
DO $$ DECLARE u text; BEGIN
  FOREACH u IN ARRAY ARRAY['10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005',''] LOOP
    PERFORM set_config('request.jwt.claim.sub',u,true);
    PERFORM pg_temp.expect_error($q$SELECT * FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111')$q$,'42501','Supplier management denied');
    PERFORM pg_temp.expect_error($q$SELECT * FROM public.subscriber_supplier_directory('11111111-1111-4111-8111-111111111111')$q$,'42501','Supplier management denied');
    PERFORM pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111','[]')$q$,'42501','Supplier management denied');
    PERFORM pg_temp.expect_error($q$SELECT public.set_company_operating_country('11111111-1111-4111-8111-111111111111','GB',3)$q$,'42501','Supplier management denied');
    PERFORM pg_temp.expect_error($q$SELECT public.company_operating_country('11111111-1111-4111-8111-111111111111')$q$,'42501','Supplier management denied');
  END LOOP;
END $$;
RESET ROLE;
UPDATE public.company_accounts SET plan_status='expired' WHERE id='11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_ok((SELECT count(*)>0 FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111')),'read-only account retains reads');
SELECT pg_temp.expect_error($q$SELECT * FROM public.set_company_central_suppliers('11111111-1111-4111-8111-111111111111','[]')$q$,'42501','Supplier management denied');
SELECT pg_temp.expect_error($q$SELECT public.set_company_operating_country('11111111-1111-4111-8111-111111111111','GB',3)$q$,'42501','Supplier management denied');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT * FROM public.company_central_suppliers('11111111-1111-4111-8111-111111111111')$q$,'42501');
RESET ROLE;
-- Platform operations remain directly possible under actual service role.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_ok(current_user='service_role','platform role');
UPDATE public.company_suppliers SET enabled=false WHERE company_account_id='22222222-2222-4222-8222-222222222222';
INSERT INTO public.company_supplier_preferences(company_account_id,operating_country_code)
 VALUES('22222222-2222-4222-8222-222222222222','GB');
SELECT pg_temp.expect_error($q$UPDATE public.company_supplier_preferences SET operating_country_code='ZZ',write_expected_revision=1 WHERE company_account_id='22222222-2222-4222-8222-222222222222'$q$,'23514');
SELECT pg_temp.assert_ok((SELECT operating_country_code='GB' FROM public.company_supplier_preferences WHERE company_account_id='22222222-2222-4222-8222-222222222222'),'country CHECK readback');
CREATE TEMP TABLE scv22_country_times AS SELECT revision,updated_at FROM public.company_supplier_preferences
 WHERE company_account_id='22222222-2222-4222-8222-222222222222';
UPDATE public.company_supplier_preferences SET operating_country_code='US',write_expected_revision=1
 WHERE company_account_id='22222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_ok((SELECT p.revision=2 AND p.updated_at>t.updated_at AND p.write_expected_revision IS NULL
 FROM public.company_supplier_preferences p CROSS JOIN scv22_country_times t
 WHERE p.company_account_id='22222222-2222-4222-8222-222222222222'),'direct service write increments exactly once and consumes evidence');
UPDATE scv22_country_times SET revision=2,updated_at=(SELECT updated_at FROM public.company_supplier_preferences
 WHERE company_account_id='22222222-2222-4222-8222-222222222222');
UPDATE public.company_supplier_preferences SET operating_country_code='US',write_expected_revision=2,updated_at='2000-01-01'
 WHERE company_account_id='22222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_ok((SELECT p.revision=2 AND p.updated_at=t.updated_at FROM public.company_supplier_preferences p CROSS JOIN scv22_country_times t
 WHERE p.company_account_id='22222222-2222-4222-8222-222222222222'),'direct no-op preserves revision and timestamp');
SELECT pg_temp.expect_error($q$UPDATE public.company_supplier_preferences SET operating_country_code='GB',write_expected_revision=1 WHERE company_account_id='22222222-2222-4222-8222-222222222222'$q$,'40001','Country revision conflict');
SELECT pg_temp.expect_error($q$UPDATE public.company_supplier_preferences SET operating_country_code='GB' WHERE company_account_id='22222222-2222-4222-8222-222222222222'$q$,'40001','Country revision conflict');
SELECT pg_temp.expect_error($q$UPDATE public.company_supplier_preferences SET operating_country_code='GB',write_expected_revision=2,revision=99 WHERE company_account_id='22222222-2222-4222-8222-222222222222'$q$,'40001','Country revision conflict');
UPDATE public.company_supplier_preferences SET operating_country_code=NULL,write_expected_revision=2
 WHERE company_account_id='22222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_ok((SELECT revision=3 AND operating_country_code IS NULL AND write_expected_revision IS NULL FROM public.company_supplier_preferences
 WHERE company_account_id='22222222-2222-4222-8222-222222222222'),'explicit null direct write revision');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
SELECT pg_temp.expect_error($q$SELECT public.set_company_operating_country('22222222-2222-4222-8222-222222222222','GB',1)$q$,'40001','Country revision conflict');
SELECT public.set_company_operating_country('22222222-2222-4222-8222-222222222222','GB',3);
SELECT pg_temp.assert_ok(public.company_operating_country('22222222-2222-4222-8222-222222222222')->>'revision'='4','RPC uses trigger without double increment');
RESET ROLE;
SELECT pg_temp.assert_ok((SELECT p.updated_at>t.updated_at AND p.write_expected_revision IS NULL
 FROM public.company_supplier_preferences p CROSS JOIN scv22_country_times t
 WHERE p.company_account_id='22222222-2222-4222-8222-222222222222'),'RPC timestamp advances and evidence consumed');
UPDATE scv22_country_times SET updated_at=(SELECT updated_at FROM public.company_supplier_preferences
 WHERE company_account_id='22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;
SELECT public.set_company_operating_country('22222222-2222-4222-8222-222222222222','GB',4);
SELECT pg_temp.assert_ok(public.company_operating_country('22222222-2222-4222-8222-222222222222')->>'revision'='4','RPC no-op preserves trigger revision');
RESET ROLE;
SELECT pg_temp.assert_ok((SELECT p.revision=4 AND p.updated_at=t.updated_at FROM public.company_supplier_preferences p CROSS JOIN scv22_country_times t
 WHERE p.company_account_id='22222222-2222-4222-8222-222222222222'),'RPC no-op preserves timestamp');
SELECT pg_temp.assert_ok((SELECT NOT enabled FROM public.company_suppliers WHERE company_account_id='22222222-2222-4222-8222-222222222222'),'platform readback');
SELECT pg_temp.assert_ok((SELECT revision=2 AND account_reference='PRIVATE' FROM public.company_suppliers WHERE supplier_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4' AND company_account_id='11111111-1111-4111-8111-111111111111'),'disabled relationship identity and private reference preserved');
SELECT pg_temp.assert_history();
SELECT pg_temp.assert_ok(NOT EXISTS(SELECT 1 FROM scv22_original_names o FULL JOIN public.suppliers s USING(id)
 WHERE o.name IS DISTINCT FROM s.name),'original platform names unchanged');
ROLLBACK;
