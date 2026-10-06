import { createClient } from '@supabase/supabase-js'
import type { VercelRequest } from '@vercel/node'

// Service-role access stays inside serverless functions; the browser only sends a bearer token.
export const supportDb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export class SupportHttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function requireSupportContext(req: VercelRequest) {
  const header = req.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  const token = typeof value === 'string' ? /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() : null
  if (!token) throw new SupportHttpError(401, 'Authentication required')
  const { data, error } = await supportDb.auth.getUser(token)
  if (error || !data.user) throw new SupportHttpError(401, 'Authentication required')
  const user = data.user

  const { data: owned, error: ownerError } = await supportDb.from('company_accounts')
    .select('id').eq('owner_user_id', user.id).maybeSingle()
  if (ownerError) throw ownerError
  if (owned?.id) return { user, accountId: owned.id as string }

  const { data: member, error: memberError } = await supportDb.from('company_members')
    .select('company_account_id').eq('user_id', user.id).eq('status', 'active').maybeSingle()
  if (memberError) throw memberError
  if (!member?.company_account_id) throw new SupportHttpError(403, 'Active company access required')
  return { user, accountId: member.company_account_id as string }
}

export function supportError(error: unknown) {
  return error instanceof SupportHttpError
    ? { status: error.status, message: error.message }
    : { status: 500, message: 'Support request failed' }
}
