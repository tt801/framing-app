-- Block 2A: company-scoped customer persistence.
-- Forward-only migration. Non-destructive; does not touch existing tables.

begin;

-- id is text (not uuid) so legacy browser-local customer ids can be preserved
-- on explicit import without remapping references used by local quotes/invoices.
create table if not exists public.customers (
  id text primary key,
  company_account_id uuid not null references public.company_accounts(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null check (email = '' or position('@' in email) > 0),
  phone text,
  company_name text,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_company_account_id on public.customers(company_account_id);
create index if not exists idx_customers_company_email on public.customers(company_account_id, lower(email));

alter table public.customers enable row level security;

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row
execute procedure public.touch_updated_at();

-- Writable = same rule used elsewhere: active subscription, or trialing with an
-- unexpired trial checked against the real clock, not a cached client flag.
create or replace function public.is_company_account_writable(p_company_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_accounts ca
    where ca.id = p_company_account_id
      and (
        ca.plan_status = 'active'
        or (ca.plan_status = 'trialing' and ca.trial_ends_at > now())
      )
  );
$$;

revoke all on function public.is_company_account_writable(uuid) from public;
grant execute on function public.is_company_account_writable(uuid) to authenticated;

revoke all on public.customers from anon, authenticated;
grant select on public.customers to authenticated;
grant insert (id, company_account_id, first_name, last_name, email, phone, company_name, notes, created_by_user_id)
  on public.customers to authenticated;
grant update (first_name, last_name, email, phone, company_name, notes) on public.customers to authenticated;
grant delete on public.customers to authenticated;

drop policy if exists "Company members can read customers" on public.customers;
create policy "Company members can read customers"
  on public.customers
  for select
  using (
    exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
    or public.is_active_company_member(company_account_id)
  );

drop policy if exists "Writable accounts can insert customers" on public.customers;
create policy "Writable accounts can insert customers"
  on public.customers
  for insert
  with check (
    (
      exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
      or public.is_active_company_member(company_account_id)
    )
    and public.is_company_account_writable(company_account_id)
  );

drop policy if exists "Writable accounts can update customers" on public.customers;
create policy "Writable accounts can update customers"
  on public.customers
  for update
  using (
    (
      exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
      or public.is_active_company_member(company_account_id)
    )
    and public.is_company_account_writable(company_account_id)
  )
  with check (
    (
      exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
      or public.is_active_company_member(company_account_id)
    )
    and public.is_company_account_writable(company_account_id)
  );

drop policy if exists "Writable accounts can delete customers" on public.customers;
create policy "Writable accounts can delete customers"
  on public.customers
  for delete
  using (
    (
      exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
      or public.is_active_company_member(company_account_id)
    )
    and public.is_company_account_writable(company_account_id)
  );

commit;
