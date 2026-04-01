-- Team access and invite support for Framers App
-- Run this in the Supabase SQL Editor after TRIAL_SETUP.sql.

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_account_id uuid not null references public.company_accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  full_name text,
  phone text,
  role text not null default 'staff' check (role in ('owner', 'manager', 'sales', 'workshop', 'staff')),
  status text not null default 'invited' check (status in ('invited', 'active', 'inactive')),
  invited_by_user_id uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  last_invite_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_account_id, email),
  unique (user_id)
);

create index if not exists idx_company_members_company_account_id
  on public.company_members(company_account_id);

create index if not exists idx_company_members_user_id
  on public.company_members(user_id);

create index if not exists idx_company_members_email
  on public.company_members(lower(email));

alter table public.company_members enable row level security;

drop policy if exists "Company owners and members can read memberships" on public.company_members;
create policy "Company owners and members can read memberships"
  on public.company_members
  for select
  using (
    auth.uid() = user_id
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or exists (
      select 1
      from public.company_accounts ca
      where ca.id = company_account_id
        and ca.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Company owners can insert memberships" on public.company_members;
create policy "Company owners can insert memberships"
  on public.company_members
  for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1
      from public.company_accounts ca
      where ca.id = company_account_id
        and ca.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Owners and invited users can update memberships" on public.company_members;
create policy "Owners and invited users can update memberships"
  on public.company_members
  for update
  using (
    auth.uid() = user_id
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or exists (
      select 1
      from public.company_accounts ca
      where ca.id = company_account_id
        and ca.owner_user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or exists (
      select 1
      from public.company_accounts ca
      where ca.id = company_account_id
        and ca.owner_user_id = auth.uid()
    )
  );

drop trigger if exists trg_company_members_updated_at on public.company_members;
create trigger trg_company_members_updated_at
before update on public.company_members
for each row
execute procedure public.touch_updated_at();
