-- Block 2D/2E hardening: capture initial supplier cost baselines on INSERT.
-- Additive forward migration only. Do NOT backfill historical products/events.
BEGIN;

-- Block 2D remains the sole writer of supplier_product_cost_events.
-- New behavior:
--   * INSERT with a complete initial cost tuple => one baseline event (old_* = NULL).
--   * INSERT without complete cost tuple => no event.
-- Existing UPDATE transition auditing semantics remain unchanged.
CREATE OR REPLACE FUNCTION public.block2d_audit_product_cost() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_actor text := pg_catalog.current_setting('app.block2d_actor_user_id', true);
  v_feed_run text := pg_catalog.current_setting('app.block2e_feed_run_id', true);
  v_feed_row text := pg_catalog.current_setting('app.block2e_feed_row_id', true);
  v_new_cost_complete boolean := NEW.wholesale_cost IS NOT NULL AND NEW.cost_currency IS NOT NULL
    AND NEW.cost_unit IS NOT NULL AND NEW.cost_tax_basis IS NOT NULL AND NEW.cost_effective_at IS NOT NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_new_cost_complete THEN
      RETURN NEW;
    END IF;
    IF (NULLIF(v_feed_run,'') IS NULL) <> (NULLIF(v_feed_row,'') IS NULL) THEN
      RAISE EXCEPTION 'incomplete feed cost provenance' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(v_feed_row,'') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.supplier_feed_rows fr
      JOIN public.supplier_feed_runs run ON run.id = fr.feed_run_id
      WHERE fr.id = v_feed_row::uuid AND fr.feed_run_id = v_feed_run::uuid
        AND fr.source_product_key = NEW.source_product_key
        AND fr.proposed_action = 'create' AND fr.apply_state IN ('pending','failed')
        AND run.status = 'applying' AND run.mode = 'apply_requested'
        AND run.approved_plan_fingerprint = run.plan_fingerprint
    ) THEN
      RAISE EXCEPTION 'invalid feed cost provenance' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.supplier_product_cost_events (
      supplier_id, supplier_product_id, event_key, feed_run_id, feed_row_id,
      old_cost, new_cost, old_currency, new_currency, old_unit, new_unit,
      old_tax_basis, new_tax_basis, old_effective_at, source_effective_at, actor_user_id, reason
    ) VALUES (
      NEW.supplier_id, NEW.id,
      CASE WHEN NULLIF(v_feed_row,'') IS NULL THEN 'block2d:' || pg_catalog.gen_random_uuid()::text
           ELSE 'block2e:' || v_feed_row END,
      NULLIF(v_feed_run,'')::uuid, NULLIF(v_feed_row,'')::uuid,
      NULL, NEW.wholesale_cost, NULL, NEW.cost_currency,
      NULL, NEW.cost_unit, NULL, NEW.cost_tax_basis,
      NULL, NEW.cost_effective_at, NULLIF(v_actor,'')::uuid,
      CASE WHEN NULLIF(v_feed_run,'') IS NOT NULL THEN 'supplier feed canonical cost create'
           WHEN NULLIF(v_actor,'') IS NULL THEN 'trusted product cost create'
           ELSE 'platform admin cost create' END
    );
    RETURN NEW;
  END IF;

  IF (OLD.wholesale_cost, OLD.cost_currency, OLD.cost_unit, OLD.cost_tax_basis, OLD.cost_effective_at)
     IS DISTINCT FROM
     (NEW.wholesale_cost, NEW.cost_currency, NEW.cost_unit, NEW.cost_tax_basis, NEW.cost_effective_at) THEN
    IF (NULLIF(v_feed_run,'') IS NULL) <> (NULLIF(v_feed_row,'') IS NULL) THEN
      RAISE EXCEPTION 'incomplete feed cost provenance' USING ERRCODE = '22023';
    END IF;
    IF NULLIF(v_feed_row,'') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.supplier_feed_rows fr
      JOIN public.supplier_feed_runs run ON run.id = fr.feed_run_id
      WHERE fr.id = v_feed_row::uuid AND fr.feed_run_id = v_feed_run::uuid
        AND fr.matched_product_id = NEW.id AND fr.expected_product_revision = OLD.product_revision
        AND fr.proposed_action = 'update' AND fr.apply_state IN ('pending','failed')
        AND run.status = 'applying' AND run.mode = 'apply_requested'
        AND run.approved_plan_fingerprint = run.plan_fingerprint
    ) THEN
      RAISE EXCEPTION 'invalid feed cost provenance' USING ERRCODE = '22023';
    END IF;
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

DROP TRIGGER IF EXISTS block2d_product_cost_audit ON public.supplier_products;
CREATE TRIGGER block2d_product_cost_audit AFTER INSERT OR UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.block2d_audit_product_cost();

-- Feed-created canonical inserts now establish and validate feed cost provenance
-- through the same Block 2D audit trigger path as updates.
CREATE OR REPLACE FUNCTION public.block2e_apply_row(p_run_id uuid,p_row_id uuid,p_fingerprint text)
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
    -- before any canonical UPDATE/INSERT; errors in the DML subtransaction leave no product/event.
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
        v_old_actor := pg_catalog.current_setting('app.block2d_actor_user_id',true);
        v_old_run := pg_catalog.current_setting('app.block2e_feed_run_id',true);
        v_old_row := pg_catalog.current_setting('app.block2e_feed_row_id',true);
        PERFORM pg_catalog.set_config('app.block2d_actor_user_id',v_run.approved_by::text,true);
        PERFORM pg_catalog.set_config('app.block2e_feed_run_id',p_run_id::text,true);
        PERFORM pg_catalog.set_config('app.block2e_feed_row_id',p_row_id::text,true);
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
        PERFORM pg_catalog.set_config('app.block2e_feed_run_id',COALESCE(v_old_run,''),true);
        PERFORM pg_catalog.set_config('app.block2e_feed_row_id',COALESCE(v_old_row,''),true);
        PERFORM pg_catalog.set_config('app.block2d_actor_user_id',COALESCE(v_old_actor,''),true);
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

COMMIT;
