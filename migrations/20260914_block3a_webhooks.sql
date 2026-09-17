-- Block 3A: reliable Stripe webhook claims and ordered subscription updates.
begin;

create table if not exists public.stripe_webhook_logs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  company_account_id uuid references public.company_accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  claimed_at timestamptz,
  claim_token uuid,
  attempt_count integer not null default 0
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

create index if not exists idx_stripe_webhook_logs_claim on public.stripe_webhook_logs(status, claimed_at);

create or replace function public.claim_stripe_subscription_reconciliation(p_company_account_id uuid, p_lease_token uuid, p_lease_seconds integer default 300)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.company_accounts where id = p_company_account_id) then return false; end if;
  insert into public.stripe_subscription_reconciliation_locks(company_account_id, lease_token, claimed_at)
  values (p_company_account_id, p_lease_token, now())
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
  get diagnostics v_count = row_count;
  return v_count = 1;
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
  set event_type = excluded.event_type,
      payload = excluded.payload,
      status = 'pending', claimed_at = now(), claim_token = p_claim_token,
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
  update public.stripe_webhook_logs
  set status = p_status, processed_at = case when p_status = 'processed' then now() else null end,
      claimed_at = null, claim_token = null
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
  update public.company_accounts
  set stripe_subscription_id = p_subscription_id, stripe_price_id = p_price_id,
      plan_status = coalesce(p_status, 'expired'), subscription_cancel_at = p_cancel_at,
      subscription_renewed_at = p_period_end
  where id = p_company_account_id;
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

commit;