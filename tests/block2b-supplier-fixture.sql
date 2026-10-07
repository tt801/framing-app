-- Disposable PostgreSQL ONLY. Minimal synthetic Supabase prerequisite for Block 2B tests.
-- This is not an installation script and must never run on Production or Sandbox.
-- Run once on a fresh local database before the checked-in Block 6B migration.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE public.company_accounts (
  id uuid PRIMARY KEY, owner_user_id uuid NOT NULL REFERENCES auth.users(id), plan_status text NOT NULL
);
CREATE TABLE public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_account_id uuid NOT NULL REFERENCES public.company_accounts(id),
  user_id uuid NOT NULL REFERENCES auth.users(id), role text NOT NULL, status text NOT NULL
);
CREATE FUNCTION public.is_active_company_member(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members
    WHERE company_account_id = p_company AND user_id = auth.uid() AND status = 'active')
$$;
CREATE FUNCTION public.is_company_account_writable(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_accounts
    WHERE id = p_company AND plan_status = 'active')
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.company_accounts, public.company_members TO authenticated;
GRANT SELECT ON auth.users TO authenticated;
