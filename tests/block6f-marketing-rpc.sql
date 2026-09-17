-- Block 6F real database authorization checks. Synthetic fixtures are rolled back.
\set ON_ERROR_STOP on
begin;
set role postgres;
reset request.jwt.claims; reset request.jwt.claim.sub; reset request.jwt.claim.role;
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
('6f000000-0000-4000-8000-000000000001','authenticated','authenticated','b6f-owner-a@test.local',now(),now(),now()),
('6f000000-0000-4000-8000-000000000002','authenticated','authenticated','b6f-owner-b@test.local',now(),now(),now()),
('6f000000-0000-4000-8000-000000000003','authenticated','authenticated','b6f-manager@test.local',now(),now(),now()),
('6f000000-0000-4000-8000-000000000004','authenticated','authenticated','b6f-sales@test.local',now(),now(),now()),
('6f000000-0000-4000-8000-000000000005','authenticated','authenticated','b6f-workshop@test.local',now(),now(),now()),
('6f000000-0000-4000-8000-000000000006','authenticated','authenticated','b6f-staff@test.local',now(),now(),now()),
('6f000000-0000-4000-8000-000000000007','authenticated','authenticated','b6f-inactive@test.local',now(),now(),now()) on conflict(id) do update set email=excluded.email;
insert into public.company_accounts(id,owner_user_id,company_name,plan_status,trial_started_at,trial_ends_at) values
('6f100000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000001','Block 6F A','active',now(),now()+interval '30 days'),
('6f100000-0000-4000-8000-000000000002','6f000000-0000-4000-8000-000000000002','Block 6F B','active',now(),now()+interval '30 days') on conflict(id) do update set plan_status='active',trial_ends_at=now()+interval '30 days';
insert into public.company_members(company_account_id,user_id,email,role,status,joined_at) values
('6f100000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000003','b6f-manager@test.local','manager','active',now()),
('6f100000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000004','b6f-sales@test.local','sales','active',now()),
('6f100000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000005','b6f-workshop@test.local','workshop','active',now()),
('6f100000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000006','b6f-staff@test.local','staff','active',now()),
('6f100000-0000-4000-8000-000000000001','6f000000-0000-4000-8000-000000000007','b6f-inactive@test.local','staff','inactive',now()) on conflict(user_id) do update set company_account_id=excluded.company_account_id,role=excluded.role,status=excluded.status;
insert into public.customers(id,company_account_id,first_name,last_name,email) values('b6f-customer-a','6f100000-0000-4000-8000-000000000001','A','Customer','b6f-a@test.local'),('b6f-customer-b','6f100000-0000-4000-8000-000000000002','B','Customer','b6f-b@test.local');
do $$ begin if (select count(*) from public.company_accounts where id in('6f100000-0000-4000-8000-000000000001','6f100000-0000-4000-8000-000000000002'))<>2 or not public.is_company_account_writable('6f100000-0000-4000-8000-000000000001') then raise exception 'marketing fixtures inactive or missing';end if;end $$;
set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000001',true);
select public.create_marketing_record('b6f-campaign','6f100000-0000-4000-8000-000000000001','campaign','b6f-customer-a','{"name":"Campaign"}');
select public.create_marketing_record('b6f-template','6f100000-0000-4000-8000-000000000001','template',null,'{"name":"Template"}');
select public.create_marketing_record('b6f-log','6f100000-0000-4000-8000-000000000001','submission_log','b6f-customer-a','{"providerAccepted":true,"deliveryStatus":"not-confirmed"}');
do $$ begin if (select count(*) from public.company_marketing_records where company_account_id='6f100000-0000-4000-8000-000000000001')<>3 then raise exception 'owner records missing';end if;end $$;
select public.update_marketing_record('b6f-campaign','6f100000-0000-4000-8000-000000000001','{"name":"Updated"}',1);
do $$ begin begin perform public.update_marketing_record('b6f-campaign','6f100000-0000-4000-8000-000000000001','{"name":"Stale"}',1);raise exception 'stale update accepted';exception when others then if sqlerrm not like '%changed or no longer exists%' then raise;end if;end;if(select payload->>'name' from public.company_marketing_records where id='b6f-campaign')<>'Updated'then raise exception 'stale overwrite';end if;begin perform public.delete_marketing_record('missing','6f100000-0000-4000-8000-000000000001',1);raise exception 'missing delete accepted';exception when others then if sqlerrm not like '%changed or no longer exists%' then raise;end if;end;begin perform public.create_marketing_record('b6f-campaign','6f100000-0000-4000-8000-000000000001','campaign',null,'{"name":"Overwrite"}');raise exception 'duplicate overwrite accepted';exception when unique_violation then null;end;begin perform public.create_marketing_record('b6f-cross-customer','6f100000-0000-4000-8000-000000000001','campaign','b6f-customer-b','{}');raise exception 'cross customer accepted';exception when others then if sqlerrm not like '%customer_id must belong%' then raise;end if;end;end $$;
select set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000003',true);select public.create_marketing_record('b6f-manager','6f100000-0000-4000-8000-000000000001','campaign',null,'{}');
select set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000004',true);select public.create_marketing_record('b6f-sales','6f100000-0000-4000-8000-000000000001','template',null,'{}');
select set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000005',true);select public.create_marketing_record('b6f-workshop','6f100000-0000-4000-8000-000000000001','submission_log',null,'{}');
select set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000006',true);select public.create_marketing_record('b6f-staff','6f100000-0000-4000-8000-000000000001','campaign',null,'{}');
select set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000002',true);do $$ begin if exists(select 1 from public.company_marketing_records where id='b6f-campaign') then raise exception 'unrelated read allowed';end if;begin perform public.create_marketing_record('b6f-cross','6f100000-0000-4000-8000-000000000001','campaign',null,'{}');raise exception 'unrelated write allowed';exception when others then if sqlerrm not like '%not allowed%' then raise;end if;end;end $$;
select set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000007',true);do $$ begin if exists(select 1 from public.company_marketing_records where id='b6f-campaign') then raise exception 'inactive read allowed';end if;begin perform public.create_marketing_record('b6f-inactive','6f100000-0000-4000-8000-000000000001','campaign',null,'{}');raise exception 'inactive write allowed';exception when others then if sqlerrm not like '%not allowed%' then raise;end if;end;end $$;
reset role;set role postgres;reset request.jwt.claims;reset request.jwt.claim.sub;reset request.jwt.claim.role;update public.company_accounts set plan_status='expired',trial_ends_at=now()-interval '1 day' where id='6f100000-0000-4000-8000-000000000001';
do $$ begin if public.is_company_account_writable('6f100000-0000-4000-8000-000000000001') then raise exception 'expired account writable';end if;end $$;
set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','6f000000-0000-4000-8000-000000000001',true);do $$ begin begin perform public.create_marketing_record('b6f-expired','6f100000-0000-4000-8000-000000000001','campaign',null,'{}');raise exception 'expired create allowed';exception when others then if sqlerrm not like '%not allowed%' then raise;end if;end;end $$;
reset role;set local role anon;do $$ begin begin perform public.create_marketing_record('b6f-anon','6f100000-0000-4000-8000-000000000001','campaign',null,'{}');raise exception 'anonymous write allowed';exception when others then null;end;end $$;
rollback;
