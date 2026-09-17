import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calendar = vi.hoisted(() => ({
  importLegacy: vi.fn(), addEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(),
  events: [{ id:'manual-1', type:'appointment', title:'Manual event', start:'2026-09-15T09:00:00.000Z', revision:1 }],
  getLegacyCalendarEventCount: vi.fn(() => 2), companyName:'Calendar Test Company',
}))
const toast = vi.hoisted(() => vi.fn())
vi.mock('react-big-calendar',()=>({ Calendar: ({events,onSelectEvent}:any)=><div>{events.map((event:any)=><button key={event.id} type="button" onClick={()=>onSelectEvent(event)}>{event.title}</button>)}</div>, Views:{WEEK:'week',MONTH:'month',DAY:'day'}, dateFnsLocalizer:()=>({}) }))
vi.mock('react-big-calendar/lib/addons/dragAndDrop',()=>({default:(Component:any)=>Component}))
vi.mock('@/lib/calendar',()=>({useCalendar:()=>calendar}))
vi.mock('@/lib/customers',()=>({useCustomers:()=>({customers:[]})}))
vi.mock('@/lib/jobs',()=>({useJobs:()=>({jobs:[{id:'job-1',description:'Derived job',dueDate:'2026-09-16'}]})}))
vi.mock('@/lib/invoices',()=>({useInvoices:()=>({invoices:[{id:'invoice-1',number:'INV-1',dueDateISO:'2026-09-17'}]})}))
vi.mock('@/lib/layout',()=>({useLayout:()=>({layoutMode:'fixed'})}))
vi.mock('@/lib/users',()=>({useUsers:()=>({users:[]})}))
vi.mock('@/lib/companyMembers',()=>({useCompanyMembers:()=>({members:[],loading:false,error:null})}))
vi.mock('@/lib/toast',()=>({useToast:()=>({add:toast})}))
vi.mock('@/lib/history',()=>({useHistory:()=>({canUndo:()=>false,undo:vi.fn()})}))
import CalendarPage from '@/pages/Calendar'

afterEach(cleanup)
beforeEach(()=>{vi.clearAllMocks(); calendar.importLegacy.mockResolvedValue({ok:true,imported:1,skipped:0,failures:[{id:'bad-event',reason:'Calendar job_id must belong to the same company_account_id'}]}); vi.stubGlobal('confirm',vi.fn(()=>true)); localStorage.setItem('frameit_calendar_events_v1','[{"id":"good-event"},{"id":"bad-event"}]')})
describe('Block 6C Calendar import feedback',()=>{
 it('confirms destination/count, preserves source data, renders manual and derived events once, and reports partial failure',async()=>{const source=localStorage.getItem('frameit_calendar_events_v1');render(<CalendarPage/>);expect(screen.getByText('Manual event')).toBeTruthy();expect(screen.getByText('Derived job')).toBeTruthy();expect(screen.getByText('Invoice INV-1 due')).toBeTruthy();expect(screen.getAllByText('Manual event')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Import legacy events'}));expect(window.confirm).toHaveBeenCalledWith('Import 2 legacy calendar events into Calendar Test Company? Original browser data will be preserved.');await waitFor(()=>expect(toast).toHaveBeenCalledWith('1 imported, 0 already imported. 1 failed.','error'));expect(localStorage.getItem('frameit_calendar_events_v1')).toBe(source)})
 it('shows failed save feedback without success',async()=>{calendar.getLegacyCalendarEventCount.mockReturnValue(0);calendar.updateEvent.mockResolvedValue({ok:false,error:'Calendar event changed or no longer exists'});render(<CalendarPage/>);fireEvent.click(screen.getByText('Manual event'));fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Changed'}});await waitFor(()=>expect(toast).toHaveBeenCalledWith('Calendar event changed or no longer exists','error'));expect(toast).not.toHaveBeenCalledWith('Event moved','success')})
})
