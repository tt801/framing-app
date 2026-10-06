import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireSupportContext, supportDb, SupportHttpError, supportError } from '../../server/supportContext.js'

const commentFields = 'id,ticket_id,author_user_id,author_name,author_email,body,visibility,created_at'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()
  try {
    const { user, accountId } = await requireSupportContext(req)
    const raw = req.method === 'GET' ? req.query.ticketId : req.body?.ticketId
    const ticketId = Array.isArray(raw) ? raw[0] : raw
    if (typeof ticketId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) {
      throw new SupportHttpError(400, 'Invalid ticket ID')
    }
    // Scope on the parent ticket; legacy Admin comments need not have company_account_id populated.
    const { data: ticket, error: ticketError } = await supportDb.from('support_tickets')
      .select('id').eq('id', ticketId).eq('company_account_id', accountId).maybeSingle()
    if (ticketError) throw ticketError
    if (!ticket) throw new SupportHttpError(404, 'Ticket not found')

    if (req.method === 'GET') {
      const { data, error } = await supportDb.from('support_ticket_comments').select(commentFields)
        .eq('ticket_id', ticketId).eq('visibility', 'customer').order('created_at', { ascending: true })
      if (error) throw error
      return res.status(200).json({ comments: data || [] })
    }
    const body = req.body?.body
    if (typeof body !== 'string' || !body.trim() || body.trim().length > 5000) {
      throw new SupportHttpError(400, 'Reply must be between 1 and 5000 characters')
    }
    const insert = {
      ticket_id: ticketId, company_account_id: accountId, author_user_id: user.id,
      author_name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
      author_email: user.email || null, body: body.trim(), visibility: 'customer',
    }
    const { data, error } = await supportDb.from('support_ticket_comments').insert(insert).select(commentFields).single()
    if (error || !data) throw error || new Error('Could not save reply')
    return res.status(200).json({ comment: data })
  } catch (error) {
    const { status, message } = supportError(error)
    return res.status(status).json({ error: message })
  }
}
