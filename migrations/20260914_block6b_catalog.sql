-- Block 6B: company-scoped catalog products and stock document.
begin;

create table if not exists public.company_catalog (
  company_account_id uuid primary key references public.company_accounts(id) on delete cascade,
  catalog jsonb not null default '{"frames":[],"mats":[],"glazing":[],"printingMaterials":[],"backers":[],"stock":{"frames":[],"sheets":[],"rolls":[]}}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_stock_adjustments (
  company_account_id uuid not null references public.company_accounts(id) on delete cascade,
  adjustment_key text not null,
  created_at timestamptz not null default now(),
  primary key (company_account_id, adjustment_key)
);

alter table public.company_catalog enable row level security;
revoke all on public.company_catalog from anon, authenticated;
grant select, insert, update on public.company_catalog to authenticated;

drop policy if exists "Company members can read catalog" on public.company_catalog;
create policy "Company members can read catalog" on public.company_catalog for select using (
  exists (select 1 from public.company_accounts ca where ca.id=company_account_id and ca.owner_user_id=auth.uid())
  or public.is_active_company_member(company_account_id)
);
drop policy if exists "Company admins can write catalog" on public.company_catalog;
create policy "Company admins can write catalog" on public.company_catalog for all using (
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

create or replace function public.update_company_catalog(p_company_account_id uuid, p_catalog jsonb, p_revision bigint)
returns public.company_catalog language plpgsql security definer set search_path=public as $$
declare v public.company_catalog;
begin
  if not public.is_company_account_writable(p_company_account_id) or not (
    exists (select 1 from public.company_accounts ca where ca.id=p_company_account_id and ca.owner_user_id=auth.uid())
    or exists (select 1 from public.company_members cm where cm.company_account_id=p_company_account_id and cm.user_id=auth.uid() and cm.status='active' and cm.role in ('owner','manager'))
  ) then raise exception 'Catalog writes are not allowed for this company'; end if;
  update public.company_catalog set catalog=p_catalog, revision=revision+1, updated_at=now()
  where company_account_id=p_company_account_id and revision=p_revision;
  if not found then raise exception 'Catalog changed or no longer exists'; end if;
  select * into v from public.company_catalog where company_account_id=p_company_account_id;
  return v;
end;
$$;

create or replace function public.adjust_company_stock(p_company_account_id uuid, p_adjustment_key text, p_kind text, p_product_id text, p_delta numeric)
returns public.company_catalog language plpgsql security definer set search_path=public as $$
declare v public.company_catalog; item jsonb; idx integer; arr jsonb; id_key text;
begin
  if not public.is_company_account_writable(p_company_account_id) or not (
    exists (select 1 from public.company_accounts ca where ca.id=p_company_account_id and ca.owner_user_id=auth.uid())
    or exists (select 1 from public.company_members cm where cm.company_account_id=p_company_account_id and cm.user_id=auth.uid() and cm.status='active' and cm.role in ('owner','manager'))
  ) then raise exception 'Catalog writes are not allowed for this company'; end if;
  if exists (select 1 from public.catalog_stock_adjustments where company_account_id=p_company_account_id and adjustment_key=p_adjustment_key) then
    select * into v from public.company_catalog where company_account_id=p_company_account_id; return v;
  end if;
  select * into v from public.company_catalog where company_account_id=p_company_account_id for update;
  if not found then raise exception 'Catalog not found'; end if;
  id_key := case when p_kind='frame' then 'profileId' when p_kind='roll' then 'materialId' else 'id' end;
  arr := case when p_kind='frame' then coalesce(v.catalog->'stock'->'frames','[]'::jsonb) when p_kind='roll' then coalesce(v.catalog->'stock'->'rolls','[]'::jsonb) else coalesce(v.catalog->'stock'->'sheets','[]'::jsonb) end;
  idx := -1;
  for item in select value from jsonb_array_elements(arr) with ordinality t(value,ord) loop
    if item->>id_key=p_product_id then idx := (select ordinality::integer-1 from jsonb_array_elements(arr) with ordinality t2(value,ordinality) where t2.value=item limit 1); exit; end if;
  end loop;
  if idx < 0 then raise exception 'Stock product not found'; end if;
  if p_kind='frame' then arr := jsonb_set(arr, array[idx::text,'metersAvailable'], to_jsonb(greatest(0,(arr->idx->>'metersAvailable')::numeric+p_delta)));
  elsif p_kind='roll' then arr := jsonb_set(arr, array[idx::text,'metersRemaining'], to_jsonb(greatest(0,(arr->idx->>'metersRemaining')::numeric+p_delta)));
  else arr := jsonb_set(arr, array[idx::text,'qty'], to_jsonb(greatest(0,(arr->idx->>'qty')::numeric+p_delta))); end if;
  v.catalog := jsonb_set(v.catalog, array['stock',case when p_kind='frame' then 'frames' when p_kind='roll' then 'rolls' else 'sheets' end], arr);
  update public.company_catalog set catalog=v.catalog, revision=revision+1, updated_at=now() where company_account_id=p_company_account_id;
  insert into public.catalog_stock_adjustments(company_account_id,adjustment_key) values(p_company_account_id,p_adjustment_key);
  select * into v from public.company_catalog where company_account_id=p_company_account_id; return v;
end;
$$;

revoke all on function public.update_company_catalog(uuid,jsonb,bigint) from public, anon, authenticated;
revoke all on function public.adjust_company_stock(uuid,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.update_company_catalog(uuid,jsonb,bigint) to authenticated;
grant execute on function public.adjust_company_stock(uuid,text,text,text,numeric) to authenticated;

commit;