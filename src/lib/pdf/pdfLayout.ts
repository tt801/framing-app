import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { pdfSettings } from './pdfDocumentData'

type Row = [string, string, boolean?]
const ink = '#202B36'
const muted = '#596573'

/** All coordinates are millimetres. Footer and continuation-header space is reserved everywhere. */
export class PdfLayout {
  readonly doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  readonly margin = 15
  readonly width = 180
  readonly bottom = 270
  readonly brand: ReturnType<typeof pdfSettings>
  readonly top: number
  y = 15
  private referenceLines: string[]
  readonly title: string
  readonly reference: string

  constructor(title: string, reference: string, settings: unknown, meta: string[]) {
    this.title = title
    this.reference = reference
    this.brand = pdfSettings(settings)
    this.font(9)
    this.referenceLines = this.lines(`${title} | ${reference}`, this.width)
    this.top = Math.max(32, 18 + this.referenceLines.length * 4.5)
    this.doc.setProperties({ title: `${title} ${reference}`, author: this.brand.name, creator: 'FramersApp' })
    this.font(22, true)
    this.doc.text(title.toUpperCase(), 195, 22, { align: 'right' })
    let logoHeight = 0
    if (this.brand.logo) {
      try {
        const image = this.doc.getImageProperties(this.brand.logo)
        const scale = Math.min(38 / image.width, 18 / image.height)
        const w = image.width * scale, h = image.height * scale
        this.doc.addImage(this.brand.logo, image.fileType, 15, 15, w, h)
        logoHeight = 18
      } catch { /* Invalid or unsupported logos fall back to the business name. */ }
    }
    const contact = [this.brand.address, [this.brand.email, this.brand.phone].filter(Boolean).join(' | '), this.brand.website,
      [this.brand.registration && `Company No: ${this.brand.registration}`, this.brand.vat && `Tax No: ${this.brand.vat}`].filter(Boolean).join(' | ')].filter(Boolean).join('\n')
    autoTable(this.doc, {
      startY: Math.max(32, 15 + logoHeight + 5), theme: 'plain',
      body: [
        [{ content: this.brand.name, styles: { fontSize: 15, fontStyle: 'bold', textColor: ink } },
          { content: reference, styles: { fontSize: 11, fontStyle: 'bold', halign: 'right' } }],
        [contact, { content: meta.filter(Boolean).join('\n'), styles: { halign: 'right' } }],
      ],
      styles: { font: 'helvetica', fontSize: 9, textColor: muted, cellPadding: { top: 1, right: 0, bottom: 2, left: 0 }, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 70 } },
      margin: this.margins(),
    })
    this.afterTable(7)
    this.doc.setDrawColor(this.accent())
    this.doc.setLineWidth(0.6)
    this.doc.line(15, this.y - 3, 195, this.y - 3)
  }

  private accent() { return /^#[0-9a-f]{6}$/i.test(this.brand.accent) ? this.brand.accent : '#334155' }
  private margins() { return { left: 15, right: 15, top: this.top, bottom: 27 } }
  private font(size = 10, bold = false) {
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal')
    this.doc.setFontSize(size)
    this.doc.setTextColor(ink)
  }
  private lines(value: string, width = this.width): string[] { return this.doc.splitTextToSize(value, width) }
  private afterTable(gap = 5) {
    const table = this.doc as jsPDF & { lastAutoTable?: { finalY: number } }
    this.y = (table.lastAutoTable?.finalY ?? this.y) + gap
  }
  ensure(height: number) {
    if (this.y + height > this.bottom) { this.doc.addPage(); this.y = this.top }
  }
  section(title: string) {
    this.ensure(16)
    this.font(11, true)
    this.doc.text(title, 15, this.y + 4)
    this.y += 10
  }
  paragraph(value: string, options: { bold?: boolean; size?: number } = {}) {
    if (!value) return
    const size = options.size ?? 10
    this.font(size, options.bold)
    const height = size * 0.3528 * 1.35
    for (const line of this.lines(value)) {
      this.ensure(height + 1)
      this.doc.text(line, 15, this.y + size * 0.3528)
      this.y += height
    }
    this.y += 3
  }
  block(title: string, value: string) {
    if (!value) return
    this.section(title)
    this.paragraph(value)
  }
  table(head: string[], body: string[][], financial = false) {
    this.ensure(18)
    autoTable(this.doc, {
      startY: this.y, head: [head], body, theme: 'plain', showHead: 'everyPage',
      // Move ordinary rows intact; AutoTable still splits rows taller than a fresh page.
      rowPageBreak: 'avoid',
      margin: this.margins(),
      styles: { font: 'helvetica', fontSize: 9.5, textColor: ink, cellPadding: 3, overflow: 'linebreak', lineColor: '#E3E7EB', lineWidth: { bottom: 0.15 } },
      headStyles: { fillColor: '#EEF1F4', textColor: ink, fontStyle: 'bold' },
      columnStyles: financial ? { 0: { cellWidth: 96 }, 1: { cellWidth: 16, halign: 'right' }, 2: { cellWidth: 34, halign: 'right' }, 3: { cellWidth: 34, halign: 'right' } }
        : { 0: { cellWidth: 48 }, 1: { cellWidth: 132 } },
    })
    this.afterTable()
  }
  totals(rows: Row[], currency: string) {
    // Measure labels and values separately so unusual currencies/large amounts cannot collide.
    this.font(10)
    const heights = rows.map(([label, value]) => Math.max(this.lines(label, 55).length, this.lines(value, 37).length) * 4.8 + 2)
    this.ensure(heights.reduce((sum, height) => sum + height, 0) + 12)
    this.font(8)
    this.doc.setTextColor(muted)
    this.doc.text(`Currency: ${currency}`, 195, this.y + 3, { align: 'right' })
    this.y += 7
    rows.forEach(([label, value, bold], index) => {
      const height = heights[index]
      this.ensure(height)
      if (bold) { this.doc.setFillColor('#EEF1F4'); this.doc.rect(95, this.y, 100, height, 'F') }
      this.font(10, bold)
      this.lines(label, 55).forEach((line, i) => this.doc.text(line, 98, this.y + 4.5 + i * 4.8))
      this.lines(value, 37).forEach((line, i) => this.doc.text(line, 192, this.y + 4.5 + i * 4.8, { align: 'right' }))
      this.y += height
    })
    this.y += 6
  }
  qc() {
    this.ensure(93)
    this.section('Printable final QC — complete by hand')
    this.paragraph('Blank checks below are not completed application records.', { size: 9 })
    for (const label of ['Specification and dimensions verified', 'Frame finish and joints checked', 'Glazing clean; artwork and mount inspected', 'Backing and hanging hardware secure', 'Packaging and collection identification checked']) {
      this.doc.setDrawColor('#596573'); this.doc.setLineWidth(0.25)
      this.doc.rect(16, this.y + 0.8, 3, 3)
      this.font(10); this.doc.text(label, 22, this.y + 3.5)
      this.y += 6
    }
    this.y += 3
    this.paragraph('Checked by: ____________________    Date: ____________________')
    this.paragraph('Signature: __________________________________________________')
    this.paragraph('Exception notes: ______________________________________________')
    this.doc.setDrawColor('#B8C0C8'); this.doc.line(15, this.y + 3, 195, this.y + 3)
    this.y += 9
  }
  finish() {
    const count = this.doc.getNumberOfPages()
    for (let page = 1; page <= count; page++) {
      this.doc.setPage(page)
      if (page > 1) {
        this.font(9, true)
        this.referenceLines.forEach((line, index) => this.doc.text(line, 15, 17 + index * 4.5))
        this.doc.setDrawColor('#D8DEE5'); this.doc.setLineWidth(0.2)
        this.doc.line(15, this.top - 4, 195, this.top - 4)
      }
      this.doc.setDrawColor('#D8DEE5'); this.doc.setLineWidth(0.2)
      this.doc.line(15, 278, 195, 278)
      this.font(8); this.doc.setTextColor(muted)
      this.doc.text('Created with FramersApp', 15, 284)
      this.doc.text(`Page ${page} of ${count}`, 195, 284, { align: 'right' })
    }
    return this.doc
  }
}
