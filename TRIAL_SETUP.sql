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
  constraint company_accounts_owner_user_id_key unique (owner_user_id)
);

create index if not exists idx_company_accounts_owner_user_id
  on public.company_accounts(owner_user_id);

alter table public.company_accounts enable row level security;

create or replace function public.protect_company_account_client_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then
      new.owner_user_id = auth.uid();
      new.plan_status = 'trialing';
      new.trial_started_at = now();
      new.trial_ends_at = now() + interval '14 days';
      new.trial_extended_days = 0;
    elsif tg_op = 'UPDATE' then
      new.owner_user_id = old.owner_user_id;
      new.plan_status = old.plan_status;
      new.trial_started_at = old.trial_started_at;
      new.trial_ends_at = old.trial_ends_at;
      new.trial_extended_days = old.trial_extended_days;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_company_account_client_fields() from public;

drop trigger if exists trg_company_accounts_client_field_guard on public.company_accounts;
create trigger trg_company_accounts_client_field_guard
before insert or update on public.company_accounts
for each row
execute procedure public.protect_company_account_client_fields();

create or replace function public.ensure_owner_membership()
returns table (
  id uuid,
  company_account_id uuid,
  user_id uuid,
  email text,
  role text,
  status text,
  invited_at timestamptz,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.company_accounts%rowtype;
  v_email text;
  v_existing_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication with email is required';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = auth.uid();

  if v_email is null or v_email = '' then
    raise exception 'Authentication with email is required';
  end if;

  select * into v_account
  from public.company_accounts ca
  where ca.owner_user_id = auth.uid();

  if not found then
    raise exception 'No owned company account found';
  end if;

  select cm.id into v_existing_id
  from public.company_members cm
  where cm.user_id = auth.uid()
  for update;

  if v_existing_id is not null then
    return query
    update public.company_members as cm
    set
      company_account_id = v_account.id,
      email = v_email,
      role = 'owner',
      status = 'active',
      joined_at = coalesce(cm.joined_at, now()),
      updated_at = now()
    where cm.id = v_existing_id
    returning cm.id, cm.company_account_id, cm.user_id, cm.email, cm.role, cm.status, cm.invited_at, cm.joined_at;
    return;
  end if;

  select cm.id into v_existing_id
  from public.company_members cm
  where cm.company_account_id = v_account.id
    and lower(cm.email) = v_email
  for update;

  if v_existing_id is not null then
    return query
    update public.company_members as cm
    set
      user_id = auth.uid(),
      role = 'owner',
      status = 'active',
      joined_at = coalesce(cm.joined_at, now()),
      updated_at = now()
    where cm.id = v_existing_id
    returning cm.id, cm.company_account_id, cm.user_id, cm.email, cm.role, cm.status, cm.invited_at, cm.joined_at;
    return;
  end if;

  return query
  insert into public.company_members as cm (
    company_account_id,
    user_id,
    email,
    role,
    status,
    invited_at,
    joined_at,
    last_invite_sent_at
  )
  values (
    v_account.id,
    auth.uid(),
    v_email,
    'owner',
    'active',
    now(),
    now(),
    now()
  )
  returning cm.id, cm.company_account_id, cm.user_id, cm.email, cm.role, cm.status, cm.invited_at, cm.joined_at;
end;
$$;

revoke all on function public.ensure_owner_membership() from public;
grant execute on function public.ensure_owner_membership() to authenticated;

create or replace function public.create_company_trial_account(p_company_name text default null)
returns table (
  id uuid,
  owner_user_id uuid,
  company_name text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  plan_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.company_accounts%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = auth.uid();

  if v_email is null or v_email = '' then
    raise exception 'Authentication with email is required';
  end if;

  select * into v_account
  from public.company_accounts ca
  where ca.owner_user_id = auth.uid();

  if not found then
    if to_regclass('public.company_members') is not null and exists (
      select 1
      from public.company_members cm
      where cm.status <> 'inactive'
        and (
          cm.user_id = auth.uid()
          or (v_email <> '' and lower(cm.email) = v_email)
        )
    ) then
      raise exception 'Existing company membership or invitation found';
    end if;

    insert into public.company_accounts as ca (owner_user_id, company_name)
    values (auth.uid(), nullif(trim(p_company_name), ''))
    on conflict on constraint company_accounts_owner_user_id_key do update
    set company_name = case
      when coalesce(ca.company_name, '') = '' then excluded.company_name
      else ca.company_name
    end
    returning * into v_account;
  elsif nullif(trim(p_company_name), '') is not null and coalesce(v_account.company_name, '') = '' then
    update public.company_accounts ca
    set company_name = nullif(trim(p_company_name), '')
    where ca.id = v_account.id
    returning * into v_account;
  end if;

  if to_regclass('public.company_members') is not null then
    perform public.ensure_owner_membership();
  end if;

  return query
  select
    v_account.id,
    v_account.owner_user_id,
    v_account.company_name,
    v_account.trial_started_at,
    v_account.trial_ends_at,
    v_account.plan_status;
end;
$$;

revoke all on function public.create_company_trial_account(text) from public;
grant execute on function public.create_company_trial_account(text) to authenticated;

revoke insert on public.company_accounts from anon, authenticated;
revoke update on public.company_accounts from anon, authenticated;
revoke select on public.company_accounts from anon, authenticated;
grant select (id, owner_user_id, company_name, plan_status, trial_started_at, trial_ends_at, trial_extended_days, created_at, updated_at)
  on public.company_accounts to authenticated;
grant update (company_name) on public.company_accounts to authenticated;

-- Users can read their owned company account and active members can read their company account.
drop policy if exists "Users can read own company account" on public.company_accounts;
create policy "Users can read own company account"
  on public.company_accounts
  for select
  using (auth.uid() = owner_user_id);

drop policy if exists "Users can insert own company account" on public.company_accounts;
drop policy if exists "Users can update own company account" on public.company_accounts;

-- Owners can update profile fields granted above; billing and trial fields are blocked by grants and the trigger.
drop policy if exists "Company owners can update safe profile fields" on public.company_accounts;
create policy "Company owners can update safe profile fields"
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
