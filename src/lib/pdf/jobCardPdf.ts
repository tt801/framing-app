import { jobSpecificationFields } from '@/lib/jobSpecification'
import { jobDetailsDraft, savedJobDetails } from '@/lib/jobEditing'
import { PdfLayout } from './pdfLayout'
import { pdfCommercial, pdfCustomer, pdfDate, record, text, type PdfRecord } from './pdfDocumentData'

export async function exportJobCardPDF({ job, customer, settings, download = true }: {
  job: PdfRecord; customer?: PdfRecord | null; settings?: PdfRecord | null; download?: boolean
}) {
  const reference = text(job.refNo ?? job.id) || 'Reference not recorded'
  const created = pdfDate(job.createdAt ?? job.created_at), due = pdfDate(job.dueDate ?? job.dueDateISO), completed = pdfDate(job.completedAt)
  const layout = new PdfLayout('Job card', reference, settings, [
    `Status: ${text(job.status) || 'new'}`, created && `Created: ${created}`, due && `Due: ${due}`,
    job.priority ? `Priority: ${text(job.priority)}` : '', job.assignedTo ? `Assigned: ${text(job.assignedTo)}` : '',
    completed && `Completed: ${completed}`,
  ])
  layout.block('Customer', pdfCustomer(job, customer).join('\n') || (job.jobType === 'internal' ? 'Internal work — no customer' : 'Customer not recorded'))
  layout.section('Job details')
  if (job.jobType) layout.paragraph(`Job type: ${job.jobType === 'internal' ? 'Internal' : text(job.jobType)}`)
  layout.paragraph(`Description: ${text(job.description) || 'Not recorded'}`)
  layout.block('Work instructions', text(job.workInstructions))
  layout.block('Workshop notes', text(job.notes))
  layout.section('Specifications')
  const spec = jobDetailsDraft(job).spec
  const dimensions = (width: string, height: string) => width !== '' && height !== '' && Number.isFinite(Number(width)) && Number.isFinite(Number(height))
    ? `${Number(width).toFixed(1)} × ${Number(height).toFixed(1)} cm` : undefined
  layout.table(['Specification', 'Recorded value'], jobSpecificationFields(job).map(field => {
    const label = field.label === 'Artwork dimensions' ? 'Artwork' : field.label === 'Visible dimensions' ? 'Visible' : field.label
    const value = label === 'Artwork' ? dimensions(spec.artWidth, spec.artHeight) : label === 'Visible' ? dimensions(spec.visibleWidth, spec.visibleHeight)
      : label === 'Frame face width' && spec.faceWidth !== '' && Number.isFinite(Number(spec.faceWidth)) ? `${Number(spec.faceWidth).toFixed(1)} cm` : undefined
    return [`${label}:`, value || field.value]
  }))
  const details = savedJobDetails(job), costs = record(details.costs)
  const snapshot = job.pricingSnapshot ?? costs.pricingSnapshot
  if (snapshot || job.total != null || costs.total != null) {
    const values = pdfCommercial({ ...costs, ...job, pricingSnapshot: snapshot,
      currencyCode: job.currencyCode ?? (typeof job.currency === 'string' ? job.currency : record(job.currency).code) ?? record(details.settings).currencyCode,
      currencySymbol: job.currencySymbol ?? record(job.currency).symbol ?? record(details.settings).currencySymbol }, settings)
    layout.section('Commercial summary — not an invoice')
    layout.totals([['Subtotal', values.money(values.subtotal)], [values.taxTitle, values.money(values.tax)], ['Total', values.money(values.total), true]], values.currency)
  } else layout.paragraph('Commercial value not recorded', { size: 9 })
  layout.section('Saved workshop checklist')
  const checklist = Array.isArray(job.checklist) ? job.checklist : Array.isArray(details.checklist) ? details.checklist : []
  if (!checklist.length) layout.paragraph('No checklist items for this job.', { size: 9 })
  checklist.forEach(value => {
    const item = record(value)
    layout.paragraph(`${item.done ? '[x]' : '[ ]'} ${text(item.text ?? item.label)}`, { size: 10 })
  })
  layout.qc()
  layout.block('Additional information', layout.brand.jobFooter)
  const doc = layout.finish()
  if (download) doc.save(`job-card-${text(job.id) || 'job'}.pdf`)
  return doc
}