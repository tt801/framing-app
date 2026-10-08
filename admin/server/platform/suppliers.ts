import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { PlatformDependencies } from './dependencies.js'
import { validateSupplier } from './supplierValidation.js'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const columns = 'id,name,slug,status,countries,asset_rights_status,created_at,updated_at'
export function createHandler({ getSupabaseAdmin, requirePlatformAdmin, platformAdminError }: PlatformDependencies) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (!['GET', 'POST', 'PATCH'].includes(req.method || '')) return res.status(405).end()
    try {
      await requirePlatformAdmin(req)
      if (req.method === 'GET') {
        const { data, error } = await getSupabaseAdmin().from('suppliers').select(columns).order('name')
        if (error) throw error
        return res.status(200).json({ suppliers: data ?? [] })
      }
      const body = req.body
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['id', 'fields'].includes(key)) || !body.fields ||
        (req.method === 'POST' && 'id' in body) || (req.method === 'PATCH' && !uuid(body.id))) return res.status(400).json({ error: 'Invalid supplier request' })
      let fields: Record<string, unknown>
      try { fields = validateSupplier(body.fields, req.method === 'POST') }
      catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid supplier fields' }) }
      const table = getSupabaseAdmin().from('suppliers')
      const query = req.method === 'POST' ? table.insert(fields) : table.update(fields).eq('id', body.id)
      const { data, error } = await query.select(columns).single()
      if (error) throw error
      return res.status(req.method === 'POST' ? 201 : 200).json({ supplier: data })
    } catch (e) {
      const { status, message } = platformAdminError(e)
      return res.status(status).json({ error: message })
    }
  }
}
