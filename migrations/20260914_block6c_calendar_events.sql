-- Block 6C: company-scoped manual calendar events. Derived job/invoice events remain computed by the client.
begin;

create table if not exists public.calendar_events (
  id text primary key,
  company_account_id uuid not null references public.company_accounts(id) on delete cascade,
  event jsonb not null,
  customer_id text references public.customers(id) on delete set null,
  job_id text references public.jobs(id) on delete set null,
  invoice_id text references public.invoices(id) on delete set null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_calendar_events_company on public.calendar_events(company_account_id);
alter table public.calendar_events enable row level security;

create or replace function public.check_calendar_event_references()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.customer_id is not null and not exists (select 1 from public.customers where id=new.customer_id and company_account_id=new.company_account_id) then raise exception 'Calendar customer_id must belong to the same company_account_id'; end if;
  if new.job_id is not null and not exists (select 1 from public.jobs where id=new.job_id and company_account_id=new.company_account_id) then raise exception 'Calendar job_id must belong to the same company_account_id'; end if;
  if new.invoice_id is not null and not exists (select 1 from public.invoices where id=new.invoice_id and company_account_id=new.company_account_id) then raise exception 'Calendar invoice_id must belong to the same company_account_id'; end if;
  if tg_op='UPDATE' and new.company_account_id<>old.company_account_id then raise exception 'Calendar company_account_id cannot be changed'; end if;
  return new;
end $$;
drop trigger if exists trg_calendar_event_references on public.calendar_events;
create trigger trg_calendar_event_references before insert or update on public.calendar_events for each row execute procedure public.check_calendar_event_references();
drop trigger if exists trg_calendar_events_updated_at on public.calendar_events;
create trigger trg_calendar_events_updated_at before update on public.calendar_events for each row execute procedure public.touch_updated_at();

create or replace function public.calendar_event_writable(p_company_account_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.is_company_account_writable(p_company_account_id) and (exists(select 1 from public.company_accounts where id=p_company_account_id and owner_user_id=auth.uid()) or exists(select 1 from public.company_members where company_account_id=p_company_account_id and user_id=auth.uid() and status='active' and role in ('owner','manager','sales','workshop','staff')))
$$;

create or replace function public.create_calendar_event(p_id text,p_company_account_id uuid,p_event jsonb,p_customer_id text default null,p_job_id text default null,p_invoice_id text default null)
returns public.calendar_events language plpgsql security definer set search_path=public as $$ declare v public.calendar_events; begin
  if not public.calendar_event_writable(p_company_account_id) then raise exception 'Calendar writes are not allowed for this company'; end if;
  insert into public.calendar_events(id,company_account_id,event,customer_id,job_id,invoice_id) values(p_id,p_company_account_id,p_event,p_customer_id,p_job_id,p_invoice_id) returning * into v; return v;
end $$;
create or replace function public.update_calendar_event(p_id text,p_company_account_id uuid,p_event jsonb,p_customer_id text,p_job_id text,p_invoice_id text,p_revision bigint)
returns public.calendar_events language plpgsql security definer set search_path=public as $$ declare v public.calendar_events; begin
  if not public.calendar_event_writable(p_company_account_id) then raise exception 'Calendar writes are not allowed for this company'; end if;
  update public.calendar_events set event=p_event,customer_id=p_customer_id,job_id=p_job_id,invoice_id=p_invoice_id,revision=revision+1 where id=p_id and company_account_id=p_company_account_id and revision=p_revision returning * into v;
  if not found then raise exception 'Calendar event changed or no longer exists'; end if; return v;
end $$;
create or replace function public.delete_calendar_event(p_id text,p_company_account_id uuid,p_revision bigint)
returns void language plpgsql security definer set search_path=public as $$ begin
  if not public.calendar_event_writable(p_company_account_id) then raise exception 'Calendar writes are not allowed for this company'; end if;
  delete from public.calendar_events where id=p_id and company_account_id=p_company_account_id and revision=p_revision;
  if not found then raise exception 'Calendar event changed or no longer exists'; end if;
end $$;

revoke all on public.calendar_events from anon, authenticated;
grant select on public.calendar_events to authenticated;
grant execute on function public.create_calendar_event(text,uuid,jsonb,text,text,text),public.update_calendar_event(text,uuid,jsonb,text,text,text,bigint),public.delete_calendar_event(text,uuid,bigint) to authenticated;
drop policy if exists "Calendar members can read" on public.calendar_events;
create policy "Calendar members can read" on public.calendar_events for select using (exists(select 1 from public.company_accounts where id=company_account_id and owner_user_id=auth.uid()) or public.is_active_company_member(company_account_id));
commit;
