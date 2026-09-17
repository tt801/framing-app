import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const { requests, supabaseMock } = vi.hoisted(() => {
  const requests = new Map<string, { resolve: (value: any) => void }[]>()
  const supabaseMock = {
    from: vi.fn((table: string) => {
      if (table !== 'jobs') throw new Error(`Unexpected table: ${table}`)
      let companyId = ''
      const query: any = {
        select: () => query,
        eq: (_column: string, value: string) => { companyId = value; return query },
        order: () => {
          const list = requests.get(companyId) || []
          let resolveRequest: (value: any) => void = () => {}
          const promise = new Promise<any>(resolveValue => { resolveRequest = resolveValue })
          list.push({ resolve: resolveRequest }); requests.set(companyId, list)
          return promise
        },
      }
      return query
    }),
  }
  return { requests, supabaseMock }
})

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))
import { useJobs } from '@/lib/jobs'
import fs from 'node:fs'
import path from 'node:path'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js'
import { exportJobCardPDF } from '@/lib/pdf/jobCardPdf'

const access = (companyAccountId: string): BillingAccess => ({
  readOnly: false, hasFullAccess: true, canUsePremiumFeatures: true, isFounder: false,
  isPastDue: false, statusMessage: '', companyAccountId, companyName: companyAccountId, userId: `${companyAccountId}-user`,
})

function Wrapper({ company, children }: { company: string; children: React.ReactNode }) {
  return <BillingAccessProvider value={access(company)}>{children}</BillingAccessProvider>
}

beforeEach(() => requests.clear())

describe('Block 2D invoice-hook-style job isolation', () => {
  it('clears A while B loads and ignores the late A response', async () => {
    let company = 'job-company-a'
    const { result, rerender } = renderHook(() => useJobs(), { wrapper: ({ children }) => <Wrapper company={company}>{children}</Wrapper> })
    await waitFor(() => expect(requests.get(company)?.length).toBe(1))

    company = 'job-company-b'; rerender()
    await waitFor(() => expect(requests.get(company)?.length).toBe(1))
    expect(result.current.loading).toBe(true)
    expect(result.current.jobs).toEqual([])
    requests.get(company)![0].resolve({ data: [{ id: 'job-b', ref_no: 1001, customer_id: null, quote_id: null, invoice_id: null, updated_at: 'b', payload: { status: 'new', customer: {}, artwork: {}, frame: {}, checklist: [] } }], error: null })
    await waitFor(() => expect(result.current.jobs.map(job => job.id)).toEqual(['job-b']))
    requests.get('job-company-a')![0].resolve({ data: [{ id: 'job-a', ref_no: 1001, customer_id: null, quote_id: null, invoice_id: null, updated_at: 'a', payload: { status: 'new', customer: {}, artwork: {}, frame: {}, checklist: [] } }], error: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(result.current.jobs.map(job => job.id)).toEqual(['job-b'])
  })

  it('generates and inspects a saved job-card PDF', async () => {
    const job = {
      id: 'job-card-db', refNo: 1042, status: 'new', createdAt: new Date().toISOString(),
      customer: { firstName: 'Job', lastName: 'Customer', email: 'job@test.local' },
      description: 'Sunset Artwork', frameName: 'Oak Frame', glazingName: 'Regular Glass',
      artwork: { title: 'Sunset Artwork', artist: 'Artist' },
      frame: { profile: 'Oak Frame', glazing: 'Regular Glass' },
      checklist: [{ key: 'measure', label: 'Measure artwork', done: true }],
      notes: 'Handle with care',
    }
    const document = await exportJobCardPDF({ job, customer: job.customer, settings: { companyName: 'Test Company', currencyCode: 'ZAR', currencySymbol: 'R ' }, download: false })
    const bytes = Buffer.from(document.output('arraybuffer'))
    const artifactPath = path.join('C:/Users/thomp/block1-db-tests', 'block2d-job-card.pdf')
    fs.writeFileSync(artifactPath, bytes)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    const parsed = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true }).promise
    let text = ''
    for (let pageNumber = 1; pageNumber <= parsed.numPages; pageNumber++) {
      const page = await parsed.getPage(pageNumber)
      const content = await page.getTextContent()
      text += content.items.map(item => ('str' in item ? item.str : '')).join(' ')
    }
    expect(text).toContain('1042')
    expect(text).toContain('Sunset Artwork')
    expect(text).toContain('Oak Frame')
    expect(text).toContain('[x]')
  })

})
