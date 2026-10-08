-- Disposable database only, after Block 2B prerequisites and before Block 2C.
-- Apply Block 2C migration next with psql -v ON_ERROR_STOP=1: it must abort
-- with "Unexpected ... overload". The (uuid) function must remain absent.
\set ON_ERROR_STOP on
CREATE FUNCTION public.effective_company_supplier_products(p_company_account_id integer)
RETURNS SETOF jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
SELECT pg_catalog.to_regprocedure('public.effective_company_supplier_products(uuid)') IS NULL AS intended_not_yet_installed;
