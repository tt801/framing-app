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
  constraint company_members_company_account_id_email_key unique (company_account_id, email),
  constraint company_members_user_id_key unique (user_id)
);

create index if not exists idx_company_members_company_account_id
  on public.company_members(company_account_id);

create index if not exists idx_company_members_user_id
  on public.company_members(user_id);

create index if not exists idx_company_members_email
  on public.company_members(lower(email));

alter table public.company_members enable row level security;

create or replace function public.is_active_company_member(p_company_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_account_id = p_company_account_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  );
$$;

revoke all on function public.is_active_company_member(uuid) from public;
grant execute on function public.is_active_company_member(uuid) to authenticated;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'company_accounts'
      and column_name = 'stripe_price_id'
  ) then
    execute $sql$
      create or replace function public.get_company_billing_access(p_company_account_id uuid)
      returns table (is_founder boolean)
      language plpgsql
      stable
      security definer
      set search_path = public
      as $fn$
      begin
        if auth.uid() is null then
          raise exception 'Authentication is required';
        end if;

        return query
        select coalesce(ca.stripe_price_id = 'founder_lifetime', false)
        from public.company_accounts ca
        where ca.id = p_company_account_id
          and (ca.owner_user_id = auth.uid() or public.is_active_company_member(ca.id));

        if not found then
          raise exception 'Company account not found';
        end if;
      end;
      $fn$;
    $sql$;

    revoke all on function public.get_company_billing_access(uuid) from public;
    grant execute on function public.get_company_billing_access(uuid) to authenticated;
  end if;
end;
$$;

drop policy if exists "Users can read own company account" on public.company_accounts;
create policy "Users can read own company account"
  on public.company_accounts
  for select
  using (auth.uid() = owner_user_id or public.is_active_company_member(id));

create or replace function public.accept_company_invitation()
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
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication with confirmed email is required';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null;

  if v_email is null or v_email = '' then
    raise exception 'Authentication with email is required';
  end if;

  return query
  with candidate as (
    select locked.id
    from public.company_members locked
    where lower(locked.email) = v_email
      and locked.status = 'invited'
      and (locked.user_id is null or locked.user_id = auth.uid())
    order by locked.invited_at desc
    limit 1
    for update
  )
  update public.company_members as cm
  set
    user_id = auth.uid(),
    status = 'active',
    joined_at = coalesce(cm.joined_at, now()),
    updated_at = now()
  from candidate
  where cm.id = candidate.id
    and lower(cm.email) = v_email
    and cm.status = 'invited'
    and (cm.user_id is null or cm.user_id = auth.uid())
  returning cm.id, cm.company_account_id, cm.user_id, cm.email, cm.role, cm.status, cm.invited_at, cm.joined_at;

  if not found then
    raise exception 'No pending invitation found for authenticated user';
  end if;
end;
$$;

revoke all on function public.accept_company_invitation() from public;
grant execute on function public.accept_company_invitation() to authenticated;

revoke insert on public.company_members from anon, authenticated;
revoke update on public.company_members from anon, authenticated;
revoke delete on public.company_members from anon, authenticated;
grant select on public.company_members to authenticated;
grant update (full_name, phone) on public.company_members to authenticated;

drop policy if exists "Company owners and members can read memberships" on public.company_members;
create policy "Company owners and members can read memberships"
  on public.company_members
  for select
  using (
    auth.uid() = user_id
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.is_active_company_member(company_account_id)
    or exists (
      select 1
      from public.company_accounts ca
      where ca.id = company_account_id
        and ca.owner_user_id = auth.uid()
    )
  );

drop policy if exists "Company owners can insert memberships" on public.company_members;
drop policy if exists "Owners and invited users can update memberships" on public.company_members;
drop policy if exists "Members can update their own profile fields" on public.company_members;
create policy "Members can update their own profile fields"
  on public.company_members
  for update
  using (
    auth.uid() = user_id
    and status = 'active'
  )
  with check (
    auth.uid() = user_id
    and status = 'active'
  );

drop trigger if exists trg_company_members_updated_at on public.company_members;
create trigger trg_company_members_updated_at
before update on public.company_members
for each row
execute procedure public.touch_updated_at();
