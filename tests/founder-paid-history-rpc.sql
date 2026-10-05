-- Run only on disposable PostgreSQL initialized with the project billing migrations.
-- Two-connection final-slot race is exercised separately by
-- tests/founder-final-slot-race.py against the disposable local database.
-- Every fixture and effect rolls back; no production connection is permitted.
begin;
insert into auth.users(id,email) values
('10000000-0000-4000-8000-000000000001','one@example.invalid'),
('10000000-0000-4000-8000-000000000002','two@example.invalid'),
('10000000-0000-4000-8000-000000000003','three@example.invalid'),
('10000000-0000-4000-8000-000000000004','four@example.invalid');
-- Legacy accounts must stay unknown, even an apparently new trial.
insert into public.company_accounts(id,owner_user_id,plan_status,stripe_customer_id,trial_started_at,trial_ends_at)
 values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','trialing','cus-test-a',now()-interval '1 day',now()+interval '13 days'),
        ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','trialing','cus-test-b',now()-interval '1 day',now()+interval '13 days'),
        ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','trialing',null,now()-interval '1 day',now()+interval '13 days');
DO $$ begin
 if (select count(*) from public.company_accounts where has_ever_paid_recurring is null) <> 3 then raise exception 'legacy history backfilled unsafely'; end if;
end $$;
-- Legacy entry points must never admit an unreserved Founder payment.
DO $$ declare r record; begin
 select * into r from public.begin_stripe_checkout('20000000-0000-4000-8000-000000000001','price-f','key-legacy',true,1);
 if r.allowed then raise exception 'legacy Founder begin bypassed reservation v2'; end if;
 if public.complete_founder_checkout('20000000-0000-4000-8000-000000000001','cs-legacy','cus-test-a','price-f')
 then raise exception 'legacy Founder completion succeeded'; end if;
end $$;
DO $$ declare r record; begin
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000001','price-f','key-null',true,1);
 if r.allowed then raise exception 'unknown history eligible'; end if;
 begin
  update public.company_accounts set stripe_price_id='founder_lifetime',plan_status='active'
   where id='20000000-0000-4000-8000-000000000001';
  raise exception 'legacy direct Founder write bypassed reservation';
 exception when others then
  if sqlerrm <> 'Founder completion requires a matching completed reservation' then raise; end if;
 end;
 if (select stripe_price_id from public.company_accounts where id='20000000-0000-4000-8000-000000000001') is not null
 then raise exception 'legacy direct Founder write persisted'; end if;
 begin
  insert into public.company_accounts(id,owner_user_id,stripe_price_id)
  values ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','founder_lifetime');
  raise exception 'direct Founder insert bypassed reservation';
 exception when others then
  if sqlerrm <> 'Founder completion requires a matching completed reservation' then raise; end if;
 end;
end $$;
DO $$ declare r record; begin
 select * into r from public.begin_stripe_checkout('20000000-0000-4000-8000-000000000003','price-recurring','key-legacy-recurring',false,1);
 if not r.allowed or r.founder_reserved then raise exception 'legacy recurring checkout was broken'; end if;
end $$;
-- Fresh signup under the authenticated JWT creates positively known FALSE history.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
insert into public.company_accounts(id,owner_user_id,has_ever_paid_recurring,plan_status)
 values ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',true,'active');
DO $$ begin
 if not exists (select 1 from public.company_accounts where id='20000000-0000-4000-8000-000000000004'
   and has_ever_paid_recurring=false and plan_status='trialing' and trial_ends_at>now()) then
   raise exception 'new authenticated trial not verified false'; end if;
end $$;
select set_config('request.jwt.claim.role','service_role',true);
update public.company_accounts set has_ever_paid_recurring=false where id in
 ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002');
DO $$ declare r record; begin
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000001','price-f','key-a',true,1);
 if not r.allowed or not r.founder_reserved then raise exception 'eligible trial did not reserve capacity'; end if;
 if (select count(*) from public.company_accounts where stripe_price_id='founder_lifetime')<>0 then raise exception 'checkout start consumed slot'; end if;
 if (select has_ever_paid_recurring from public.company_accounts where id='20000000-0000-4000-8000-000000000001') is distinct from false
 then raise exception 'Checkout start mutated recurring paid history'; end if;
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000001','price-f','key-other-request',true,1);
 if r.allowed then raise exception 'second same-account request can release first creator reservation on failure'; end if;
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000002','price-f','key-b',true,1);
 if r.allowed then raise exception 'second checkout obtained the reserved final slot'; end if;
end $$;
DO $$ declare attempt uuid; expected_expiry timestamptz := now()+interval '50 minutes'; begin
 select id into attempt from public.stripe_checkout_attempts where idempotency_key='key-a';
 if not public.save_stripe_checkout_session(attempt,'20000000-0000-4000-8000-000000000001',
   'cs-a','https://checkout.stripe.test/a','cus-test-a',expected_expiry) then
   raise exception 'Stripe session binding failed'; end if;
 if (select expires_at from public.stripe_checkout_attempts where id=attempt) <> expected_expiry then
   raise exception 'actual Stripe expiry did not replace provisional expiry'; end if;
end $$;
update public.stripe_checkout_attempts set expires_at=now()-interval '1 hour' where idempotency_key='key-a';
update public.company_accounts set trial_ends_at=now()-interval '1 hour' where id='20000000-0000-4000-8000-000000000001';
DO $$ begin
 if not public.complete_founder_checkout_v2('20000000-0000-4000-8000-000000000001','cs-a','cus-test-a','price-f',1)
  then raise exception 'first paid Founder denied'; end if;
 if not public.complete_founder_checkout_v2('20000000-0000-4000-8000-000000000001','cs-a','cus-test-a','price-f',1)
  then raise exception 'duplicate completion not idempotent'; end if;
 if public.complete_founder_checkout_v2('20000000-0000-4000-8000-000000000002','cs-b','cus-test-b','price-f',1)
  then raise exception 'unreserved company completed Founder'; end if;
 if (select count(*) from public.company_accounts where stripe_price_id='founder_lifetime')<>1 then raise exception 'completion count wrong'; end if;
 if (select count(*) from public.stripe_checkout_attempts where status='completed')<>1 then raise exception 'duplicate marked another completion'; end if;
end $$;
-- A separate rollback-contained case exercises payment before Stripe expiry.
savepoint founder_within_expiry;
DO $$ declare r record; begin
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000002','price-f','key-within',true,2);
 if not r.allowed then raise exception 'available second slot was denied'; end if;
 if not public.save_stripe_checkout_session(r.attempt_id,'20000000-0000-4000-8000-000000000002',
   'cs-within','https://checkout.stripe.test/within','cus-test-b',now()+interval '35 minutes')
 then raise exception 'live Stripe session was not bound'; end if;
 update public.company_accounts set has_ever_paid_recurring=true, stripe_subscription_id='sub-race'
   where id='20000000-0000-4000-8000-000000000002';
 if not public.complete_founder_checkout_v2('20000000-0000-4000-8000-000000000002','cs-within','cus-test-b','price-f',2)
 then raise exception 'successful payment within reservation denied'; end if;
end $$;
rollback to savepoint founder_within_expiry;
DO $$ declare r record; begin
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000001','price-recurring','key-founder-recurring',false,1);
 if r.allowed then raise exception 'Founder started another recurring checkout'; end if;
end $$;
DO $$ declare r record; begin
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000002','price-f','key-b',true,2);
 if not r.allowed or not r.founder_reserved then raise exception 'remaining capacity not reservable'; end if;
end $$;
update public.stripe_checkout_attempts set session_id='cs-b',customer_id='cus-test-b',expires_at=now()-interval '1 hour' where idempotency_key='key-b';
DO $$ begin
 if not public.expire_stripe_checkout_attempt((select id from public.stripe_checkout_attempts where idempotency_key='key-b'),
  '20000000-0000-4000-8000-000000000002') then raise exception 'verified expired reservation not released'; end if;
 if public.complete_founder_checkout_v2('20000000-0000-4000-8000-000000000002','cs-b','cus-test-b','price-f',2)
 then raise exception 'late webhook converted a released reservation'; end if;
end $$;
DO $$ declare r record; begin
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000002','price-f','key-after-expiry',true,2);
 if not r.allowed then raise exception 'expired reservation did not free capacity'; end if;
 update public.stripe_checkout_attempts set expires_at=now()-interval '1 hour' where id=r.attempt_id;
 if not public.expire_stripe_checkout_attempt(r.attempt_id,'20000000-0000-4000-8000-000000000002')
 then raise exception 'failed Checkout creation did not release provisional reservation'; end if;
end $$;
DO $$ declare r record; begin
 update public.company_accounts set plan_status='active' where id='20000000-0000-4000-8000-000000000002';
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000002','price-f','key-active-false',true,9);
 if r.allowed then raise exception 'active recurring with FALSE history eligible'; end if;
 update public.company_accounts set plan_status='trialing', trial_ends_at=now()-interval '1 second'
 where id='20000000-0000-4000-8000-000000000002';
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000002','price-f','key-expired-false',true,9);
 if r.allowed then raise exception 'expired initial trial eligible'; end if;
end $$;
-- Reconciliation must not erase an already completed Founder marker and free a slot.
insert into public.stripe_webhook_logs(event_id,event_type,payload,status,claim_token)
values ('evt-reconcile','customer.subscription.deleted','{}','pending','30000000-0000-4000-8000-000000000004');
insert into public.stripe_subscription_reconciliation_locks(company_account_id,lease_token)
values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000005');
DO $$ begin
 perform public.reconcile_stripe_subscription_state('20000000-0000-4000-8000-000000000001',
   'evt-reconcile','30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000005',
   null,'expired',null,null,null);
 if (select stripe_price_id from public.company_accounts where id='20000000-0000-4000-8000-000000000001') is distinct from 'founder_lifetime'
 then raise exception 'reconciliation freed a completed Founder slot'; end if;
end $$;
-- Never record history for abandoned Checkout, subscription status, or pending invoice.
update public.company_accounts set stripe_customer_id='cus-test-c' where id='20000000-0000-4000-8000-000000000003';
insert into public.stripe_webhook_logs(event_id,event_type,payload,status,claim_token)
 values ('evt-pending','invoice.payment_succeeded','{"object":{"status":"open","amount_paid":0,"customer":"cus-test-c","parent":{"subscription_details":{"subscription":"sub-test"}}}}','pending','30000000-0000-4000-8000-000000000001');
DO $$ begin
 begin
  perform public.record_paid_recurring_invoice('20000000-0000-4000-8000-000000000003','evt-pending','30000000-0000-4000-8000-000000000001','cus-test-c','sub-test');
  raise exception 'pending invoice accepted';
 exception when others then
  if sqlerrm='pending invoice accepted' then raise; end if;
 end;
 if (select has_ever_paid_recurring from public.company_accounts where id='20000000-0000-4000-8000-000000000003') is not null
 then raise exception 'pending invoice mutated history'; end if;
end $$;
insert into public.stripe_webhook_logs(event_id,event_type,payload,status,claim_token)
 values ('evt-paid','invoice.payment_succeeded','{"object":{"status":"paid","amount_paid":500,"customer":"cus-test-c","parent":{"subscription_details":{"subscription":"sub-test"}}}}','pending','30000000-0000-4000-8000-000000000002');
DO $$ begin
 if not public.record_paid_recurring_invoice('20000000-0000-4000-8000-000000000003','evt-paid','30000000-0000-4000-8000-000000000002','cus-test-c','sub-test') then raise exception 'verified paid invoice not recorded'; end if;
 if (select has_ever_paid_recurring from public.company_accounts where id='20000000-0000-4000-8000-000000000003') is distinct from true then raise exception 'paid history not true'; end if;
end $$;
update public.company_accounts set stripe_customer_id='cus-test-d' where id='20000000-0000-4000-8000-000000000004';
-- A failed invoice and a positive but mismatched identity cannot set history.
insert into public.stripe_webhook_logs(event_id,event_type,payload,status,claim_token)
 values ('evt-failed','invoice.payment_failed','{"object":{"status":"open","amount_paid":500,"customer":"cus-test-d","parent":{"subscription_details":{"subscription":"sub-test-d"}}}}','pending','30000000-0000-4000-8000-000000000006');
DO $$ begin
 begin
  perform public.record_paid_recurring_invoice('20000000-0000-4000-8000-000000000004','evt-failed','30000000-0000-4000-8000-000000000006','cus-test-d','sub-test-d');
  raise exception 'failed invoice accepted';
 exception when others then if sqlerrm='failed invoice accepted' then raise; end if; end;
 if (select has_ever_paid_recurring from public.company_accounts where id='20000000-0000-4000-8000-000000000004') is distinct from false
 then raise exception 'failed payment mutated paid history'; end if;
end $$;
insert into public.stripe_webhook_logs(event_id,event_type,payload,status,claim_token)
 values ('evt-paid-new','invoice.payment_succeeded','{"object":{"status":"paid","amount_paid":500,"customer":"cus-test-d","parent":{"subscription_details":{"subscription":"sub-test-d"}}}}','pending','30000000-0000-4000-8000-000000000003');
DO $$ begin
 begin
  perform public.record_paid_recurring_invoice('20000000-0000-4000-8000-000000000004','evt-paid-new',
    '30000000-0000-4000-8000-000000000003','cus-test-d','sub-wrong');
  raise exception 'mismatched subscription accepted';
 exception when others then if sqlerrm='mismatched subscription accepted' then raise; end if; end;
 if (select has_ever_paid_recurring from public.company_accounts where id='20000000-0000-4000-8000-000000000004') is distinct from false
 then raise exception 'mismatched invoice mutated history'; end if;
end $$;
DO $$ begin
 if not public.record_paid_recurring_invoice('20000000-0000-4000-8000-000000000004','evt-paid-new','30000000-0000-4000-8000-000000000003','cus-test-d','sub-test-d') then
   raise exception 'new FALSE invoice not recorded'; end if;
 if (select has_ever_paid_recurring from public.company_accounts where id='20000000-0000-4000-8000-000000000004') is distinct from true then
   raise exception 'new FALSE history did not become TRUE after paid invoice'; end if;
end $$;
DO $$ begin
 begin
  update public.company_accounts set has_ever_paid_recurring=false where id='20000000-0000-4000-8000-000000000003';
  raise exception 'true history reset';
 exception when others then if sqlerrm='true history reset' then raise; end if;
 end;
 if (select has_ever_paid_recurring from public.company_accounts where id='20000000-0000-4000-8000-000000000003') is distinct from true
 then raise exception 'true paid history did not survive rejected reset'; end if;
end $$;
DO $$ declare r record; begin
 update public.company_accounts set plan_status='past_due' where id='20000000-0000-4000-8000-000000000003';
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000003','price-f','key-paid',true,9);
 if r.allowed then raise exception 'past-due paid history eligible'; end if;
 update public.company_accounts set plan_status='expired' where id='20000000-0000-4000-8000-000000000003';
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000003','price-f','key-former',true,9);
 if r.allowed then raise exception 'former paid history eligible'; end if;
 update public.company_accounts set plan_status='active' where id='20000000-0000-4000-8000-000000000003';
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000003','price-f','key-active',true,9);
 if r.allowed then raise exception 'active paid history eligible'; end if;
 update public.company_accounts set trial_started_at=now()-interval '15 days',trial_ends_at=now()+interval '2 days'
  where id='20000000-0000-4000-8000-000000000002';
 select * into r from public.begin_stripe_checkout_v2('20000000-0000-4000-8000-000000000002','price-f','key-extended',true,9);
 if r.allowed then raise exception 'extended trial eligible after original window'; end if;
end $$;
-- Role test: browser cannot write protected column, even when already TRUE.
reset role;
set role authenticated;
DO $$ begin
 if has_column_privilege('authenticated','public.company_accounts','has_ever_paid_recurring','UPDATE')
    or has_column_privilege('authenticated','public.company_accounts','has_ever_paid_recurring','INSERT')
    or has_function_privilege('authenticated','public.complete_founder_checkout_v2(uuid,text,text,text,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.complete_founder_checkout(uuid,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.begin_stripe_checkout(uuid,text,text,boolean,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.begin_stripe_checkout_v2(uuid,text,text,boolean,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.expire_stripe_checkout_attempt(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.save_stripe_checkout_session(uuid,uuid,text,text,text,timestamptz)','EXECUTE')
    or has_function_privilege('anon','public.begin_stripe_checkout_v2(uuid,text,text,boolean,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.record_paid_recurring_invoice(uuid,text,uuid,text,text)','EXECUTE') then
  raise exception 'browser role has column write'; end if;
 begin
  update public.company_accounts set has_ever_paid_recurring=null where id='20000000-0000-4000-8000-000000000003';
  raise exception 'browser reset accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
