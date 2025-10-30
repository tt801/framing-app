// src/lib/company.ts
import { useEffect, useState } from 'react'

export type CompanyProfile = {
  companyName: string
  registrationNumber: string
  vatNumber: string
  currencyCode: string
  currencySymbol: string

  email: string
  phone: string
  website: string

  addressLine1: string
  addressLine2: string
  city: string
  region: string
  postalCode: string
  country: string

  quotePrefix: string
  invoicePrefix: string

  bankName: string
  bankAccountNumber: string
  bankBranchCode: string

  notes: string
}

const KEY = 'frameit.company'

const DEFAULTS: CompanyProfile = {
  companyName: '',
  registrationNumber: '',
  vatNumber: '',
  currencyCode: 'ZAR',
  currencySymbol: 'R ',

  email: '',
  phone: '',
  website: '',

  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  postalCode: '',
  country: 'South Africa',

  quotePrefix: 'Q-',
  invoicePrefix: 'INV-',

  bankName: '',
  bankAccountNumber: '',
  bankBranchCode: '',

  notes: '',
}

export function useCompany() {
  const [profile, setProfile] = useState<CompanyProfile>(DEFAULTS)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) setProfile({ ...DEFAULTS, ...JSON.parse(raw) })
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = (next: Partial<CompanyProfile>) => {
    setProfile(prev => {
      const updated = { ...prev, ...next }
      localStorage.setItem(KEY, JSON.stringify(updated))
      return updated
    })
  }

  const reset = () => {
    setProfile(DEFAULTS)
    localStorage.setItem(KEY, JSON.stringify(DEFAULTS))
  }

  return { profile, save, reset }
}
