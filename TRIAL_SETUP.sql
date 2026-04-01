-- Trial + company account setup for Framers App
-- Run this in Supabase SQL Editor once.

create table if not exists public.company_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  company_name text,
  plan_status text not null default 'trialing' check (plan_status in ('trialing', 'active', 'past_due', 'expired')),
  trial_started_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  trial_extended_days integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id)
);

create index if not exists idx_company_accounts_owner_user_id
  on public.company_accounts(owner_user_id);

alter table public.company_accounts enable row level security;

-- Users can read only their own company account row.
drop policy if exists "Users can read own company account" on public.company_accounts;
create policy "Users can read own company account"
  on public.company_accounts
  for select
  using (auth.uid() = owner_user_id);

-- Users can insert their own company account row.
drop policy if exists "Users can insert own company account" on public.company_accounts;
create policy "Users can insert own company account"
  on public.company_accounts
  for insert
  with check (auth.uid() = owner_user_id);

-- Users can update only their own company account row.
drop policy if exists "Users can update own company account" on public.company_accounts;
create policy "Users can update own company account"
  on public.company_accounts
  for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

-- Keep updated_at fresh on updates.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_company_accounts_updated_at on public.company_accounts;
create trigger trg_company_accounts_updated_at
before update on public.company_accounts
for each row
execute procedure public.touch_updated_at();
