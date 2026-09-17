set role postgres;
reset request.jwt.claims;
reset request.jwt.claim.sub;
reset request.jwt.claim.role;
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
('7a000000-0000-4000-8000-000000000001','authenticated','authenticated','release-owner@test.local',now(),now(),now()),
('7a000000-0000-4000-8000-000000000002','authenticated','authenticated','release-member@test.local',now(),now(),now()) on conflict(id) do update set email=excluded.email;
insert into public.company_accounts(id,owner_user_id,company_name,plan_status,trial_started_at,trial_ends_at) values('7a100000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001','Release Seed','active',now(),now()+interval '30 days') on conflict(id) do update set plan_status='active',trial_ends_at=now()+interval '30 days';
insert into public.company_members(company_account_id,user_id,email,role,status,joined_at) values('7a100000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000002','release-member@test.local','staff','active',now()) on conflict(user_id) do update set company_account_id=excluded.company_account_id,status='active';
insert into public.stripe_webhook_logs(event_id,event_type,payload,company_account_id,status) values('release-seed-webhook','checkout.session.completed','{}','7a100000-0000-4000-8000-000000000001','processed') on conflict(event_id) do nothing;
insert into public.support_tickets(id,ticket_number,company_account_id,requester_user_id,requester_email,subject,message) values('7a200000-0000-4000-8000-000000000001','RELEASE-SEED-1','7a100000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001','release-owner@test.local','Seed ticket','Seed support data') on conflict(ticket_number) do nothing;
insert into public.support_ticket_comments(id,ticket_id,company_account_id,author_user_id,author_email,body) values('7a300000-0000-4000-8000-000000000001','7a200000-0000-4000-8000-000000000001','7a100000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001','release-owner@test.local','Seed comment') on conflict(id) do nothing;
