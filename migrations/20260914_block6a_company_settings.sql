-- Block 6A: company-scoped business settings only.
begin;

create table if not exists public.company_settings (
  company_account_id uuid primary key references public.company_accounts(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_company_settings_updated_at()
returns trigger language plpgsql security definer set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists trg_company_settings_updated_at on public.company_settings;
create trigger trg_company_settings_updated_at before update on public.company_settings for each row execute procedure public.touch_company_settings_updated_at();

alter table public.company_settings enable row level security;
revoke all on public.company_settings from anon, authenticated;
grant select, insert, update on public.company_settings to authenticated;

drop policy if exists "Company members can read settings" on public.company_settings;
create policy "Company members can read settings" on public.company_settings for select using (
  exists (select 1 from public.company_accounts ca where ca.id=company_account_id and ca.owner_user_id=auth.uid())
  or public.is_active_company_member(company_account_id)
);
drop policy if exists "Company admins can write settings" on public.company_settings;
create policy "Company admins can write settings" on public.company_settings for all using (
  public.is_company_account_writable(company_account_id) and (
    exists (select 1 from public.company_accounts ca where ca.id=company_account_id and ca.owner_user_id=auth.uid())
    or exists (select 1 from public.company_members cm where cm.company_account_id=company_account_id and cm.user_id=auth.uid() and cm.status='active' and cm.role in ('owner','manager'))
  )
) with check (
  public.is_company_account_writable(company_account_id) and (
    exists (select 1 from public.company_accounts ca where ca.id=company_account_id and ca.owner_user_id=auth.uid())
    or exists (select 1 from public.company_members cm where cm.company_account_id=company_account_id and cm.user_id=auth.uid() and cm.status='active' and cm.role in ('owner','manager'))
  )
);

commit;