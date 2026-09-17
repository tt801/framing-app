-- Block 2D: company-scoped job persistence.
-- Forward-only migration. Legacy browser jobs are imported explicitly by the app.

begin;

create table if not exists public.job_reference_counters (
  company_account_id uuid primary key references public.company_accounts(id) on delete cascade,
  last_ref_no integer not null default 1000
);

create table if not exists public.jobs (
  id text primary key,
  company_account_id uuid not null references public.company_accounts(id) on delete cascade,
  ref_no integer not null,
  customer_id text references public.customers(id) on delete set null,
  quote_id text,
  invoice_id text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_account_id, ref_no)
);

create index if not exists idx_jobs_company_account_id on public.jobs(company_account_id);
create index if not exists idx_jobs_customer_id on public.jobs(customer_id);
create index if not exists idx_jobs_quote_id on public.jobs(quote_id);
create index if not exists idx_jobs_invoice_id on public.jobs(invoice_id);

alter table public.jobs enable row level security;

drop trigger if exists trg_jobs_updated_at on public.jobs;
create trigger trg_jobs_updated_at before update on public.jobs
for each row execute procedure public.touch_updated_at();

create or replace function public.check_job_references()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c where c.id = new.customer_id and c.company_account_id = new.company_account_id
  ) then raise exception 'Job customer_id must belong to the same company_account_id'; end if;
  if new.quote_id is not null and not exists (
    select 1 from public.quotes q where q.id = new.quote_id and q.company_account_id = new.company_account_id
  ) then raise exception 'Job quote_id must belong to the same company_account_id'; end if;
  if new.invoice_id is not null and not exists (
    select 1 from public.invoices i where i.id = new.invoice_id and i.company_account_id = new.company_account_id
  ) then raise exception 'Job invoice_id must belong to the same company_account_id'; end if;
  if tg_op = 'UPDATE' and new.company_account_id <> old.company_account_id then
    raise exception 'Job company_account_id cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_reference_check on public.jobs;
create trigger trg_jobs_reference_check before insert or update on public.jobs
for each row execute procedure public.check_job_references();

create or replace function public.next_job_reference(p_company_account_id uuid, p_requested integer default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_ref integer;
begin
  insert into public.job_reference_counters(company_account_id, last_ref_no)
  values (p_company_account_id, greatest(coalesce(p_requested, 1001) - 1, 1000))
  on conflict (company_account_id) do nothing;
  select greatest(c.last_ref_no + 1, coalesce(p_requested, 1001)) into v_ref
  from public.job_reference_counters c where c.company_account_id = p_company_account_id for update;
  update public.job_reference_counters set last_ref_no = v_ref where company_account_id = p_company_account_id;
  return v_ref;
end;
$$;

create or replace function public.create_job(
  p_id text, p_company_account_id uuid, p_payload jsonb,
  p_customer_id text default null, p_quote_id text default null,
  p_invoice_id text default null, p_ref_no integer default null
)
returns public.jobs language plpgsql security definer set search_path = public as $$
declare v_job public.jobs; v_payload jsonb := coalesce(p_payload, '{}'::jsonb); v_ref integer;
begin
  if not ((exists (select 1 from public.company_accounts ca where ca.id=p_company_account_id and ca.owner_user_id=auth.uid())
    or public.is_active_company_member(p_company_account_id)) and public.is_company_account_writable(p_company_account_id))
  then raise exception 'Job writes are not allowed for this company'; end if;
  v_ref := coalesce(p_ref_no, nullif(v_payload->>'refNo','')::integer, public.next_job_reference(p_company_account_id));
  insert into public.job_reference_counters(company_account_id, last_ref_no)
  values (p_company_account_id, greatest(v_ref, 1000))
  on conflict (company_account_id) do update
  set last_ref_no = greatest(public.job_reference_counters.last_ref_no, excluded.last_ref_no);
  v_payload := jsonb_set(jsonb_set(v_payload, '{id}', to_jsonb(coalesce(nullif(p_id,''), gen_random_uuid()::text))), '{refNo}', to_jsonb(v_ref));
  insert into public.jobs(id, company_account_id, ref_no, customer_id, quote_id, invoice_id, payload)
  values (coalesce(nullif(p_id,''), gen_random_uuid()::text), p_company_account_id, v_ref, p_customer_id, p_quote_id, p_invoice_id, v_payload)
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on public.jobs, public.job_reference_counters from anon, authenticated;
grant select on public.jobs to authenticated;
grant insert (id, company_account_id, ref_no, customer_id, quote_id, invoice_id, payload) on public.jobs to authenticated;
grant update (ref_no, customer_id, quote_id, invoice_id, payload) on public.jobs to authenticated;
grant delete on public.jobs to authenticated;
grant execute on function public.create_job(text, uuid, jsonb, text, text, text, integer) to authenticated;

drop policy if exists "Company members can read jobs" on public.jobs;
create policy "Company members can read jobs" on public.jobs for select using (
  exists (select 1 from public.company_accounts ca where ca.id=company_account_id and ca.owner_user_id=auth.uid())
  or public.is_active_company_member(company_account_id)
);
drop policy if exists "Writable accounts can insert jobs" on public.jobs;
create policy "Writable accounts can insert jobs" on public.jobs for insert with check (
  (exists (select 1 from public.company_accounts ca where ca.id=company_account_id and ca.owner_user_id=auth.uid())
   or public.is_active_company_member(company_account_id)) and public.is_company_account_writable(company_account_id)
);
drop policy if exists "Writable accounts can update jobs" on public.jobs;
create policy "Writable accounts can update jobs" on public.jobs for update using (
  (exists (select 1 from public.company_accounts ca where ca.id=company_account_id and ca.owner_user_id=auth.uid())
   or public.is_active_company_member(company_account_id)) and public.is_company_account_writable(company_account_id)
) with check (
  (exists (select 1 from public.company_accounts ca where ca.id=company_account_id and ca.owner_user_id=auth.uid())
   or public.is_active_company_member(company_account_id)) and public.is_company_account_writable(company_account_id)
);
drop policy if exists "Writable accounts can delete jobs" on public.jobs;
create policy "Writable accounts can delete jobs" on public.jobs for delete using (
  (exists (select 1 from public.company_accounts ca where ca.id=company_account_id and ca.owner_user_id=auth.uid())
   or public.is_active_company_member(company_account_id)) and public.is_company_account_writable(company_account_id)
);

commit;