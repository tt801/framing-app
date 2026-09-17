-- Block 1 access-control hardening for existing databases.
-- Apply manually in a reviewed maintenance window. This migration is non-destructive.

begin;

alter table if exists public.company_accounts
add column if not exists stripe_customer_id text,
add column if not exists stripe_subscription_id text,
add column if not exists stripe_price_id text,
add column if not exists subscription_renewed_at timestamptz,
add column if not exists subscription_cancel_at timestamptz;

alter table if exists public.company_accounts enable row level security;
alter table if exists public.company_members enable row level security;
alter table if exists public.support_tickets enable row level security;
alter table if exists public.support_ticket_comments enable row level security;
alter table if exists public.stripe_webhook_logs enable row level security;

do $$
begin
  if to_regclass('public.company_accounts') is not null and not exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('public.company_accounts')
      and conname = 'company_accounts_owner_user_id_key'
  ) then
    alter table public.company_accounts
      add constraint company_accounts_owner_user_id_key unique (owner_user_id);
  end if;

  if to_regclass('public.company_members') is not null and not exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('public.company_members')
      and conname = 'company_members_company_account_id_email_key'
  ) then
    alter table public.company_members
      add constraint company_members_company_account_id_email_key unique (company_account_id, email);
  end if;

  if to_regclass('public.company_members') is not null and not exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('public.company_members')
      and conname = 'company_members_user_id_key'
  ) then
    alter table public.company_members
      add constraint company_members_user_id_key unique (user_id);
  end if;
end;
$$;

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
      new.stripe_customer_id = null;
      new.stripe_subscription_id = null;
      new.stripe_price_id = null;
      new.subscription_renewed_at = null;
      new.subscription_cancel_at = null;
    elsif tg_op = 'UPDATE' then
      new.owner_user_id = old.owner_user_id;
      new.plan_status = old.plan_status;
      new.trial_started_at = old.trial_started_at;
      new.trial_ends_at = old.trial_ends_at;
      new.trial_extended_days = old.trial_extended_days;
      new.stripe_customer_id = old.stripe_customer_id;
      new.stripe_subscription_id = old.stripe_subscription_id;
      new.stripe_price_id = old.stripe_price_id;
      new.subscription_renewed_at = old.subscription_renewed_at;
      new.subscription_cancel_at = old.subscription_cancel_at;
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
    raise exception 'Authentication with confirmed email is required';
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

create or replace function public.get_company_billing_access(p_company_account_id uuid)
returns table (is_founder boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.get_company_billing_access(uuid) from public;
grant execute on function public.get_company_billing_access(uuid) to authenticated;

revoke insert on public.company_accounts from anon, authenticated;
revoke update on public.company_accounts from anon, authenticated;
revoke select on public.company_accounts from anon, authenticated;
grant select (id, owner_user_id, company_name, plan_status, trial_started_at, trial_ends_at, trial_extended_days, created_at, updated_at)
  on public.company_accounts to authenticated;
grant update (company_name) on public.company_accounts to authenticated;

revoke insert on public.company_members from anon, authenticated;
revoke update on public.company_members from anon, authenticated;
revoke delete on public.company_members from anon, authenticated;
grant select on public.company_members to authenticated;
grant update (full_name, phone) on public.company_members to authenticated;

do $$
begin
  if to_regclass('public.support_tickets') is not null then
    revoke all on public.support_tickets from anon, authenticated;
  end if;

  if to_regclass('public.support_ticket_comments') is not null then
    revoke all on public.support_ticket_comments from anon, authenticated;
  end if;
end;
$$;

drop policy if exists "Users can read own company account" on public.company_accounts;
create policy "Users can read own company account"
  on public.company_accounts
  for select
  using (auth.uid() = owner_user_id or public.is_active_company_member(id));

drop policy if exists "Users can insert own company account" on public.company_accounts;
drop policy if exists "Users can update own company account" on public.company_accounts;
drop policy if exists "Company owners can update safe profile fields" on public.company_accounts;
create policy "Company owners can update safe profile fields"
  on public.company_accounts
  for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

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
  using (auth.uid() = user_id and status = 'active')
  with check (auth.uid() = user_id and status = 'active');

do $$
begin
  if to_regclass('public.support_tickets') is not null then
    drop policy if exists "Support tickets are server only" on public.support_tickets;
    create policy "Support tickets are server only"
      on public.support_tickets
      for all
      using (false)
      with check (false);
  end if;

  if to_regclass('public.support_ticket_comments') is not null then
    drop policy if exists "Support ticket comments are server only" on public.support_ticket_comments;
    create policy "Support ticket comments are server only"
      on public.support_ticket_comments
      for all
      using (false)
      with check (false);
  end if;

  if to_regclass('public.stripe_webhook_logs') is not null then
    drop policy if exists "Webhook logs are internal only" on public.stripe_webhook_logs;
    create policy "Webhook logs are internal only"
      on public.stripe_webhook_logs
      for select
      using (false);
  end if;
end;
$$;

commit;