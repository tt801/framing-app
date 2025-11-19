// src/lib/pdf/invoicePdf.ts
import jsPDF from 'jspdf'
import { computeInvoiceTotals } from '../tax' // <-- uses taxRatePct, taxLabel, vatNumber from settings

export type InvoiceItem = { id: string; description: string; qty: number; unitPrice: number }
export type InvoicePayment = { dateISO?: string; amount: number }
export type Invoice = {
  id: string
  number: string
  dateISO?: string
  dueDateISO?: string
  items: InvoiceItem[]
  subtotal?: number     // optional incoming; we’ll recompute for safety
  total?: number        // optional incoming; we’ll recompute for safety
  notes?: string
  payments?: InvoicePayment[]
  taxExempt?: boolean
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
  // Currency
  currencyCode?: string
  currencySymbol?: string

  // Seller details
  companyName?: string
  companyNumber?: string        // optional company registration #
  companyAddress?: string       // single block (fallback if address1/2 not used)
  companyAddress1?: string
  companyAddress2?: string
  companyEmail?: string
  companyPhone?: string
  logoDataUrl?: string

  // Tax
  taxLabel?: string             // e.g. "VAT" / "GST"
  taxRatePct?: number           // e.g. 15
  vatNumber?: string            // e.g. ZA123...

  // Banking / terms / footer
  bankDetails?: string          // free text bank details
  paymentTermsDays?: number     // e.g. 14 / 30
  invoiceFooter?: string        // note printed at bottom

  // Back-compat (if you previously stored one string)
  taxDetails?: string
}

const safe = (v: unknown) => (v == null ? '' : String(v))
const moneyFmt = (n: number, code?: string, sym?: string) => {
  try { if (code) return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(Number(n) || 0) } catch {}
  return `${safe(sym)}${(Number(n) || 0).toFixed(2)}`
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

  // ---------- totals (recompute for correctness) ----------
  const totals = computeInvoiceTotals(
    { items: (invoice.items || []).map(it => ({ qty: Number(it.qty) || 0, unitPrice: Number(it.unitPrice) || 0 })), taxExempt: !!invoice.taxExempt },
    {
      taxRatePct: settings?.taxRatePct,
      taxLabel: settings?.taxLabel,
      currency: settings?.currencyCode,
      vatNumber: settings?.vatNumber,
    }
  )

  const doc = new jsPDF({ unit: 'mm', compress: true })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 14
  let y = margin

  // Logo (optional)
  if (settings?.logoDataUrl) {
    try { doc.addImage(settings.logoDataUrl, 'PNG', pageW - margin - 36, margin - 2, 36, 18) } catch {}
  }

  // ---------- Seller header (legal: seller identification) ----------
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text(safe(settings?.companyName) || 'Invoice', margin, y); y += 7
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)

  const sellerLines: string[] = []
  // Address (prefer single block if provided)
  if (settings?.companyAddress) {
    sellerLines.push(safe(settings.companyAddress))
  } else {
    ;[settings?.companyAddress1, settings?.companyAddress2].filter(Boolean).forEach(l => sellerLines.push(safe(l)))
  }
  if (settings?.companyNumber) sellerLines.push(`Company No: ${safe(settings.companyNumber)}`)
  if (settings?.vatNumber)     sellerLines.push(`${(settings?.taxLabel || 'VAT').toUpperCase()} No: ${safe(settings.vatNumber)}`)
  if (settings?.companyEmail)  sellerLines.push(`Email: ${safe(settings.companyEmail)}`)
  if (settings?.companyPhone)  sellerLines.push(`Phone: ${safe(settings.companyPhone)}`)

  sellerLines.forEach(line => { doc.text(line, margin, y); y += 5 })

  // ---------- Invoice meta (legal: unique number, date, due) ----------
  const metaX = pageW - margin - 74
  let metaY = margin + 4
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('INVOICE', metaX, metaY)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); metaY += 7
  doc.text(`Invoice #: ${safe(invoice.number)}`, metaX, metaY);                    metaY += 5
  if (invoice.dateISO)    { doc.text(`Date: ${formatDate(invoice.dateISO)}`, metaX, metaY);   metaY += 5 }
  if (invoice.dueDateISO) { doc.text(`Due: ${formatDate(invoice.dueDateISO)}`, metaX, metaY); metaY += 5 }
  if (typeof settings?.paymentTermsDays === 'number') { doc.text(`Terms: ${settings.paymentTermsDays} days`, metaX, metaY); metaY += 5 }

  // Old one-string tax details (back-compat)
  if (settings?.taxDetails) { doc.text(safe(settings.taxDetails), metaX, metaY); metaY += 5 }

  // ---------- Bill To (legal: customer identification) ----------
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

  // ---------- Items (legal: description, qty, unit price, amount) ----------
  y += 4
  const hasAT = await ensureAutoTable(doc)
  if (hasAT) {
    ;(doc as any).autoTable({
      startY: y,
      head: [[ 'Description', 'Qty', 'Unit Price', 'Amount' ]],
      body: (invoice.items || []).map(it => {
        const amt = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)
        return [
          safe(it.description),
          String(Number(isFinite(Number(it.qty)) ? it.qty : 0)),
          moneyFmt(Number(it.unitPrice || 0), settings?.currencyCode, settings?.currencySymbol),
          moneyFmt(amt, settings?.currencyCode, settings?.currencySymbol),
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
      const amt = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)
      doc.text(safe(it.description), colX[0], y)
      doc.text(String(Number(it.qty) || 0), colX[1], y, { align: 'right' })
      doc.text(moneyFmt(Number(it.unitPrice || 0), settings?.currencyCode, settings?.currencySymbol), colX[2], y, { align: 'right' })
      doc.text(moneyFmt(amt, settings?.currencyCode, settings?.currencySymbol), colX[3], y, { align: 'right' })
      y += 6
    })
    doc.setDrawColor(220); doc.line(margin, y, pageW - margin, y); y += 4
  }

  // ---------- Totals (legal: show tax rate & amount) ----------
  const totalsX = pageW - margin - 70
  let tY = Math.max(y, hasAT ? (doc as any).lastAutoTable?.finalY + 4 || y : y)
  doc.setDrawColor(200); doc.setFillColor(250,250,250); doc.roundedRect(totalsX, tY, 70, 26, 2, 2, 'S')
  tY += 7

  const taxLabel = (settings?.taxLabel || 'VAT').toUpperCase()
  const currencyCode = settings?.currencyCode
  const currencySym  = settings?.currencySymbol

  const totalsRows: Array<[string, string, boolean?]> = [
    ['Subtotal', moneyFmt(totals.subTotal, currencyCode, currencySym)],
    [`${taxLabel} (${(totals.taxRatePct || 0).toFixed(2)}%)`, moneyFmt(totals.taxAmount, currencyCode, currencySym)],
    ['Total',    moneyFmt(totals.grandTotal, currencyCode, currencySym), true],
  ]

  totalsRows.forEach(([label, value, bold]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(label, totalsX + 4, tY)
    doc.text(value, totalsX + 66, tY, { align: 'right' })
    tY += 7
  })
  y = tY + 2

  // ---------- Payments (optional) ----------
  if (invoice.payments && invoice.payments.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Payments', margin, y); y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    invoice.payments.forEach(p => {
      const line = `${formatDate(p.dateISO)} — ${moneyFmt(p.amount ?? 0, currencyCode, currencySym)}`
      doc.text(line, margin, y); y += 5
    })
    y += 2
  }

  // ---------- Bank / Tax / Notes (legal: seller VAT, payment terms, bank details) ----------
  const blockTop = Math.max(y, pageH - 60)
  const blockLines: string[] = []

  if (settings?.bankDetails)            blockLines.push(`Bank: ${safe(settings.bankDetails)}`)
  if (settings?.vatNumber)              blockLines.push(`${taxLabel} No: ${safe(settings.vatNumber)}`)
  if (typeof settings?.paymentTermsDays === 'number')
                                        blockLines.push(`Payment Terms: ${settings.paymentTermsDays} days`)
  if (invoice.dueDateISO)               blockLines.push(`Due Date: ${formatDate(invoice.dueDateISO)}`)
  if (invoice.notes)                    blockLines.push(`Notes: ${safe(invoice.notes)}`)
  if (settings?.taxDetails && !settings?.vatNumber) // back-compat: show legacy “Tax:” line only if VAT not already shown
                                        blockLines.push(`Tax: ${safe(settings.taxDetails)}`)

  if (blockLines.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    const h = Math.max(18, 10 + blockLines.length * 5)
    doc.setDrawColor(230); doc.roundedRect(margin, blockTop, pageW - margin*2, h, 2, 2, 'S')
    let ly = blockTop + 7; blockLines.forEach(l => { doc.text(l, margin + 4, ly); ly += 5 })
  }

  // ---------- Footer ----------
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
