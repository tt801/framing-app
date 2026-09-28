-- Run ONLY against a disposable local Supabase database with the forward migration applied.
-- All synthetic fixtures and mutations are rolled back. Never run on production.
-- Before the fix, the first A-manager -> B SELECT assertion fails.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE postgres;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at) VALUES
  ('71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-owner-a@test.local', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-manager-a@test.local', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'rls-staff-a@test.local', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'rls-owner-b@test.local', now(), now(), now()),
  ('71000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'rls-owner-c@test.local', now(), now(), now());
INSERT INTO public.company_accounts (id, owner_user_id, company_name, plan_status) VALUES
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Fixture A', 'active'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000004', 'Fixture B', 'active'),
  ('72000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000005', 'Fixture C', 'active');
INSERT INTO public.company_members (company_account_id, user_id, email, role, status) VALUES
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'rls-owner-a@test.local', 'owner', 'active'),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'rls-manager-a@test.local', 'manager', 'active'),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000003', 'rls-staff-a@test.local', 'staff', 'active'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000004', 'rls-owner-b@test.local', 'owner', 'active');
-- B has both records. A is initially absent for legitimate INSERT; C is absent
-- to test forbidden cross-tenant INSERT without a duplicate-key false positive.
INSERT INTO public.company_settings (company_account_id, settings)
VALUES ('72000000-0000-4000-8000-000000000002', '{"marker":"B-original"}'::jsonb);
INSERT INTO public.company_catalog (company_account_id, catalog)
VALUES ('72000000-0000-4000-8000-000000000002', '{"marker":"B-original"}'::jsonb);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
DECLARE tbl text; field_name text; visible_count integer; affected integer;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['company_settings', 'company_catalog'] LOOP
    field_name := CASE WHEN tbl = 'company_settings' THEN 'settings' ELSE 'catalog' END;
    -- Deliberately query B's ID while authenticated as A's manager.
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_account_id = $1', tbl)
      INTO visible_count USING '72000000-0000-4000-8000-000000000002'::uuid;
    IF visible_count <> 0 THEN RAISE EXCEPTION 'A manager can SELECT B %', tbl; END IF;
    BEGIN
      EXECUTE format('INSERT INTO public.%I (company_account_id, %I) VALUES ($1, $2::jsonb)', tbl, field_name)
        USING '72000000-0000-4000-8000-000000000003'::uuid, '{"marker":"unauthorized"}';
      RAISE EXCEPTION 'A manager can INSERT C %', tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    EXECUTE format('UPDATE public.%I SET %I = $1::jsonb WHERE company_account_id = $2', tbl, field_name)
      USING '{"marker":"unauthorized"}', '72000000-0000-4000-8000-000000000002'::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'A manager can UPDATE B %', tbl; END IF;
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE company_account_id = $1', tbl)
        USING '72000000-0000-4000-8000-000000000002'::uuid;
      RAISE EXCEPTION 'Authenticated DELETE unexpectedly granted on %', tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    EXECUTE format('INSERT INTO public.%I (company_account_id, %I) VALUES ($1, $2::jsonb)', tbl, field_name)
      USING '72000000-0000-4000-8000-000000000001'::uuid, '{"marker":"A-manager"}';
    EXECUTE format('UPDATE public.%I SET %I = $1::jsonb WHERE company_account_id = $2', tbl, field_name)
      USING '{"marker":"A-updated"}', '72000000-0000-4000-8000-000000000001'::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'A manager cannot UPDATE own %', tbl; END IF;
  END LOOP;
END $$;

-- Also target B's ID for INSERT when its rows are absent: no PK collision can
-- conceal a permissive WITH CHECK. The setup/restore writes remain local fixtures.
RESET ROLE;
SET LOCAL ROLE postgres;
DELETE FROM public.company_settings WHERE company_account_id = '72000000-0000-4000-8000-000000000002';
DELETE FROM public.company_catalog WHERE company_account_id = '72000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
DO $$
DECLARE tbl text; field_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['company_settings', 'company_catalog'] LOOP
    field_name := CASE WHEN tbl = 'company_settings' THEN 'settings' ELSE 'catalog' END;
    BEGIN
      EXECUTE format('INSERT INTO public.%I (company_account_id, %I) VALUES ($1, $2::jsonb)', tbl, field_name)
        USING '72000000-0000-4000-8000-000000000002'::uuid, '{"marker":"unauthorized"}';
      RAISE EXCEPTION 'A manager can INSERT B %', tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE postgres;
INSERT INTO public.company_settings (company_account_id, settings)
VALUES ('72000000-0000-4000-8000-000000000002', '{"marker":"B-original"}'::jsonb);
INSERT INTO public.company_catalog (company_account_id, catalog)
VALUES ('72000000-0000-4000-8000-000000000002', '{"marker":"B-original"}'::jsonb);
SET LOCAL ROLE authenticated;

-- A's owner also has an active owner membership, the vulnerable case.
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
DO $$
DECLARE tbl text; field_name text; visible_count integer; affected integer;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['company_settings', 'company_catalog'] LOOP
    field_name := CASE WHEN tbl = 'company_settings' THEN 'settings' ELSE 'catalog' END;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_account_id = $1', tbl)
      INTO visible_count USING '72000000-0000-4000-8000-000000000001'::uuid;
    IF visible_count <> 1 THEN RAISE EXCEPTION 'A owner cannot SELECT own %', tbl; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_account_id = $1', tbl)
      INTO visible_count USING '72000000-0000-4000-8000-000000000002'::uuid;
    IF visible_count <> 0 THEN RAISE EXCEPTION 'A owner can SELECT B %', tbl; END IF;
    BEGIN
      EXECUTE format('INSERT INTO public.%I (company_account_id, %I) VALUES ($1, $2::jsonb)', tbl, field_name)
        USING '72000000-0000-4000-8000-000000000003'::uuid, '{"marker":"unauthorized"}';
      RAISE EXCEPTION 'A owner can INSERT C %', tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    EXECUTE format('UPDATE public.%I SET %I = $1::jsonb WHERE company_account_id = $2', tbl, field_name)
      USING '{"marker":"A-owner"}', '72000000-0000-4000-8000-000000000001'::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'A owner cannot UPDATE own %', tbl; END IF;
    EXECUTE format('UPDATE public.%I SET %I = $1::jsonb WHERE company_account_id = $2', tbl, field_name)
      USING '{"marker":"unauthorized"}', '72000000-0000-4000-8000-000000000002'::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'A owner can UPDATE B %', tbl; END IF;
  END LOOP;
END $$;

-- Staff may read A but cannot write either A or another business.
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
DO $$
DECLARE tbl text; field_name text; visible_count integer; affected integer;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['company_settings', 'company_catalog'] LOOP
    field_name := CASE WHEN tbl = 'company_settings' THEN 'settings' ELSE 'catalog' END;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_account_id = $1', tbl)
      INTO visible_count USING '72000000-0000-4000-8000-000000000001'::uuid;
    IF visible_count <> 1 THEN RAISE EXCEPTION 'A staff cannot SELECT own %', tbl; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_account_id = $1', tbl)
      INTO visible_count USING '72000000-0000-4000-8000-000000000002'::uuid;
    IF visible_count <> 0 THEN RAISE EXCEPTION 'A staff can SELECT B %', tbl; END IF;
    BEGIN
      EXECUTE format('INSERT INTO public.%I (company_account_id, %I) VALUES ($1, $2::jsonb)', tbl, field_name)
        USING '72000000-0000-4000-8000-000000000003'::uuid, '{"marker":"unauthorized"}';
      RAISE EXCEPTION 'A staff can INSERT C %', tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    EXECUTE format('UPDATE public.%I SET %I = $1::jsonb WHERE company_account_id = $2', tbl, field_name)
      USING '{"marker":"unauthorized"}', '72000000-0000-4000-8000-000000000001'::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'A staff can UPDATE own %', tbl; END IF;
    EXECUTE format('UPDATE public.%I SET %I = $1::jsonb WHERE company_account_id = $2', tbl, field_name)
      USING '{"marker":"unauthorized"}', '72000000-0000-4000-8000-000000000002'::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'A staff can UPDATE B %', tbl; END IF;
  END LOOP;
END $$;

-- B's owner retains B read/write, not A access.
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
DO $$
DECLARE tbl text; field_name text; visible_count integer; affected integer;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['company_settings', 'company_catalog'] LOOP
    field_name := CASE WHEN tbl = 'company_settings' THEN 'settings' ELSE 'catalog' END;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_account_id = $1', tbl)
      INTO visible_count USING '72000000-0000-4000-8000-000000000002'::uuid;
    IF visible_count <> 1 THEN RAISE EXCEPTION 'B owner cannot SELECT own %', tbl; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_account_id = $1', tbl)
      INTO visible_count USING '72000000-0000-4000-8000-000000000001'::uuid;
    IF visible_count <> 0 THEN RAISE EXCEPTION 'B owner can SELECT A %', tbl; END IF;
    EXECUTE format('UPDATE public.%I SET %I = $1::jsonb WHERE company_account_id = $2', tbl, field_name)
      USING '{"marker":"B-owner"}', '72000000-0000-4000-8000-000000000002'::uuid;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'B owner cannot UPDATE own %', tbl; END IF;
  END LOOP;
END $$;

-- C's owner has no company_members row: the correctly scoped account-owner
-- branch must still allow initial creation, without relying on membership.
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000005', true);
DO $$
DECLARE tbl text; field_name text; visible_count integer;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['company_settings', 'company_catalog'] LOOP
    field_name := CASE WHEN tbl = 'company_settings' THEN 'settings' ELSE 'catalog' END;
    EXECUTE format('INSERT INTO public.%I (company_account_id, %I) VALUES ($1, $2::jsonb)', tbl, field_name)
      USING '72000000-0000-4000-8000-000000000003'::uuid, '{"marker":"C-owner"}';
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_account_id = $1', tbl)
      INTO visible_count USING '72000000-0000-4000-8000-000000000003'::uuid;
    IF visible_count <> 1 THEN RAISE EXCEPTION 'C owner cannot SELECT own %', tbl; END IF;
  END LOOP;
END $$;

RESET ROLE;
SET LOCAL ROLE postgres;
DO $$ BEGIN
  IF (SELECT settings->>'marker' FROM public.company_settings WHERE company_account_id = '72000000-0000-4000-8000-000000000003') IS DISTINCT FROM 'C-owner'
     OR (SELECT catalog->>'marker' FROM public.company_catalog WHERE company_account_id = '72000000-0000-4000-8000-000000000003') IS DISTINCT FROM 'C-owner' THEN
    RAISE EXCEPTION 'Cross-tenant INSERT changed C';
  END IF;
  IF (SELECT settings->>'marker' FROM public.company_settings WHERE company_account_id = '72000000-0000-4000-8000-000000000002') IS DISTINCT FROM 'B-owner'
     OR (SELECT catalog->>'marker' FROM public.company_catalog WHERE company_account_id = '72000000-0000-4000-8000-000000000002') IS DISTINCT FROM 'B-owner' THEN
    RAISE EXCEPTION 'Cross-tenant UPDATE changed B';
  END IF;
END $$;
ROLLBACK;
