-- Block 6C real-RPC authorization tests. Run only against the disposable local database.
-- All fixtures and mutations are rolled back.
\set ON_ERROR_STOP on
begin;
set role postgres;
reset request.jwt.claims;
reset request.jwt.claim.sub;
reset request.jwt.claim.role;

insert into auth.users (id,aud,role,email,email_confirmed_at,created_at,updated_at)
values
 ('61000000-0000-4000-8000-000000000001','authenticated','authenticated','block6c-owner-a@test.local',now(),now(),now()),
 ('61000000-0000-4000-8000-000000000002','authenticated','authenticated','block6c-owner-b@test.local',now(),now(),now()),
 ('61000000-0000-4000-8000-000000000003','authenticated','authenticated','block6c-member-a@test.local',now(),now(),now()),
 ('61000000-0000-4000-8000-000000000004','authenticated','authenticated','block6c-inactive-a@test.local',now(),now(),now()),
 ('61000000-0000-4000-8000-000000000005','authenticated','authenticated','block6c-member-b@test.local',now(),now(),now())
on conflict (id) do update set email=excluded.email;
insert into public.company_accounts (id,owner_user_id,company_name,plan_status,trial_started_at,trial_ends_at)
values
 ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','Block 6C A','active',now(),now()+interval '30 days'),
 ('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','Block 6C B','active',now(),now()+interval '30 days')
on conflict (id) do update set plan_status='active',trial_ends_at=now()+interval '30 days';
insert into public.company_members (company_account_id,user_id,email,role,status,joined_at)
values ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','block6c-member-a@test.local','staff','active',now())
on conflict (user_id) do update set company_account_id=excluded.company_account_id,status='active',role='staff';
insert into public.company_members (company_account_id,user_id,email,role,status,joined_at) values
 ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000004','block6c-inactive-a@test.local','staff','inactive',now()),
 ('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000005','block6c-member-b@test.local','staff','active',now())
on conflict (user_id) do update set company_account_id=excluded.company_account_id,status=excluded.status,role=excluded.role;
insert into public.customers(id,company_account_id,first_name,last_name,email) values
 ('block6c-customer-a','62000000-0000-4000-8000-000000000001','A','Customer','a-calendar@test.local'),
 ('block6c-customer-b','62000000-0000-4000-8000-000000000002','B','Customer','b-calendar@test.local');
insert into public.invoices(id,company_account_id,invoice_number,payload) values
 ('block6c-invoice-a','62000000-0000-4000-8000-000000000001','B6C-A','{}'),
 ('block6c-invoice-b','62000000-0000-4000-8000-000000000002','B6C-B','{}');
insert into public.jobs(id,company_account_id,ref_no,payload) values
 ('block6c-job-a','62000000-0000-4000-8000-000000000001',6101,'{}'),
 ('block6c-job-b','62000000-0000-4000-8000-000000000002',6102,'{}');
do $$ begin
 if not public.is_company_account_writable('62000000-0000-4000-8000-000000000001') or not public.is_company_account_writable('62000000-0000-4000-8000-000000000002') then raise exception 'fixtures are not writable'; end if;
 if (select count(*) from public.company_accounts where id in ('62000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002'))<>2 then raise exception 'fixtures missing'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
select public.create_calendar_event('block6c-event','62000000-0000-4000-8000-000000000001','{"id":"block6c-event","type":"appointment","title":"original","start":"2026-09-15T09:30:00.000Z","end":"2026-09-15T10:15:00.000Z","allDay":false}'::jsonb,'block6c-customer-a','block6c-job-a','block6c-invoice-a');
do $$ begin if (select count(*) from public.calendar_events where id='block6c-event')<>1 then raise exception 'authorized create failed'; end if; end $$;
select public.create_calendar_event('block6d-assignment','62000000-0000-4000-8000-000000000001','{"id":"block6d-assignment","type":"other","title":"assigned","start":"2026-09-16T09:00:00.000Z","assignedTo":"61000000-0000-4000-8000-000000000003"}'::jsonb,null,null,null);
do $$ begin
 begin perform public.create_calendar_event('block6d-inactive','62000000-0000-4000-8000-000000000001','{"assignedTo":"61000000-0000-4000-8000-000000000004"}'::jsonb,null,null,null); raise exception 'inactive assignment accepted'; exception when others then if sqlerrm not like '%assignedTo must be an active member%' then raise; end if; end;
 begin perform public.create_calendar_event('block6d-cross','62000000-0000-4000-8000-000000000001','{"assignedTo":"61000000-0000-4000-8000-000000000005"}'::jsonb,null,null,null); raise exception 'cross-company assignment accepted'; exception when others then if sqlerrm not like '%assignedTo must be an active member%' then raise; end if; end;
end $$;
reset role; set role postgres; reset request.jwt.claims; reset request.jwt.claim.sub; reset request.jwt.claim.role;
update public.company_members set status='inactive' where user_id='61000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
select public.update_calendar_event('block6d-assignment','62000000-0000-4000-8000-000000000001','{"id":"block6d-assignment","type":"other","title":"historical retained","start":"2026-09-16T09:00:00.000Z","assignedTo":"61000000-0000-4000-8000-000000000003"}'::jsonb,null,null,null,1);
do $$ begin
 begin perform public.update_calendar_event('block6d-assignment','62000000-0000-4000-8000-000000000001','{"assignedTo":"61000000-0000-4000-8000-000000000004"}'::jsonb,null,null,null,2); raise exception 'invalid reassignment accepted'; exception when others then if sqlerrm not like '%assignedTo must be an active member%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
do $$ begin
 begin
  update public.company_members set role='owner',status='active' where user_id='61000000-0000-4000-8000-000000000003';
  if found then raise exception 'ordinary staff changed role or status'; end if;
 exception when insufficient_privilege then null;
 end;
end $$;
reset role; set role postgres; reset request.jwt.claims; reset request.jwt.claim.sub; reset request.jwt.claim.role;
update public.company_members set status='active' where user_id='61000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select public.update_calendar_event('block6c-event','62000000-0000-4000-8000-000000000001','{"id":"block6c-event","type":"appointment","title":"updated","start":"2026-09-15T09:30:00.000Z","allDay":true}'::jsonb,'block6c-customer-a','block6c-job-a','block6c-invoice-a',1);
do $$ begin begin perform public.update_calendar_event('block6c-event','62000000-0000-4000-8000-000000000001','{"title":"stale"}'::jsonb,null,null,null,1); raise exception 'stale update accepted'; exception when others then if sqlerrm not like '%changed or no longer exists%' then raise; end if; end; if (select event->>'title' from public.calendar_events where id='block6c-event')<>'updated' then raise exception 'stale update overwrote row'; end if; end $$;

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
do $$ begin
 if not exists(select 1 from public.calendar_events where id='block6c-event') then raise exception 'active member read denied'; end if;
end $$;
select public.create_calendar_event('block6c-member-event','62000000-0000-4000-8000-000000000001','{"id":"block6c-member-event","type":"other","title":"member","start":"2026-09-16T09:00:00.000Z"}'::jsonb,null,null,null);
select public.update_calendar_event('block6c-member-event','62000000-0000-4000-8000-000000000001','{"id":"block6c-member-event","type":"other","title":"member updated","start":"2026-09-16T09:00:00.000Z"}'::jsonb,null,null,null,1);
select public.delete_calendar_event('block6c-member-event','62000000-0000-4000-8000-000000000001',2);
do $$ begin if exists(select 1 from public.calendar_events where id='block6c-member-event') then raise exception 'active member delete failed'; end if; end $$;

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.calendar_events where id='block6c-event') then raise exception 'unrelated read allowed'; end if;
 begin perform public.create_calendar_event('block6c-b-write','62000000-0000-4000-8000-000000000001','{}',null,null,null); raise exception 'unrelated create allowed'; exception when others then if sqlerrm not like '%not allowed%' then raise; end if; end;
 begin perform public.update_calendar_event('block6c-event','62000000-0000-4000-8000-000000000001','{}',null,null,null,2); raise exception 'unrelated update allowed'; exception when others then if sqlerrm not like '%not allowed%' then raise; end if; end;
 begin perform public.delete_calendar_event('block6c-event','62000000-0000-4000-8000-000000000001',2); raise exception 'unrelated delete allowed'; exception when others then if sqlerrm not like '%not allowed%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
do $$ declare r text; begin
 foreach r in array array['block6c-customer-b','block6c-job-b','block6c-invoice-b'] loop
  begin
   if r='block6c-customer-b' then perform public.create_calendar_event('block6c-bad-customer','62000000-0000-4000-8000-000000000001','{}',r,null,null);
   elsif r='block6c-job-b' then perform public.create_calendar_event('block6c-bad-job','62000000-0000-4000-8000-000000000001','{}',null,r,null);
   else perform public.create_calendar_event('block6c-bad-invoice','62000000-0000-4000-8000-000000000001','{}',null,null,r); end if;
   raise exception 'cross-company reference accepted: %',r;
  exception when others then if sqlerrm like 'cross-company reference accepted%' then raise; end if; end;
 end loop;
end $$;
reset role;
set role postgres; reset request.jwt.claims; reset request.jwt.claim.sub; reset request.jwt.claim.role;
update public.company_accounts set plan_status='expired',trial_ends_at=now()-interval '1 day' where id='62000000-0000-4000-8000-000000000001';
do $$ begin if public.is_company_account_writable('62000000-0000-4000-8000-000000000001') then raise exception 'expired fixture is writable'; end if; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
do $$ begin
 begin perform public.create_calendar_event('block6c-expired','62000000-0000-4000-8000-000000000001','{}',null,null,null); raise exception 'expired create allowed'; exception when others then if sqlerrm not like '%not allowed%' then raise; end if; end;
 begin perform public.update_calendar_event('block6c-event','62000000-0000-4000-8000-000000000001','{}',null,null,null,2); raise exception 'expired update allowed'; exception when others then if sqlerrm not like '%not allowed%' then raise; end if; end;
 begin perform public.delete_calendar_event('block6c-event','62000000-0000-4000-8000-000000000001',2); raise exception 'expired delete allowed'; exception when others then if sqlerrm not like '%not allowed%' then raise; end if; end;
end $$;
reset role;
set local role anon;
do $$ begin begin perform public.create_calendar_event('block6c-anon','62000000-0000-4000-8000-000000000001','{}',null,null,null); raise exception 'anonymous create allowed'; exception when others then null; end; end $$;
rollback;
