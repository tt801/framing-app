import { expect, it, vi } from 'vitest'
import { jobSpecificationFields } from '@/lib/jobSpecification'
import { exportJobCardPDF } from '@/lib/pdf/jobCardPdf'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

const details = {
  dims: { art: { widthCm: 40, heightCm: 30 }, visible: { widthCm: 50, heightCm: 40 }, frameFaceWidthCm: 2 },
  frame: { name: 'UAT-H2 Frame' }, glazing: { name: 'UAT-H2 Glass' },
  mats: { hasMat1: true, hasMat2: false, hasMat3: false, mat1: { name: 'UAT-H2 Matd', borderCm: 5 } },
  printing: { include: false }, backer: { include: false },
  costs: { subtotal: 175.75, taxRate: 0.15, total: 202.11 },
}
async function pdfText(job: Record<string, unknown>) {
  const before = structuredClone(job)
  const save = vi.spyOn(HTMLAnchorElement.prototype, 'click')
  const document = await exportJobCardPDF({ job, settings: { currencyCode: 'GBP' }, download: false })
  expect(save).not.toHaveBeenCalled(); save.mockRestore()
  expect(job).toEqual(before)
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(document.output('arraybuffer')) }).promise
  let text = ''
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent()
    text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + ' '
  }
  await pdf.destroy()
  return text
}

it.each(['details', 'detailsJson'])('exports the frozen workshop information from %s without saving a PDF or altering pricing', async shape => {
  const text = await pdfText({ id: 'local-only', [shape]: shape === 'details' ? structuredClone(details) : JSON.stringify(details) })
  for (const expected of ['40.0 × 30.0 cm', '50.0 × 40.0 cm', 'Frame face width: 2.0 cm', 'UAT-H2 Frame', 'UAT-H2 Glass',
    'Mat 1: UAT-H2 Matd', '5 cm border', 'Additional mats: None', 'Printing: Off', 'Foam/backer: Off', '£175.75', '£26.36', '£202.11'])
    expect(text).toContain(expected)
})

it('exports enabled printing/backer and additional saved mat names and borders', async () => {
  const text = await pdfText({ details: { ...details, printing: { include: true }, backer: { include: true },
    mats: { ...details.mats, hasMat2: true, hasMat3: true, mat2: { name: 'Second saved mat', borderCm: 1 }, mat3: { name: 'Third saved mat', borderCm: 0 } } } })
  for (const expected of ['Second saved mat', '1 cm border', 'Third saved mat', '0 cm border', 'Printing: On', 'Foam/backer: On'])
    expect(text).toContain(expected)
})

it('does not invent missing production options in a legacy PDF', async () => {
  const text = await pdfText({ id: 'legacy' })
  for (const label of ['Mat 1', 'Additional mats', 'Printing', 'Foam/backer']) expect(text).toContain(`${label}: Not recorded`)
})

it('reads top-level saved fields without catalogue lookups', () => {
  const fields = Object.fromEntries(jobSpecificationFields({ artwork: { widthCm: 40, heightCm: 30 },
    dims: details.dims, frame: details.frame, glazing: details.glazing, mats: details.mats,
    printing: details.printing, backer: details.backer }).map(field => [field.label, field.value]))
  expect(fields).toMatchObject({ 'Artwork dimensions': '40 × 30 cm', 'Visible dimensions': '50 × 40 cm',
    Frame: 'UAT-H2 Frame', 'Frame face width': '2 cm', 'Mat 1': 'UAT-H2 Matd — 5 cm border',
    'Additional mats': 'None', Glazing: 'UAT-H2 Glass', Printing: 'Off', 'Foam/backer': 'Off' })
})

it('does not turn partial or nonfinite measurements and unknown options into zero, None or Off', () => {
  const fields = Object.fromEntries(jobSpecificationFields({ details: { dims: { art: { widthCm: 40, heightCm: NaN } },
    mats: { hasMat1: true, mat1: { name: 'Saved mat' }, hasMat2: true, mat2: { name: 'Second mat' } } } }).map(field => [field.label, field.value]))
  expect(fields['Artwork dimensions']).toBe('40 cm × Not recorded')
  expect(fields['Mat 1']).toBe('Saved mat — Not recorded border')
  expect(fields['Additional mats']).toBe('Mat 2: Second mat — Not recorded border; Mat 3: Not recorded')
  expect(fields.Printing).toBe('Not recorded'); expect(fields['Foam/backer']).toBe('Not recorded')
})
