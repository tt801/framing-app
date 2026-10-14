-- Phase 5E: bounded atomic staging transport only. Installation requires separate approval.
-- No backfill, historical record mutation, new table grants, or canonical writes.
BEGIN;

CREATE FUNCTION public.block2e_stage_rows(p_run_id uuid, p_rows jsonb) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_run public.supplier_feed_runs%ROWTYPE;
  v_row jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_run_id IS NULL OR p_rows IS NULL OR pg_catalog.jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'invalid staging batch' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100
    OR pg_catalog.octet_length(pg_catalog.convert_to(p_rows::text, 'UTF8')) > 262144 THEN
    RAISE EXCEPTION 'staging batch exceeds bounds' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_rows) AS e(value)
    WHERE pg_catalog.jsonb_typeof(e.value) <> 'object') THEN
    RAISE EXCEPTION 'staging batch elements must be objects' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.supplier_feed_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.persistence_version <> 2 OR v_run.status <> 'staged' THEN
    RAISE EXCEPTION 'run not staging' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT e.value FROM pg_catalog.jsonb_array_elements(p_rows)
    WITH ORDINALITY AS e(value, ordinal) ORDER BY e.ordinal LOOP
    v_ids := pg_catalog.array_append(v_ids, public.block2e_stage_row(p_run_id, v_row));
  END LOOP;
  RETURN v_ids;
END $$;

REVOKE ALL ON FUNCTION public.block2e_stage_rows(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block2e_stage_rows(uuid,jsonb) TO service_role;

COMMIT;
