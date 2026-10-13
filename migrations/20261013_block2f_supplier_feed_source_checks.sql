-- Block 2F Phase 5B: append-only supplier feed check history.
-- Additive migration only. Do not run in Sandbox/Production without explicit approval.
BEGIN;

CREATE TABLE public.supplier_feed_source_checks (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  feed_source_id uuid NOT NULL REFERENCES public.supplier_feed_sources(id) ON DELETE RESTRICT,
  checked_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  status text NOT NULL CHECK (status IN ('changed','unchanged','fetch_error','evidence_error','validation_error','planning_error')),
  release_classification text CHECK (release_classification IS NULL OR release_classification IN ('changed','unchanged')),
  source_url text NOT NULL CHECK (pg_catalog.btrim(source_url) <> ''),
  published_update_source_url text NOT NULL CHECK (pg_catalog.btrim(published_update_source_url) <> ''),
  published_update_date text CHECK (published_update_date ~ '^\d{2}/\d{2}/\d{4}$'),
  published_update_date_raw text,
  published_update_match text,
  artifact_retrieved_at timestamptz,
  evidence_retrieved_at timestamptz,
  etag text,
  last_modified text,
  content_byte_length integer CHECK (content_byte_length IS NULL OR content_byte_length >= 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  release_logical_key text CHECK (release_logical_key IS NULL OR pg_catalog.btrim(release_logical_key) <> ''),
  feed_run_id uuid REFERENCES public.supplier_feed_runs(id) ON DELETE RESTRICT,
  plan_fingerprint text CHECK (plan_fingerprint IS NULL OR plan_fingerprint ~ '^[0-9a-f]{64}$'),
  error_code text CHECK (error_code IS NULL OR (pg_catalog.btrim(error_code) <> '' AND pg_catalog.length(error_code) <= 64)),
  error_summary text CHECK (error_summary IS NULL OR pg_catalog.length(error_summary) <= 512),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT block2f_check_classification_consistent CHECK (
    (status IN ('changed','unchanged') AND release_classification = status)
    OR (status IN ('fetch_error','evidence_error','validation_error','planning_error') AND release_classification IS NULL)
  ),
  CONSTRAINT block2f_check_success_has_sha CHECK (
    status NOT IN ('changed','unchanged') OR sha256 IS NOT NULL
  ),
  CONSTRAINT block2f_check_changed_has_plan_link CHECK (
    status <> 'changed' OR (feed_run_id IS NOT NULL AND plan_fingerprint IS NOT NULL AND release_logical_key IS NOT NULL)
  ),
  CONSTRAINT block2f_check_error_fields CHECK (
    (status IN ('fetch_error','evidence_error','validation_error','planning_error') AND error_code IS NOT NULL AND error_summary IS NOT NULL)
    OR (status IN ('changed','unchanged') AND error_code IS NULL AND error_summary IS NULL)
  )
);

CREATE INDEX block2f_source_checks_latest_idx
  ON public.supplier_feed_source_checks(feed_source_id, checked_at DESC, created_at DESC);

CREATE INDEX block2f_source_checks_latest_success_sha_idx
  ON public.supplier_feed_source_checks(feed_source_id, checked_at DESC, created_at DESC)
  WHERE status IN ('changed','unchanged') AND sha256 IS NOT NULL;

CREATE INDEX block2f_source_checks_release_key_idx
  ON public.supplier_feed_source_checks(feed_source_id, release_logical_key)
  WHERE release_logical_key IS NOT NULL;

CREATE INDEX block2f_source_checks_run_idx
  ON public.supplier_feed_source_checks(feed_run_id)
  WHERE feed_run_id IS NOT NULL;

CREATE FUNCTION public.block2f_source_check_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'supplier feed source checks are append-only' USING ERRCODE = '22023';
END $$;

CREATE TRIGGER block2f_source_check_guard
  BEFORE UPDATE OR DELETE ON public.supplier_feed_source_checks
  FOR EACH ROW EXECUTE FUNCTION public.block2f_source_check_guard();

REVOKE ALL ON FUNCTION public.block2f_source_check_guard() FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.supplier_feed_source_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_feed_source_checks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.supplier_feed_source_checks TO service_role;

CREATE FUNCTION public.block2e_record_source_check(
  p_feed_source_id uuid,
  p_checked_at timestamptz,
  p_status text,
  p_source_url text,
  p_published_update_source_url text,
  p_published_update_date text,
  p_published_update_date_raw text,
  p_published_update_match text,
  p_artifact_retrieved_at timestamptz,
  p_evidence_retrieved_at timestamptz,
  p_etag text,
  p_last_modified text,
  p_content_byte_length integer,
  p_sha256 text,
  p_release_logical_key text,
  p_feed_run_id uuid,
  p_plan_fingerprint text,
  p_error_code text,
  p_error_summary text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_source public.supplier_feed_sources%ROWTYPE;
  v_run public.supplier_feed_runs%ROWTYPE;
  v_status text := COALESCE(pg_catalog.btrim(p_status), '');
  v_checked_at timestamptz := COALESCE(p_checked_at, pg_catalog.now());
  v_source_url text := NULLIF(pg_catalog.btrim(p_source_url), '');
  v_update_source_url text := NULLIF(pg_catalog.btrim(p_published_update_source_url), '');
  v_release_classification text;
  v_id uuid;
BEGIN
  IF v_status NOT IN ('changed','unchanged','fetch_error','evidence_error','validation_error','planning_error') THEN
    RAISE EXCEPTION 'invalid source-check status' USING ERRCODE = '22023';
  END IF;

  IF v_source_url IS NULL OR v_update_source_url IS NULL THEN
    RAISE EXCEPTION 'source URLs are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source FROM public.supplier_feed_sources WHERE id = p_feed_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown feed source' USING ERRCODE = '22023';
  END IF;

  IF p_feed_run_id IS NOT NULL THEN
    SELECT * INTO v_run FROM public.supplier_feed_runs WHERE id = p_feed_run_id;
    IF NOT FOUND OR v_run.feed_source_id IS DISTINCT FROM p_feed_source_id THEN
      RAISE EXCEPTION 'feed run does not belong to feed source' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_release_classification := CASE WHEN v_status IN ('changed','unchanged') THEN v_status ELSE NULL END;

  INSERT INTO public.supplier_feed_source_checks (
    feed_source_id, checked_at, status, release_classification,
    source_url, published_update_source_url, published_update_date,
    published_update_date_raw, published_update_match,
    artifact_retrieved_at, evidence_retrieved_at,
    etag, last_modified, content_byte_length, sha256,
    release_logical_key, feed_run_id, plan_fingerprint,
    error_code, error_summary
  ) VALUES (
    p_feed_source_id, v_checked_at, v_status, v_release_classification,
    v_source_url, v_update_source_url, p_published_update_date,
    p_published_update_date_raw, p_published_update_match,
    p_artifact_retrieved_at, p_evidence_retrieved_at,
    p_etag, p_last_modified, p_content_byte_length, p_sha256,
    p_release_logical_key, p_feed_run_id, p_plan_fingerprint,
    p_error_code, p_error_summary
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.block2e_record_source_check(
  uuid,timestamptz,text,text,text,text,text,text,timestamptz,timestamptz,text,text,integer,text,text,uuid,text,text,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block2e_record_source_check(
  uuid,timestamptz,text,text,text,text,text,text,timestamptz,timestamptz,text,text,integer,text,text,uuid,text,text,text
) TO service_role;

COMMIT;