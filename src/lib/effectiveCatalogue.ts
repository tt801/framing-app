import type { Catalog, Frame, Mat, Glazing, PrintingMaterial, Backer } from './store'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const supplierEffectiveId = (productId: string) => `supplier:${productId.toLowerCase()}`
export const isSupplierProductId = (id: string) => /^supplier:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)

/** Only fields permitted by effective_company_supplier_products. Never include cost or selling amounts. */
export type SafeSupplierRow = {
  company_account_id: string; supplier_id: string; supplier_product_id: string
  supplier_name: string; supplier_enabled: boolean; supplier_status: string
  supplier_sku: string | null; category: string; subcategory?: string | null
  display_description: string | null; supplier_description: string
  collection_name?: string | null; colour?: string | null; finish?: string | null; material?: string | null
  width_mm?: number | null; depth_mm?: number | null; rebate_width_mm?: number | null; rebate_depth_mm?: number | null
  sheet_width_mm?: number | null; sheet_height_mm?: number | null; purchase_unit?: string | null
  mat_core?: string | null; mat_thickness_mm?: number | null; mat_quality?: string | null
  glazing_material?: string | null; glazing_thickness_mm?: number | null
  availability: string; lifecycle: string; replacement_product_id: string | null
  source_image_url?: string | null; cached_asset_key?: string | null; thumbnail_key?: string | null
  texture_key?: string | null; image_rights_status?: string | null; asset_status?: string | null
  active_override: boolean | null; excluded_override: boolean | null
  description_override: string | null
}
/**
 * Discovery is not commercial adaptation. Future priced Visualiser adapters must require:
 * frame: positive face/width_mm and an explicit selling amount per metre;
 * mat: explicit selling amount per square metre (mat0 remains a legacy sentinel);
 * glazing: explicit selling amount per square metre;
 * printing: explicit selling amount per square metre;
 * backer: explicit selling amount per square metre, plus a supported backer selection path.
 * Units/currency must be checked against the company settings. Missing dimensions, ambiguous
 * units, packs/sheets and wholesale costs cannot be substituted as customer selling prices.
 * Block 2B's free-text selling_unit does not establish that compatibility, so every
 * supplier category remains discoverable but non-selectable until a reviewed adapter exists.
 */
export type EffectiveCategory = 'frame' | 'mat' | 'glazing' | 'printing' | 'backer' | 'other'
export type EffectiveLegacyProduct = {
  source: 'legacy'; id: string; name: string; category: EffectiveCategory
  commerciallySelectable: true; legacyProduct: Frame | Mat | Glazing | PrintingMaterial | Backer
}
export type EffectiveSupplierProduct = {
  source: 'supplier'; id: string; supplierId: string; supplierProductId: string; supplierName: string
  supplierSku: string | null; category: EffectiveCategory; name: string
  lifecycle: string; availability: string; replacementProductId: string | null
  visibleForNewSelection: boolean; commerciallySelectable: false
  dimensions: { widthMm: number | null; depthMm: number | null; sheetWidthMm: number | null; sheetHeightMm: number | null }
  asset: { sourceUrl: string | null; key: string | null; thumbnailKey: string | null; textureKey: string | null; rights: string | null; status: string | null }
}
export type EffectiveProduct = EffectiveLegacyProduct | EffectiveSupplierProduct

export type EffectiveCatalogue = {
  /** Original company catalogue is never rewritten or passed through migrateCatalog. */
  legacyCatalog: Catalog
  /** Authorized records remain resolvable even if discontinued/excluded; not priced products. */
  supplierProducts: EffectiveSupplierProduct[]
  /** Products available for discovery in new designs; supplier entries are still not priceable. */
  discovery: EffectiveProduct[]
  findProduct: (id: string) => EffectiveProduct | undefined
  /** A saved supplier reference must not fall back to a different priced product. */
  selectionIssue: (selectedIds: readonly string[]) => string | null
}

export function resolveEffectiveCatalogue(input: {
  companyAccountId: string; legacyCompanyCatalog: Catalog; supplierRows: readonly SafeSupplierRow[]
}): EffectiveCatalogue {
  const { companyAccountId, legacyCompanyCatalog, supplierRows } = input
  const legacy: EffectiveLegacyProduct[] = [
    ...legacyCompanyCatalog.frames.map(legacyProduct => ({ source: 'legacy' as const, category: 'frame' as const, id: legacyProduct.id, name: legacyProduct.name, commerciallySelectable: true as const, legacyProduct })),
    ...legacyCompanyCatalog.mats.map(legacyProduct => ({ source: 'legacy' as const, category: 'mat' as const, id: legacyProduct.id, name: legacyProduct.name, commerciallySelectable: true as const, legacyProduct })),
    ...legacyCompanyCatalog.glazing.map(legacyProduct => ({ source: 'legacy' as const, category: 'glazing' as const, id: legacyProduct.id, name: legacyProduct.name, commerciallySelectable: true as const, legacyProduct })),
    ...(legacyCompanyCatalog.printingMaterials ?? []).map(legacyProduct => ({ source: 'legacy' as const, category: 'printing' as const, id: legacyProduct.id, name: legacyProduct.name, commerciallySelectable: true as const, legacyProduct })),
    ...(legacyCompanyCatalog.backers ?? []).map(legacyProduct => ({ source: 'legacy' as const, category: 'backer' as const, id: legacyProduct.id, name: legacyProduct.name, commerciallySelectable: true as const, legacyProduct })),
  ]
  const byId = new Map<string, EffectiveProduct>(legacy.map(product => [product.id, product]))
  const supplierProducts: EffectiveSupplierProduct[] = []
  for (const row of [...supplierRows].sort((a, b) => a.supplier_product_id.localeCompare(b.supplier_product_id))) {
    if (row.company_account_id !== companyAccountId || row.supplier_enabled !== true || row.supplier_status !== 'active' ||
      !uuidPattern.test(row.supplier_id) || !uuidPattern.test(row.supplier_product_id) ||
      !['frame','mat','glazing','printing','backer','other'].includes(row.category)) continue
    const id = supplierEffectiveId(row.supplier_product_id)
    if (byId.has(id)) continue // A legacy/manual ID wins; never replace or re-key it.
    const visibleForNewSelection = row.lifecycle === 'active' && row.availability === 'available' &&
      row.excluded_override !== true && row.active_override !== false
    const product: EffectiveSupplierProduct = {
      source: 'supplier', id, supplierId: row.supplier_id, supplierProductId: row.supplier_product_id,
      supplierName: row.supplier_name, supplierSku: row.supplier_sku, category: row.category as EffectiveCategory,
      name: row.description_override ?? row.display_description ?? row.supplier_description,
      lifecycle: row.lifecycle, availability: row.availability, replacementProductId: row.replacement_product_id,
      visibleForNewSelection, commerciallySelectable: false,
      dimensions: { widthMm: row.width_mm ?? null, depthMm: row.depth_mm ?? null,
        sheetWidthMm: row.sheet_width_mm ?? null, sheetHeightMm: row.sheet_height_mm ?? null },
      // Block 2B defines no affirmative browser/Visualiser permitted-use vocabulary.
      // Do not trust even an injected projection row or an unapproved company override key.
      asset: { sourceUrl: null, key: null, thumbnailKey: null, textureKey: null,
        rights: row.image_rights_status ?? null, status: row.asset_status ?? null },
    }
    byId.set(id, product)
    supplierProducts.push(product)
  }
  return { legacyCatalog: legacyCompanyCatalog, supplierProducts,
    discovery: [...legacy, ...supplierProducts.filter(product => product.visibleForNewSelection)],
    findProduct: (id: string) => byId.get(id),
    selectionIssue: (selectedIds: readonly string[]) => {
      for (const id of selectedIds) {
        const found = byId.get(id)
        if (found?.source === 'supplier') return `Supplier product ${id} is no longer selectable for priced designs.`
        if (!found && id.startsWith('supplier:')) return `Supplier product ${id} is unavailable for this company.`
      }
      return null
    } }
}
