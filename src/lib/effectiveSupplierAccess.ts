import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { resolveEffectiveCatalogue } from './effectiveCatalogue'
import type { SafeSupplierRow } from './effectiveCatalogue'
import type { Catalog } from './store'

const safeKeys = [
  'company_account_id','supplier_id','supplier_product_id','supplier_name','supplier_enabled','supplier_status',
  'supplier_sku','category','subcategory','supplier_description','display_description','collection_name',
  'colour','finish','material','purchase_unit','width_mm','depth_mm','rebate_width_mm','rebate_depth_mm',
  'sheet_width_mm','sheet_height_mm','mat_core','mat_thickness_mm','mat_quality','glazing_material',
  'glazing_thickness_mm','availability','lifecycle','replacement_product_id','source_image_url',
  'cached_asset_key','thumbnail_key','texture_key','image_rights_status','asset_status',
  'active_override','excluded_override','description_override',
] as const

type ProjectionRpc = (name: string, args: { p_company_account_id: string }) =>
  Promise<{ data: unknown; error: { message: string } | null }>

/** Defense in depth: retain only the approved projection, never a cost/price field. */
export async function fetchSafeSupplierRows(companyAccountId: string, rpc: ProjectionRpc): Promise<SafeSupplierRow[]> {
  const { data, error } = await rpc('effective_company_supplier_products', { p_company_account_id: companyAccountId })
  if (error) throw new Error(error.message)
  if (!Array.isArray(data)) throw new Error('Invalid supplier projection')
  return data.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid supplier projection')
    const source = value as Record<string, unknown>
    if (source.company_account_id !== companyAccountId ||
      !['supplier_id','supplier_product_id','supplier_name','supplier_description','category','availability','lifecycle']
        .every(key => typeof source[key] === 'string') ||
      source.supplier_enabled !== true || source.supplier_status !== 'active') throw new Error('Invalid supplier projection')
    const entry = Object.fromEntries(safeKeys.filter(key => Object.prototype.hasOwnProperty.call(source, key))
      .map(key => [key, source[key]])) as SafeSupplierRow
    return entry
  })
}

/** Separate from useCatalog persistence: this hook never calls setCatalog. */
export function useEffectiveCompanyCatalogue(companyAccountId: string | null, legacyCompanyCatalog: Catalog) {
  const [scope, setScope] = useState<{ companyId: string | null; rows: SafeSupplierRow[] }>({ companyId: null, rows: [] })
  useEffect(() => {
    let live = true
    if (!companyAccountId || !supabase) return () => { live = false }
    void fetchSafeSupplierRows(companyAccountId, async (name, args) => {
      const { data, error } = await supabase.rpc(name, args)
      return { data, error }
    }).then(rows => {
      if (live) setScope({ companyId: companyAccountId, rows })
    }).catch(() => { if (live) setScope({ companyId: companyAccountId, rows: [] }) })
    return () => { live = false }
  }, [companyAccountId])
  return useMemo(() => resolveEffectiveCatalogue({ companyAccountId: companyAccountId ?? '',
    legacyCompanyCatalog, supplierRows: scope.companyId === companyAccountId ? scope.rows : [] }),
  [companyAccountId, legacyCompanyCatalog, scope])
}
