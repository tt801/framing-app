import { savedJobDetails } from './jobEditing'
import { pdfCommercial, pdfSettings, record, text } from './pdf/pdfDocumentData'

export type MessageDraft = { subject: string; body: string }
const presentAmount = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
const hasTotal = (value: unknown) => {
  const d = record(value)
  return presentAmount(d.total) || presentAmount(d.grandTotal) || presentAmount(record(d.pricingSnapshot).total)
}
const reference = (d: Record<string, unknown>) => text(d.number ?? d.refNo ?? d.id) || 'reference not recorded'
const greeting = (name: string) => `Hello ${name.trim() || 'there'},`
const signature = (settings: unknown) => {
  const brand = pdfSettings(settings)
  return ['Kind regards,', brand.name, brand.phone, brand.email].filter(Boolean).join('\n')
}

/** Drafts only. No delivery, status updates, repricing or PDF attachment takes place here. */
export function documentDraft(kind: 'quote' | 'invoice', document: unknown, name: string, settings: unknown): MessageDraft {
  const d = record(document), brand = pdfSettings(settings), ref = reference(d), values = pdfCommercial(d, settings)
  const label = kind === 'quote' ? 'Quote' : 'Invoice'
  const lines = [greeting(name), '', `${label} reference: ${ref}`]
  if (d.status) lines.push(`Recorded status: ${text(d.status)}`)
  if (hasTotal(d)) lines.push(`${label} total: ${values.money(values.total)}`)
  if (kind === 'invoice' && hasTotal(d) && !['draft', 'void'].includes(text(d.status).toLowerCase())) {
    if (text(d.status).toLowerCase() === 'paid' && !values.payments.length) lines.push('Recorded status: Paid. Payment details are not recorded; please contact us if you need confirmation.')
    else if (values.payments.length) lines.push(`Recorded payments: ${values.money(values.paid)}`,
      `${values.balance < 0 ? 'Credit balance' : 'Balance remaining'}: ${values.money(Math.abs(values.balance))}`)
  }
  lines.push('', kind === 'quote' ? 'Please let us know if you have any questions or would like to proceed.' : 'Please contact us with any questions about this invoice.', '', signature(settings))
  return { subject: `${label} ${ref} from ${brand.name}`, body: lines.join('\n') }
}

export function jobReadyDraft(document: unknown, name: string, settings: unknown): MessageDraft {
  const job = record(document), s = record(settings), brand = pdfSettings(s), details = savedJobDetails(job)
  const ref = text(job.refNo ?? job.id) || 'reference not recorded'
  const address = brand.address.split('\n')
  const replacements: Record<string, string> = { customerName: name.trim() || 'there', jobId: ref, companyName: brand.name,
    companyAddressLine1: text(s.companyAddressLine1 ?? s.addressLine1) || address[0] || '',
    companyAddressLine2: text(s.companyAddressLine2 ?? s.addressLine2) || address.slice(1).join(', ') }
  const template = text(s.jobReadyMessageTemplate).trim()
  const body = template ? template.replace(/{{\s*(\w+)\s*}}/g, (match, key: string) => replacements[key] ?? match)
    : [greeting(name), '', `Your framing order ${ref} is ready for collection.`,
      brand.address ? `\nCollection address:\n${brand.address}` : '', '\nPlease contact us to arrange collection or ask any questions.'].filter(Boolean).join('\n')
  const commercial = { ...record(details.costs), ...job,
    currencyCode: job.currencyCode ?? (typeof job.currency === 'string' ? job.currency : record(job.currency).code) ?? record(details.settings).currencyCode }
  const values = pdfCommercial(commercial, settings)
  return { subject: `Ready for collection — ${ref} — ${brand.name}`,
    body: [body, hasTotal(commercial) ? `Job value: ${values.money(values.total)}\nThis is the job value, not a confirmation of the outstanding balance.` : '',
      signature(settings)].filter(Boolean).join('\n\n') }
}

export function accountUpdateDraft(name: string, invoices: unknown[], settings: unknown): MessageDraft {
  const balances = new Map<string, { amount: number; money: (value: number) => string }>()
  let uncertain = false
  for (const invoice of invoices) {
    const d = record(invoice), status = text(d.status).toLowerCase()
    if (['draft', 'void'].includes(status)) continue
    const values = pdfCommercial(d, settings)
    if (!hasTotal(d) || (status === 'paid' && !values.payments.length)) { uncertain = true; continue }
    const entry = balances.get(values.currency) || { amount: 0, money: values.money }
    // Do not offset an invoice credit against another invoice without an allocation record.
    entry.amount += Math.max(0, values.balance)
    balances.set(values.currency, entry)
  }
  const lines = [greeting(name), '', `An account update from ${pdfSettings(settings).name}.`]
  if ([...balances.values()].some(value => value.amount > 0)) {
    lines.push('Balances remaining on issued invoices, based on recorded payments:')
    for (const [currency, value] of balances) if (value.amount > 0) lines.push(`${currency}: ${value.money(value.amount)}`)
  } else lines.push('Thank you for your business. Please contact us if you would like an account statement.')
  if (uncertain) lines.push('Some invoice payment details need confirmation; please contact us for a reconciled statement.')
  lines.push('', 'If you have made a recent payment, please let us know so we can check our records.', '', signature(settings))
  return { subject: `Account update from ${pdfSettings(settings).name}`, body: lines.join('\n') }
}

export const mailtoDraft = (email: string, draft: MessageDraft) =>
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`
export const whatsAppDraft = (phone: string, body: string) =>
  `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(body)}`
