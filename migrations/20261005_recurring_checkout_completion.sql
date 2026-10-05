-- Additive ledger completion. Apply to the intended project only after review;
-- never use the browser role to complete a Checkout attempt.
begin;
create or replace function public.complete_recurring_checkout(
  p_company_account_id uuid, p_session_id text, p_customer_id text,
  p_subscription_id text, p_event_id text, p_claim_token uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_session jsonb; v_account public.company_accounts%rowtype; v_attempt public.stripe_checkout_attempts%rowtype;
begin
  -- Only a currently claimed, signature-verified webhook may attest to payment.
  select payload->'object' into v_session from public.stripe_webhook_logs
   where event_id=p_event_id and event_type='checkout.session.completed'
     and claim_token=p_claim_token and status='pending';
  if v_session is null or v_session->>'id' is distinct from p_session_id
     or v_session->>'mode' is distinct from 'subscription'
     or v_session->>'status' is distinct from 'complete'
     or v_session->>'payment_status' is distinct from 'paid'
     or v_session->>'customer' is distinct from p_customer_id
     or v_session->>'subscription' is distinct from p_subscription_id
     or nullif(p_subscription_id,'') is null then return false; end if;
  select * into v_account from public.company_accounts where id=p_company_account_id for update;
  if not found or v_account.stripe_customer_id is distinct from p_customer_id
     or v_account.stripe_subscription_id is distinct from p_subscription_id
     or v_account.stripe_price_id is null or v_account.stripe_price_id='founder_lifetime'
     then return false; end if;
  select * into v_attempt from public.stripe_checkout_attempts
   where company_account_id=p_company_account_id and session_id=p_session_id for update;
  if not found or v_attempt.customer_id is distinct from p_customer_id
     or v_attempt.price_id is distinct from v_account.stripe_price_id
     or v_attempt.founder_reserved then return false; end if;
  if v_attempt.status='completed' then return true; end if;
  if v_attempt.status<>'pending' then return false; end if;
  update public.stripe_checkout_attempts
     set status='completed', completed_at=now()
   where id=v_attempt.id;
  return true;
end;
$$;
revoke all on function public.complete_recurring_checkout(uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.complete_recurring_checkout(uuid,text,text,text,text,uuid) to service_role;
commit;
