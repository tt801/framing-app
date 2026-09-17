-- Block 6D: validate new manual calendar assignees against canonical active memberships.
begin;
create or replace function public.check_calendar_event_references()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_assigned_to text := nullif(new.event->>'assignedTo','');
begin
  if new.customer_id is not null and not exists (select 1 from public.customers where id=new.customer_id and company_account_id=new.company_account_id) then raise exception 'Calendar customer_id must belong to the same company_account_id'; end if;
  if new.job_id is not null and not exists (select 1 from public.jobs where id=new.job_id and company_account_id=new.company_account_id) then raise exception 'Calendar job_id must belong to the same company_account_id'; end if;
  if new.invoice_id is not null and not exists (select 1 from public.invoices where id=new.invoice_id and company_account_id=new.company_account_id) then raise exception 'Calendar invoice_id must belong to the same company_account_id'; end if;
  if (tg_op='INSERT' or v_assigned_to is distinct from nullif(old.event->>'assignedTo','')) and v_assigned_to is not null and not exists (select 1 from public.company_members where company_account_id=new.company_account_id and user_id::text=v_assigned_to and status='active') then raise exception 'Calendar assignedTo must be an active member of the same company_account_id'; end if;
  if tg_op='UPDATE' and new.company_account_id<>old.company_account_id then raise exception 'Calendar company_account_id cannot be changed'; end if;
  return new;
end $$;
revoke all on function public.check_calendar_event_references() from public, anon, authenticated;
commit;
