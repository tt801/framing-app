-- Block 2B: additive, private central supplier foundation. Not a supplier-price resolver.
-- Apply only after review; this migration does not touch company_catalog or historical documents.
-- Rollback (only before any supplier/company records are used): drop these new tables in
-- reverse FK order, then the four block2b_* trigger functions. Never replay against
-- a populated installation to 'undo' a feed: preserve identities and audit history.
BEGIN;

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','retired')),
  countries text[] NOT NULL DEFAULT '{}',
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_metadata) = 'object'),
  asset_rights_status text NOT NULL DEFAULT 'unknown'
    CHECK (asset_rights_status IN ('unknown','permitted','restricted','prohibited')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  catalog_scope text NOT NULL DEFAULT 'default' CHECK (btrim(catalog_scope) <> ''),
  source_product_key text CHECK (source_product_key IS NULL OR btrim(source_product_key) <> ''),
  supplier_sku text CHECK (supplier_sku IS NULL OR btrim(supplier_sku) <> ''),
  sku_normalized text GENERATED ALWAYS AS (nullif(lower(btrim(supplier_sku)), '')) STORED,
  variant_key text NOT NULL DEFAULT '' CHECK (variant_key = btrim(variant_key)),
  category text NOT NULL CHECK (category IN ('frame','mat','glazing','printing','backer','other')),
  subcategory text,
  supplier_description text NOT NULL CHECK (btrim(supplier_description) <> ''),
  display_description text,
  collection_name text, colour text, finish text, material text,
  purchase_unit text, pack_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pack_metadata) = 'object'),
  width_mm numeric CHECK (width_mm >= 0 AND width_mm < 'Infinity'::numeric),
  depth_mm numeric CHECK (depth_mm >= 0 AND depth_mm < 'Infinity'::numeric),
  rebate_width_mm numeric CHECK (rebate_width_mm >= 0 AND rebate_width_mm < 'Infinity'::numeric),
  rebate_depth_mm numeric CHECK (rebate_depth_mm >= 0 AND rebate_depth_mm < 'Infinity'::numeric),
  sheet_width_mm numeric CHECK (sheet_width_mm >= 0 AND sheet_width_mm < 'Infinity'::numeric),
  sheet_height_mm numeric CHECK (sheet_height_mm >= 0 AND sheet_height_mm < 'Infinity'::numeric),
  mat_core text, mat_thickness_mm numeric CHECK (mat_thickness_mm >= 0 AND mat_thickness_mm < 'Infinity'::numeric), mat_quality text,
  glazing_material text, glazing_thickness_mm numeric CHECK (glazing_thickness_mm >= 0 AND glazing_thickness_mm < 'Infinity'::numeric),
  glazing_uv_percent numeric CHECK (glazing_uv_percent BETWEEN 0 AND 100), glazing_reflection text,
  availability text NOT NULL DEFAULT 'unknown' CHECK (availability IN ('unknown','available','limited','unavailable')),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','discontinued','superseded')),
  replacement_product_id uuid,
  wholesale_cost numeric CHECK (wholesale_cost >= 0 AND wholesale_cost < 'Infinity'::numeric),
  cost_currency text CHECK (cost_currency ~ '^[A-Z]{3}$'),
  cost_unit text, cost_tax_basis text CHECK (cost_tax_basis IN ('exclusive','inclusive','exempt','unknown')),
  cost_effective_at timestamptz,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_metadata) = 'object'),
  source_revision text, source_updated_at timestamptz, last_observed_at timestamptz,
  source_image_url text, source_attribution text,
  image_rights_status text NOT NULL DEFAULT 'unknown'
    CHECK (image_rights_status IN ('unknown','permitted','restricted','prohibited')),
  image_permitted_uses jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(image_permitted_uses) = 'object'),
  source_image_updated_at timestamptz, cached_asset_key text, thumbnail_key text, texture_key text,
  image_checksum text, asset_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (asset_status IN ('unreviewed','approved','unavailable','failed')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, id),
  CONSTRAINT supplier_products_replacement_not_self CHECK (replacement_product_id IS NULL OR replacement_product_id <> id),
  CONSTRAINT supplier_products_replacement_same_supplier FOREIGN KEY (supplier_id, replacement_product_id)
    REFERENCES public.supplier_products(supplier_id, id) ON DELETE RESTRICT,
  CONSTRAINT supplier_products_cost_complete CHECK (wholesale_cost IS NULL OR
    (cost_currency IS NOT NULL AND nullif(btrim(cost_unit), '') IS NOT NULL AND cost_tax_basis IS NOT NULL))
);
CREATE UNIQUE INDEX supplier_products_source_key_uq ON public.supplier_products (supplier_id, source_product_key)
  WHERE source_product_key IS NOT NULL;
CREATE UNIQUE INDEX supplier_products_sku_variant_uq ON public.supplier_products
  (supplier_id, catalog_scope, sku_normalized, variant_key) WHERE sku_normalized IS NOT NULL;
CREATE INDEX supplier_products_browse_idx ON public.supplier_products (supplier_id, category, lifecycle, availability);
CREATE INDEX supplier_products_replacement_idx ON public.supplier_products (replacement_product_id)
  WHERE replacement_product_id IS NOT NULL;

-- Old source keys/SKUs remain resolvable when the current code changes. The feed
-- importer must detect aliases colliding with another product's current code.
CREATE TABLE public.supplier_product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL,
  supplier_product_id uuid NOT NULL,
  catalog_scope text NOT NULL DEFAULT 'default' CHECK (btrim(catalog_scope) <> ''),
  alias_kind text NOT NULL CHECK (alias_kind IN ('source_key','sku')),
  alias_value text NOT NULL CHECK (btrim(alias_value) <> ''),
  variant_key text NOT NULL DEFAULT '' CHECK (variant_key = btrim(variant_key)),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_product_aliases_product_fk FOREIGN KEY (supplier_id, supplier_product_id)
    REFERENCES public.supplier_products(supplier_id, id) ON DELETE RESTRICT,
  CHECK (alias_kind <> 'sku' OR alias_value = lower(btrim(alias_value)))
);
CREATE UNIQUE INDEX supplier_product_aliases_source_uq ON public.supplier_product_aliases (supplier_id, alias_value)
  WHERE alias_kind = 'source_key';
CREATE UNIQUE INDEX supplier_product_aliases_sku_uq ON public.supplier_product_aliases
  (supplier_id, catalog_scope, alias_value, variant_key) WHERE alias_kind = 'sku';
CREATE INDEX supplier_product_aliases_product_idx ON public.supplier_product_aliases (supplier_product_id);

CREATE TABLE public.supplier_feed_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  source_version text, source_checksum text, adapter_version text NOT NULL CHECK (btrim(adapter_version) <> ''),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','staged','validated','approved','applied','failed','rolled_back')),
  artifact_ref text, started_at timestamptz, completed_at timestamptz,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  valid_count integer NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  change_count integer NOT NULL DEFAULT 0 CHECK (change_count >= 0),
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_summary) = 'object'),
  -- Retain actor IDs for audit even if an auth user is later removed.
  approved_by uuid, applied_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, id)
);
CREATE INDEX supplier_feed_runs_recent_idx ON public.supplier_feed_runs (supplier_id, created_at DESC);

CREATE TABLE public.supplier_feed_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_run_id uuid NOT NULL REFERENCES public.supplier_feed_runs(id) ON DELETE RESTRICT,
  row_number integer CHECK (row_number > 0), source_record_key text,
  raw_record jsonb NOT NULL, proposed_product jsonb,
  validation_status text NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','valid','invalid')),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_errors) = 'array'),
  proposed_action text CHECK (proposed_action IN ('create','update','unchanged','discontinue','review')),
  proposed_diff jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feed_run_id, row_number)
);
CREATE INDEX supplier_feed_rows_state_idx ON public.supplier_feed_rows (feed_run_id, validation_status);

CREATE TABLE public.company_suppliers (
  company_account_id uuid NOT NULL REFERENCES public.company_accounts(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  region text, account_reference text, reference_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(reference_metadata) = 'object'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_account_id, supplier_id)
);
CREATE INDEX company_suppliers_supplier_idx ON public.company_suppliers (supplier_id, enabled);

-- NULL means inherit/no override. FALSE and zero are deliberate override values.
-- These are data placeholders, not an activated supplier selling-price rule.
CREATE TABLE public.company_product_overrides (
  company_account_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  supplier_product_id uuid NOT NULL,
  active_override boolean, excluded_override boolean,
  description_override text, image_asset_key_override text,
  effective_cost_override numeric CHECK (effective_cost_override >= 0 AND effective_cost_override < 'Infinity'::numeric),
  cost_currency text CHECK (cost_currency ~ '^[A-Z]{3}$'), cost_unit text,
  selling_price_override numeric CHECK (selling_price_override >= 0 AND selling_price_override < 'Infinity'::numeric),
  selling_currency text CHECK (selling_currency ~ '^[A-Z]{3}$'), selling_unit text,
  stock_eligibility_override boolean,
  stock_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(stock_metadata) = 'object'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_account_id, supplier_product_id),
  FOREIGN KEY (company_account_id, supplier_id) REFERENCES public.company_suppliers(company_account_id, supplier_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id, supplier_product_id) REFERENCES public.supplier_products(supplier_id, id) ON DELETE RESTRICT,
  CHECK (effective_cost_override IS NULL OR (cost_currency IS NOT NULL AND nullif(btrim(cost_unit), '') IS NOT NULL)),
  CHECK (selling_price_override IS NULL OR (selling_currency IS NOT NULL AND nullif(btrim(selling_unit), '') IS NOT NULL))
);
CREATE INDEX company_product_overrides_product_idx ON public.company_product_overrides (supplier_product_id);

CREATE TABLE public.supplier_product_cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL, supplier_product_id uuid NOT NULL,
  feed_run_id uuid, event_key text NOT NULL CHECK (btrim(event_key) <> ''),
  old_cost numeric CHECK (old_cost >= 0 AND old_cost < 'Infinity'::numeric),
  new_cost numeric NOT NULL CHECK (new_cost >= 0 AND new_cost < 'Infinity'::numeric),
  old_currency text CHECK (old_currency ~ '^[A-Z]{3}$'), new_currency text NOT NULL CHECK (new_currency ~ '^[A-Z]{3}$'),
  old_unit text, new_unit text NOT NULL CHECK (btrim(new_unit) <> ''),
  old_tax_basis text CHECK (old_tax_basis IN ('exclusive','inclusive','exempt','unknown')),
  new_tax_basis text NOT NULL CHECK (new_tax_basis IN ('exclusive','inclusive','exempt','unknown')),
  source_effective_at timestamptz, observed_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  reason text,
  FOREIGN KEY (supplier_id, supplier_product_id) REFERENCES public.supplier_products(supplier_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id, feed_run_id) REFERENCES public.supplier_feed_runs(supplier_id, id) ON DELETE RESTRICT,
  CHECK (feed_run_id IS NOT NULL OR nullif(btrim(reason), '') IS NOT NULL),
  UNIQUE (supplier_product_id, event_key)
);
CREATE UNIQUE INDEX supplier_product_cost_events_run_uq ON public.supplier_product_cost_events (supplier_product_id, feed_run_id)
  WHERE feed_run_id IS NOT NULL;
CREATE INDEX supplier_product_cost_events_history_idx ON public.supplier_product_cost_events (supplier_product_id, observed_at DESC);

CREATE FUNCTION public.block2b_touch_row() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_TABLE_NAME IN ('company_suppliers','company_product_overrides') THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION public.block2b_protect_product() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Supplier products cannot be hard-deleted'; END IF;
  IF NEW.id <> OLD.id OR NEW.supplier_id <> OLD.supplier_id THEN
    RAISE EXCEPTION 'Supplier product identity cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION public.block2b_protect_cost_event() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Supplier cost events are append-only';
END $$;
CREATE FUNCTION public.block2b_protect_alias() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Supplier product aliases are append-only';
END $$;
CREATE TRIGGER block2b_supplier_touch BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.block2b_touch_row();
CREATE TRIGGER block2b_product_touch BEFORE UPDATE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.block2b_touch_row();
CREATE TRIGGER block2b_feed_touch BEFORE UPDATE ON public.supplier_feed_runs
  FOR EACH ROW EXECUTE FUNCTION public.block2b_touch_row();
CREATE TRIGGER block2b_company_supplier_touch BEFORE UPDATE ON public.company_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.block2b_touch_row();
CREATE TRIGGER block2b_override_touch BEFORE UPDATE ON public.company_product_overrides
  FOR EACH ROW EXECUTE FUNCTION public.block2b_touch_row();
CREATE TRIGGER block2b_product_guard BEFORE UPDATE OR DELETE ON public.supplier_products
  FOR EACH ROW EXECUTE FUNCTION public.block2b_protect_product();
CREATE TRIGGER block2b_cost_event_guard BEFORE UPDATE OR DELETE ON public.supplier_product_cost_events
  FOR EACH ROW EXECUTE FUNCTION public.block2b_protect_cost_event();
CREATE TRIGGER block2b_alias_guard BEFORE UPDATE OR DELETE ON public.supplier_product_aliases
  FOR EACH ROW EXECUTE FUNCTION public.block2b_protect_alias();
REVOKE ALL ON FUNCTION public.block2b_touch_row(), public.block2b_protect_product(),
  public.block2b_protect_cost_event(), public.block2b_protect_alias() FROM PUBLIC, anon, authenticated;

-- No client read projection in 2B: wholesale costs, feeds and staging are private.
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_product_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_feed_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_feed_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_product_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_product_cost_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suppliers, public.supplier_products, public.supplier_product_aliases,
  public.supplier_feed_runs, public.supplier_feed_rows, public.company_suppliers,
  public.company_product_overrides, public.supplier_product_cost_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.suppliers, public.supplier_products,
  public.supplier_feed_runs, public.supplier_feed_rows TO service_role;
GRANT SELECT, INSERT ON public.supplier_product_aliases, public.supplier_product_cost_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.company_suppliers, public.company_product_overrides TO service_role;
-- Aliases and cost history are immutable even for the table owner; triggers reject UPDATE/DELETE.
GRANT SELECT, INSERT, UPDATE ON public.company_suppliers, public.company_product_overrides TO authenticated;

-- These entire configuration tables (including possible trade costs/references) are
-- owner/manager-only. Block 2C must provide any safe staff-facing projection.
CREATE POLICY "Company supplier managers read" ON public.company_suppliers FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.company_accounts ca
  WHERE ca.id = company_suppliers.company_account_id AND ca.owner_user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.company_members cm
    WHERE cm.company_account_id = company_suppliers.company_account_id AND cm.user_id = auth.uid()
      AND cm.status = 'active' AND cm.role IN ('owner','manager')));
CREATE POLICY "Company supplier managers insert" ON public.company_suppliers FOR INSERT TO authenticated
WITH CHECK (public.is_company_account_writable(company_account_id) AND
  (EXISTS (SELECT 1 FROM public.company_accounts ca
    WHERE ca.id = company_suppliers.company_account_id AND ca.owner_user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.company_members cm
    WHERE cm.company_account_id = company_suppliers.company_account_id AND cm.user_id = auth.uid()
      AND cm.status = 'active' AND cm.role IN ('owner','manager'))));
CREATE POLICY "Company supplier managers update" ON public.company_suppliers FOR UPDATE TO authenticated
USING (public.is_company_account_writable(company_account_id) AND
  (EXISTS (SELECT 1 FROM public.company_accounts ca
    WHERE ca.id = company_suppliers.company_account_id AND ca.owner_user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.company_members cm
    WHERE cm.company_account_id = company_suppliers.company_account_id AND cm.user_id = auth.uid()
      AND cm.status = 'active' AND cm.role IN ('owner','manager'))))
WITH CHECK (public.is_company_account_writable(company_account_id) AND
  (EXISTS (SELECT 1 FROM public.company_accounts ca
    WHERE ca.id = company_suppliers.company_account_id AND ca.owner_user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.company_members cm
    WHERE cm.company_account_id = company_suppliers.company_account_id AND cm.user_id = auth.uid()
      AND cm.status = 'active' AND cm.role IN ('owner','manager'))));

CREATE POLICY "Company override managers read" ON public.company_product_overrides FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.company_accounts ca
  WHERE ca.id = company_product_overrides.company_account_id AND ca.owner_user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.company_members cm
    WHERE cm.company_account_id = company_product_overrides.company_account_id AND cm.user_id = auth.uid()
      AND cm.status = 'active' AND cm.role IN ('owner','manager')));
CREATE POLICY "Company override managers insert" ON public.company_product_overrides FOR INSERT TO authenticated
WITH CHECK (public.is_company_account_writable(company_account_id) AND
  (EXISTS (SELECT 1 FROM public.company_accounts ca
    WHERE ca.id = company_product_overrides.company_account_id AND ca.owner_user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.company_members cm
    WHERE cm.company_account_id = company_product_overrides.company_account_id AND cm.user_id = auth.uid()
      AND cm.status = 'active' AND cm.role IN ('owner','manager'))));
CREATE POLICY "Company override managers update" ON public.company_product_overrides FOR UPDATE TO authenticated
USING (public.is_company_account_writable(company_account_id) AND
  (EXISTS (SELECT 1 FROM public.company_accounts ca
    WHERE ca.id = company_product_overrides.company_account_id AND ca.owner_user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.company_members cm
    WHERE cm.company_account_id = company_product_overrides.company_account_id AND cm.user_id = auth.uid()
      AND cm.status = 'active' AND cm.role IN ('owner','manager'))))
WITH CHECK (public.is_company_account_writable(company_account_id) AND
  (EXISTS (SELECT 1 FROM public.company_accounts ca
    WHERE ca.id = company_product_overrides.company_account_id AND ca.owner_user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.company_members cm
    WHERE cm.company_account_id = company_product_overrides.company_account_id AND cm.user_id = auth.uid()
      AND cm.status = 'active' AND cm.role IN ('owner','manager'))));
COMMIT;
