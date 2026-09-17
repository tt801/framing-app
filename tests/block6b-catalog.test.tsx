import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const { pending, supabaseMock, serverCatalog } = vi.hoisted(() => {
  const pending = new Map<string, { resolve: (value:any)=>void }[]>()
  const serverCatalog: { value: any } = { value: null }
  const supabaseMock={from:vi.fn((table:string)=>{let company='';let insertPayload:any;const q:any={select:()=>q,eq:(_k:string,v:string)=>{company=v;return q},maybeSingle:()=>{let r:any;const p=new Promise(x=>{r=x});const key=`${table}:${company}`;const list=pending.get(key)||[];list.push({resolve:r});pending.set(key,list);return p},insert:(payload:any)=>{insertPayload=payload;return q},single:async()=>{if(table==='company_catalog'){if(serverCatalog.value)return {data:null,error:Object.assign(new Error('duplicate key value violates unique constraint company_catalog_pkey'),{code:'23505'})};serverCatalog.value=insertPayload;return {data:{catalog:insertPayload.catalog,revision:1},error:null}}return {data:{settings:{}},error:null}}};return q})}
  return {pending,supabaseMock,serverCatalog}
})
vi.mock('@/lib/supabase',()=>({supabase:supabaseMock}))
import { useCatalog } from '@/lib/store'
let company='company-a';const access=(id:string):BillingAccess=>({readOnly:false,hasFullAccess:true,canUsePremiumFeatures:true,isFounder:false,isPastDue:false,statusMessage:'',companyAccountId:id,companyName:id,userId:'user'})
const Wrapper=({children}:{children:React.ReactNode})=><BillingAccessProvider value={access(company)}>{children}</BillingAccessProvider>
beforeEach(()=>{pending.clear();company='company-a';localStorage.clear()})

describe('Block 6B catalog hook',()=>{
  it('loads company catalog, clears stale state, and ignores late responses',async()=>{const {result,rerender}=renderHook(()=>useCatalog(),{wrapper:Wrapper});await waitFor(()=>expect(pending.get('company_settings:company-a')?.length).toBe(1));pending.get('company_settings:company-a')![0].resolve({data:null,error:null});await waitFor(()=>expect(pending.get('company_catalog:company-a')?.length).toBe(1));company='company-b';rerender();await waitFor(()=>expect(pending.get('company_catalog:company-b')?.length).toBe(1));expect(result.current.catalog.frames).toEqual([]);pending.get('company_catalog:company-b')![0].resolve({data:{catalog:{frames:[{id:'b'}],mats:[],glazing:[],printingMaterials:[],backers:[],stock:{}},revision:1},error:null});await waitFor(()=>expect(result.current.catalog.frames[0].id).toBe('b'));pending.get('company_catalog:company-a')![0].resolve({data:{catalog:{frames:[{id:'a'}],mats:[],glazing:[],printingMaterials:[],backers:[],stock:{}},revision:1},error:null});await new Promise(r=>setTimeout(r,0));expect(result.current.catalog.frames[0].id).toBe('b')})

  it('rejects a stale empty-state import without overwriting a concurrent catalog',async()=>{
    const {result}=renderHook(()=>useCatalog(),{wrapper:Wrapper});
    await waitFor(()=>expect(pending.get('company_settings:company-a')?.length).toBe(1));
    pending.get('company_settings:company-a')![0].resolve({data:null,error:null});
    await waitFor(()=>expect(pending.get('company_catalog:company-a')?.length).toBe(1));
    pending.get('company_catalog:company-a')![0].resolve({data:null,error:null});
    await waitFor(()=>expect(result.current.loading).toBe(false));
    const legacy={frames:[{id:'legacy-b',name:'Legacy B',pricePerMeter:9,faceWidthCm:2}],mats:[],glazing:[],printingMaterials:[],backers:[],stock:{frames:[],sheets:[],rolls:[]}};
    localStorage.setItem('framing_app_catalog_v1',JSON.stringify(legacy));
    const aCatalog={frames:[{id:'a',name:'A',pricePerMeter:42,faceWidthCm:2}],mats:[],glazing:[],printingMaterials:[],backers:[],stock:{frames:[],sheets:[],rolls:[]}};
    serverCatalog.value={company_account_id:'company-a',catalog:aCatalog,revision:1};
    const resultB=await result.current.importLegacyCatalog();
    expect(resultB.ok).toBe(false);
    expect(resultB.error).toContain('Catalog already contains');
    expect(serverCatalog.value.catalog).toEqual(aCatalog);
    expect(result.current.catalog.frames).toEqual([]);
    serverCatalog.value=null;
    const firstImport=await result.current.importLegacyCatalog();
    expect(firstImport.ok).toBe(true);
    expect(serverCatalog.value.catalog.frames[0].id).toBe('legacy-b');
  })
})
