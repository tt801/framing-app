import { useCompany } from '@/lib/company'
import type { QuotePdfSettings } from './quotePdf'
import { record, type PdfRecord } from './pdfDocumentData'

/** Add company-profile fields that useCatalog intentionally does not project. No writes. */
export function usePdfCompanySettings(catalogSettings: unknown): QuotePdfSettings & PdfRecord {
  const { profile } = useCompany()
  const catalog = record(catalogSettings)
  const result: PdfRecord = { ...catalog }
  for (const key of ['registrationNumber', 'website', 'bankName', 'bankAccountNumber', 'bankBranchCode',
    'companyLogoDataUrl', 'quoteFooterNote', 'invoiceFooterNote', 'jobCardFooterNote']) {
    // An explicitly empty profile value must not resurrect an old catalogue logo/footer.
    if (profile[key] !== undefined) result[key] = profile[key]
  }
  return result
}
