-- Block 2E: private, additive supplier-feed persistence. Install only after separate approval.
-- Legacy version-1 rows remain historical; no ownership backfill and no automatic apply.
BEGIN;

CREATE TABLE public.supplier_feed_sources (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  source_key text NOT NULL CHECK (pg_catalog.btrim(source_key) <> ''),
  scope_key text NOT NULL CHECK (pg_catalog.btrim(scope_key) <> ''),
  allows_authoritative_snapshots boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (supplier_id, source_key, scope_key),
  UNIQUE (supplier_id, id, scope_key)
);
ALTER TABLE public.supplier_feed_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_feed_sources FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.supplier_feed_sources TO service_role;

ALTER TABLE public.supplier_products
  ADD COLUMN owner_feed_source_id uuid,
  ADD COLUMN owner_scope_key text,
  ADD COLUMN ownership_run_id uuid,
  ADD COLUMN product_revision bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT block2e_product_revision_positive CHECK (product_revision > 0),
  ADD CONSTRAINT block2e_owner_complete CHECK ((owner_feed_source_id IS NULL AND owner_scope_key IS NULL AND ownership_run_id IS NULL)
    OR (owner_feed_source_id IS NOT NULL AND owner_scope_key IS NOT NULL AND ownership_run_id IS NOT NULL)),
  ADD CONSTRAINT block2e_owner_source_fk FOREIGN KEY (supplier_id, owner_feed_source_id, owner_scope_key)
    REFERENCES public.supplier_feed_sources(supplier_id, id, scope_key) ON DELETE RESTRICT;
CREATE INDEX block2e_owned_products_idx ON public.supplier_products(supplier_id, owner_feed_source_id, owner_scope_key, id)
  WHERE owner_feed_source_id IS NOT NULL;

ALTER TABLE public.supplier_feed_runs
  ADD COLUMN persistence_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN feed_source_id uuid,
  ADD COLUMN scope_key text,
  ADD COLUMN adapter_id text,
  ADD COLUMN mode text,
  ADD COLUMN coverage text,
  ADD COLUMN authoritative_snapshot boolean,
  ADD COLUMN acquisition_complete boolean,
  ADD COLUMN parsing_complete boolean,
  ADD COLUMN validation_safe_for_missing boolean,
  ADD COLUMN missing_inference_enabled boolean,
  ADD COLUMN allow_empty_snapshot_missing_inference boolean NOT NULL DEFAULT false,
  ADD COLUMN empty_snapshot_ack_by uuid,
  ADD COLUMN empty_snapshot_ack_at timestamptz,
  ADD COLUMN logical_run_key text,
  ADD COLUMN planner_version text,
  ADD COLUMN plan_fingerprint text,
  ADD COLUMN plan_counts jsonb,
  ADD COLUMN policy_snapshot jsonb,
  ADD COLUMN anomaly_flags jsonb,
  ADD COLUMN approved_plan_fingerprint text,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN acknowledged_anomalies jsonb,
  ADD COLUMN apply_disposition text NOT NULL DEFAULT 'retryable',
  ADD COLUMN failure_code text,
  ADD COLUMN artifact_purge_after timestamptz,
  ADD COLUMN artifact_purged_at timestamptz,
  ADD COLUMN staging_purge_after timestamptz,
  ADD COLUMN staging_purged_at timestamptz,
  ADD CONSTRAINT block2e_run_version CHECK (persistence_version IN (1,2)),
  ADD CONSTRAINT block2e_run_mode CHECK (mode IS NULL OR mode IN ('dry_run','apply_requested')),
  ADD CONSTRAINT block2e_run_coverage CHECK (coverage IS NULL OR coverage IN ('snapshot','delta')),
  ADD CONSTRAINT block2e_run_disposition CHECK (apply_disposition IN ('retryable','replan_required')),
  ADD CONSTRAINT block2e_run_fingerprint CHECK (plan_fingerprint IS NULL OR plan_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT block2e_approved_fingerprint CHECK (approved_plan_fingerprint IS NULL OR approved_plan_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT block2e_run_checksum CHECK (persistence_version = 1 OR source_checksum IS NULL OR source_checksum ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT block2e_run_json CHECK ((plan_counts IS NULL OR pg_catalog.jsonb_typeof(plan_counts) = 'object')
    AND (policy_snapshot IS NULL OR pg_catalog.jsonb_typeof(policy_snapshot) = 'object')
    AND (anomaly_flags IS NULL OR pg_catalog.jsonb_typeof(anomaly_flags) = 'array')
    AND (acknowledged_anomalies IS NULL OR pg_catalog.jsonb_typeof(acknowledged_anomalies) = 'array')),
  ADD CONSTRAINT block2e_run_empty_ack CHECK (NOT allow_empty_snapshot_missing_inference OR
    (empty_snapshot_ack_by IS NOT NULL AND empty_snapshot_ack_at IS NOT NULL)),
  ADD CONSTRAINT block2e_run_v2_required CHECK (persistence_version = 1 OR
    (feed_source_id IS NOT NULL AND scope_key IS NOT NULL AND adapter_id IS NOT NULL AND pg_catalog.btrim(adapter_id) <> ''
      AND mode IS NOT NULL AND coverage IS NOT NULL AND authoritative_snapshot IS NOT NULL
      AND acquisition_complete IS NOT NULL AND parsing_complete IS NOT NULL
      AND validation_safe_for_missing IS NOT NULL AND missing_inference_enabled IS NOT NULL
      AND logical_run_key IS NOT NULL AND pg_catalog.btrim(logical_run_key) <> ''
      AND planner_version IS NOT NULL AND pg_catalog.btrim(planner_version) <> '')),
  ADD CONSTRAINT block2e_run_dry_status CHECK (persistence_version = 1 OR mode <> 'dry_run' OR
    status IN ('queued','staged','planned','failed','rejected')),
  ADD CONSTRAINT block2e_run_v2_status CHECK (persistence_version = 1 OR
    status IN ('queued','staged','planned','awaiting_approval','approved','applying','partially_applied','applied','failed','rejected')),
  ADD CONSTRAINT block2e_run_plan_required CHECK (persistence_version = 1 OR
    status NOT IN ('planned','awaiting_approval','approved','applying','partially_applied','applied') OR
    (plan_fingerprint IS NOT NULL AND plan_counts IS NOT NULL AND policy_snapshot IS NOT NULL AND anomaly_flags IS NOT NULL)),
  ADD CONSTRAINT block2e_run_approval_required CHECK (persistence_version = 1 OR
    status NOT IN ('approved','applying','partially_applied','applied') OR
    (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_plan_fingerprint = plan_fingerprint
      AND acknowledged_anomalies IS NOT NULL));
ALTER TABLE public.supplier_feed_runs DROP CONSTRAINT supplier_feed_runs_status_check;
ALTER TABLE public.supplier_feed_runs ADD CONSTRAINT block2e_run_status CHECK
  (status IN ('queued','staged','validated','approved','applied','failed','rolled_back',
    'planned','awaiting_approval','applying','partially_applied','rejected'));
ALTER TABLE public.supplier_feed_runs ADD CONSTRAINT block2e_run_source_fk
  FOREIGN KEY (supplier_id, feed_source_id, scope_key)
  REFERENCES public.supplier_feed_sources(supplier_id, id, scope_key) ON DELETE RESTRICT;
CREATE UNIQUE INDEX block2e_run_key_uq ON public.supplier_feed_runs(supplier_id, logical_run_key)
  WHERE persistence_version = 2;
ALTER TABLE public.supplier_feed_runs ADD CONSTRAINT block2e_run_owner_ref UNIQUE (supplier_id, id, feed_source_id, scope_key);
ALTER TABLE public.supplier_products ADD CONSTRAINT block2e_ownership_run_fk
  FOREIGN KEY (supplier_id, ownership_run_id, owner_feed_source_id, owner_scope_key)
  REFERENCES public.supplier_feed_runs(supplier_id, id, feed_source_id, scope_key) ON DELETE RESTRICT;

ALTER TABLE public.supplier_feed_rows
  ALTER COLUMN raw_record DROP NOT NULL,
  ADD COLUMN row_persistence_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN row_kind text,
  ADD COLUMN source_path text,
  ADD COLUMN item_fingerprint text,
  ADD COLUMN source_product_key text,
  ADD COLUMN source_product_key_origin text,
  ADD COLUMN validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN outcome_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN action_fingerprint text,
  ADD COLUMN matched_product_id uuid REFERENCES public.supplier_products(id) ON DELETE RESTRICT,
  ADD COLUMN expected_product_updated_at timestamptz,
  ADD COLUMN expected_product_revision bigint,
  ADD COLUMN result_product_id uuid REFERENCES public.supplier_products(id) ON DELETE RESTRICT,
  ADD COLUMN result_product_revision bigint,
  ADD COLUMN apply_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN applied_at timestamptz,
  ADD COLUMN failure_code text,
  ADD COLUMN failure_detail jsonb,
  ADD CONSTRAINT block2e_row_version CHECK (row_persistence_version IN (1,2)),
  ADD CONSTRAINT block2e_row_kind CHECK (row_kind IS NULL OR row_kind IN ('source_item','potential_missing')),
  ADD CONSTRAINT block2e_row_origin CHECK (source_product_key_origin IS NULL OR source_product_key_origin IN ('supplier_provided','adapter_derived')),
  ADD CONSTRAINT block2e_row_fingerprints CHECK ((item_fingerprint IS NULL OR item_fingerprint ~ '^[0-9a-f]{64}$')
    AND (action_fingerprint IS NULL OR action_fingerprint ~ '^[0-9a-f]{64}$')),
  ADD CONSTRAINT block2e_row_state CHECK (apply_state IN ('pending','applied','skipped','failed','conflict')),
  ADD CONSTRAINT block2e_row_issues CHECK (pg_catalog.jsonb_typeof(validation_warnings) = 'array'
    AND (failure_detail IS NULL OR pg_catalog.jsonb_typeof(failure_detail) = 'object')),
  ADD CONSTRAINT block2e_row_revision CHECK ((expected_product_revision IS NULL OR expected_product_revision > 0)
    AND (result_product_revision IS NULL OR result_product_revision > 0)),
  ADD CONSTRAINT block2e_row_v2_required CHECK (row_persistence_version = 1 OR
    (row_kind IS NOT NULL AND action_fingerprint IS NOT NULL AND
      ((row_kind = 'source_item' AND row_number IS NOT NULL AND item_fingerprint IS NOT NULL)
       OR (row_kind = 'potential_missing' AND row_number IS NULL AND matched_product_id IS NOT NULL
         AND proposed_action = 'potential_missing')))),
  ADD CONSTRAINT block2e_row_v2_action CHECK (row_persistence_version = 1 OR
    proposed_action IN ('create','update','unchanged','reject','review','potential_missing')),
  ADD CONSTRAINT block2e_row_v2_target CHECK (row_persistence_version = 1 OR
    proposed_action NOT IN ('update','unchanged','potential_missing') OR
    (matched_product_id IS NOT NULL AND expected_product_revision IS NOT NULL AND expected_product_updated_at IS NOT NULL)),
  ADD CONSTRAINT block2e_row_applied CHECK (row_persistence_version = 1 OR apply_state <> 'applied' OR
    (proposed_action IN ('create','update') AND applied_at IS NOT NULL AND result_product_id IS NOT NULL AND result_product_revision IS NOT NULL));
ALTER TABLE public.supplier_feed_rows DROP CONSTRAINT supplier_feed_rows_proposed_action_check;
ALTER TABLE public.supplier_feed_rows ADD CONSTRAINT block2e_row_action CHECK
  (proposed_action IS NULL OR proposed_action IN ('create','update','unchanged','discontinue','review',
    'reject','potential_missing'));
ALTER TABLE public.supplier_feed_rows ADD CONSTRAINT block2e_row_ref UNIQUE (feed_run_id, id);
CREATE UNIQUE INDEX block2e_action_fingerprint_uq ON public.supplier_feed_rows(feed_run_id, action_fingerprint)
  WHERE action_fingerprint IS NOT NULL;
CREATE UNIQUE INDEX block2e_potential_missing_uq ON public.supplier_feed_rows(feed_run_id, matched_product_id)
  WHERE row_persistence_version = 2 AND proposed_action = 'potential_missing';
CREATE UNIQUE INDEX block2e_applied_target_uq ON public.supplier_feed_rows(feed_run_id, result_product_id)
  WHERE row_persistence_version = 2 AND apply_state = 'applied';
CREATE INDEX block2e_row_resume_idx ON public.supplier_feed_rows(feed_run_id, apply_state, row_number);

ALTER TABLE public.supplier_product_cost_events ADD COLUMN feed_row_id uuid;
ALTER TABLE public.supplier_product_cost_events ADD CONSTRAINT block2e_event_row_fk
  FOREIGN KEY (feed_run_id, feed_row_id) REFERENCES public.supplier_feed_rows(feed_run_id, id) ON DELETE RESTRICT;
ALTER TABLE public.supplier_product_cost_events ADD CONSTRAINT block2e_event_row_requires_run
  CHECK (feed_row_id IS NULL OR feed_run_id IS NOT NULL);
CREATE INDEX block2e_event_row_idx ON public.supplier_product_cost_events(feed_row_id) WHERE feed_row_id IS NOT NULL;

-- A canonical revision belongs to all trusted writers, including the existing Block 2D RPC.
-- Reject any explicit attempted change; non-supplied UPDATEs preserve OLD and are incremented here.
CREATE FUNCTION public.block2e_product_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.product_revision IS DISTINCT FROM OLD.product_revision THEN
    RAISE EXCEPTION 'product_revision is database-owned' USING ERRCODE = '22023';
  END IF;
  IF OLD.product_revision = 9223372036854775807 THEN
    RAISE EXCEPTION 'product_revision overflow' USING ERRCODE = '22003';
  END IF;
  IF (NEW.owner_feed_source_id, NEW.owner_scope_key, NEW.ownership_run_id)
     IS DISTINCT FROM (OLD.owner_feed_source_id, OLD.owner_scope_key, OLD.ownership_run_id) THEN
    RAISE EXCEPTION 'feed ownership cannot be silently changed' USING ERRCODE = '22023';
  END IF;
  NEW.product_revision := OLD.product_revision + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER block2e_product_revision BEFORE UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.block2e_product_revision_guard();
REVOKE ALL ON FUNCTION public.block2e_product_revision_guard() FROM PUBLIC, anon, authenticated, service_role;

-- A source can be registered only through the privileged server role; registration
-- and authorization of authoritative snapshots are separate decisions.
GRANT INSERT, UPDATE (allows_authoritative_snapshots) ON public.supplier_feed_sources TO service_role;
-- No current application path writes Block 2B feed tables directly. Keep v1
-- records readable for history, but close the unused service-role write grant:
-- a caller must not select the v1 default as an escape hatch. Version-2
-- writes remain available through the owner-executed, narrowly granted RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.supplier_feed_runs, public.supplier_feed_rows FROM service_role;
-- Existing Admin PATCH already calls the Block 2D RPC. Make that allowlisted RPC
-- owner-executed so direct service-role product UPDATE can be withdrawn without
-- changing the application request contract or its updated_at conflict behavior.
ALTER FUNCTION public.block2d_update_supplier_product(uuid,uuid,timestamptz,jsonb,uuid) SECURITY DEFINER;
REVOKE UPDATE ON public.supplier_products FROM service_role;
-- The audit trigger (now owner-executed) alone may insert new cost events.
REVOKE INSERT ON public.supplier_product_cost_events FROM service_role;

CREATE FUNCTION public.block2e_run_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.persistence_version=2 AND current_user='service_role' THEN
      RAISE EXCEPTION 'version-2 runs require privileged RPC' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.persistence_version IS DISTINCT FROM OLD.persistence_version THEN
    RAISE EXCEPTION 'run persistence version is immutable' USING ERRCODE = '22023'; END IF;
  IF OLD.persistence_version <> 2 THEN RETURN NEW; END IF;
  IF current_user='service_role' THEN
    RAISE EXCEPTION 'version-2 runs require privileged RPC' USING ERRCODE = '42501'; END IF;
  IF (NEW.supplier_id, NEW.feed_source_id, NEW.scope_key, NEW.logical_run_key,
      NEW.mode, NEW.coverage, NEW.adapter_id, NEW.adapter_version, NEW.planner_version,
      NEW.authoritative_snapshot, NEW.source_checksum)
    IS DISTINCT FROM
     (OLD.supplier_id, OLD.feed_source_id, OLD.scope_key, OLD.logical_run_key,
      OLD.mode, OLD.coverage, OLD.adapter_id, OLD.adapter_version, OLD.planner_version,
      OLD.authoritative_snapshot, OLD.source_checksum) THEN
    RAISE EXCEPTION 'run identity and mode are immutable' USING ERRCODE = '22023';
  END IF;
  IF OLD.plan_fingerprint IS NOT NULL AND
    (NEW.plan_fingerprint, NEW.plan_counts, NEW.policy_snapshot, NEW.anomaly_flags,
      NEW.acquisition_complete, NEW.parsing_complete, NEW.validation_safe_for_missing,
      NEW.missing_inference_enabled, NEW.allow_empty_snapshot_missing_inference)
    IS DISTINCT FROM
    (OLD.plan_fingerprint, OLD.plan_counts, OLD.policy_snapshot, OLD.anomaly_flags,
      OLD.acquisition_complete, OLD.parsing_complete, OLD.validation_safe_for_missing,
      OLD.missing_inference_enabled, OLD.allow_empty_snapshot_missing_inference) THEN
    RAISE EXCEPTION 'frozen plan cannot change' USING ERRCODE = '22023';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('staged','failed','rejected')) OR
    (OLD.status = 'staged' AND NEW.status IN ('planned','awaiting_approval','failed','rejected')) OR
    (OLD.status = 'awaiting_approval' AND NEW.status IN ('approved','rejected')) OR
    (OLD.status = 'approved' AND NEW.status = 'applying') OR
    (OLD.status = 'applying' AND NEW.status IN ('partially_applied','applied')) OR
    (OLD.status = 'partially_applied' AND NEW.status IN ('applying','applied'))
  ) THEN RAISE EXCEPTION 'invalid feed run transition % -> %', OLD.status, NEW.status USING ERRCODE = '22023'; END IF;
  IF OLD.apply_disposition = 'replan_required' AND NEW.apply_disposition <> OLD.apply_disposition THEN
    RAISE EXCEPTION 'conflicted plan is terminal' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER block2e_run_state BEFORE INSERT OR UPDATE ON public.supplier_feed_runs
  FOR EACH ROW EXECUTE FUNCTION public.block2e_run_guard();
REVOKE ALL ON FUNCTION public.block2e_run_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.block2e_row_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_run public.supplier_feed_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.supplier_feed_runs WHERE id = NEW.feed_run_id;
  IF NOT FOUND OR (v_run.persistence_version=2) IS DISTINCT FROM (NEW.row_persistence_version=2) THEN
    RAISE EXCEPTION 'run/row persistence version mismatch' USING ERRCODE = '22023'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.row_persistence_version=2 AND current_user='service_role' THEN
      RAISE EXCEPTION 'version-2 rows require privileged RPC' USING ERRCODE = '42501'; END IF;
    IF v_run.status <> 'staged' AND NEW.row_persistence_version = 2 THEN
      RAISE EXCEPTION 'run is not staging' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.row_persistence_version IS DISTINCT FROM OLD.row_persistence_version THEN
    RAISE EXCEPTION 'row persistence version is immutable' USING ERRCODE = '22023'; END IF;
  IF OLD.row_persistence_version <> 2 THEN RETURN NEW; END IF;
  IF current_user='service_role' THEN
    RAISE EXCEPTION 'version-2 rows require privileged RPC' USING ERRCODE = '42501'; END IF;
  -- Only the retention function can reach this state after the 90-day gate.
  IF v_run.staging_purged_at IS NOT NULL AND NEW.proposed_product IS NULL
    AND NEW.proposed_diff IS NULL AND NEW.raw_record IS NULL
    AND NEW.validation_errors='[]'::jsonb AND NEW.validation_warnings='[]'::jsonb
    AND (OLD.feed_run_id,OLD.row_kind,OLD.row_number,OLD.source_record_key,OLD.source_path,
         OLD.item_fingerprint,OLD.source_product_key,OLD.source_product_key_origin,
         OLD.validation_status,OLD.proposed_action,OLD.action_fingerprint,OLD.matched_product_id,
         OLD.expected_product_revision,OLD.expected_product_updated_at,OLD.apply_state,
         OLD.result_product_id,OLD.result_product_revision,OLD.outcome_codes)
      IS NOT DISTINCT FROM
        (NEW.feed_run_id,NEW.row_kind,NEW.row_number,NEW.source_record_key,NEW.source_path,
         NEW.item_fingerprint,NEW.source_product_key,NEW.source_product_key_origin,
         NEW.validation_status,NEW.proposed_action,NEW.action_fingerprint,NEW.matched_product_id,
         NEW.expected_product_revision,NEW.expected_product_updated_at,NEW.apply_state,
         NEW.result_product_id,NEW.result_product_revision,NEW.outcome_codes) THEN
    RETURN NEW;
  END IF;
  IF (OLD.feed_run_id, OLD.row_kind, OLD.row_number, OLD.source_record_key, OLD.source_path,
      OLD.item_fingerprint, OLD.source_product_key, OLD.source_product_key_origin,
      OLD.raw_record, OLD.proposed_product, OLD.validation_status, OLD.validation_errors,
      OLD.validation_warnings, OLD.proposed_action, OLD.proposed_diff,
      OLD.action_fingerprint, OLD.matched_product_id, OLD.expected_product_revision,
      OLD.expected_product_updated_at)
    IS DISTINCT FROM
     (NEW.feed_run_id, NEW.row_kind, NEW.row_number, NEW.source_record_key, NEW.source_path,
      NEW.item_fingerprint, NEW.source_product_key, NEW.source_product_key_origin,
      NEW.raw_record, NEW.proposed_product, NEW.validation_status, NEW.validation_errors,
      NEW.validation_warnings, NEW.proposed_action, NEW.proposed_diff,
      NEW.action_fingerprint, NEW.matched_product_id, NEW.expected_product_revision,
      NEW.expected_product_updated_at) THEN
    RAISE EXCEPTION 'staged plan row is immutable' USING ERRCODE = '22023';
  END IF;
  IF OLD.apply_state IN ('applied','skipped','conflict') AND NEW.apply_state <> OLD.apply_state THEN
    RAISE EXCEPTION 'checkpoint is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER block2e_row_state BEFORE INSERT OR UPDATE ON public.supplier_feed_rows
  FOR EACH ROW EXECUTE FUNCTION public.block2e_row_guard();
REVOKE ALL ON FUNCTION public.block2e_row_guard() FROM PUBLIC, anon, authenticated, service_role;

-- The ONLY cost-history creator remains Block 2D's product UPDATE trigger.
-- Feed context is local to one transaction, set only around an actual feed UPDATE.
CREATE OR REPLACE FUNCTION public.block2d_audit_product_cost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := pg_catalog.current_setting('app.block2d_actor_user_id', true);
  v_feed_run text := pg_catalog.current_setting('app.block2e_feed_run_id', true);
  v_feed_row text := pg_catalog.current_setting('app.block2e_feed_row_id', true);
BEGIN
  IF (OLD.wholesale_cost, OLD.cost_currency, OLD.cost_unit, OLD.cost_tax_basis, OLD.cost_effective_at)
     IS DISTINCT FROM
     (NEW.wholesale_cost, NEW.cost_currency, NEW.cost_unit, NEW.cost_tax_basis, NEW.cost_effective_at) THEN
    IF (NULLIF(v_feed_run,'') IS NULL) <> (NULLIF(v_feed_row,'') IS NULL) THEN
      RAISE EXCEPTION 'incomplete feed cost provenance' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(v_feed_row,'') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.supplier_feed_rows fr
      JOIN public.supplier_feed_runs run ON run.id=fr.feed_run_id
      WHERE fr.id=v_feed_row::uuid AND fr.feed_run_id=v_feed_run::uuid
        AND fr.matched_product_id=NEW.id AND fr.expected_product_revision=OLD.product_revision
        AND fr.proposed_action='update' AND fr.apply_state IN ('pending','failed')
        AND run.status='applying' AND run.mode='apply_requested'
        AND run.approved_plan_fingerprint=run.plan_fingerprint
    ) THEN RAISE EXCEPTION 'invalid feed cost provenance' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.supplier_product_cost_events (
      supplier_id, supplier_product_id, event_key, feed_run_id, feed_row_id,
      old_cost, new_cost, old_currency, new_currency, old_unit, new_unit,
      old_tax_basis, new_tax_basis, old_effective_at, source_effective_at, actor_user_id, reason
    ) VALUES (
      NEW.supplier_id, NEW.id,
      CASE WHEN NULLIF(v_feed_row,'') IS NULL THEN 'block2d:' || pg_catalog.gen_random_uuid()::text
           ELSE 'block2e:' || v_feed_row END,
      NULLIF(v_feed_run,'')::uuid, NULLIF(v_feed_row,'')::uuid,
      OLD.wholesale_cost, NEW.wholesale_cost, OLD.cost_currency, NEW.cost_currency,
      OLD.cost_unit, NEW.cost_unit, OLD.cost_tax_basis, NEW.cost_tax_basis,
      OLD.cost_effective_at, NEW.cost_effective_at, NULLIF(v_actor,'')::uuid,
      CASE WHEN NULLIF(v_feed_run,'') IS NOT NULL THEN 'supplier feed canonical cost update'
           WHEN NULLIF(v_actor,'') IS NULL THEN 'trusted product cost update'
           ELSE 'platform admin cost update' END
    );
  END IF;
  RETURN NEW;
END $$;

-- Minimal run creation: artifact checksum is deliberately NOT unique. The logical
-- run key is unique per supplier, so a later apply needs its own new run.
CREATE FUNCTION public.block2e_create_run(
  p_supplier_id uuid, p_source_id uuid, p_scope_key text, p_key text,
  p_mode text, p_coverage text, p_authoritative boolean,
  p_adapter_id text, p_adapter_version text, p_planner_version text,
  p_checksum text, p_artifact_ref text, p_acquired boolean,
  p_parsed boolean, p_validation_safe boolean, p_missing_enabled boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_mode NOT IN ('dry_run','apply_requested') OR p_coverage NOT IN ('snapshot','delta')
    OR p_key IS NULL OR pg_catalog.btrim(p_key) = '' OR p_adapter_id IS NULL
    OR pg_catalog.btrim(p_adapter_id) = '' OR p_adapter_version IS NULL
    OR pg_catalog.btrim(p_adapter_version) = '' OR p_planner_version IS NULL
    OR pg_catalog.btrim(p_planner_version) = '' OR p_authoritative IS NULL
    OR p_acquired IS NULL OR p_parsed IS NULL OR p_validation_safe IS NULL OR p_missing_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid feed run declaration' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.supplier_feed_sources WHERE id=p_source_id AND supplier_id=p_supplier_id AND scope_key=p_scope_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'source/scope mismatch' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.supplier_feed_runs(supplier_id,feed_source_id,scope_key,persistence_version,
    logical_run_key,mode,coverage,authoritative_snapshot,adapter_id,adapter_version,
    planner_version,source_checksum,artifact_ref,acquisition_complete,parsing_complete,
    validation_safe_for_missing,missing_inference_enabled,artifact_purge_after,staging_purge_after)
  VALUES (p_supplier_id,p_source_id,p_scope_key,2,p_key,p_mode,p_coverage,p_authoritative,
    p_adapter_id,p_adapter_version,p_planner_version,p_checksum,p_artifact_ref,p_acquired,
    p_parsed,p_validation_safe,p_missing_enabled,
    CASE WHEN p_artifact_ref IS NULL THEN NULL ELSE pg_catalog.now() + interval '90 days' END,
    pg_catalog.now() + interval '90 days') RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.block2e_stage_row(p_run_id uuid, p_row jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_run public.supplier_feed_runs%ROWTYPE; v_id uuid; v_kind text;
BEGIN
  IF p_row IS NULL OR pg_catalog.jsonb_typeof(p_row) <> 'object' OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_object_keys(p_row) AS k(key) WHERE k.key <> ALL (ARRAY[
      'row_number','row_kind','source_record_key','source_path','item_fingerprint','source_product_key',
      'source_product_key_origin','raw_record','proposed_product','validation_status',
      'validation_errors','validation_warnings','proposed_action','proposed_diff',
      'action_fingerprint','matched_product_id','expected_product_revision','expected_product_updated_at'])) THEN
    RAISE EXCEPTION 'invalid staging envelope' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.supplier_feed_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.persistence_version <> 2 OR v_run.status <> 'staged' THEN
    RAISE EXCEPTION 'run not staging' USING ERRCODE = '22023';
  END IF;
  v_kind := p_row->>'row_kind';
  IF (p_row ? 'raw_record') AND pg_catalog.jsonb_typeof(p_row->'raw_record') <> 'null' THEN
    RAISE EXCEPTION 'complete raw HTTP responses/records are not accepted in diagnostic staging' USING ERRCODE = '22023';
  END IF;
  IF v_kind='potential_missing' AND (v_run.coverage <> 'snapshot' OR NOT v_run.authoritative_snapshot
    OR NOT v_run.acquisition_complete OR NOT v_run.parsing_complete OR NOT v_run.validation_safe_for_missing
    OR NOT v_run.missing_inference_enabled) THEN
    RAISE EXCEPTION 'missing inference not eligible' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.supplier_feed_rows(feed_run_id,row_persistence_version,row_kind,row_number,
    source_record_key,source_path,item_fingerprint,source_product_key,source_product_key_origin,
    proposed_product,validation_status,validation_errors,validation_warnings,proposed_action,
    proposed_diff,action_fingerprint,matched_product_id,expected_product_revision,expected_product_updated_at)
  VALUES (p_run_id,2,v_kind,(p_row->>'row_number')::integer,p_row->>'source_record_key',
    p_row->>'source_path',p_row->>'item_fingerprint',p_row->>'source_product_key',
    p_row->>'source_product_key_origin',p_row->'proposed_product',
    COALESCE(p_row->>'validation_status','pending'),COALESCE(p_row->'validation_errors','[]'::jsonb),
    COALESCE(p_row->'validation_warnings','[]'::jsonb),p_row->>'proposed_action',
    p_row->'proposed_diff',p_row->>'action_fingerprint',(p_row->>'matched_product_id')::uuid,
    (p_row->>'expected_product_revision')::bigint,(p_row->>'expected_product_updated_at')::timestamptz)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.block2e_begin_staging(p_run_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.supplier_feed_runs SET status='staged' WHERE id=p_run_id AND persistence_version=2 AND status='queued';
  IF NOT FOUND THEN RAISE EXCEPTION 'run not queued' USING ERRCODE = '22023'; END IF;
END $$;

-- Independently authorized empty-snapshot switch, before plan freeze only.
CREATE FUNCTION public.block2e_ack_empty_snapshot(p_run_id uuid, p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'actor required' USING ERRCODE = '22023'; END IF;
  UPDATE public.supplier_feed_runs SET allow_empty_snapshot_missing_inference=true,
    empty_snapshot_ack_by=p_actor, empty_snapshot_ack_at=pg_catalog.now()
  WHERE id=p_run_id AND persistence_version=2 AND mode='apply_requested' AND status='staged'
    AND coverage='snapshot' AND authoritative_snapshot;
  IF NOT FOUND THEN RAISE EXCEPTION 'not eligible for empty snapshot authorization' USING ERRCODE = '22023'; END IF;
END $$;

-- All five functions are invoked by the privileged Platform Admin server only.
REVOKE ALL ON FUNCTION public.block2e_create_run(uuid,uuid,text,text,text,text,boolean,text,text,text,text,text,boolean,boolean,boolean,boolean),
  public.block2e_stage_row(uuid,jsonb), public.block2e_begin_staging(uuid),
  public.block2e_ack_empty_snapshot(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block2e_create_run(uuid,uuid,text,text,text,text,boolean,text,text,text,text,text,boolean,boolean,boolean,boolean),
  public.block2e_stage_row(uuid,jsonb), public.block2e_begin_staging(uuid),
  public.block2e_ack_empty_snapshot(uuid,uuid) TO service_role;

-- Supplied product INSERT revisions must also be the database default, never caller-selected.
CREATE FUNCTION public.block2e_product_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.product_revision <> 1 THEN
    RAISE EXCEPTION 'product_revision on INSERT must be 1' USING ERRCODE = '22023';
  END IF;
  IF NEW.owner_feed_source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.supplier_feed_runs r WHERE r.id=NEW.ownership_run_id
      AND r.supplier_id=NEW.supplier_id AND r.feed_source_id=NEW.owner_feed_source_id
      AND r.scope_key=NEW.owner_scope_key AND r.mode='apply_requested'
      AND r.status='applying' AND r.approved_plan_fingerprint=r.plan_fingerprint
  ) THEN RAISE EXCEPTION 'ownership requires applying approved run' USING ERRCODE = '22023'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER block2e_product_insert BEFORE INSERT ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.block2e_product_insert_guard();
REVOKE ALL ON FUNCTION public.block2e_product_insert_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.block2e_has_sensitive_keys(p_json jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_key text; v_value jsonb;
BEGIN
  IF p_json IS NULL THEN RETURN false; END IF;
  IF pg_catalog.jsonb_typeof(p_json)='object' THEN
    FOR v_key,v_value IN SELECT key,value FROM pg_catalog.jsonb_each(p_json) LOOP
      IF pg_catalog.lower(v_key) ~ '(password|secret|token|authorization|credential|api[_-]?key|cookie|set-cookie)'
         OR public.block2e_has_sensitive_keys(v_value) THEN RETURN true; END IF;
    END LOOP;
  ELSIF pg_catalog.jsonb_typeof(p_json)='array' THEN
    FOR v_value IN SELECT value FROM pg_catalog.jsonb_array_elements(p_json) LOOP
      IF public.block2e_has_sensitive_keys(v_value) THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.block2e_has_sensitive_keys(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Plan freeze computes its OWN fingerprint over the actual staged rows, evidence and
-- policy. The server reads this value for approval; no client-provided digest is trusted.
CREATE FUNCTION public.block2e_freeze_plan(p_run_id uuid, p_policy jsonb DEFAULT '{}'::jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_run public.supplier_feed_runs%ROWTYPE; v_row public.supplier_feed_rows%ROWTYPE;
  v_source public.supplier_feed_sources%ROWTYPE; v_counts jsonb := '{}'::jsonb;
  v_flags jsonb := '[]'::jsonb; v_rows jsonb; v_fingerprint text;
  v_kind text; v_count integer; v_denominator integer; v_limit jsonb;
  v_valid integer; v_total integer; v_source_rows integer; v_owned integer; v_cost_changed boolean; v_target public.supplier_products%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.supplier_feed_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.persistence_version <> 2 OR v_run.status <> 'staged' THEN
    RAISE EXCEPTION 'run not ready for plan freeze' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_source FROM public.supplier_feed_sources WHERE id=v_run.feed_source_id AND supplier_id=v_run.supplier_id;
  IF NOT FOUND OR v_source.scope_key <> v_run.scope_key THEN
    RAISE EXCEPTION 'source/scope mismatch' USING ERRCODE = '22023'; END IF;
  IF p_policy IS NULL OR pg_catalog.jsonb_typeof(p_policy) <> 'object' OR
    EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_policy) AS k(key)
      WHERE k.key <> ALL (ARRAY['creates','updates','costChanges','potentialMissing'])) THEN
    RAISE EXCEPTION 'invalid mass-change policy' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO v_valid FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id
    AND row_persistence_version=2 AND row_kind='source_item' AND validation_status='valid';
  SELECT count(*) INTO v_total FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id AND row_persistence_version=2;
  SELECT count(*) INTO v_source_rows FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id AND row_kind='source_item';
  SELECT count(*) INTO v_owned FROM public.supplier_products WHERE supplier_id=v_run.supplier_id
    AND owner_feed_source_id=v_run.feed_source_id AND owner_scope_key=v_run.scope_key;
  IF EXISTS (SELECT 1 FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id
      AND (row_persistence_version<>2 OR validation_status='pending')) THEN
    RAISE EXCEPTION 'all staged rows must be resolved version-2 rows' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id AND row_kind='source_item'
      AND validation_status='valid' AND source_product_key IS NOT NULL
      GROUP BY source_product_key HAVING count(*)>1) THEN
    RAISE EXCEPTION 'duplicate validated source product key' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id
      AND matched_product_id IS NOT NULL AND proposed_action IN ('update','unchanged')
      GROUP BY matched_product_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'duplicate canonical target in one run' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id AND
     (pg_catalog.jsonb_typeof(proposed_product) NOT IN ('object') AND proposed_action IN ('create','update')
      OR public.block2e_has_sensitive_keys(proposed_product) OR public.block2e_has_sensitive_keys(proposed_diff)
      OR public.block2e_has_sensitive_keys(validation_errors) OR public.block2e_has_sensitive_keys(validation_warnings))) THEN
    RAISE EXCEPTION 'unsafe or missing normalized staging data' USING ERRCODE = '22023'; END IF;
  FOR v_row IN SELECT * FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id LOOP
    IF v_row.proposed_action IN ('create','update','unchanged') AND
       (v_row.validation_status<>'valid' OR v_row.source_product_key IS NULL OR pg_catalog.btrim(v_row.source_product_key)=''
        OR v_row.source_product_key_origin IS NULL) THEN
      RAISE EXCEPTION 'invalid canonical candidate' USING ERRCODE = '22023'; END IF;
    IF v_row.proposed_action IN ('create','update') AND
      (v_row.proposed_product->>'supplierId' IS DISTINCT FROM v_run.supplier_id::text
       OR v_row.proposed_product->>'runId' IS DISTINCT FROM v_run.id::text
       OR v_row.proposed_product->>'sourceId' IS DISTINCT FROM v_run.feed_source_id::text
       OR v_row.proposed_product->>'scopeId' IS DISTINCT FROM v_run.scope_key
       OR v_row.proposed_product->'adapter'->>'id' IS DISTINCT FROM v_run.adapter_id
       OR v_row.proposed_product->'adapter'->>'version' IS DISTINCT FROM v_run.adapter_version
       OR v_row.proposed_product->>'sourceProductKey' IS DISTINCT FROM v_row.source_product_key
       OR v_row.proposed_product->>'sourceProductKeyOrigin' IS DISTINCT FROM v_row.source_product_key_origin
       OR v_row.proposed_product->'fields'->>'category' IS NULL
       OR v_row.proposed_product->'fields'->>'supplierDescription' IS NULL) THEN
      RAISE EXCEPTION 'candidate provenance/fields mismatch' USING ERRCODE = '22023'; END IF;
    IF v_row.proposed_action='create' THEN
      IF v_row.matched_product_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.supplier_products p WHERE p.supplier_id=v_run.supplier_id
          AND (p.source_product_key=v_row.source_product_key OR
            (v_row.proposed_product->'fields'->>'supplierSku' IS NOT NULL AND
              p.sku_normalized=pg_catalog.lower(pg_catalog.btrim(v_row.proposed_product->'fields'->>'supplierSku'))
              AND p.catalog_scope=COALESCE(v_row.proposed_product->'fields'->>'catalogScope','default')
              AND p.variant_key=COALESCE(v_row.proposed_product->'fields'->>'variantKey','')))
        ) OR EXISTS (SELECT 1 FROM public.supplier_product_aliases a
          WHERE a.supplier_id=v_run.supplier_id AND a.alias_kind='source_key' AND a.alias_value=v_row.source_product_key) THEN
        RAISE EXCEPTION 'create collides with existing identity or SKU; review required' USING ERRCODE = '22023'; END IF;
    ELSIF v_row.proposed_action IN ('update','unchanged','potential_missing') THEN
      SELECT * INTO v_target FROM public.supplier_products p WHERE p.supplier_id=v_run.supplier_id
        AND p.id=v_row.matched_product_id;
      IF v_target.id IS NULL OR v_target.product_revision IS DISTINCT FROM v_row.expected_product_revision
        OR v_target.updated_at IS DISTINCT FROM v_row.expected_product_updated_at
        OR v_target.owner_feed_source_id IS DISTINCT FROM v_run.feed_source_id
        OR v_target.owner_scope_key IS DISTINCT FROM v_run.scope_key
        OR (v_row.proposed_action<>'potential_missing' AND NOT
          (v_target.source_product_key=v_row.source_product_key OR EXISTS (
            SELECT 1 FROM public.supplier_product_aliases a WHERE a.supplier_id=v_run.supplier_id
              AND a.supplier_product_id=v_target.id AND a.alias_kind='source_key'
              AND a.alias_value=v_row.source_product_key))) THEN
        RAISE EXCEPTION 'target version, ownership or identity mismatch' USING ERRCODE = '22023'; END IF;
      IF v_row.proposed_action='update' THEN
        IF EXISTS (SELECT 1 FROM public.supplier_products p WHERE p.supplier_id=v_run.supplier_id
             AND p.id<>v_target.id AND (p.source_product_key=v_row.source_product_key OR
               (v_row.proposed_product->'fields'->>'supplierSku' IS NOT NULL AND
                p.sku_normalized=pg_catalog.lower(pg_catalog.btrim(v_row.proposed_product->'fields'->>'supplierSku'))
                AND p.catalog_scope=COALESCE(v_row.proposed_product->'fields'->>'catalogScope','default')
                AND p.variant_key=COALESCE(v_row.proposed_product->'fields'->>'variantKey',''))))
           OR EXISTS (SELECT 1 FROM public.supplier_product_aliases a WHERE a.supplier_id=v_run.supplier_id
              AND a.alias_kind='source_key' AND a.alias_value=v_row.source_product_key
              AND a.supplier_product_id<>v_target.id) THEN
          RAISE EXCEPTION 'ambiguous current-key/alias/SKU evidence' USING ERRCODE = '22023'; END IF;
        v_cost_changed := (v_row.proposed_product ? 'cost') AND
          (v_target.wholesale_cost,v_target.cost_currency,v_target.cost_unit,v_target.cost_tax_basis,v_target.cost_effective_at)
          IS DISTINCT FROM
          ((v_row.proposed_product->'cost'->>'amount')::numeric,
            v_row.proposed_product->'cost'->>'currency',v_row.proposed_product->'cost'->>'unit',
            v_row.proposed_product->'cost'->>'taxBasis',
            (v_row.proposed_product->'cost'->>'effectiveAt')::timestamptz);
        IF pg_catalog.jsonb_typeof(v_row.proposed_diff)<>'object' OR
           pg_catalog.jsonb_typeof(v_row.proposed_diff->'costChange')<>'boolean' OR
           (v_row.proposed_diff->>'costChange')::boolean IS DISTINCT FROM v_cost_changed THEN
          RAISE EXCEPTION 'cost-change assessment differs from canonical tuple' USING ERRCODE = '22023'; END IF;
      END IF;
      IF v_row.proposed_action='potential_missing' THEN
        IF v_run.coverage<>'snapshot' OR NOT v_run.authoritative_snapshot OR
          NOT v_source.allows_authoritative_snapshots OR NOT v_run.acquisition_complete OR
          NOT v_run.parsing_complete OR NOT v_run.validation_safe_for_missing OR
          NOT v_run.missing_inference_enabled OR (v_valid=0 AND NOT v_run.allow_empty_snapshot_missing_inference)
          OR EXISTS (SELECT 1 FROM public.supplier_feed_rows invalid WHERE invalid.feed_run_id=p_run_id
            AND invalid.proposed_action IN ('reject','review'))
          OR EXISTS (SELECT 1 FROM public.supplier_feed_rows seen WHERE seen.feed_run_id=p_run_id
             AND seen.row_kind='source_item' AND seen.validation_status='valid' AND
             (seen.matched_product_id=v_row.matched_product_id OR
              seen.source_product_key=(SELECT present.source_product_key FROM public.supplier_products present
                WHERE present.id=v_row.matched_product_id))) THEN
          RAISE EXCEPTION 'unsafe potential_missing plan' USING ERRCODE = '22023'; END IF;
      END IF;
    END IF;
  END LOOP;
  IF v_run.authoritative_snapshot AND v_run.coverage='snapshot' AND NOT v_source.allows_authoritative_snapshots THEN
    RAISE EXCEPTION 'source is not registered for authoritative snapshots' USING ERRCODE = '22023'; END IF;
  SELECT pg_catalog.jsonb_build_object('create',count(*) FILTER(WHERE proposed_action='create'),
    'update',count(*) FILTER(WHERE proposed_action='update'),
    'unchanged',count(*) FILTER(WHERE proposed_action='unchanged'),
    'reject',count(*) FILTER(WHERE proposed_action='reject'),
    'review',count(*) FILTER(WHERE proposed_action='review'),
    'potential_missing',count(*) FILTER(WHERE proposed_action='potential_missing'),
    'cost_changes',count(*) FILTER(WHERE proposed_action='update' AND proposed_diff->>'costChange'='true'))
    INTO v_counts FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id;
  FOREACH v_kind IN ARRAY ARRAY['creates','updates','costChanges','potentialMissing'] LOOP
    v_denominator := CASE WHEN v_kind='creates' THEN greatest(1,v_source_rows) ELSE greatest(1,v_owned) END;
    v_limit := p_policy->v_kind;
    IF v_limit IS NOT NULL THEN
      IF pg_catalog.jsonb_typeof(v_limit)<>'object' OR v_limit='{}'::jsonb OR
        EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(v_limit) AS k(key)
           WHERE k.key <> ALL (ARRAY['count','proportion'])) OR
        (v_limit ? 'count' AND ((v_limit->>'count') !~ '^[0-9]+$' OR (v_limit->>'count')::numeric > 2147483647)) OR
        (v_limit ? 'proportion' AND ((v_limit->>'proportion') !~ '^(0(\.[0-9]+)?|1(\.0+)?)$')) THEN
        RAISE EXCEPTION 'invalid mass-change limit' USING ERRCODE = '22023'; END IF;
      v_count := CASE v_kind WHEN 'creates' THEN (v_counts->>'create')::integer
        WHEN 'updates' THEN (v_counts->>'update')::integer
        WHEN 'costChanges' THEN (v_counts->>'cost_changes')::integer
        ELSE (v_counts->>'potential_missing')::integer END;
      IF ((v_limit ? 'count') AND v_count > (v_limit->>'count')::integer)
         OR ((v_limit ? 'proportion') AND v_count::numeric / v_denominator > (v_limit->>'proportion')::numeric) THEN
        v_flags := v_flags || pg_catalog.jsonb_build_array(v_kind);
      END IF;
    END IF;
  END LOOP;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'row',r.id,'kind',r.row_kind,'sourceRow',r.row_number,
    'sourceRecord',r.source_record_key,'sourcePath',r.source_path,
    'action',r.proposed_action,'fingerprint',r.action_fingerprint,
    'item',r.item_fingerprint,'key',r.source_product_key,'keyOrigin',r.source_product_key_origin,
    'candidate',r.proposed_product,'validationStatus',r.validation_status,
    'diff',r.proposed_diff,'target',r.matched_product_id,
    'revision',r.expected_product_revision,'updatedAt',r.expected_product_updated_at,
    'errors',r.validation_errors,'warnings',r.validation_warnings
    ) ORDER BY r.action_fingerprint),'[]'::jsonb) INTO v_rows
  FROM public.supplier_feed_rows r WHERE r.feed_run_id=p_run_id;
  v_fingerprint := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('run',v_run.id,'supplier',v_run.supplier_id,
      'source',v_run.feed_source_id,'scope',v_run.scope_key,'adapter',v_run.adapter_id,
      'version',v_run.adapter_version,'planner',v_run.planner_version,'mode',v_run.mode,
      'coverage',v_run.coverage,'authoritative',v_run.authoritative_snapshot,
      'checksum',v_run.source_checksum,'emptyAcknowledged',v_run.allow_empty_snapshot_missing_inference,
      'counts',v_counts,'policy',p_policy,'flags',v_flags,'rows',v_rows)::text,'UTF8')),'hex');
  UPDATE public.supplier_feed_runs SET plan_fingerprint=v_fingerprint,
    plan_counts=v_counts,policy_snapshot=p_policy,anomaly_flags=v_flags,
    row_count=v_total,valid_count=v_valid,error_count=(v_counts->>'reject')::integer,
    change_count=(v_counts->>'create')::integer+(v_counts->>'update')::integer,
    status=CASE WHEN v_run.mode='dry_run' THEN 'planned' ELSE 'awaiting_approval' END
    WHERE id=p_run_id;
  RETURN v_fingerprint;
END $$;

CREATE FUNCTION public.block2e_approve_run(
  p_run_id uuid,p_fingerprint text,p_actor uuid,p_acknowledged jsonb DEFAULT '[]'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_run public.supplier_feed_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.supplier_feed_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.persistence_version<>2 OR v_run.mode<>'apply_requested'
     OR v_run.status<>'awaiting_approval' OR p_actor IS NULL
     OR p_fingerprint IS DISTINCT FROM v_run.plan_fingerprint
     OR pg_catalog.jsonb_typeof(p_acknowledged)<>'array' OR
     (SELECT pg_catalog.jsonb_agg(value ORDER BY value) FROM pg_catalog.jsonb_array_elements_text(p_acknowledged))
       IS DISTINCT FROM
     (SELECT pg_catalog.jsonb_agg(value ORDER BY value) FROM pg_catalog.jsonb_array_elements_text(v_run.anomaly_flags))
     AND NOT (p_acknowledged='[]'::jsonb AND v_run.anomaly_flags='[]'::jsonb) THEN
    RAISE EXCEPTION 'approval/acknowledgement mismatch' USING ERRCODE = '22023'; END IF;
  UPDATE public.supplier_feed_runs SET approved_by=p_actor,approved_at=pg_catalog.now(),
    approved_plan_fingerprint=v_run.plan_fingerprint,acknowledged_anomalies=p_acknowledged,
    status='approved' WHERE id=p_run_id;
END $$;

-- A materializer accepts ONLY this allowlist. No selling-price, credentials or
-- arbitrary canonical columns can flow from proposed_product to product DML.
CREATE FUNCTION public.block2e_product_fields(p_candidate jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_fields jsonb := p_candidate->'fields'; v_result jsonb; v_cost jsonb := p_candidate->'cost'; v_asset jsonb := p_candidate->'asset';
  v_key text; v_column text;
BEGIN
  IF pg_catalog.jsonb_typeof(v_fields)<>'object' OR
     pg_catalog.jsonb_typeof(v_fields->'category')<>'string' OR
     pg_catalog.jsonb_typeof(v_fields->'supplierDescription')<>'string' THEN
    RAISE EXCEPTION 'invalid normalized product fields' USING ERRCODE = '22023'; END IF;
  v_result := pg_catalog.jsonb_build_object(
    'category',v_fields->'category','supplier_description',v_fields->'supplierDescription',
    'availability',v_fields->'availability','lifecycle',v_fields->'lifecycle',
    'supplier_sku',v_fields->'supplierSku','catalog_scope',COALESCE(v_fields->'catalogScope','"default"'::jsonb),
    'variant_key',COALESCE(v_fields->'variantKey','""'::jsonb),
    'subcategory',v_fields->'subcategory','display_description',v_fields->'displayDescription',
    'collection_name',v_fields->'collectionName','colour',v_fields->'colour',
    'finish',v_fields->'finish','material',v_fields->'material','purchase_unit',v_fields->'purchaseUnit',
    'width_mm',v_fields->'widthMm','depth_mm',v_fields->'depthMm',
    'rebate_width_mm',v_fields->'rebateWidthMm','rebate_depth_mm',v_fields->'rebateDepthMm',
    'sheet_width_mm',v_fields->'sheetWidthMm','sheet_height_mm',v_fields->'sheetHeightMm',
    'mat_core',v_fields->'matCore','mat_thickness_mm',v_fields->'matThicknessMm',
    'mat_quality',v_fields->'matQuality','glazing_material',v_fields->'glazingMaterial',
    'glazing_thickness_mm',v_fields->'glazingThicknessMm','glazing_uv_percent',v_fields->'glazingUvPercent',
    'glazing_reflection',v_fields->'glazingReflection');
  -- Omission is not an instruction to clear an existing canonical field.
  -- Explicit JSON null is preserved as a deliberate clear where nullable.
  FOR v_key,v_column IN SELECT * FROM (VALUES
    ('supplierSku','supplier_sku'),('catalogScope','catalog_scope'),('variantKey','variant_key'),
    ('subcategory','subcategory'),('displayDescription','display_description'),
    ('collectionName','collection_name'),('colour','colour'),('finish','finish'),
    ('material','material'),('purchaseUnit','purchase_unit'),('widthMm','width_mm'),
    ('depthMm','depth_mm'),('rebateWidthMm','rebate_width_mm'),('rebateDepthMm','rebate_depth_mm'),
    ('sheetWidthMm','sheet_width_mm'),('sheetHeightMm','sheet_height_mm'),('matCore','mat_core'),
    ('matThicknessMm','mat_thickness_mm'),('matQuality','mat_quality'),
    ('glazingMaterial','glazing_material'),('glazingThicknessMm','glazing_thickness_mm'),
    ('glazingUvPercent','glazing_uv_percent'),('glazingReflection','glazing_reflection')
  ) AS mappings(source_key,canonical_column) LOOP
    IF NOT (v_fields ? v_key) THEN v_result := v_result - v_column; END IF;
  END LOOP;
  IF v_cost IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(v_cost)<>'object' OR
      v_cost->>'amount' IS NULL OR v_cost->>'currency' IS NULL OR
      v_cost->>'unit' IS NULL OR v_cost->>'taxBasis' IS NULL OR v_cost->>'effectiveAt' IS NULL THEN
      RAISE EXCEPTION 'partial cost tuple' USING ERRCODE = '22023'; END IF;
    v_result := v_result || pg_catalog.jsonb_build_object('wholesale_cost',v_cost->'amount',
      'cost_currency',v_cost->'currency','cost_unit',v_cost->'unit',
      'cost_tax_basis',v_cost->'taxBasis','cost_effective_at',v_cost->'effectiveAt');
  END IF;
  IF v_asset IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(v_asset)<>'object' OR v_asset->>'rightsStatus' IS NULL THEN
      RAISE EXCEPTION 'invalid asset metadata' USING ERRCODE = '22023'; END IF;
    v_result := v_result || pg_catalog.jsonb_build_object('image_rights_status',v_asset->'rightsStatus');
    IF v_asset ? 'sourceUrl' THEN
      v_result := v_result || pg_catalog.jsonb_build_object('source_image_url',v_asset->'sourceUrl'); END IF;
    IF v_asset ? 'attribution' THEN
      v_result := v_result || pg_catalog.jsonb_build_object('source_attribution',v_asset->'attribution'); END IF;
    IF v_asset ? 'permittedUses' THEN
      v_result := v_result || pg_catalog.jsonb_build_object('image_permitted_uses',
        pg_catalog.jsonb_build_object('uses',v_asset->'permittedUses')); END IF;
    IF v_asset ? 'sourceUpdatedAt' THEN
      v_result := v_result || pg_catalog.jsonb_build_object('source_image_updated_at',v_asset->'sourceUpdatedAt'); END IF;
  END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.block2e_product_fields(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- One invocation = at most one canonical product mutation and one durable row checkpoint.
-- Caller must commit between invocations. No loop over products or bulk apply RPC.
CREATE FUNCTION public.block2e_apply_row(p_run_id uuid,p_row_id uuid,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_run public.supplier_feed_runs%ROWTYPE; v_row public.supplier_feed_rows%ROWTYPE;
  v_current public.supplier_products%ROWTYPE; v_next public.supplier_products%ROWTYPE;
  v_fields jsonb; v_result uuid; v_revision bigint; v_state text;
  v_old_actor text; v_old_run text; v_old_row text; v_error text;
BEGIN
  SELECT * INTO v_run FROM public.supplier_feed_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.persistence_version<>2 OR v_run.mode<>'apply_requested'
    OR v_run.status NOT IN ('approved','applying','partially_applied','applied')
    OR v_run.approved_plan_fingerprint IS NULL
    OR p_fingerprint IS DISTINCT FROM v_run.approved_plan_fingerprint
    OR v_run.plan_fingerprint IS DISTINCT FROM v_run.approved_plan_fingerprint THEN
    RAISE EXCEPTION 'run/approval fingerprint mismatch' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.supplier_feed_rows WHERE id=p_row_id AND feed_run_id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_row.row_persistence_version<>2 THEN
    RAISE EXCEPTION 'row/run mismatch' USING ERRCODE = '22023'; END IF;
  IF v_row.apply_state IN ('applied','skipped','conflict') THEN
    RETURN pg_catalog.jsonb_build_object('state',v_row.apply_state,'productId',v_row.result_product_id,
      'productRevision',v_row.result_product_revision);
  END IF;
  IF v_run.apply_disposition='replan_required' OR v_run.status='applied' THEN
    RAISE EXCEPTION 'run is not applicable' USING ERRCODE = '22023'; END IF;
  IF v_run.status <> 'applying' THEN
    UPDATE public.supplier_feed_runs SET status='applying',applied_by=v_run.approved_by WHERE id=p_run_id;
  END IF;
  IF v_row.proposed_action NOT IN ('create','update') THEN
    UPDATE public.supplier_feed_rows SET apply_state='skipped',applied_at=pg_catalog.now(),
      outcome_codes=ARRAY['non_mutating_plan_outcome'] WHERE id=p_row_id;
    v_state := 'skipped';
  ELSE
    -- The materializer uses only known canonical fields. Reject unsafe candidates
    -- before any canonical UPDATE; errors in the DML subtransaction leave no product/event.
    BEGIN
      IF public.block2e_has_sensitive_keys(v_row.proposed_product) THEN
        RAISE EXCEPTION 'unsafe candidate' USING ERRCODE = '22023'; END IF;
      v_fields := public.block2e_product_fields(v_row.proposed_product);
      IF v_row.proposed_action='update' THEN
        SELECT * INTO v_current FROM public.supplier_products
          WHERE id=v_row.matched_product_id AND supplier_id=v_run.supplier_id FOR UPDATE;
        IF NOT FOUND OR v_current.product_revision IS DISTINCT FROM v_row.expected_product_revision
          OR v_current.owner_feed_source_id IS DISTINCT FROM v_run.feed_source_id
          OR v_current.owner_scope_key IS DISTINCT FROM v_run.scope_key
          OR NOT (v_current.source_product_key=v_row.source_product_key OR EXISTS (
            SELECT 1 FROM public.supplier_product_aliases a WHERE a.supplier_id=v_run.supplier_id
              AND a.supplier_product_id=v_current.id AND a.alias_kind='source_key'
              AND a.alias_value=v_row.source_product_key)) THEN
          -- The revision, NOT updated_at, is authoritative. This branch makes NO UPDATE.
          UPDATE public.supplier_feed_rows SET apply_state='conflict',failure_code='stale_product_revision',
            outcome_codes=ARRAY['replan_required'] WHERE id=p_row_id;
          UPDATE public.supplier_feed_runs SET status='partially_applied',
            apply_disposition='replan_required',failure_code='stale_product_revision' WHERE id=p_run_id;
          RETURN pg_catalog.jsonb_build_object('state','conflict','reason','replan_required');
        END IF;
        SELECT * INTO v_next FROM pg_catalog.jsonb_populate_record(v_current,v_fields);
        v_old_actor := pg_catalog.current_setting('app.block2d_actor_user_id',true);
        v_old_run := pg_catalog.current_setting('app.block2e_feed_run_id',true);
        v_old_row := pg_catalog.current_setting('app.block2e_feed_row_id',true);
        PERFORM pg_catalog.set_config('app.block2d_actor_user_id',v_run.approved_by::text,true);
        PERFORM pg_catalog.set_config('app.block2e_feed_run_id',p_run_id::text,true);
        PERFORM pg_catalog.set_config('app.block2e_feed_row_id',p_row_id::text,true);
        UPDATE public.supplier_products SET
          category=v_next.category,supplier_description=v_next.supplier_description,
          availability=v_next.availability,lifecycle=v_next.lifecycle,
          supplier_sku=v_next.supplier_sku,catalog_scope=v_next.catalog_scope,variant_key=v_next.variant_key,
          subcategory=v_next.subcategory,display_description=v_next.display_description,
          collection_name=v_next.collection_name,colour=v_next.colour,finish=v_next.finish,
          material=v_next.material,purchase_unit=v_next.purchase_unit,
          width_mm=v_next.width_mm,depth_mm=v_next.depth_mm,rebate_width_mm=v_next.rebate_width_mm,
          rebate_depth_mm=v_next.rebate_depth_mm,sheet_width_mm=v_next.sheet_width_mm,
          sheet_height_mm=v_next.sheet_height_mm,mat_core=v_next.mat_core,
          mat_thickness_mm=v_next.mat_thickness_mm,mat_quality=v_next.mat_quality,
          glazing_material=v_next.glazing_material,glazing_thickness_mm=v_next.glazing_thickness_mm,
          glazing_uv_percent=v_next.glazing_uv_percent,glazing_reflection=v_next.glazing_reflection,
          wholesale_cost=v_next.wholesale_cost,cost_currency=v_next.cost_currency,
          cost_unit=v_next.cost_unit,cost_tax_basis=v_next.cost_tax_basis,
          cost_effective_at=v_next.cost_effective_at,
          source_image_url=v_next.source_image_url,source_attribution=v_next.source_attribution,
          image_rights_status=v_next.image_rights_status,
          image_permitted_uses=v_next.image_permitted_uses,
          source_image_updated_at=v_next.source_image_updated_at
        WHERE id=v_current.id RETURNING id,product_revision INTO v_result,v_revision;
        PERFORM pg_catalog.set_config('app.block2e_feed_run_id',COALESCE(v_old_run,''),true);
        PERFORM pg_catalog.set_config('app.block2e_feed_row_id',COALESCE(v_old_row,''),true);
        PERFORM pg_catalog.set_config('app.block2d_actor_user_id',COALESCE(v_old_actor,''),true);
      ELSE
        IF EXISTS (SELECT 1 FROM public.supplier_products p WHERE p.supplier_id=v_run.supplier_id
           AND p.source_product_key=v_row.source_product_key) OR EXISTS (
           SELECT 1 FROM public.supplier_product_aliases a WHERE a.supplier_id=v_run.supplier_id
             AND a.alias_kind='source_key' AND a.alias_value=v_row.source_product_key) THEN
          UPDATE public.supplier_feed_rows SET apply_state='conflict',failure_code='identity_collision',
            outcome_codes=ARRAY['replan_required'] WHERE id=p_row_id;
          UPDATE public.supplier_feed_runs SET status='partially_applied',
            apply_disposition='replan_required',failure_code='identity_collision' WHERE id=p_run_id;
          RETURN pg_catalog.jsonb_build_object('state','conflict','reason','replan_required');
        END IF;
        SELECT * INTO v_next FROM pg_catalog.jsonb_populate_record(NULL::public.supplier_products,v_fields);
        INSERT INTO public.supplier_products(
          supplier_id,source_product_key,owner_feed_source_id,owner_scope_key,ownership_run_id,
          category,supplier_description,availability,lifecycle,supplier_sku,catalog_scope,variant_key,
          subcategory,display_description,collection_name,colour,finish,material,purchase_unit,
          width_mm,depth_mm,rebate_width_mm,rebate_depth_mm,sheet_width_mm,sheet_height_mm,
          mat_core,mat_thickness_mm,mat_quality,glazing_material,glazing_thickness_mm,
          glazing_uv_percent,glazing_reflection,wholesale_cost,cost_currency,cost_unit,cost_tax_basis,
          cost_effective_at,source_image_url,source_attribution,image_rights_status,
          image_permitted_uses,source_image_updated_at)
        VALUES (v_run.supplier_id,v_row.source_product_key,v_run.feed_source_id,v_run.scope_key,p_run_id,
          v_next.category,v_next.supplier_description,v_next.availability,v_next.lifecycle,
          v_next.supplier_sku,COALESCE(v_next.catalog_scope,'default'),COALESCE(v_next.variant_key,''),v_next.subcategory,
          v_next.display_description,v_next.collection_name,v_next.colour,v_next.finish,
          v_next.material,v_next.purchase_unit,v_next.width_mm,v_next.depth_mm,
          v_next.rebate_width_mm,v_next.rebate_depth_mm,v_next.sheet_width_mm,v_next.sheet_height_mm,
          v_next.mat_core,v_next.mat_thickness_mm,v_next.mat_quality,v_next.glazing_material,
          v_next.glazing_thickness_mm,v_next.glazing_uv_percent,v_next.glazing_reflection,
          v_next.wholesale_cost,v_next.cost_currency,v_next.cost_unit,v_next.cost_tax_basis,
          v_next.cost_effective_at,v_next.source_image_url,v_next.source_attribution,
          COALESCE(v_next.image_rights_status,'unknown'),
          COALESCE(v_next.image_permitted_uses,'{}'::jsonb),v_next.source_image_updated_at)
        RETURNING id,product_revision INTO v_result,v_revision;
      END IF;
      UPDATE public.supplier_feed_rows SET apply_state='applied',applied_at=pg_catalog.now(),
        result_product_id=v_result,result_product_revision=v_revision,
        outcome_codes=ARRAY['canonical_applied'] WHERE id=p_row_id;
      v_state := 'applied';
    EXCEPTION WHEN OTHERS THEN
      -- PL/pgSQL rolls back ALL mutations inside the failed subtransaction,
      -- including the Block 2D audit event. Keep a non-sensitive failure code.
      UPDATE public.supplier_feed_rows SET apply_state='failed',failure_code=SQLSTATE,
        outcome_codes=ARRAY['retryable_apply_failure'] WHERE id=p_row_id;
      v_state := 'failed';
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id
      AND apply_state IN ('pending','failed')) THEN
    UPDATE public.supplier_feed_runs SET status='applied',completed_at=pg_catalog.now() WHERE id=p_run_id;
  ELSE
    UPDATE public.supplier_feed_runs SET status='partially_applied' WHERE id=p_run_id;
  END IF;
  RETURN pg_catalog.jsonb_build_object('state',v_state,'productId',v_result,'productRevision',v_revision);
END $$;

-- Delete ONLY bulky private staging after its retention window, keep row outcome,
-- identity/provenance, action and checkpoint. Artifact deletion is an external job,
-- never performed implicitly by this migration.
CREATE FUNCTION public.block2e_mark_retention_purged(p_run_id uuid,p_artifact boolean,p_staging boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_run public.supplier_feed_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.supplier_feed_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.persistence_version<>2 OR
      v_run.status NOT IN ('planned','applied','failed','rejected') THEN
    RAISE EXCEPTION 'run not terminal' USING ERRCODE = '22023'; END IF;
  IF p_staging THEN
    IF pg_catalog.now()<v_run.staging_purge_after THEN
      RAISE EXCEPTION 'staging retention window active' USING ERRCODE = '22023'; END IF;
    UPDATE public.supplier_feed_runs SET staging_purged_at=pg_catalog.now() WHERE id=p_run_id;
    UPDATE public.supplier_feed_rows SET proposed_product=NULL,proposed_diff=NULL,
      raw_record=NULL,validation_errors='[]'::jsonb,validation_warnings='[]'::jsonb
    WHERE feed_run_id=p_run_id;
  END IF;
  IF p_artifact THEN
    IF v_run.artifact_ref IS NOT NULL AND pg_catalog.now()<v_run.artifact_purge_after THEN
      RAISE EXCEPTION 'artifact retention window active' USING ERRCODE = '22023'; END IF;
    UPDATE public.supplier_feed_runs SET artifact_ref=NULL,artifact_purged_at=pg_catalog.now() WHERE id=p_run_id;
  END IF;
END $$;

-- A genuinely zero-row approved run cannot call apply_row. Finish it without
-- creating any canonical mutation or inferring absence.
CREATE FUNCTION public.block2e_finish_empty_run(p_run_id uuid,p_fingerprint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_run public.supplier_feed_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.supplier_feed_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.persistence_version<>2 OR v_run.mode<>'apply_requested'
     OR v_run.status<>'approved' OR v_run.row_count<>0
     OR p_fingerprint IS DISTINCT FROM v_run.plan_fingerprint
     OR v_run.approved_plan_fingerprint IS DISTINCT FROM v_run.plan_fingerprint
     OR EXISTS (SELECT 1 FROM public.supplier_feed_rows WHERE feed_run_id=p_run_id) THEN
    RAISE EXCEPTION 'not an approved empty run' USING ERRCODE = '22023'; END IF;
  UPDATE public.supplier_feed_runs SET status='applying',applied_by=v_run.approved_by WHERE id=p_run_id;
  UPDATE public.supplier_feed_runs SET status='applied',completed_at=pg_catalog.now() WHERE id=p_run_id;
END $$;

REVOKE ALL ON FUNCTION public.block2e_freeze_plan(uuid,jsonb),
  public.block2e_approve_run(uuid,text,uuid,jsonb),public.block2e_apply_row(uuid,uuid,text),
  public.block2e_mark_retention_purged(uuid,boolean,boolean),
  public.block2e_finish_empty_run(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block2e_freeze_plan(uuid,jsonb),
  public.block2e_approve_run(uuid,text,uuid,jsonb),public.block2e_apply_row(uuid,uuid,text),
  public.block2e_mark_retention_purged(uuid,boolean,boolean),
  public.block2e_finish_empty_run(uuid,text) TO service_role;

COMMIT;
