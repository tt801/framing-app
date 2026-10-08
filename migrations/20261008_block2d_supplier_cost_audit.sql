-- Block 2D: additive supplier cost audit. PREPARE ONLY; requires separate Sandbox approval.
-- Install before deploying the Block 2D product PATCH handler (it fails closed without this RPC).
-- Reversal before any Block 2D writes: drop the RPC and audit trigger/function, remove
-- old_effective_at and the two new checks, then restore the three NOT NULL columns
-- only if no clearing events exist. Once audit events exist, retain them; do not erase history.
BEGIN;

-- A removed cost is itself an auditable transition. Block 2B originally required
-- new_cost/currency/unit/tax to be non-null; relax these ONLY on the private event table.
ALTER TABLE public.supplier_product_cost_events
  ALTER COLUMN new_cost DROP NOT NULL,
  ALTER COLUMN new_currency DROP NOT NULL,
  ALTER COLUMN new_unit DROP NOT NULL,
  ALTER COLUMN new_tax_basis DROP NOT NULL,
  ADD COLUMN old_effective_at timestamptz,
  ADD CONSTRAINT block2d_new_cost_complete CHECK (
    (new_cost IS NULL AND new_currency IS NULL AND new_unit IS NULL
      AND new_tax_basis IS NULL AND source_effective_at IS NULL)
    OR (new_cost IS NOT NULL AND new_currency IS NOT NULL
      AND nullif(btrim(new_unit), '') IS NOT NULL AND new_tax_basis IS NOT NULL
      AND source_effective_at IS NOT NULL)
  );

-- This trigger is the audit boundary for *every* trusted UPDATE, not just this UI.
-- The AFTER trigger and product UPDATE share a transaction; an insert failure
-- rolls the product change back. Initial INSERTs intentionally have no event.
CREATE FUNCTION public.block2d_audit_product_cost() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_actor text := pg_catalog.current_setting('app.block2d_actor_user_id', true);
BEGIN
  IF (OLD.wholesale_cost, OLD.cost_currency, OLD.cost_unit, OLD.cost_tax_basis, OLD.cost_effective_at)
     IS DISTINCT FROM
     (NEW.wholesale_cost, NEW.cost_currency, NEW.cost_unit, NEW.cost_tax_basis, NEW.cost_effective_at) THEN
    INSERT INTO public.supplier_product_cost_events (
      supplier_id, supplier_product_id, event_key,
      old_cost, new_cost, old_currency, new_currency,
      old_unit, new_unit, old_tax_basis, new_tax_basis,
      old_effective_at, source_effective_at, actor_user_id, reason
    ) VALUES (
      NEW.supplier_id, NEW.id, 'block2d:' || pg_catalog.gen_random_uuid()::text,
      OLD.wholesale_cost, NEW.wholesale_cost, OLD.cost_currency, NEW.cost_currency,
      OLD.cost_unit, NEW.cost_unit, OLD.cost_tax_basis, NEW.cost_tax_basis,
      OLD.cost_effective_at, NEW.cost_effective_at,
      NULLIF(v_actor, '')::uuid,
      CASE WHEN NULLIF(v_actor, '') IS NULL THEN 'trusted product cost update' ELSE 'platform admin cost update' END
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER block2d_product_cost_audit AFTER UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.block2d_audit_product_cost();
REVOKE ALL ON FUNCTION public.block2d_audit_product_cost() FROM PUBLIC, anon, authenticated, service_role;

-- Single update route for Admin metadata + cost. A row lock and expected version
-- stop a replay (including one after an intervening edit) from writing again.
-- jsonb_populate_record preserves omitted fields; only server-validated fields
-- may be changed even by a direct service-role caller of this RPC.
CREATE FUNCTION public.block2d_update_supplier_product(
  p_supplier_id uuid, p_product_id uuid, p_expected_updated_at timestamptz,
  p_fields jsonb, p_actor_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_current public.supplier_products%ROWTYPE;
  v_next public.supplier_products%ROWTYPE;
BEGIN
  IF p_supplier_id IS NULL OR p_product_id IS NULL OR p_expected_updated_at IS NULL
     OR p_actor_user_id IS NULL OR p_fields IS NULL OR pg_catalog.jsonb_typeof(p_fields) <> 'object'
     OR p_fields = '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid supplier product update' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_object_keys(p_fields) AS field(key)
    WHERE field.key <> ALL (ARRAY[
      'category','supplier_description','availability','lifecycle',
      'subcategory','display_description','collection_name','colour','finish','material',
      'purchase_unit','mat_core','mat_quality','glazing_material','glazing_reflection','source_attribution',
      'width_mm','depth_mm','rebate_width_mm','rebate_depth_mm','sheet_width_mm','sheet_height_mm',
      'mat_thickness_mm','glazing_thickness_mm','glazing_uv_percent',
      'wholesale_cost','cost_currency','cost_unit','cost_tax_basis','cost_effective_at'
    ])
  ) THEN
    RAISE EXCEPTION 'Uneditable supplier product field' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_current FROM public.supplier_products
  WHERE supplier_id = p_supplier_id AND id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier product not found' USING ERRCODE = 'P0002'; END IF;
  IF v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Supplier product version changed; refresh before retrying' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_next FROM pg_catalog.jsonb_populate_record(v_current, p_fields);
  PERFORM pg_catalog.set_config('app.block2d_actor_user_id', p_actor_user_id::text, true);
  UPDATE public.supplier_products SET
    category = v_next.category, supplier_description = v_next.supplier_description,
    availability = v_next.availability, lifecycle = v_next.lifecycle,
    subcategory = v_next.subcategory, display_description = v_next.display_description,
    collection_name = v_next.collection_name, colour = v_next.colour, finish = v_next.finish,
    material = v_next.material, purchase_unit = v_next.purchase_unit, mat_core = v_next.mat_core,
    mat_quality = v_next.mat_quality, glazing_material = v_next.glazing_material,
    glazing_reflection = v_next.glazing_reflection, source_attribution = v_next.source_attribution,
    width_mm = v_next.width_mm, depth_mm = v_next.depth_mm,
    rebate_width_mm = v_next.rebate_width_mm, rebate_depth_mm = v_next.rebate_depth_mm,
    sheet_width_mm = v_next.sheet_width_mm, sheet_height_mm = v_next.sheet_height_mm,
    mat_thickness_mm = v_next.mat_thickness_mm, glazing_thickness_mm = v_next.glazing_thickness_mm,
    glazing_uv_percent = v_next.glazing_uv_percent,
    wholesale_cost = v_next.wholesale_cost, cost_currency = v_next.cost_currency,
    cost_unit = v_next.cost_unit, cost_tax_basis = v_next.cost_tax_basis,
    cost_effective_at = v_next.cost_effective_at
  WHERE supplier_id = p_supplier_id AND id = p_product_id;
  RETURN p_product_id;
END $$;
REVOKE ALL ON FUNCTION public.block2d_update_supplier_product(uuid,uuid,timestamptz,jsonb,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block2d_update_supplier_product(uuid,uuid,timestamptz,jsonb,uuid)
  TO service_role;
COMMIT;
