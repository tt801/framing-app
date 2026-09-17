-- Block 2C: company-scoped invoice persistence.
-- Forward-only migration. Existing browser-local invoices are imported explicitly by the app.

begin;

create table if not exists public.invoice_number_counters (
  company_account_id uuid primary key references public.company_accounts(id) on delete cascade,
  last_seq integer not null default 0
);

create table if not exists public.invoices (
  id text primary key,
  company_account_id uuid not null references public.company_accounts(id) on delete cascade,
  customer_id text references public.customers(id) on delete set null,
  quote_id text,
  invoice_number text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_account_id, invoice_number)
);

create index if not exists idx_invoices_company_account_id on public.invoices(company_account_id);
create index if not exists idx_invoices_customer_id on public.invoices(customer_id);
create index if not exists idx_invoices_quote_id on public.invoices(quote_id);

alter table public.invoices enable row level security;

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
before update on public.invoices
for each row execute procedure public.touch_updated_at();

create or replace function public.check_invoice_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.company_account_id = new.company_account_id
  ) then
    raise exception 'Invoice customer_id must belong to the same company_account_id';
  end if;

  if new.quote_id is not null and not exists (
    select 1 from public.quotes q
    where q.id = new.quote_id and q.company_account_id = new.company_account_id
  ) then
    raise exception 'Invoice quote_id must belong to the same company_account_id';
  end if;

  if tg_op = 'UPDATE' and new.company_account_id <> old.company_account_id then
    raise exception 'Invoice company_account_id cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_reference_check on public.invoices;
create trigger trg_invoices_reference_check
before insert or update on public.invoices
for each row execute procedure public.check_invoice_references();

create or replace function public.next_invoice_number(
  p_company_account_id uuid,
  p_prefix text,
  p_start_number integer
)
returns table(invoice_number text, seq integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq integer;
begin
  insert into public.invoice_number_counters(company_account_id, last_seq)
  values (p_company_account_id, greatest(coalesce(p_start_number, 1) - 1, 0))
  on conflict (company_account_id) do nothing;

  select c.last_seq + 1 into v_seq
  from public.invoice_number_counters c
  where c.company_account_id = p_company_account_id
  for update;

  v_seq := greatest(v_seq, coalesce(p_start_number, 1));
  update public.invoice_number_counters
  set last_seq = v_seq
  where company_account_id = p_company_account_id;

  return query select coalesce(p_prefix, '') || v_seq::text, v_seq;
end;
$$;

create or replace function public.create_invoice(
  p_id text,
  p_company_account_id uuid,
  p_customer_id text,
  p_quote_id text,
  p_payload jsonb,
  p_prefix text default '',
  p_start_number integer default 1
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_number text := nullif(v_payload->>'number', '');
  v_seq integer;
begin
  if not (
    exists (select 1 from public.company_accounts ca where ca.id = p_company_account_id and ca.owner_user_id = auth.uid())
    or public.is_active_company_member(p_company_account_id)
  ) or not public.is_company_account_writable(p_company_account_id) then
    raise exception 'Invoice writes are not allowed for this company';
  end if;

  if nullif(v_payload->>'seq', '') is not null then
    v_seq := (v_payload->>'seq')::integer;
  end if;

  if v_number is null then
    select n.invoice_number, n.seq into v_number, v_seq
    from public.next_invoice_number(p_company_account_id, p_prefix, p_start_number) n;
    v_payload := jsonb_set(jsonb_set(v_payload, '{number}', to_jsonb(v_number)), '{seq}', to_jsonb(v_seq));
  end if;

  insert into public.invoices(id, company_account_id, customer_id, quote_id, invoice_number, payload)
  values (coalesce(nullif(p_id, ''), gen_random_uuid()::text), p_company_account_id, p_customer_id, p_quote_id, v_number, v_payload)
  returning * into v_invoice;
  return v_invoice;
end;
$$;

create or replace function public.append_invoice_payment(
  p_company_account_id uuid,
  p_invoice_id text,
  p_payment jsonb
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_payment_id text := p_payment->>'id';
begin
  if not (
    exists (select 1 from public.company_accounts ca where ca.id = p_company_account_id and ca.owner_user_id = auth.uid())
    or public.is_active_company_member(p_company_account_id)
  ) or not public.is_company_account_writable(p_company_account_id) then
    raise exception 'Invoice writes are not allowed for this company';
  end if;

  update public.invoices i
  set payload = jsonb_set(
    i.payload,
    '{payments}',
    coalesce(i.payload->'payments', '[]'::jsonb) || case
      when v_payment_id is not null and exists (
        select 1 from jsonb_array_elements(coalesce(i.payload->'payments', '[]'::jsonb)) p
        where p->>'id' = v_payment_id
      ) then '[]'::jsonb
      else jsonb_build_array(p_payment)
    end
  )
  where i.id = p_invoice_id and i.company_account_id = p_company_account_id
  returning i.* into v_invoice;

  if not found then raise exception 'Invoice not found'; end if;
  return v_invoice;
end;
$$;

revoke all on public.invoices, public.invoice_number_counters from anon, authenticated;
grant select on public.invoices to authenticated;
grant insert (id, company_account_id, customer_id, quote_id, invoice_number, payload) on public.invoices to authenticated;
grant update (customer_id, quote_id, payload, invoice_number) on public.invoices to authenticated;
grant delete on public.invoices to authenticated;
grant execute on function public.create_invoice(text, uuid, text, text, jsonb, text, integer) to authenticated;
grant execute on function public.append_invoice_payment(uuid, text, jsonb) to authenticated;

drop policy if exists "Company members can read invoices" on public.invoices;
create policy "Company members can read invoices" on public.invoices for select using (
  exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
  or public.is_active_company_member(company_account_id)
);

drop policy if exists "Writable accounts can insert invoices" on public.invoices;
create policy "Writable accounts can insert invoices" on public.invoices for insert with check (
  (exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
   or public.is_active_company_member(company_account_id))
  and public.is_company_account_writable(company_account_id)
);

drop policy if exists "Writable accounts can update invoices" on public.invoices;
create policy "Writable accounts can update invoices" on public.invoices for update using (
  (exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
   or public.is_active_company_member(company_account_id))
  and public.is_company_account_writable(company_account_id)
) with check (
  (exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
   or public.is_active_company_member(company_account_id))
  and public.is_company_account_writable(company_account_id)
);

drop policy if exists "Writable accounts can delete invoices" on public.invoices;
create policy "Writable accounts can delete invoices" on public.invoices for delete using (
  (exists (select 1 from public.company_accounts ca where ca.id = company_account_id and ca.owner_user_id = auth.uid())
   or public.is_active_company_member(company_account_id))
  and public.is_company_account_writable(company_account_id)
);

commit;