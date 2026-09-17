import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingAccessProvider, type BillingAccess } from '@/lib/billingAccess'

const { pending, rows, supabaseMock } = vi.hoisted(() => {
  const pending = new Map<string, { resolve:(value:any)=>void }[]>()
  const rows = new Map<string, any[]>()
  const supabaseMock:any = {
    from: vi.fn((table:string) => { let company=''; const query:any={
      select:()=>query, eq:(_key:string,value:string)=>{company=value;return query}, order:()=>new Promise(resolve=>{const list=pending.get(company)||[];list.push({resolve});pending.set(company,list)}),
    }; return query }),
    rpc: vi.fn(async (name:string,args:any) => {
      const list=rows.get(args.p_company_account_id)||[]
      if(name==='create_calendar_event'){ if(list.some(row=>row.id===args.p_id)) return {data:null,error:{message:'duplicate'}}; const row={id:args.p_id,event:args.p_event,customer_id:args.p_customer_id,job_id:args.p_job_id,invoice_id:args.p_invoice_id,revision:1}; rows.set(args.p_company_account_id,[...list,row]);return {data:row,error:null} }
      const index=list.findIndex(row=>row.id===args.p_id&&row.revision===args.p_revision)
      if(index<0)return {data:null,error:{message:'Calendar event changed or no longer exists'}}
      if(name==='delete_calendar_event'){ rows.set(args.p_company_account_id,list.filter((_,i)=>i!==index));return {data:null,error:null} }
      const row={...list[index],event:args.p_event,customer_id:args.p_customer_id,job_id:args.p_job_id,invoice_id:args.p_invoice_id,revision:list[index].revision+1}; rows.set(args.p_company_account_id,list.map((value,i)=>i===index?row:value));return {data:row,error:null}
    }),
  }; return {pending,rows,supabaseMock}
})
vi.mock('@/lib/supabase',()=>({supabase:supabaseMock}))
import { useCalendar } from '@/lib/calendar'
let company='calendar-a'
const access=(companyAccountId:string):BillingAccess=>({readOnly:false,hasFullAccess:true,canUsePremiumFeatures:true,isFounder:false,isPastDue:false,statusMessage:'',companyAccountId,companyName:companyAccountId,userId:'user'})
const Wrapper=({children}:{children:React.ReactNode})=><BillingAccessProvider value={access(company)}>{children}</BillingAccessProvider>
beforeEach(()=>{company='calendar-a';pending.clear();rows.clear();localStorage.clear();vi.clearAllMocks()})
const resolveRead=(id:string,data:any[])=>pending.get(id)![0].resolve({data,error:null})

describe('Block 6C calendar hook',()=>{
 it('clears A, accepts B, and ignores a late A response',async()=>{const {result,rerender}=renderHook(()=>useCalendar(),{wrapper:Wrapper});await waitFor(()=>expect(pending.get('calendar-a')).toHaveLength(1));company='calendar-b';rerender();await waitFor(()=>expect(pending.get('calendar-b')).toHaveLength(1));expect(result.current.events).toEqual([]);resolveRead('calendar-b',[{id:'b',event:{id:'b',type:'other',title:'B',start:'2026-09-15T10:00:00.000Z'},customer_id:null,job_id:null,invoice_id:null,revision:1}]);await waitFor(()=>expect(result.current.events[0]?.id).toBe('b'));resolveRead('calendar-a',[{id:'a',event:{id:'a',type:'other',title:'A',start:'2026-09-15T10:00:00.000Z'},customer_id:null,job_id:null,invoice_id:null,revision:1}]);await new Promise(resolve=>setTimeout(resolve,0));expect(result.current.events.map(event=>event.id)).toEqual(['b'])})
 it('awaits CRUD, retains time/all-day values, rejects stale saves, and imports legacy IDs idempotently',async()=>{const {result}=renderHook(()=>useCalendar(),{wrapper:Wrapper});await waitFor(()=>expect(pending.get('calendar-a')).toHaveLength(1));resolveRead('calendar-a',[]);const created=await result.current.addEvent({type:'appointment',title:'Timed',start:'2026-09-15T09:30:00.000Z',end:'2026-09-15T10:15:00.000Z',allDay:false});expect(created.ok).toBe(true);await waitFor(()=>expect(result.current.events[0]?.start).toBe('2026-09-15T09:30:00.000Z'));const edited=await result.current.updateEvent(result.current.events[0].id,{allDay:true,title:'All day'});expect(edited.ok).toBe(true);await waitFor(()=>expect(result.current.events[0]).toMatchObject({title:'All day',allDay:true,start:'2026-09-15T09:30:00.000Z'}));rows.set('calendar-a',[{...rows.get('calendar-a')![0],revision:3}]);const stale=await result.current.updateEvent(result.current.events[0].id,{title:'stale'});expect(stale.ok).toBe(false);expect(result.current.events[0].title).toBe('All day');const deleted=await result.current.deleteEvent(result.current.events[0].id);expect(deleted.ok).toBe(false);localStorage.setItem('frameit_calendar_events_v1',JSON.stringify([{id:'legacy-id',type:'other',title:'Legacy',start:'2026-09-20T12:00:00.000Z',allDay:false}]));const first=await result.current.importLegacy();const second=await result.current.importLegacy();expect(first).toMatchObject({imported:1,skipped:0});expect(second).toMatchObject({imported:0,skipped:1});expect(rows.get('calendar-a')!.find(row=>row.id==='legacy-id')?.id).toBe('legacy-id')})
})
