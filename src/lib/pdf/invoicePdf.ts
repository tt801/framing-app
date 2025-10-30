// src/lib/pdf/invoicePdf.ts
import jsPDF from 'jspdf'

export type InvoiceItem = { id: string; description: string; qty: number; unitPrice: number }
export type InvoicePayment = { dateISO?: string; amount: number }
export type Invoice = {
  id: string
  number: string
  dateISO?: string
  dueDateISO?: string
  items: InvoiceItem[]
  subtotal: number
  total: number
  notes?: string
  payments?: InvoicePayment[]
}
export type Customer = {
  id?: string
  firstName: string
  lastName: string
  email: string
  company?: string
  phone?: string
  address1?: string
  address2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}
export type InvoicePdfSettings = {
  currencyCode?: string
  currencySymbol?: string
  companyName?: string
  companyAddress1?: string
  companyAddress2?: string
  companyEmail?: string
  companyPhone?: string
  taxDetails?: string
  bankDetails?: string
  invoiceFooter?: string
  logoDataUrl?: string
}

const safe = (v: unknown) => (v == null ? '' : String(v))
const moneyFmt = (n: number, code?: string, sym?: string) => {
  try { if (code) return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n) } catch {}
  return `${safe(sym)}${(n ?? 0).toFixed(2)}`
}
const formatDate = (iso?: string) => !iso ? '' : (() => { try { return new Date(iso).toLocaleDateString() } catch { return iso } })()

async function ensureAutoTable(doc: jsPDF) {
  if (typeof (doc as any).autoTable === 'function') return true
  try {
    const mod = await import('jspdf-autotable')
    const fn = (mod as any).default || (mod as any)
    if (fn) fn(doc)
    return typeof (doc as any).autoTable === 'function'
  } catch { return false }
}

export async function exportInvoicePDF(args: {
  invoice: Invoice
  customer: Customer
  settings: InvoicePdfSettings
  fileName?: string
}) {
  const { invoice, customer, settings, fileName } = args
  const doc = new jsPDF({ unit: 'mm', compress: true })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 14
  let y = margin

  // Logo (optional)
  if (settings?.logoDataUrl) {
    try { doc.addImage(settings.logoDataUrl, 'PNG', pageW - margin - 36, margin - 2, 36, 18) } catch {}
  }

  // Company header
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text(safe(settings?.companyName) || 'Invoice', margin, y); y += 7
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  ;[settings?.companyAddress1, settings?.companyAddress2, settings?.companyEmail, settings?.companyPhone]
    .filter(Boolean).forEach(line => { doc.text(safe(line), margin, y); y += 5 })

  // Invoice meta (right)
  const metaX = pageW - margin - 70
  let metaY = margin + 4
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('INVOICE', metaX, metaY)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); metaY += 7
  doc.text(`Invoice #: ${safe(invoice.number)}`, metaX, metaY);                    metaY += 5
  if (invoice.dateISO)    { doc.text(`Date: ${formatDate(invoice.dateISO)}`, metaX, metaY);   metaY += 5 }
  if (invoice.dueDateISO) { doc.text(`Due: ${formatDate(invoice.dueDateISO)}`, metaX, metaY); metaY += 5 }
  if (settings?.taxDetails) { doc.text(safe(settings.taxDetails), metaX, metaY);               metaY += 5 }

  // Bill To
  y += 2
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Bill To', margin, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  const billTo = [
    `${safe(customer.firstName)} ${safe(customer.lastName)}`.trim(),
    safe(customer.company),
    safe(customer.email),
    [safe(customer.address1), safe(customer.address2)].filter(Boolean).join(', '),
    [safe(customer.city), safe(customer.state), safe(customer.postalCode)].filter(Boolean).join(' '),
    safe(customer.country),
    safe(customer.phone),
  ].filter(Boolean)
  billTo.forEach(line => { doc.text(line, margin, y); y += 5 })

  // Items
  y += 4
  const hasAT = await ensureAutoTable(doc)
  if (hasAT) {
    ;(doc as any).autoTable({
      startY: y,
      head: [[ 'Description', 'Qty', 'Unit Price', 'Amount' ]],
      body: (invoice.items || []).map(it => {
        const amt = Number(it.qty || 0) * Number(it.unitPrice || 0)
        return [
          safe(it.description),
          String(it.qty ?? 0),
          moneyFmt(Number(it.unitPrice || 0), settings.currencyCode, settings.currencySymbol),
          moneyFmt(amt, settings.currencyCode, settings.currencySymbol),
        ]
      }),
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 2 },
      headStyles: { fillColor: [240,240,240], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      theme: 'grid',
      margin: { left: margin, right: margin },
    })
    y = (doc as any).lastAutoTable.finalY + 4
  } else {
    const colX = [margin, pageW * 0.55, pageW * 0.72, pageW - margin]
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.text('Description', colX[0], y)
    doc.text('Qty',         colX[1], y, { align: 'right' })
    doc.text('Unit Price',  colX[2], y, { align: 'right' })
    doc.text('Amount',      colX[3], y, { align: 'right' })
    y += 5; doc.setFont('helvetica', 'normal')
    ;(invoice.items || []).forEach(it => {
      const amt = Number(it.qty || 0) * Number(it.unitPrice || 0)
      doc.text(safe(it.description), colX[0], y)
      doc.text(String(it.qty ?? 0), colX[1], y, { align: 'right' })
      doc.text(moneyFmt(Number(it.unitPrice || 0), settings.currencyCode, settings.currencySymbol), colX[2], y, { align: 'right' })
      doc.text(moneyFmt(amt, settings.currencyCode, settings.currencySymbol), colX[3], y, { align: 'right' })
      y += 6
    })
    doc.setDrawColor(220); doc.line(margin, y, pageW - margin, y); y += 4
  }

  // Payments (optional)
  if (invoice.payments && invoice.payments.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Payments', margin, y); y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    invoice.payments.forEach(p => {
      const line = `${formatDate(p.dateISO)} — ${moneyFmt(p.amount ?? 0, settings.currencyCode, settings.currencySymbol)}`
      doc.text(line, margin, y); y += 5
    })
    y += 2
  }

  // Totals
  const totalsX = pageW - margin - 60
  let tY = Math.max(y, hasAT ? (doc as any).lastAutoTable?.finalY + 4 || y : y)
  doc.setDrawColor(200); doc.setFillColor(250,250,250); doc.roundedRect(totalsX, tY, 60, 18, 2, 2, 'S')
  tY += 6
  ;([
    ['Subtotal', moneyFmt(invoice.subtotal ?? 0, settings.currencyCode, settings.currencySymbol)],
    ['Total',    moneyFmt(invoice.total ?? 0, settings.currencyCode, settings.currencySymbol), true],
  ] as Array<[string,string,boolean?]>).forEach(([label, value, bold]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(label, totalsX + 4, tY)
    doc.text(value, totalsX + 56, tY, { align: 'right' })
    tY += 6
  })
  y = tY + 2

  // Bank/Tax/Notes box
  const boxTop = Math.max(y, pageH - 50)
  const lines: string[] = []
  if (settings?.bankDetails) lines.push(`Bank: ${safe(settings.bankDetails)}`)
  if (settings?.taxDetails)  lines.push(`Tax: ${safe(settings.taxDetails)}`)
  if (invoice.notes)         lines.push(`Notes: ${safe(invoice.notes)}`)
  if (lines.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.setDrawColor(230); doc.roundedRect(margin, boxTop, pageW - margin*2, 16 + lines.length * 5, 2, 2, 'S')
    let ly = boxTop + 7; lines.forEach(l => { doc.text(l, margin + 4, ly); ly += 5 })
  }

  // Footer
  const footer = safe(settings?.invoiceFooter)
  if (footer) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120)
    doc.text(footer, pageW / 2, pageH - 8, { align: 'center' })
    doc.setTextColor(0)
  }

  // Filename
  const defName = `Invoice_${safe(invoice.number)}.pdf`
  doc.save(fileName || defName)
}
