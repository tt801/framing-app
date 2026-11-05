type SupportEmail = {
  heading: string
  reference: string
  subject: string
  context?: string[]
  message: string
  ticketUrl?: string
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

/** Links never contain an authentication token. Only trusted server configuration supplies an origin. */
export function customerSupportUrl() {
  const host = (process.env.VERCEL_URL || '').trim()
  return `https://${/^[a-z0-9.-]+(?::\d+)?$/i.test(host) ? host : 'framersapp.com'}/#/support?view=tickets`
}

export function renderSupportEmail(input: SupportEmail) {
  let url = ''
  try {
    const candidate = new URL(input.ticketUrl || '')
    if (candidate.protocol === 'https:' && !candidate.username && !candidate.password) url = candidate.href
  } catch { /* A missing/invalid link leaves the full ticket reference visible. */ }
  const context = (input.context || []).filter(Boolean)
  const footer = 'Sign in to FramersApp to view the ticket and respond. Replies to this email do not update your ticket.'
  const text = [input.heading, `Ticket: ${input.reference}`, `Subject: ${input.subject}`, ...context, '', input.message,
    '', ...(url ? [`View support tickets: ${url}`, ''] : []), footer, '', 'FramersApp Support'].join('\n')
  const paragraph = (value: string) => `<p style="margin:0 0 16px;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(value)}</p>`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.heading)}</title></head><body style="margin:0;background:#f1f5f9;color:#202b36;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0"><tr><td style="padding:28px 24px"><p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#334155">FramersApp <span style="font-size:14px;font-weight:normal">Support</span></p><h1 style="font-size:24px;line-height:1.3;margin:0 0 20px">${escapeHtml(input.heading)}</h1>${paragraph(`Ticket: ${input.reference}`)}${paragraph(`Subject: ${input.subject}`)}${context.map(paragraph).join('')}<hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0">${paragraph(input.message)}${url ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#334155;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px">View support tickets</a></p>` : ''}<p style="font-size:13px;color:#596573;margin:24px 0 0">${escapeHtml(footer)}</p></td></tr></table></td></tr></table></body></html>`
  return { text, html }
}
