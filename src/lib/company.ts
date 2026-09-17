import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useBillingAccess, useBillingWriteGuard } from '@/lib/billingAccess'

export type CompanyProfile = {
  companyName: string; registrationNumber: string; vatNumber: string; currencyCode: string; currencySymbol: string
  email: string; phone: string; website: string; addressLine1: string; addressLine2: string; city: string; region: string; postalCode: string; country: string
  quotePrefix: string; quoteNumberDigits?: number; invoicePrefix: string; invoiceStartNumber?: number; paymentTermsDays?: number; taxRatePct?: number; taxLabel?: string
  bankName: string; bankAccountNumber: string; bankBranchCode: string; bankDetails?: string; notes: string; companyAddress?: string; companyEmail?: string; companyPhone?: string
  [key: string]: any
}

export const DEFAULT_COMPANY_SETTINGS: CompanyProfile = {
  companyName:'', registrationNumber:'', vatNumber:'', currencyCode:'ZAR', currencySymbol:'R ', email:'', phone:'', website:'', addressLine1:'', addressLine2:'', city:'', region:'', postalCode:'', country:'South Africa', quotePrefix:'Q-', quoteNumberDigits:4, invoicePrefix:'INV-', invoiceStartNumber:1000, paymentTermsDays:14, taxRatePct:0, taxLabel:'VAT', bankName:'', bankAccountNumber:'', bankBranchCode:'', bankDetails:'', notes:'', companyAddress:'', companyEmail:'', companyPhone:''
}
const LEGACY_COMPANY_KEY='frameit.company'; const LEGACY_CATALOG_KEY='framing_app_catalog_v1'
function readLegacy() { let company:any={}; let catalog:any={}; try { company=JSON.parse(localStorage.getItem(LEGACY_COMPANY_KEY)||'{}') } catch {} try { catalog=JSON.parse(localStorage.getItem(LEGACY_CATALOG_KEY)||'{}') } catch {} return { company, catalog } }
function normalizeSettings(value: Record<string, any>): CompanyProfile { const merged:any={...DEFAULT_COMPANY_SETTINGS,...value}; merged.companyEmail=merged.companyEmail||merged.email; merged.companyPhone=merged.companyPhone||merged.phone; merged.companyAddress=merged.companyAddress||[merged.addressLine1,merged.addressLine2,merged.city,merged.region,merged.postalCode,merged.country].filter(Boolean).join(', '); merged.vatNumber=merged.vatNumber||merged.taxNumber||''; merged.taxRatePct=typeof merged.taxRatePct==='number'?merged.taxRatePct:(Number(merged.taxRate)||0); merged.paymentTermsDays=typeof merged.paymentTermsDays==='number'?merged.paymentTermsDays:(Number(merged.defaultPaymentTerms)||14); merged.invoiceStartNumber=typeof merged.invoiceStartNumber==='number'?merged.invoiceStartNumber:(Number(merged.nextInvoiceNumber)||1000); return merged }
export function getLegacyCompanyPreview() { const {company,catalog}=readLegacy(); return { company, catalogSettings: catalog.settings || {}, conflicts: Object.keys({...company,...(catalog.settings||{})}).filter(key => company[key] !== undefined && catalog.settings?.[key] !== undefined && String(company[key]) !== String(catalog.settings[key])) } }

export function useCompany() {
  const billing=useBillingAccess(); const allowWrite=useBillingWriteGuard(); const companyAccountId=billing.companyAccountId
  const [profile,setProfile]=useState<CompanyProfile>(DEFAULT_COMPANY_SETTINGS); const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null); const requestRef=useRef(0)
  const refresh=useCallback(async()=>{ const request=++requestRef.current; if(!supabase||!companyAccountId){setProfile(DEFAULT_COMPANY_SETTINGS);setLoading(false);return} setLoading(true); const {data,error:readError}=await supabase.from('company_settings').select('settings').eq('company_account_id',companyAccountId).maybeSingle(); if(requestRef.current!==request)return; if(readError){setError(readError.message);setLoading(false);return} setProfile(normalizeSettings(data?.settings||{}));setError(null);setLoading(false)},[companyAccountId])
  useEffect(()=>{void refresh()},[refresh])
  const save=useCallback(async(next:Partial<CompanyProfile>)=>{if(!allowWrite('update company settings'))return {ok:false,error:'Read-only account'} as const;if(!supabase||!companyAccountId)return {ok:false,error:'No active company account'} as const;const updated=normalizeSettings({...profile,...next});const {data,error:saveError}=await supabase.from('company_settings').upsert({company_account_id:companyAccountId,settings:updated},{onConflict:'company_account_id'}).select('settings').single();if(saveError||!data)return {ok:false,error:saveError?.message||'Could not save company settings'} as const;setProfile(normalizeSettings(data.settings));return {ok:true,profile:normalizeSettings(data.settings)} as const},[allowWrite,companyAccountId,profile])
  const importLegacy=useCallback(async()=>{const preview=getLegacyCompanyPreview();if(!allowWrite('import company settings'))return {ok:false,error:'Read-only account'} as const;const merged={...preview.catalogSettings,...preview.company};const result=await save(merged);return result.ok?{...result,conflicts:preview.conflicts,preview} as const:result},[allowWrite,save])
  return {companyAccountId,profile,loading,error,refresh,save,reset:()=>save(DEFAULT_COMPANY_SETTINGS),importLegacy,getLegacyCompanyPreview}
}
