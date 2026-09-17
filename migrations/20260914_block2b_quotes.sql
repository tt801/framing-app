-- Block 2B: company-scoped quote persistence.
-- Forward-only migration. Non-destructive; does not touch existing tables.

begin;

-- Full quote payload kept as JSONB to preserve the existing loosely-typed shape
-- (items, pricing, notes, status, customer snapshot fields) without data loss.
-- id is text (not uuid) so legacy browser-local quote ids survive unchanged.
create table if not exists public.quotes (
  id text primary key,
  company_account_id uuid not null references public.company_accounts(id) on delete cascade,
  customer_id text references public.customers(id) on delete set null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quotes_company_account_id on public.quotes(company_account_id);
create index if not exists idx_quotes_customer_id on public.quotes(customer_id);

alter table public.quotes enable row level security;

drop trigger if exists trg_quotes_updated_at on public.quotes;
create trigger trg_quotes_updated_at
before update on public.quotes
for each row
execute procedure public.touch_updated_at();

-- A quote's customer, if any, must belong to the same company (no cross-company link).
create or replace function public.check_quote_customer_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.customer_id
      and c.company_account_id = new.company_account_id
  ) then
    raise exception 'Quote customer_id must belong to the same company_account_id';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quotes_customer_company_check on public.quotes;
create trigger trg_quotes_customer_company_check
before insert or update on public.quotes
for each row
execute procedure public.check_quote_customer_company();

revoke all on public.quotes from anon, authenticated;
grant select on public.quotes to authenticated;
grant insert (id, company_account_id, customer_id, payload) on public.quotes to authenticated;
grant update (customer_id, payload) on public.quotes to authenticated;
grant delete on public.quotes to authenticated;

drop policy if exists "Company members can read quotes" on public.quotes;
create policy "Company members can read quotes"
  on public.quotes
  for select
  using (
    exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
    or public.is_active_company_member(company_account_id)
  );

drop policy if exists "Writable accounts can insert quotes" on public.quotes;
create policy "Writable accounts can insert quotes"
  on public.quotes
  for insert
  with check (
    (
      exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
      or public.is_active_company_member(company_account_id)
    )
    and public.is_company_account_writable(company_account_id)
  );

drop policy if exists "Writable accounts can update quotes" on public.quotes;
create policy "Writable accounts can update quotes"
  on public.quotes
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

drop policy if exists "Writable accounts can delete quotes" on public.quotes;
create policy "Writable accounts can delete quotes"
  on public.quotes
  for delete
  using (
    (
      exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
      or public.is_active_company_member(company_account_id)
    )
    and public.is_company_account_writable(company_account_id)
  );

commit;
