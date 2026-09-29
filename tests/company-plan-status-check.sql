-- Run with psql -v disposable_db=1 -f tests/company-plan-status-check.sql
-- ONLY against an initialized disposable local Supabase database as postgres.
-- This harness applies the forward migration locally; never point it at production.
\set ON_ERROR_STOP on
\if :{?disposable_db}
\else
  \echo 'Refusing to run: pass -v disposable_db=1 for a disposable local database.'
  SELECT 1 / 0;
\endif
DO $$
BEGIN
  IF current_user <> 'postgres' OR
     (inet_server_addr() IS NOT NULL AND inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet)) THEN
    RAISE EXCEPTION 'Only a local disposable database connection as postgres is allowed';
  END IF;
END $$;

-- Reproduce the exact currently observed production check in the disposable DB.
-- Repository baseline scripts already allow past_due, so an unmodified baseline
-- cannot demonstrate the before state. This schema setup is LOCAL ONLY.
BEGIN;
ALTER TABLE public.company_accounts
  DROP CONSTRAINT company_accounts_plan_status_check,
  ADD CONSTRAINT company_accounts_plan_status_check
    CHECK (plan_status IN ('trialing', 'active', 'expired'));
COMMIT;

-- RED: that currently deployed check must reject an otherwise valid transition.
BEGIN;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
VALUES ('73000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'plan-status-fixture@test.local', now(), now(), now());
INSERT INTO public.company_accounts (id, owner_user_id, company_name, plan_status)
VALUES ('74000000-0000-4000-8000-000000000001',
        '73000000-0000-4000-8000-000000000001', 'Plan status fixture', 'active');
DO $$
DECLARE rejected_constraint text;
BEGIN
  BEGIN
    UPDATE public.company_accounts SET plan_status = 'past_due'
    WHERE id = '74000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Old constraint unexpectedly accepted past_due';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    IF rejected_constraint <> 'company_accounts_plan_status_check' THEN
      RAISE EXCEPTION 'Wrong constraint rejected past_due: %', rejected_constraint;
    END IF;
  END;
  IF (SELECT plan_status FROM public.company_accounts
      WHERE id = '74000000-0000-4000-8000-000000000001') <> 'active' THEN
    RAISE EXCEPTION 'Failed transition modified the account';
  END IF;
END $$;
ROLLBACK;

-- Apply exactly the proposed forward migration to this disposable database.
\ir ../migrations/20260929_allow_company_account_past_due.sql

-- GREEN: exercise real stored values and the actual writable-account function.
BEGIN;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
VALUES ('73000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'plan-status-fixture@test.local', now(), now(), now());
INSERT INTO public.company_accounts (id, owner_user_id, company_name, plan_status)
VALUES ('74000000-0000-4000-8000-000000000001',
        '73000000-0000-4000-8000-000000000001', 'Plan status fixture', 'active');
DO $$
DECLARE fixture_id uuid := '74000000-0000-4000-8000-000000000001';
        stored_status text;
        rejected_constraint text;
        next_status text;
BEGIN
  IF public.is_company_account_writable(fixture_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Active account must be writable';
  END IF;
  FOREACH next_status IN ARRAY ARRAY['past_due', 'active', 'trialing', 'expired'] LOOP
    UPDATE public.company_accounts SET plan_status = next_status,
      trial_ends_at = now() + interval '14 days' WHERE id = fixture_id;
    SELECT plan_status INTO stored_status FROM public.company_accounts WHERE id = fixture_id;
    IF stored_status IS DISTINCT FROM next_status THEN
      RAISE EXCEPTION 'Expected stored status %, got %', next_status, stored_status;
    END IF;
    IF next_status = 'past_due' AND public.is_company_account_writable(fixture_id) IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Past-due account must be non-writable';
    END IF;
    IF next_status = 'active' AND public.is_company_account_writable(fixture_id) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Active account must remain writable';
    END IF;
  END LOOP;
  BEGIN
    UPDATE public.company_accounts SET plan_status = 'unknown_status' WHERE id = fixture_id;
    RAISE EXCEPTION 'Unknown status unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    IF rejected_constraint <> 'company_accounts_plan_status_check' THEN
      RAISE EXCEPTION 'Wrong constraint rejected unknown status: %', rejected_constraint;
    END IF;
  END;
  SELECT plan_status INTO stored_status FROM public.company_accounts WHERE id = fixture_id;
  IF stored_status <> 'expired' THEN
    RAISE EXCEPTION 'Rejected status altered the account: %', stored_status;
  END IF;
END $$;
ROLLBACK;
