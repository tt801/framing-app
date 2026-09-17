-- Stripe integration setup for Framers App
-- Run this in Supabase SQL Editor after TRIAL_SETUP.sql

-- Extend company_accounts table with Stripe fields
alter table if exists public.company_accounts
add column if not exists stripe_customer_id text,
add column if not exists stripe_subscription_id text,
add column if not exists stripe_price_id text,
add column if not exists subscription_renewed_at timestamptz,
add column if not exists subscription_cancel_at timestamptz;

alter table if exists public.company_accounts
drop constraint if exists company_accounts_plan_status_check;

alter table if exists public.company_accounts
add constraint company_accounts_plan_status_check
check (plan_status in ('trialing', 'active', 'past_due', 'expired'));

-- Create an index for quick Stripe customer lookup
create index if not exists idx_company_accounts_stripe_customer_id
  on public.company_accounts(stripe_customer_id);

create table if not exists public.stripe_checkout_attempts (
  id uuid primary key default gen_random_uuid(), company_account_id uuid not null references public.company_accounts(id) on delete cascade,
  price_id text not null, idempotency_key text not null unique, session_id text unique, customer_id text,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  founder_reserved boolean not null default false, expires_at timestamptz not null, completed_at timestamptz, created_at timestamptz not null default now()
);
alter table public.stripe_checkout_attempts add column if not exists session_url text;
alter table public.stripe_checkout_attempts add column if not exists customer_id text;
create unique index if not exists idx_checkout_attempt_open_account_price on public.stripe_checkout_attempts(company_account_id, price_id) where status='pending';
create index if not exists idx_checkout_attempt_founder_reservations on public.stripe_checkout_attempts(founder_reserved,status,expires_at);

drop function if exists public.begin_stripe_checkout(uuid,text,text,boolean,integer);
create or replace function public.begin_stripe_checkout(p_company_account_id uuid,p_price_id text,p_idempotency_key text,p_is_founder boolean,p_founder_max integer)
returns table(allowed boolean,reason text,attempt_id uuid,existing_session_id text,existing_session_url text,idempotency_key text,founder_reserved boolean)
language plpgsql security definer set search_path=public as $$
declare v public.stripe_checkout_attempts; c integer; r integer;
begin
 if not exists(select 1 from company_accounts where id=p_company_account_id) then return query select false,'Account not found',null::uuid,null::text,null::text,false; return; end if;
 if not p_is_founder and exists(select 1 from company_accounts where id=p_company_account_id and stripe_subscription_id is not null and plan_status in('active','trialing','past_due')) then return query select false,'An active subscription already exists; use billing management',null::uuid,null::text,null::text,false; return; end if;
 if p_is_founder and exists(select 1 from company_accounts where id=p_company_account_id and stripe_price_id='founder_lifetime') then return query select false,'Founder access already exists; use billing management',null::uuid,null::text,null::text,false; return; end if;
 select a.* into v from stripe_checkout_attempts a where a.company_account_id=p_company_account_id and a.price_id=p_price_id and a.status='pending' for update;
 if found and v.expires_at>now() then return query select true,null,v.id,v.session_id,v.session_url,v.idempotency_key,v.founder_reserved; return; end if;
 if found then return query select false,'Stripe session status must be confirmed before releasing this attempt',v.id,v.session_id,v.session_url,v.idempotency_key,v.founder_reserved; return; end if;
 select a.* into v from stripe_checkout_attempts a where a.idempotency_key=p_idempotency_key and a.status='failed' for update;
 if found then update stripe_checkout_attempts set status='pending',founder_reserved=p_is_founder,expires_at=now()+interval '24 hours',session_id=null,completed_at=null where id=v.id returning * into v; return query select true,null,v.id,null::text,v.idempotency_key,v.founder_reserved; return; end if;
 if p_is_founder then select count(*) into c from company_accounts where stripe_price_id='founder_lifetime'; select count(*) into r from stripe_checkout_attempts a where a.founder_reserved and a.status='pending'; if c+r>=p_founder_max then return query select false,'Founder plan is sold out',null::uuid,null::text,null::text,false; return; end if; end if;
 insert into stripe_checkout_attempts(company_account_id,price_id,idempotency_key,founder_reserved,expires_at) values(p_company_account_id,p_price_id,p_idempotency_key,p_is_founder,now()+interval '24 hours') returning * into v;
 return query select true,null,v.id,null::text,null::text,v.idempotency_key,v.founder_reserved;
end; $$;

create or replace function public.expire_stripe_checkout_attempt(p_attempt_id uuid,p_company_account_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$ declare c integer; begin update stripe_checkout_attempts set status='failed',founder_reserved=false where id=p_attempt_id and company_account_id=p_company_account_id and status='pending'; get diagnostics c=row_count; return c=1; end; $$;

drop function if exists public.save_stripe_checkout_session(uuid,uuid,text,timestamptz);
create or replace function public.save_stripe_checkout_session(p_attempt_id uuid,p_company_account_id uuid,p_session_id text,p_session_url text,p_customer_id text,p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$ declare c integer; begin update stripe_checkout_attempts set session_id=p_session_id,session_url=p_session_url,customer_id=p_customer_id,expires_at=least(expires_at,p_expires_at) where id=p_attempt_id and company_account_id=p_company_account_id and status='pending'; get diagnostics c=row_count; return c=1; end; $$;
drop function if exists public.complete_founder_checkout(uuid,text,text);
create or replace function public.complete_founder_checkout(p_company_account_id uuid,p_session_id text,p_customer_id text,p_founder_price_id text)
returns boolean language plpgsql security definer set search_path=public as $$ declare c integer; begin if exists(select 1 from stripe_checkout_attempts where company_account_id=p_company_account_id and session_id=p_session_id and status='completed') then return true; end if; update stripe_checkout_attempts set status='completed',completed_at=now() where company_account_id=p_company_account_id and session_id=p_session_id and customer_id=p_customer_id and price_id=p_founder_price_id and status='pending'; get diagnostics c=row_count; if c<>1 then return false; end if; update company_accounts set plan_status='active',stripe_price_id='founder_lifetime',stripe_customer_id=coalesce(p_customer_id,stripe_customer_id),subscription_renewed_at=now()+interval '100 years' where id=p_company_account_id; get diagnostics c=row_count; return c=1; end; $$;

revoke all on function public.begin_stripe_checkout(uuid,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.expire_stripe_checkout_attempt(uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_stripe_checkout_session(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_founder_checkout(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.begin_stripe_checkout(uuid,text,text,boolean,integer) to service_role;
grant execute on function public.expire_stripe_checkout_attempt(uuid,uuid) to service_role;
grant execute on function public.save_stripe_checkout_session(uuid,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.complete_founder_checkout(uuid,text,text,text) to service_role;

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

do $$
begin
  if to_regclass('public.company_members') is not null and exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'is_active_company_member'
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
  else
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
          and ca.owner_user_id = auth.uid();

        if not found then
          raise exception 'Company account not found';
        end if;
      end;
      $fn$;
    $sql$;
  end if;

  revoke all on function public.get_company_billing_access(uuid) from public;
  grant execute on function public.get_company_billing_access(uuid) to authenticated;
end;
$$;

-- Create a webhook log table for debugging
create table if not exists public.stripe_webhook_logs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  company_account_id uuid references public.company_accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed'))
);

alter table public.stripe_webhook_logs add column if not exists claimed_at timestamptz;
alter table public.stripe_webhook_logs add column if not exists claim_token uuid;
alter table public.stripe_webhook_logs add column if not exists attempt_count integer not null default 0;
alter table public.stripe_webhook_logs alter column processed_at drop not null;
alter table public.company_accounts add column if not exists stripe_subscription_event_created_at timestamptz;
alter table public.company_accounts add column if not exists stripe_subscription_event_id text;

create table if not exists public.stripe_subscription_reconciliation_locks (
  company_account_id uuid primary key references public.company_accounts(id) on delete cascade,
  lease_token uuid not null,
  claimed_at timestamptz not null default now()
);

create or replace function public.claim_stripe_subscription_reconciliation(p_company_account_id uuid, p_lease_token uuid, p_lease_seconds integer default 300)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.company_accounts where id = p_company_account_id) then return false; end if;
  insert into public.stripe_subscription_reconciliation_locks(company_account_id, lease_token, claimed_at) values (p_company_account_id, p_lease_token, now())
  on conflict (company_account_id) do update set lease_token = excluded.lease_token, claimed_at = now()
  where public.stripe_subscription_reconciliation_locks.claimed_at < now() - make_interval(secs => p_lease_seconds);
  return exists (select 1 from public.stripe_subscription_reconciliation_locks where company_account_id = p_company_account_id and lease_token = p_lease_token);
end;
$$;

create or replace function public.release_stripe_subscription_reconciliation(p_company_account_id uuid, p_lease_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  delete from public.stripe_subscription_reconciliation_locks where company_account_id = p_company_account_id and lease_token = p_lease_token;
  get diagnostics v_count = row_count; return v_count = 1;
end;
$$;

create or replace function public.reconcile_stripe_subscription_state(
  p_company_account_id uuid, p_event_id text, p_claim_token uuid, p_reconcile_token uuid,
  p_subscription_id text, p_status text, p_price_id text, p_period_end timestamptz, p_cancel_at timestamptz
)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not exists (select 1 from public.stripe_webhook_logs where event_id = p_event_id and claim_token = p_claim_token and status = 'pending')
    or not exists (select 1 from public.stripe_subscription_reconciliation_locks where company_account_id = p_company_account_id and lease_token = p_reconcile_token)
  then raise exception 'Webhook or reconciliation lease is not active'; end if;
  update public.company_accounts set stripe_subscription_id = p_subscription_id, stripe_price_id = p_price_id, plan_status = coalesce(p_status, 'expired'), subscription_cancel_at = p_cancel_at, subscription_renewed_at = p_period_end where id = p_company_account_id;
  get diagnostics v_count = row_count; return v_count = 1;
end;
$$;

create or replace function public.claim_stripe_webhook(
  p_event_id text, p_event_type text, p_payload jsonb, p_claim_token uuid, p_lease_seconds integer default 300
)
returns table(claimed boolean, status text)
language plpgsql security definer set search_path = public as $$
declare v_log public.stripe_webhook_logs;
begin
  insert into public.stripe_webhook_logs(event_id, event_type, payload, status, claimed_at, claim_token, attempt_count)
  values (p_event_id, p_event_type, p_payload, 'pending', now(), p_claim_token, 1)
  on conflict (event_id) do update
  set event_type = excluded.event_type, payload = excluded.payload, status = 'pending', claimed_at = now(), claim_token = p_claim_token,
      attempt_count = public.stripe_webhook_logs.attempt_count + 1
  where public.stripe_webhook_logs.status <> 'processed'
    and (public.stripe_webhook_logs.claimed_at is null or public.stripe_webhook_logs.claimed_at < now() - make_interval(secs => p_lease_seconds));
  select * into v_log from public.stripe_webhook_logs where event_id = p_event_id;
  return query select (v_log.status = 'pending' and v_log.claim_token = p_claim_token), v_log.status;
end;
$$;

create or replace function public.finish_stripe_webhook(p_event_id text, p_claim_token uuid, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.stripe_webhook_logs set status = p_status, processed_at = case when p_status = 'processed' then now() else null end, claimed_at = null, claim_token = null
  where event_id = p_event_id and claim_token = p_claim_token and status = 'pending';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

drop function if exists public.apply_stripe_subscription_event(uuid, text, text, text, timestamptz, timestamptz, timestamptz, text, boolean);

create or replace function public.apply_stripe_subscription_event(
  p_company_account_id uuid, p_subscription_id text, p_status text, p_price_id text,
  p_period_end timestamptz, p_cancel_at timestamptz, p_event_created timestamptz, p_event_id text, p_claim_token uuid, p_deleted boolean default false
)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not exists (select 1 from public.stripe_webhook_logs where event_id = p_event_id and claim_token = p_claim_token and status = 'pending') then
    raise exception 'Webhook lease is not active';
  end if;
  update public.company_accounts
  set stripe_subscription_id = case when p_deleted then null else p_subscription_id end,
      stripe_price_id = case when p_deleted then stripe_price_id else p_price_id end,
      plan_status = case when p_deleted then 'expired' else p_status end,
      subscription_cancel_at = case when p_deleted then subscription_cancel_at else p_cancel_at end,
      subscription_renewed_at = case when p_deleted then subscription_renewed_at else p_period_end end,
      stripe_subscription_event_created_at = p_event_created,
      stripe_subscription_event_id = p_event_id
  where id = p_company_account_id
    and (stripe_subscription_event_created_at is null
      or p_event_created > stripe_subscription_event_created_at
      or (p_event_created = stripe_subscription_event_created_at and coalesce(p_event_id, '') > coalesce(stripe_subscription_event_id, '')))
    and (not p_deleted or stripe_subscription_id = p_subscription_id or stripe_subscription_id is null);
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.claim_stripe_webhook(text, text, jsonb, uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_stripe_webhook(text, uuid, text) from public, anon, authenticated;
revoke all on function public.apply_stripe_subscription_event(uuid, text, text, text, timestamptz, timestamptz, timestamptz, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook(text, text, jsonb, uuid, integer) to service_role;
grant execute on function public.finish_stripe_webhook(text, uuid, text) to service_role;
grant execute on function public.apply_stripe_subscription_event(uuid, text, text, text, timestamptz, timestamptz, timestamptz, text, uuid, boolean) to service_role;
revoke all on function public.claim_stripe_subscription_reconciliation(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_stripe_subscription_reconciliation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reconcile_stripe_subscription_state(uuid, text, uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_stripe_subscription_reconciliation(uuid, uuid, integer) to service_role;
grant execute on function public.release_stripe_subscription_reconciliation(uuid, uuid) to service_role;
grant execute on function public.reconcile_stripe_subscription_state(uuid, text, uuid, uuid, text, text, text, timestamptz, timestamptz) to service_role;

create index if not exists idx_stripe_webhook_logs_event_id
  on public.stripe_webhook_logs(event_id);

create index if not exists idx_stripe_webhook_logs_status
  on public.stripe_webhook_logs(status);

-- RLS for webhook logs (admin only, or we keep this internal)
alter table public.stripe_webhook_logs enable row level security;

drop policy if exists "Webhook logs are internal only" on public.stripe_webhook_logs;
create policy "Webhook logs are internal only"
  on public.stripe_webhook_logs
  for select
  using (false); -- No user reads this
