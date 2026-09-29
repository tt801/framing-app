-- Run with psql -v ON_ERROR_STOP=1 -f tests/counter-helper-privileges.sql
-- against an initialized, disposable local Supabase database AFTER applying the new migration.
-- Never run against production; all fixture writes are rolled back.
\set ON_ERROR_STOP on
begin;
set role postgres;
reset request.jwt.claims;
reset request.jwt.claim.sub;
reset request.jwt.claim.role;

insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('63000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
        'counter-helper-owner@test.local', now(), now(), now());
insert into public.company_accounts (id, owner_user_id, company_name, plan_status, trial_started_at, trial_ends_at)
values ('64000000-0000-4000-8000-000000000001',
        '63000000-0000-4000-8000-000000000001', 'Counter helper test', 'active',
        now(), now() + interval '30 days');

do $$
begin
  if has_function_privilege('anon', 'public.next_invoice_number(uuid,text,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.next_invoice_number(uuid,text,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.next_job_reference(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.next_job_reference(uuid,integer)', 'EXECUTE') then
    raise exception 'A browser role can execute an internal counter helper';
  end if;
  if not has_function_privilege('authenticated', 'public.create_invoice(text,uuid,text,text,jsonb,text,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_job(text,uuid,jsonb,text,text,text,integer)', 'EXECUTE') then
    raise exception 'An intended create RPC lost authenticated access';
  end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform public.next_invoice_number('64000000-0000-4000-8000-000000000001', 'INV-', 1);
    raise exception 'anonymous invoice helper call succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.next_job_reference('64000000-0000-4000-8000-000000000001', null);
    raise exception 'anonymous job helper call succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true),
       set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    perform public.next_invoice_number('64000000-0000-4000-8000-000000000001', 'INV-', 1);
    raise exception 'authenticated invoice helper call succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.next_job_reference('64000000-0000-4000-8000-000000000001', null);
    raise exception 'authenticated job helper call succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

select public.create_invoice('counter-helper-invoice', '64000000-0000-4000-8000-000000000001',
                             null, null, '{}'::jsonb, 'INV-', 1);
select public.create_job('counter-helper-job', '64000000-0000-4000-8000-000000000001',
                         '{}'::jsonb, null, null, null, null);
reset role;
do $$
begin
  if (select invoice_number from public.invoices where id = 'counter-helper-invoice') <> 'INV-1'
     or (select last_seq from public.invoice_number_counters
         where company_account_id = '64000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'guarded invoice creation did not allocate its first number';
  end if;
  if (select ref_no from public.jobs where id = 'counter-helper-job') <> 1001
     or (select last_ref_no from public.job_reference_counters
         where company_account_id = '64000000-0000-4000-8000-000000000001') <> 1001 then
    raise exception 'guarded job creation did not allocate its first reference';
  end if;
end $$;
rollback;
