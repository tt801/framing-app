-- Block 3B: persistent checkout coordination and founder reservations.
begin;

create table if not exists public.stripe_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  company_account_id uuid not null references public.company_accounts(id) on delete cascade,
  price_id text not null,
  idempotency_key text not null unique,
  session_id text unique,
  session_url text,
  customer_id text,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  founder_reserved boolean not null default false,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.stripe_checkout_attempts add column if not exists session_url text;
alter table public.stripe_checkout_attempts add column if not exists customer_id text;

create unique index if not exists idx_checkout_attempt_open_account_price
  on public.stripe_checkout_attempts(company_account_id, price_id)
  where status = 'pending';
create index if not exists idx_checkout_attempt_founder_reservations
  on public.stripe_checkout_attempts(founder_reserved, status, expires_at);

drop function if exists public.begin_stripe_checkout(uuid,text,text,boolean,integer);
create or replace function public.begin_stripe_checkout(
  p_company_account_id uuid, p_price_id text, p_idempotency_key text, p_is_founder boolean, p_founder_max integer
)
returns table(allowed boolean, reason text, attempt_id uuid, existing_session_id text, existing_session_url text, idempotency_key text, founder_reserved boolean)
language plpgsql security definer set search_path = public as $$
declare v_attempt public.stripe_checkout_attempts; v_completed integer; v_reserved integer;
begin
  if not exists (select 1 from public.company_accounts where id=p_company_account_id) then return query select false,'Account not found',null::uuid,null::text,null::text,null::text,false; return; end if;
  if not p_is_founder and exists (select 1 from public.company_accounts where id=p_company_account_id and stripe_subscription_id is not null and plan_status in ('active','trialing','past_due')) then
    return query select false,'An active subscription already exists; use billing management',null::uuid,null::text,null::text,null::text,false; return;
  end if;
  if p_is_founder and exists (select 1 from public.company_accounts where id=p_company_account_id and stripe_price_id='founder_lifetime') then
    return query select false,'Founder access already exists; use billing management',null::uuid,null::text,null::text,null::text,false; return;
  end if;
    select a.* into v_attempt from public.stripe_checkout_attempts a where a.company_account_id=p_company_account_id and a.price_id=p_price_id and a.status='pending' for update;
    if found and v_attempt.expires_at > now() then return query select true,null,v_attempt.id,v_attempt.session_id,v_attempt.session_url,v_attempt.idempotency_key,v_attempt.founder_reserved; return; end if;
    if found then return query select false,'Stripe session status must be confirmed before releasing this attempt',v_attempt.id,v_attempt.session_id,v_attempt.session_url,v_attempt.idempotency_key,v_attempt.founder_reserved; return; end if;
  if found then return query select true,null,v_attempt.id,v_attempt.session_id,v_attempt.session_url,v_attempt.idempotency_key,v_attempt.founder_reserved; return; end if;
  select a.* into v_attempt from public.stripe_checkout_attempts a where a.idempotency_key=p_idempotency_key and a.status='failed' for update;
  if found then
    update public.stripe_checkout_attempts set status='pending', founder_reserved=p_is_founder, expires_at=now()+interval '24 hours', session_id=null, completed_at=null where id=v_attempt.id returning * into v_attempt;
    return query select true,null,v_attempt.id,null::text,null::text,v_attempt.idempotency_key,v_attempt.founder_reserved; return;
  end if;
  if p_is_founder then
    select count(*) into v_completed from public.company_accounts where stripe_price_id='founder_lifetime';
    select count(*) into v_reserved from public.stripe_checkout_attempts a where a.founder_reserved and a.status='pending';
    if v_completed + v_reserved >= p_founder_max then return query select false,'Founder plan is sold out',null::uuid,null::text,null::text,null::text,false; return; end if;
  end if;
  insert into public.stripe_checkout_attempts(company_account_id,price_id,idempotency_key,founder_reserved,expires_at)
  values (p_company_account_id,p_price_id,p_idempotency_key,p_is_founder,now()+interval '24 hours') returning * into v_attempt;
  return query select true,null,v_attempt.id,null::text,null::text,v_attempt.idempotency_key,v_attempt.founder_reserved;
end;
$$;

create or replace function public.expire_stripe_checkout_attempt(p_attempt_id uuid, p_company_account_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.stripe_checkout_attempts set status='failed', founder_reserved=false
  where id=p_attempt_id and company_account_id=p_company_account_id and status='pending';
  get diagnostics v_count = row_count;
  return v_count=1;
end;
$$;

drop function if exists public.save_stripe_checkout_session(uuid,uuid,text,timestamptz);
drop function if exists public.save_stripe_checkout_session(uuid,uuid,text,text,timestamptz);
create or replace function public.save_stripe_checkout_session(p_attempt_id uuid, p_company_account_id uuid, p_session_id text, p_session_url text, p_customer_id text, p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.stripe_checkout_attempts set session_id=p_session_id, session_url=p_session_url, customer_id=p_customer_id, expires_at=least(expires_at,p_expires_at)
  where id=p_attempt_id and company_account_id=p_company_account_id and status='pending';
  get diagnostics v_count=row_count; return v_count=1;
end;
$$;

drop function if exists public.complete_founder_checkout(uuid,text,text);
create or replace function public.complete_founder_checkout(p_company_account_id uuid, p_session_id text, p_customer_id text, p_founder_price_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if exists (select 1 from public.stripe_checkout_attempts where company_account_id=p_company_account_id and session_id=p_session_id and status='completed') then return true; end if;
  update public.stripe_checkout_attempts set status='completed', completed_at=now() where company_account_id=p_company_account_id and session_id=p_session_id and customer_id=p_customer_id and price_id=p_founder_price_id and status='pending';
  get diagnostics v_count=row_count; if v_count <> 1 then return false; end if;
  update public.company_accounts set plan_status='active', stripe_price_id='founder_lifetime', stripe_customer_id=coalesce(p_customer_id,stripe_customer_id), subscription_renewed_at=now()+interval '100 years' where id=p_company_account_id;
  get diagnostics v_count=row_count; return v_count=1;
end;
$$;

revoke all on function public.expire_stripe_checkout_attempt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.begin_stripe_checkout(uuid,text,text,boolean,integer) from public,anon,authenticated;
revoke all on function public.save_stripe_checkout_session(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_founder_checkout(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.begin_stripe_checkout(uuid,text,text,boolean,integer) to service_role;
grant execute on function public.expire_stripe_checkout_attempt(uuid,uuid) to service_role;
grant execute on function public.save_stripe_checkout_session(uuid,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.complete_founder_checkout(uuid,text,text,text) to service_role;

commit;