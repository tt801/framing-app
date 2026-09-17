\set ON_ERROR_STOP on
\pset tuples_only on
do $$ begin
 if (select count(*) from public.company_accounts where id='7a100000-0000-4000-8000-000000000001')<>1 then raise exception 'seed account lost'; end if;
 if (select count(*) from public.company_members where user_id='7a000000-0000-4000-8000-000000000002')<>1 then raise exception 'seed membership lost'; end if;
 if (select count(*) from public.stripe_webhook_logs where event_id='release-seed-webhook')<>1 then raise exception 'seed webhook lost'; end if;
 if (select count(*) from public.support_tickets where ticket_number='RELEASE-SEED-1')<>1 then raise exception 'seed ticket lost'; end if;
 if (select count(*) from public.support_ticket_comments where id='7a300000-0000-4000-8000-000000000001')<>1 then raise exception 'seed comment lost'; end if;
 if to_regprocedure('public.create_calendar_event(text,uuid,jsonb,text,text,text)') is null or to_regprocedure('public.update_calendar_event(text,uuid,jsonb,text,text,text,bigint)') is null or to_regprocedure('public.delete_calendar_event(text,uuid,bigint)') is null then raise exception 'calendar RPC signature missing'; end if;
 if to_regprocedure('public.create_company_preset(text,uuid,text,text,jsonb)') is null or to_regprocedure('public.update_company_preset(text,uuid,text,jsonb,bigint)') is null or to_regprocedure('public.delete_company_preset(text,uuid,bigint)') is null then raise exception 'preset RPC signature missing'; end if;
 if to_regprocedure('public.create_marketing_record(text,uuid,text,text,jsonb)') is null or to_regprocedure('public.update_marketing_record(text,uuid,jsonb,bigint)') is null or to_regprocedure('public.delete_marketing_record(text,uuid,bigint)') is null then raise exception 'marketing RPC signature missing'; end if;
 if exists(select 1 from pg_class where relname in('calendar_events','company_presets','company_marketing_records') and not relrowsecurity) then raise exception 'RLS disabled on release tables'; end if;
 if (select count(*) from pg_trigger where tgrelid in('public.calendar_events'::regclass,'public.company_presets'::regclass,'public.company_marketing_records'::regclass) and not tgisinternal)<3 then raise exception 'release reference triggers missing'; end if;
 if not exists(select 1 from pg_policy where polrelid='public.company_members'::regclass and pg_get_expr(polqual, polrelid) ilike '%auth.jwt()%') then raise exception 'membership email policy is not using the verified auth.jwt helper'; end if;
 if pg_get_functiondef('public.marketing_writable(uuid)'::regprocedure) ilike '%role in%' then raise exception 'marketing role restriction restored'; end if;
 if not has_function_privilege('authenticated','public.create_calendar_event(text,uuid,jsonb,text,text,text)','execute') or not has_function_privilege('authenticated','public.create_company_preset(text,uuid,text,text,jsonb)','execute') or not has_function_privilege('authenticated','public.create_marketing_record(text,uuid,text,text,jsonb)','execute') then raise exception 'release RPC grant missing'; end if;
end $$;
select 'RELEASE_MIGRATION_ASSERTIONS_PASS';
