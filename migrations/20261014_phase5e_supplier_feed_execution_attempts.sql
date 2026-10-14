-- Phase 5E operational attempts only. INSTALLATION REQUIRES SEPARATE APPROVAL.
-- No product, cost-event, plan, approval or application state is changed.
BEGIN;
CREATE TABLE public.supplier_feed_execution_attempts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  feed_source_id uuid NOT NULL REFERENCES public.supplier_feed_sources(id) ON DELETE RESTRICT,
  trigger_type text NOT NULL CHECK (trigger_type IN ('scheduled','manual')),
  ownership_token uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  outcome text NOT NULL DEFAULT 'running' CHECK (outcome IN ('running','unchanged','planned','failed','interrupted')),
  stage text NOT NULL DEFAULT 'starting' CHECK (stage IN ('starting','checking','planning','complete','deadline','persistence','expired')),
  source_check_id uuid REFERENCES public.supplier_feed_source_checks(id) ON DELETE RESTRICT,
  feed_run_id uuid REFERENCES public.supplier_feed_runs(id) ON DELETE RESTRICT,
  CHECK (expires_at > started_at AND expires_at <= started_at + interval '6 minutes'),
  CHECK ((outcome='running' AND completed_at IS NULL) OR (outcome<>'running' AND completed_at IS NOT NULL)),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);
CREATE UNIQUE INDEX block2e_one_live_execution ON public.supplier_feed_execution_attempts(feed_source_id) WHERE outcome='running';
CREATE INDEX block2e_execution_recent ON public.supplier_feed_execution_attempts(feed_source_id,started_at DESC,id DESC);
ALTER TABLE public.supplier_feed_execution_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_feed_execution_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.supplier_feed_execution_attempts TO service_role;

CREATE FUNCTION public.block2e_execution_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'execution audit history is retained' USING ERRCODE='22023'; END IF;
  IF TG_OP='UPDATE' AND (OLD.outcome<>'running' OR NEW.outcome='running' OR
    (NEW.id,NEW.feed_source_id,NEW.trigger_type,NEW.ownership_token,NEW.started_at,NEW.expires_at)
    IS DISTINCT FROM (OLD.id,OLD.feed_source_id,OLD.trigger_type,OLD.ownership_token,OLD.started_at,OLD.expires_at)) THEN
    RAISE EXCEPTION 'execution audit identity is immutable' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER block2e_execution_audit BEFORE UPDATE OR DELETE ON public.supplier_feed_execution_attempts
  FOR EACH ROW EXECUTE FUNCTION public.block2e_execution_guard();
REVOKE ALL ON FUNCTION public.block2e_execution_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.block2e_claim_feed_execution(p_source_id uuid,p_trigger text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_attempt public.supplier_feed_execution_attempts%ROWTYPE; v_now timestamptz;
BEGIN
  IF p_trigger IS NULL OR p_trigger NOT IN ('scheduled','manual') THEN RAISE EXCEPTION 'invalid execution trigger' USING ERRCODE='22023'; END IF;
  -- Source-row lock serializes claims, including claims after expiry.
  PERFORM 1 FROM public.supplier_feed_sources WHERE id=p_source_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown feed source' USING ERRCODE='22023'; END IF;
  v_now := pg_catalog.clock_timestamp();
  UPDATE public.supplier_feed_execution_attempts SET outcome='interrupted',stage='expired',completed_at=v_now
    WHERE feed_source_id=p_source_id AND outcome='running' AND expires_at<=v_now;
  IF EXISTS (SELECT 1 FROM public.supplier_feed_execution_attempts WHERE feed_source_id=p_source_id AND outcome='running') THEN RETURN NULL; END IF;
  -- Longer than the 300s hard function limit; workers stop new work at 240s.
  INSERT INTO public.supplier_feed_execution_attempts(feed_source_id,trigger_type,started_at,expires_at)
    VALUES(p_source_id,p_trigger,v_now,v_now+interval '6 minutes') RETURNING * INTO v_attempt;
  RETURN pg_catalog.to_jsonb(v_attempt);
END $$;

CREATE FUNCTION public.block2e_finish_feed_execution(p_attempt_id uuid,p_token uuid,p_outcome text,p_stage text,p_check_id uuid,p_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_attempt public.supplier_feed_execution_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.supplier_feed_execution_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR p_token IS NULL OR v_attempt.ownership_token<>p_token OR v_attempt.outcome<>'running'
    OR v_attempt.expires_at<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'execution lease not owned or expired' USING ERRCODE='22023'; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('unchanged','planned','failed') OR p_stage IS NULL
    OR p_stage NOT IN ('checking','planning','complete','deadline','persistence') THEN RAISE EXCEPTION 'invalid execution outcome' USING ERRCODE='22023'; END IF;
  IF p_check_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.supplier_feed_source_checks WHERE id=p_check_id AND feed_source_id=v_attempt.feed_source_id) THEN
    RAISE EXCEPTION 'execution check source mismatch' USING ERRCODE='22023'; END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.supplier_feed_runs WHERE id=p_run_id AND feed_source_id=v_attempt.feed_source_id) THEN
    RAISE EXCEPTION 'execution run source mismatch' USING ERRCODE='22023'; END IF;
  UPDATE public.supplier_feed_execution_attempts SET outcome=p_outcome,stage=p_stage,source_check_id=p_check_id,
    feed_run_id=p_run_id,completed_at=pg_catalog.clock_timestamp() WHERE id=p_attempt_id;
END $$;
REVOKE ALL ON FUNCTION public.block2e_claim_feed_execution(uuid,text),public.block2e_finish_feed_execution(uuid,uuid,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.block2e_claim_feed_execution(uuid,text),public.block2e_finish_feed_execution(uuid,uuid,text,text,uuid,uuid) TO service_role;
COMMIT;
-- Rollback (only if explicitly approved): drop the two public RPCs, then table
-- and guard function. Dropping the table discards audit history; retain/export it.
