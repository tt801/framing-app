import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupportNotificationRecipients, sendSupportEmail } from '../lib/notifications.js'
import { requireSupportContext, supportDb, SupportHttpError, supportError } from '../../server/supportContext.js'

const ticketFields = 'id,ticket_number,subject,message,category,status,priority,created_at,updated_at'
const categories = new Set(['general', 'billing', 'technical', 'account'])

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new SupportHttpError(400, `${label} must be between 1 and ${max} characters`)
  }
  return value.trim()
}

function makeTicketNumber() {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `SUP-${stamp}-${suffix}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()
  try {
    const { user, accountId } = await requireSupportContext(req)
    if (req.method === 'POST') {
      const subject = requiredText(req.body?.subject, 'Subject', 150)
      const message = requiredText(req.body?.message, 'Description', 5000)
      const category = req.body?.category ?? 'general'
      if (typeof category !== 'string' || !categories.has(category)) {
        throw new SupportHttpError(400, 'Unsupported category')
      }
      const insert = {
        ticket_number: makeTicketNumber(), company_account_id: accountId,
        requester_user_id: user.id, requester_email: user.email || null,
        requester_name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
        subject, message, category, status: 'open', priority: 'normal', source: 'customer_app',
      }
      const { data, error } = await supportDb.from('support_tickets').insert(insert).select(ticketFields).single()
      if (error || !data) throw error || new Error('Could not create ticket')
      // Preserve the existing support-team notification; a notification failure must not undo a saved ticket.
      try {
        await sendSupportEmail({
          to: getSupportNotificationRecipients(),
          subject: `[Support] New ticket ${data.ticket_number}: ${data.subject}`,
          text: [
            'A new support ticket was created.', '',
            `Ticket: ${data.ticket_number}`,
            `Subject: ${data.subject}`,
            `Priority: ${data.priority}`,
            `Category: ${data.category}`,
            `Requester: ${user.email || 'no-email'}`,
            'Source: customer_app', '', data.message,
          ].join('\n'),
        })
      } catch {
        // Ticket creation succeeded; notification delivery is best-effort. Do not log user content.
        console.warn('[support-tickets] Support notification failed')
      }
      return res.status(200).json({ ticket: data })
    }

    const raw = req.query.ticketId
    const ticketId = Array.isArray(raw) ? raw[0] : raw
    if (ticketId) {
      if (typeof ticketId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) {
        throw new SupportHttpError(400, 'Invalid ticket ID')
      }
      const { data, error } = await supportDb.from('support_tickets').select(ticketFields)
        .eq('id', ticketId).eq('company_account_id', accountId).maybeSingle()
      if (error) throw error
      if (!data) throw new SupportHttpError(404, 'Ticket not found')
      return res.status(200).json({ ticket: data })
    }
    const { data, error } = await supportDb.from('support_tickets').select(ticketFields)
      .eq('company_account_id', accountId).order('created_at', { ascending: false }).limit(50)
    if (error) throw error
    return res.status(200).json({ tickets: data || [] })
  } catch (error) {
    const { status, message } = supportError(error)
    return res.status(status).json({ error: message })
  }
}
