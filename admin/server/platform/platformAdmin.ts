import { createClient } from '@supabase/supabase-js'
import type { VercelRequest } from '@vercel/node'

let client: ReturnType<typeof createClient> | null = null

export function getSupabaseAdmin() {
  if (!client) {
    const url = (process.env.SUPABASE_URL || '').trim()
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured')
    client = createClient(url, key)
  }
  return client
}

export async function requirePlatformAdmin(req: VercelRequest) {
  const configured = (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
  if (!configured.length) throw new Error('PLATFORM_ADMIN_EMAILS not configured')

  const header = req.headers.authorization || ''
  const value = Array.isArray(header) ? header[0] : header
  const token = value.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new Error('Missing bearer token')

  const { data, error } = await getSupabaseAdmin().auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid or expired token')
  if (!configured.includes((data.user.email || '').toLowerCase())) {
    throw new Error('You do not have platform admin access')
  }
  return data.user
}

export function platformAdminError(err: unknown): { status: number; message: string } {
  const message = err instanceof Error ? err.message : 'Server error'
  const isAuth = message.includes('platform admin') || message.includes('PLATFORM_ADMIN_EMAILS') ||
    message.includes('bearer token') || message.includes('expired token')
  return { status: isAuth ? 403 : 500, message }
}
