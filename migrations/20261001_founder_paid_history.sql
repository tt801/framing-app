-- Proposed EXPAND migration. No existing live billing state; do not run against
-- production without approval. Configure Stripe Live only after sandbox testing,
-- the v2 application is deployed, and the old webhook instances have drained.
-- Preserve legacy RPC identities until a separately approved CONTRACT migration.
begin;

-- No default or blanket legacy backfill: historical paid status cannot be inferred
-- from present subscription/customer/plan fields or Checkout attempts.
alter table public.company_accounts
  add column if not exists has_ever_paid_recurring boolean;

-- The existing signup guard creates fresh, authenticated trial accounts. Extend it
-- rather than trusting values supplied by a browser or changing legacy rows.
create or replace function public.protect_company_account_client_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.stripe_price_id = 'founder_lifetime' then
    raise exception 'Founder completion requires a matching completed reservation';
  end if;
  if tg_op = 'UPDATE' and old.has_ever_paid_recurring is true
     and new.has_ever_paid_recurring is distinct from true then
    raise exception 'Paid recurring history cannot be cleared';
  end if;
  if tg_op = 'UPDATE' and old.stripe_price_id is distinct from 'founder_lifetime'
     and new.stripe_price_id = 'founder_lifetime'
     and not exists (
       select 1 from public.stripe_checkout_attempts a
       where a.company_account_id = new.id and a.customer_id = new.stripe_customer_id
         and a.session_id is not null and a.status = 'completed'
         and not a.founder_reserved
     ) then
    -- Deployed legacy webhooks write this marker directly, without a reservation.
    -- Never let that service-role write bypass the v2 capacity coordinator.
    raise exception 'Founder completion requires a matching completed reservation';
  end if;
  if tg_op = 'UPDATE' and old.stripe_price_id = 'founder_lifetime' then
    -- A delayed subscription reconciliation must not erase a completed purchase
    -- and release its counted slot. Corrective removal requires a reviewed DDL.
    new.stripe_price_id = old.stripe_price_id;
    new.plan_status = old.plan_status;
    new.subscription_renewed_at = old.subscription_renewed_at;
    new.stripe_subscription_id = old.stripe_subscription_id;
  end if;
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
      new.has_ever_paid_recurring = false;
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
      new.has_ever_paid_recurring = old.has_ever_paid_recurring;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_company_account_client_fields() from public, anon, authenticated;
revoke all (has_ever_paid_recurring) on public.company_accounts from public, anon, authenticated;
-- Existing client roles have neither whole-table nor column UPDATE/INSERT grants;
-- the guard above also protects writes through definer functions with client JWTs.

-- This RPC is callable only by the trusted webhook service, after signature
-- verification and a claimed, pending invoice.payment_succeeded event. Inspect
-- the stored signed event as well as the caller's account/customer/subscription
-- correlation; a Checkout or subscription status is never proof of payment.
create or replace function public.record_paid_recurring_invoice(
  p_company_account_id uuid, p_event_id text, p_claim_token uuid,
  p_customer_id text, p_subscription_id text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_invoice jsonb;
begin
  select payload->'object' into v_invoice
    from public.stripe_webhook_logs
    where event_id = p_event_id and event_type = 'invoice.payment_succeeded'
      and claim_token = p_claim_token and status = 'pending';
  if v_invoice is null or v_invoice->>'status' <> 'paid'
     or coalesce((v_invoice->>'amount_paid')::bigint, 0) <= 0
     or v_invoice->>'customer' is distinct from p_customer_id
     or v_invoice #>> '{parent,subscription_details,subscription}' is distinct from p_subscription_id
     or nullif(p_subscription_id, '') is null then
    raise exception 'Verified paid recurring invoice required';
  end if;
  update public.company_accounts
     set has_ever_paid_recurring = true
   where id = p_company_account_id and stripe_customer_id = p_customer_id;
  return found;
end;
$$;
revoke all on function public.record_paid_recurring_invoice(uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_paid_recurring_invoice(uuid,text,uuid,text,text) to service_role;

-- Explicit v2 coordinator: no legacy caller can silently opt into a payable
-- Founder session without the eligibility/reservation contract.
create or replace function public.begin_stripe_checkout_v2(
  p_company_account_id uuid, p_price_id text, p_idempotency_key text, p_is_founder boolean, p_founder_max integer
) returns table(allowed boolean, reason text, attempt_id uuid, existing_session_id text, existing_session_url text, idempotency_key text, founder_reserved boolean)
language plpgsql security definer set search_path = public as $$
declare v_account public.company_accounts; v_attempt public.stripe_checkout_attempts; v_used bigint;
begin
  -- Every operation changing Founder capacity uses the same transaction lock.
  perform pg_advisory_xact_lock(684219, 101);
  select * into v_account from public.company_accounts where id = p_company_account_id for update;
  if not found then return query select false,'Account not found',null::uuid,null::text,null::text,null::text,false; return; end if;
  if p_is_founder then
    if p_founder_max is null or p_founder_max < 1 then
      return query select false,'Invalid Founder capacity',null::uuid,null::text,null::text,null::text,false; return;
    end if;
    if v_account.plan_status <> 'trialing' or v_account.has_ever_paid_recurring is distinct from false
       or v_account.stripe_price_id = 'founder_lifetime'
       or v_account.stripe_subscription_id is not null
       or v_account.trial_started_at > now() or v_account.trial_ends_at <= now()
       or v_account.trial_started_at + interval '14 days' <= now() then
      return query select false,'Founder requires an unexpired original trial with verified never-paid history',null::uuid,null::text,null::text,null::text,false; return;
    end if;
    if exists (select 1 from public.stripe_checkout_attempts a where a.company_account_id=p_company_account_id
      and a.status='pending' and not a.founder_reserved) then
      return query select false,'A recurring Checkout must be resolved first',null::uuid,null::text,null::text,null::text,false; return;
    end if;
  elsif v_account.stripe_price_id = 'founder_lifetime' then
    return query select false,'Founder lifetime access already exists',null::uuid,null::text,null::text,null::text,false; return;
  elsif exists (select 1 from public.stripe_checkout_attempts a where a.company_account_id=p_company_account_id
    and a.status='pending' and a.founder_reserved) then
    return query select false,'A Founder Checkout must be resolved first',null::uuid,null::text,null::text,null::text,false; return;
  elsif v_account.stripe_subscription_id is not null and v_account.plan_status in ('active','trialing','past_due') then
    return query select false,'An active subscription already exists; use billing management',null::uuid,null::text,null::text,null::text,false; return;
  end if;
  select a.* into v_attempt from public.stripe_checkout_attempts a
    where a.company_account_id=p_company_account_id and a.price_id=p_price_id and a.status='pending' for update;
  if found and v_attempt.expires_at > now() then
    if p_is_founder and v_attempt.session_id is null and v_attempt.idempotency_key <> p_idempotency_key then
      return query select false,'Founder Checkout creation is in progress',v_attempt.id,null::text,null::text,v_attempt.idempotency_key,true; return;
    end if;
    return query select true,null::text,v_attempt.id,v_attempt.session_id,v_attempt.session_url,v_attempt.idempotency_key,v_attempt.founder_reserved; return;
  end if;
  if found then
    return query select false,'Stripe session status must be confirmed before releasing this attempt',v_attempt.id,v_attempt.session_id,v_attempt.session_url,v_attempt.idempotency_key,v_attempt.founder_reserved; return;
  end if;
  if p_is_founder then
    -- Count even past-dated pending reservations until Stripe terminal state is
    -- verified. A paid session can precede its delayed webhook indefinitely.
    select (select count(*) from public.company_accounts where stripe_price_id='founder_lifetime')
         + (select count(*) from public.stripe_checkout_attempts a where a.status='pending' and a.founder_reserved)
      into v_used;
    if v_used >= p_founder_max then
      return query select false,'Founder plan is sold out',null::uuid,null::text,null::text,null::text,false; return;
    end if;
  end if;
  if not p_is_founder then
    select a.* into v_attempt from public.stripe_checkout_attempts a
      where a.idempotency_key=p_idempotency_key and a.status='failed' for update;
  else
    v_attempt := null;
  end if;
  if v_attempt.id is not null then
    update public.stripe_checkout_attempts set status='pending', founder_reserved=p_is_founder,
      expires_at=now()+interval '40 minutes',session_id=null,session_url=null,customer_id=null,completed_at=null
      where id=v_attempt.id and company_account_id=p_company_account_id and price_id=p_price_id returning * into v_attempt;
    if not found then raise exception 'Checkout idempotency key belongs to another attempt'; end if;
    return query select true,null::text,v_attempt.id,null::text,null::text,v_attempt.idempotency_key,v_attempt.founder_reserved; return;
  end if;
  insert into public.stripe_checkout_attempts(company_account_id,price_id,idempotency_key,founder_reserved,expires_at)
    values (p_company_account_id,p_price_id,p_idempotency_key,p_is_founder,now()+interval '40 minutes') returning * into v_attempt;
  return query select true,null::text,v_attempt.id,null::text,null::text,v_attempt.idempotency_key,v_attempt.founder_reserved;
end;
$$;
revoke all on function public.begin_stripe_checkout_v2(uuid,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.begin_stripe_checkout_v2(uuid,text,text,boolean,integer) to service_role;

-- Retain the previous signature for older deployed RPC callers. Only
-- recurring Checkout is delegated to v2; legacy Founder initiation cannot
-- obtain a payable URL without a v2 reservation.
create or replace function public.begin_stripe_checkout(
  p_company_account_id uuid, p_price_id text, p_idempotency_key text, p_is_founder boolean, p_founder_max integer
) returns table(allowed boolean, reason text, attempt_id uuid, existing_session_id text, existing_session_url text, idempotency_key text, founder_reserved boolean)
language plpgsql security definer set search_path = public as $$
begin
  if p_is_founder is distinct from false then
    return query select false,'Founder requires the v2 Checkout coordinator',null::uuid,null::text,null::text,null::text,false;
    return;
  end if;
  return query select * from public.begin_stripe_checkout_v2(
    p_company_account_id,p_price_id,p_idempotency_key,false,p_founder_max
  );
end;
$$;
revoke all on function public.begin_stripe_checkout(uuid,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.begin_stripe_checkout(uuid,text,text,boolean,integer) to service_role;

-- Only call after Stripe confirms the session expired unpaid, or creation
-- failed before a URL was returned. A past timestamp alone is not proof.
create or replace function public.expire_stripe_checkout_attempt(p_attempt_id uuid,p_company_account_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  perform pg_advisory_xact_lock(684219,101);
  update public.stripe_checkout_attempts set status='failed',founder_reserved=false
   where id=p_attempt_id and company_account_id=p_company_account_id and status='pending';
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function public.expire_stripe_checkout_attempt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.expire_stripe_checkout_attempt(uuid,uuid) to service_role;

-- Keep the reservation until Stripe's actual session expiry, not the earlier
-- provisional deadline assigned before calling Stripe.
create or replace function public.save_stripe_checkout_session(
 p_attempt_id uuid,p_company_account_id uuid,p_session_id text,p_session_url text,p_customer_id text,p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  update public.stripe_checkout_attempts
     set session_id=p_session_id,session_url=p_session_url,customer_id=p_customer_id,expires_at=p_expires_at
   where id=p_attempt_id and company_account_id=p_company_account_id and status='pending'
     and session_id is null and p_expires_at > now();
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function public.save_stripe_checkout_session(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_stripe_checkout_session(uuid,uuid,text,text,text,timestamptz) to service_role;

-- The old signature remains present, but cannot fulfil unreserved payments.
-- STATE 1 has no live Stripe products/sessions; do not enable Live until the
-- new handler is serving. Contract removal can happen in a later release.
create or replace function public.complete_founder_checkout(
  p_company_account_id uuid, p_session_id text, p_customer_id text, p_founder_price_id text
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  return false;
end;
$$;
revoke all on function public.complete_founder_checkout(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_founder_checkout(uuid,text,text,text) to service_role;

create or replace function public.complete_founder_checkout_v2(
  p_company_account_id uuid, p_session_id text, p_customer_id text,
  p_founder_price_id text, p_founder_max integer
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_account public.company_accounts; v_attempt public.stripe_checkout_attempts;
begin
  if p_founder_max is null or p_founder_max < 1 or nullif(p_founder_price_id,'') is null then return false; end if;
  -- One transaction-scoped global mutex serializes final-slot completions.
  perform pg_advisory_xact_lock(684219, 101);
  select * into v_account from public.company_accounts where id=p_company_account_id for update;
  if not found or v_account.stripe_customer_id is distinct from p_customer_id then return false; end if;
  select * into v_attempt from public.stripe_checkout_attempts
   where company_account_id=p_company_account_id and session_id=p_session_id
     and customer_id=p_customer_id and price_id=p_founder_price_id for update;
  if not found then return false; end if;
  if v_attempt.status='completed' then
    return v_account.stripe_price_id='founder_lifetime';
  end if;
  -- Eligibility and capacity were secured at reservation time. Never use
  -- current trial end or a second cap check to reject an already paid session.
  if v_attempt.status <> 'pending' or not v_attempt.founder_reserved
     or v_account.stripe_price_id = 'founder_lifetime' then return false; end if;
  -- Mark the specific reservation first so the company trigger can reject
  -- direct legacy service-role writes. Both updates share this RPC transaction:
  -- if entitlement fails, the reservation update rolls back as well.
  update public.stripe_checkout_attempts set status='completed',completed_at=now(),founder_reserved=false
    where id=v_attempt.id;
  update public.company_accounts set plan_status='active',stripe_price_id='founder_lifetime',
    subscription_renewed_at=now()+interval '100 years' where id=p_company_account_id;
  return true;
end;
$$;
revoke all on function public.complete_founder_checkout_v2(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.complete_founder_checkout_v2(uuid,text,text,text,integer) to service_role;

commit;
