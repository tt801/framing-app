import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const { reads, state, supabaseMock } = vi.hoisted(() => {
  const reads = new Map<string, { resolve: (value: any) => void }[]>()
  const state={saveFailure:false}; const supabaseMock = { from: vi.fn((table: string) => { if (table !== 'company_settings') throw new Error('unexpected table'); let company=''; const q:any={ select:()=>q, eq:(_k:string,v:string)=>{company=v;return q}, maybeSingle:()=>{let r:any;const p=new Promise(x=>{r=x});const list=reads.get(company)||[];list.push({resolve:r});reads.set(company,list);return p}, upsert:()=>q, single:async()=>state.saveFailure?({data:null,error:new Error('save failed')}):({data:{settings:{companyName:'Saved'}},error:null})}; return q }) }
  return { reads, state, supabaseMock }
})
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))
import { useCompany } from '@/lib/company'
const access=(companyAccountId:string):BillingAccess=>({readOnly:false,hasFullAccess:true,canUsePremiumFeatures:true,isFounder:false,isPastDue:false,statusMessage:'',companyAccountId,companyName:companyAccountId,userId:'user'})
let company='company-a'
const Wrapper=({children}:{children:React.ReactNode})=><BillingAccessProvider value={access(company)}>{children}</BillingAccessProvider>
beforeEach(()=>{reads.clear(); state.saveFailure=false; company='company-a'; localStorage.clear()})

describe('Block 6A company settings',()=>{
 it('loads settings by company, clears old state, and rejects late responses',async()=>{const {result,rerender}=renderHook(()=>useCompany(),{wrapper:Wrapper});await waitFor(()=>expect(reads.get('company-a')?.length).toBe(1));company='company-b';rerender();await waitFor(()=>expect(reads.get('company-b')?.length).toBe(1));expect(result.current.profile.companyName).toBe('');reads.get('company-b')![0].resolve({data:{settings:{companyName:'B'}},error:null});await waitFor(()=>expect(result.current.profile.companyName).toBe('B'));reads.get('company-a')![0].resolve({data:{settings:{companyName:'A'}},error:null});await new Promise(r=>setTimeout(r,0));expect(result.current.profile.companyName).toBe('B')})
 it('reports a failed save without pretending success',async()=>{const {result}=renderHook(()=>useCompany(),{wrapper:Wrapper});await waitFor(()=>expect(reads.get('company-a')?.length).toBe(1));reads.get('company-a')![0].resolve({data:null,error:null});state.saveFailure=true;const saved=await result.current.save({companyName:'New'});expect(saved.ok).toBe(false)})
 it('previews both legacy sources, reports conflicts, and preserves product arrays',async()=>{localStorage.setItem('frameit.company',JSON.stringify({companyName:'Company Profile',currencyCode:'GBP'}));localStorage.setItem('framing_app_catalog_v1',JSON.stringify({frames:[{id:'frame-1'}],settings:{companyName:'Catalog Profile',currencyCode:'ZAR'}}));const {result}=renderHook(()=>useCompany(),{wrapper:Wrapper});await waitFor(()=>expect(reads.get('company-a')?.length).toBe(1));reads.get('company-a')![0].resolve({data:null,error:null});const preview=result.current.getLegacyCompanyPreview();expect(preview.conflicts).toContain('companyName');expect(JSON.parse(localStorage.getItem('framing_app_catalog_v1')!).frames).toHaveLength(1);})
})
