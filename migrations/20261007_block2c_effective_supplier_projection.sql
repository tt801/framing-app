-- Block 2C: narrow, read-only, tenant-authorized supplier discovery projection.
-- No wholesale costs, trade terms, selling-price overrides, feed data or credentials.
-- Local migration only; do not run on Sandbox or Production without approval.
BEGIN;
-- An unexpected same-name overload may retain default PUBLIC EXECUTE. Do not alter it:
-- abort atomically so an operator can inspect it before installing this browser RPC.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'effective_company_supplier_products'
      AND p.oid IS DISTINCT FROM pg_catalog.to_regprocedure('public.effective_company_supplier_products(uuid)')
  ) THEN
    RAISE EXCEPTION 'Unexpected public.effective_company_supplier_products overload; inspect before installing Block 2C';
  END IF;
END $$;
CREATE FUNCTION public.effective_company_supplier_products(p_company_account_id uuid)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object(
    'company_account_id', cs.company_account_id,
    'supplier_enabled', cs.enabled,
    'supplier_status', s.status,
    'supplier_id', s.id,
    'supplier_name', s.name,
    'supplier_product_id', p.id,
    'supplier_sku', p.supplier_sku,
    'category', p.category,
    'subcategory', p.subcategory,
    'supplier_description', p.supplier_description,
    'display_description', p.display_description,
    'collection_name', p.collection_name,
    'colour', p.colour,
    'finish', p.finish,
    'material', p.material,
    'purchase_unit', p.purchase_unit,
    'width_mm', p.width_mm,
    'depth_mm', p.depth_mm,
    'rebate_width_mm', p.rebate_width_mm,
    'rebate_depth_mm', p.rebate_depth_mm,
    'sheet_width_mm', p.sheet_width_mm,
    'sheet_height_mm', p.sheet_height_mm,
    'mat_core', p.mat_core,
    'mat_thickness_mm', p.mat_thickness_mm,
    'mat_quality', p.mat_quality,
    'glazing_material', p.glazing_material,
    'glazing_thickness_mm', p.glazing_thickness_mm,
    'availability', p.availability,
    'lifecycle', p.lifecycle,
    'replacement_product_id', p.replacement_product_id,
    -- Block 2B has supplier/product rights statuses but no defined permitted-use
    -- vocabulary proving browser/Visualiser display rights. Fail closed for now.
    'source_image_url', NULL::text,
    'cached_asset_key', NULL::text,
    'thumbnail_key', NULL::text,
    'texture_key', NULL::text,
    'image_rights_status', p.image_rights_status,
    'asset_status', p.asset_status,
    'active_override', o.active_override,
    'excluded_override', o.excluded_override,
    'description_override', o.description_override
  )
  FROM public.company_suppliers cs
  JOIN public.suppliers s ON s.id = cs.supplier_id AND s.status = 'active'
  JOIN public.supplier_products p ON p.supplier_id = s.id
  LEFT JOIN public.company_product_overrides o
    ON o.company_account_id = cs.company_account_id AND o.supplier_id = s.id AND o.supplier_product_id = p.id
  WHERE cs.company_account_id = p_company_account_id AND cs.enabled = true
    AND auth.uid() IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.company_accounts ca
      WHERE ca.id = p_company_account_id AND ca.owner_user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.company_members cm
      WHERE cm.company_account_id = p_company_account_id AND cm.user_id = auth.uid() AND cm.status = 'active'))
  ORDER BY p.id;
$$;
REVOKE ALL ON FUNCTION public.effective_company_supplier_products(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.effective_company_supplier_products(uuid) TO authenticated;
COMMIT;
