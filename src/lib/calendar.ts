// src/lib/calendar.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useBillingAccess, useBillingWriteGuard } from '@/lib/billingAccess'

export type CalendarEventType = "appointment" | "job" | "stock" | "other";

export type CalendarEventStatus =
  | "tentative"
  | "confirmed"
  | "completed"
  | "cancelled";

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  customerId?: string;
  jobId?: string;
  location?: string;
  notes?: string;
  status?: "tentative" | "confirmed" | "completed" | "cancelled";
  assignedTo?: string; // NEW
  invoiceId?: string;
  revision?: number;
  derived?: boolean;
}
type EventRow={id:string;event:CalendarEvent;customer_id:string|null;job_id:string|null;invoice_id:string|null;revision:number}
type Result<T=undefined>={ok:boolean;event?:T;error?:string}
const LS_KEY='frameit_calendar_events_v1'
const rid=()=>Math.random().toString(36).slice(2,10)
const parse=()=>{try{const value=JSON.parse(localStorage.getItem(LS_KEY)||'[]');return Array.isArray(value)?value as CalendarEvent[]:[]}catch{return []}}
export const getLegacyCalendarEventCount=()=>typeof window==='undefined'?0:parse().length
const rowToEvent=(row:EventRow):CalendarEvent=>({...row.event,id:row.id,customerId:row.customer_id||undefined,jobId:row.job_id||undefined,invoiceId:row.invoice_id||undefined,revision:row.revision})
const errorMessage=(error:any,fallback:string)=>error?.message||fallback

export function useCalendar(){
  const billing=useBillingAccess(); const allowWrite=useBillingWriteGuard(); const companyAccountId=billing.companyAccountId
  const [events,setEvents]=useState<CalendarEvent[]>([]); const eventsRef=useRef<CalendarEvent[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null); const requestRef=useRef(0)
  useEffect(()=>{eventsRef.current=events},[events])
  const refresh=useCallback(async()=>{const request=++requestRef.current;if(!supabase||!companyAccountId){setEvents([]);setError(null);setLoading(false);return}setEvents([]);setLoading(true);const {data,error:readError}=await supabase.from('calendar_events').select('id,event,customer_id,job_id,invoice_id,revision').eq('company_account_id',companyAccountId).order('created_at');if(requestRef.current!==request)return;if(readError){setEvents([]);setError(readError.message);setLoading(false);return}setEvents((data||[]).map(rowToEvent));setError(null);setLoading(false)},[companyAccountId])
  useEffect(()=>{void refresh()},[refresh])
  const addEvent=useCallback(async(partial:Omit<CalendarEvent,'id'|'revision'|'derived'> & {id?:string}):Promise<Result<CalendarEvent>>=>{if(!allowWrite('create calendar events'))return {ok:false,error:'Read-only account'};if(!supabase||!companyAccountId)return {ok:false,error:'No active company account'};const event={...partial,id:partial.id||rid(),status:partial.status||'confirmed'};const {data,error:createError}=await supabase.rpc('create_calendar_event',{p_id:event.id,p_company_account_id:companyAccountId,p_event:event,p_customer_id:event.customerId||null,p_job_id:event.jobId||null,p_invoice_id:event.invoiceId||null});if(createError||!data)return {ok:false,error:errorMessage(createError,'Could not create calendar event')};const saved=rowToEvent(data as EventRow);eventsRef.current=[...eventsRef.current,saved];setEvents(previous=>[...previous,saved]);return {ok:true,event:saved}},[allowWrite,companyAccountId])
  const updateEvent=useCallback(async(id:string,patch:Partial<CalendarEvent>):Promise<Result<CalendarEvent>>=>{if(!allowWrite('edit calendar events'))return {ok:false,error:'Read-only account'};if(!supabase||!companyAccountId)return {ok:false,error:'No active company account'};const current=eventsRef.current.find(event=>event.id===id);if(!current)return {ok:false,error:'Calendar event not found'};const event={...current,...patch,id:current.id,revision:undefined,derived:undefined};const {data,error:updateError}=await supabase.rpc('update_calendar_event',{p_id:id,p_company_account_id:companyAccountId,p_event:event,p_customer_id:event.customerId||null,p_job_id:event.jobId||null,p_invoice_id:event.invoiceId||null,p_revision:current.revision});if(updateError||!data)return {ok:false,error:errorMessage(updateError,'Calendar event changed or no longer exists')};const saved=rowToEvent(data as EventRow);setEvents(previous=>previous.map(row=>row.id===id?saved:row));return {ok:true,event:saved}},[allowWrite,companyAccountId])
  const deleteEvent=useCallback(async(id:string):Promise<Result>=>{if(!allowWrite('delete calendar events'))return {ok:false,error:'Read-only account'};if(!supabase||!companyAccountId)return {ok:false,error:'No active company account'};const current=eventsRef.current.find(event=>event.id===id);if(!current)return {ok:false,error:'Calendar event not found'};const {error:deleteError}=await supabase.rpc('delete_calendar_event',{p_id:id,p_company_account_id:companyAccountId,p_revision:current.revision});if(deleteError)return {ok:false,error:errorMessage(deleteError,'Calendar event changed or no longer exists')};setEvents(previous=>previous.filter(row=>row.id!==id));return {ok:true}},[allowWrite,companyAccountId])
  const importLegacy=useCallback(async()=>{if(!allowWrite('import calendar events'))return {ok:false as const,error:'Read-only account'};const legacy=parse();let imported=0,skipped=0,unresolved=0;const failures:any[]=[];const known=new Set(eventsRef.current.map(event=>event.id));for(const event of legacy){if(known.has(event.id)){skipped++;continue}const {revision,derived,...manualEvent}=event;const result=await addEvent(manualEvent);if(result.ok){imported++;known.add(event.id)}else failures.push({id:event.id,reason:result.error})}return {ok:true as const,imported,skipped,unresolved,failures}},[addEvent,allowWrite])
  return {events,loading,error,refresh,addEvent,updateEvent,deleteEvent,importLegacy,getLegacyCalendarEventCount,companyName:billing.companyName,readOnly:billing.readOnly}
}