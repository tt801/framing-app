import React, { useState } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const { requests, supabaseMock } = vi.hoisted(() => {
  const requests = new Map<string, { promise: Promise<any>; resolve: (value: any) => void }[]>()
  const supabaseMock = {
    from: vi.fn((table: string) => {
      if (table === 'company_catalog' || table === 'company_settings') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }
      }
      let companyId = ''
      const query: any = {
        select: () => query,
        eq: (_column: string, value: string) => { companyId = value; return query },
        order: () => {
          const list = requests.get(companyId) || []
          let resolveDeferred: (value: any) => void = () => {}
          const promise = new Promise<any>(resolve => { resolveDeferred = resolve })
          const deferred = { promise, resolve: resolveDeferred }
          list.push(deferred)
          requests.set(companyId, list)
          return promise
        },
      }
      if (table !== 'invoices') throw new Error(`Unexpected table: ${table}`)
      return query
    }),
  }
  return { requests, supabaseMock }
})

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))

import { useInvoices } from '@/lib/invoices'
import { exportInvoicePDF } from '@/lib/pdf/invoicePdf'
import fs from 'node:fs'
import path from 'node:path'
// @ts-expect-error pdfjs-dist 3 exposes the legacy CommonJS build without a matching declaration path.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'

const companyA = 'test-company-a'
const companyB = 'test-company-b'
const access = (companyAccountId: string): BillingAccess => ({
  readOnly: false,
  hasFullAccess: true,
  canUsePremiumFeatures: true,
  isFounder: false,
  isPastDue: false,
  statusMessage: '',
  companyAccountId,
  companyName: companyAccountId,
  userId: `${companyAccountId}-user`,
})

function Wrapper({ children }: { children: React.ReactNode }) {
  const [company, setCompany] = useState(companyA)
  return (
    <BillingAccessProvider value={access(company)}>
      <button type="button" onClick={() => setCompany(companyB)}>switch</button>
      {children}
    </BillingAccessProvider>
  )
}

beforeEach(() => {
  requests.clear()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Block 2C invoice verification', () => {
  it('discards a late company-A response after switching to company B', async () => {
    const { result, rerender } = renderHook(() => useInvoices(), { wrapper: Wrapper })
    await waitFor(() => expect(requests.get(companyA)?.length).toBe(1))

    rerender()
    // Wrapper state is changed through its actual provider identity, not navigation.
    const switchButton = document.querySelector('button') as HTMLButtonElement
    switchButton.click()
    rerender()

    await waitFor(() => expect(requests.get(companyB)?.length).toBe(1))
    expect(result.current.loading).toBe(true)
    expect(result.current.invoices).toEqual([])

    requests.get(companyB)![0].resolve({
      data: [{ id: 'invoice-b', invoice_number: 'INV-B', customer_id: null, quote_id: null, created_at: '2026-09-01', payload: { items: [], subtotal: 20, total: 20 } }],
      error: null,
    })
    await waitFor(() => expect(result.current.invoices.map(invoice => invoice.id)).toEqual(['invoice-b']))

    requests.get(companyA)![0].resolve({
      data: [{ id: 'invoice-a', invoice_number: 'INV-A', customer_id: null, quote_id: null, created_at: '2026-09-01', payload: { items: [], subtotal: 10, total: 10 } }],
      error: null,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(result.current.invoices.map(invoice => invoice.id)).toEqual(['invoice-b'])
  })

  it('generates readable PDFs with stored financial values and explicit blank customer handling', async () => {
    const artifactDir = 'C:/Users/thomp/block1-db-tests'
    fs.mkdirSync(artifactDir, { recursive: true })
    const baseInvoice = {
      id: 'pdf-invoice-1',
      number: 'INV-PDF-1',
      items: [{ id: 'frame', description: 'Frame', qty: 1, unitPrice: 397.5 }],
      subtotal: 397.5,
      taxRate: 0.15,
      tax: 59.63,
      total: 457.13,
      currencyCode: 'ZAR',
      currencySymbol: 'R ',
      payments: [],
    }
    const settings = { companyName: 'Test Company', currencyCode: 'ZAR', currencySymbol: 'R ', taxLabel: 'VAT' }
    const customerPdf = await exportInvoicePDF({
      invoice: baseInvoice,
      customer: { id: 'customer-1', firstName: 'Normal', lastName: 'Customer', email: 'normal@test.local' },
      settings,
      download: false,
    })
    const unresolvedPdf = await exportInvoicePDF({ invoice: baseInvoice, settings, download: false })
    const customerBytes = Buffer.from(customerPdf.output('arraybuffer'))
    const unresolvedBytes = Buffer.from(unresolvedPdf.output('arraybuffer'))
    const customerPath = path.join(artifactDir, 'block2c-invoice-normal.pdf')
    const unresolvedPath = path.join(artifactDir, 'block2c-invoice-unresolved.pdf')
    fs.writeFileSync(customerPath, customerBytes)
    fs.writeFileSync(unresolvedPath, unresolvedBytes)
    expect(customerBytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(unresolvedBytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(customerBytes.length).toBeGreaterThan(500)
    expect(unresolvedBytes.length).toBeGreaterThan(500)
    const extractText = async (bytes: Buffer) => {
      const document = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise
      const pages: string[] = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber)
        const content = await page.getTextContent()
        pages.push(content.items.map(item => ('str' in item ? item.str : '')).join(' '))
      }
      return pages.join('\n')
    }
    const customerText = await extractText(customerBytes)
    const unresolvedText = await extractText(unresolvedBytes)
    expect(customerText).toContain('INV-PDF-1')
    expect(customerText).toContain('Normal Customer')
    expect(customerText).toContain('Frame')
    expect(customerText).toContain('ZAR 397.50')
    expect(customerText).toContain('ZAR 59.63')
    expect(customerText).toContain('ZAR 457.13')
    expect(unresolvedText).toContain('INV-PDF-1')
    expect(unresolvedText).not.toContain('undefined')
  })
})
