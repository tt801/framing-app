import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { PlatformDependencies } from './dependencies.js'
import { validateProduct } from './supplierValidation.js'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
// Explicit private Admin projection, never the customer-facing Block 2C RPC.
const columns = 'id,supplier_id,catalog_scope,source_product_key,supplier_sku,variant_key,category,subcategory,supplier_description,display_description,collection_name,colour,finish,material,purchase_unit,width_mm,depth_mm,rebate_width_mm,rebate_depth_mm,sheet_width_mm,sheet_height_mm,mat_core,mat_thickness_mm,mat_quality,glazing_material,glazing_thickness_mm,glazing_uv_percent,glazing_reflection,availability,lifecycle,replacement_product_id,wholesale_cost,cost_currency,cost_unit,cost_tax_basis,cost_effective_at,source_image_url,source_attribution,image_rights_status,image_permitted_uses,asset_status,cached_asset_key,thumbnail_key,texture_key,created_at,updated_at'
export function createHandler({ getSupabaseAdmin, requirePlatformAdmin, platformAdminError }: PlatformDependencies) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (!['GET', 'POST', 'PATCH'].includes(req.method || '')) return res.status(405).end()
    try {
      const actor = await requirePlatformAdmin(req)
      if (req.method === 'GET') {
        if (!uuid(req.query.supplierId)) return res.status(400).json({ error: 'Invalid supplier ID' })
        const { data, error } = await getSupabaseAdmin().from('supplier_products').select(columns).eq('supplier_id', req.query.supplierId).order('created_at', { ascending: false })
        if (error) throw error
        return res.status(200).json({ products: data ?? [] })
      }
      const body = req.body
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['id', 'supplierId', 'fields', 'expectedUpdatedAt'].includes(key)) || !uuid(body.supplierId) || !body.fields ||
        (req.method === 'POST' && ('id' in body || 'expectedUpdatedAt' in body)) ||
        (req.method === 'PATCH' && (!uuid(body.id) || typeof body.expectedUpdatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(body.expectedUpdatedAt) || !Number.isFinite(Date.parse(body.expectedUpdatedAt))))) return res.status(400).json({ error: 'Invalid product request' })
      let fields: Record<string, unknown>
      try { fields = validateProduct(body.fields, req.method === 'POST') }
      catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid product fields' }) }
      if (req.method === 'POST') {
        const { data, error } = await getSupabaseAdmin().from('supplier_products').insert({ ...fields, supplier_id: body.supplierId }).select(columns).single()
        if (error) throw error
        return res.status(201).json({ product: data })
      }
      // The migration-owned RPC locks/CAS-updates the row and fires its cost-audit trigger
      // in a single database transaction. Never fall back to a direct table UPDATE.
      const { data: updatedId, error: updateError } = await getSupabaseAdmin().rpc('block2d_update_supplier_product', {
        p_supplier_id: body.supplierId, p_product_id: body.id, p_expected_updated_at: body.expectedUpdatedAt,
        p_fields: fields, p_actor_user_id: actor.id,
      })
      if (updateError) throw updateError
      if (updatedId !== body.id) throw new Error('Product update was not confirmed')
      const { data, error } = await getSupabaseAdmin().from('supplier_products').select(columns).eq('supplier_id', body.supplierId).eq('id', body.id).single()
      if (error) throw error
      return res.status(200).json({ product: data })
    } catch (e) {
      // PostgreSQL CAS failure: reload the product before retrying.
      if (e && typeof e === 'object' && 'code' in e && e.code === '40001') return res.status(409).json({ error: 'Product changed; reload before saving again' })
      const { status, message } = platformAdminError(e)
      return res.status(status).json({ error: message })
    }
  }
}
