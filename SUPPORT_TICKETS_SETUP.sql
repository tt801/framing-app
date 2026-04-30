-- Support tickets table for customer support workflow
-- Run this in Supabase SQL editor before using /api/support/tickets and /api/admin/tickets

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text unique not null,
  company_account_id uuid null references company_accounts(id) on delete set null,
  requester_user_id uuid null references auth.users(id) on delete set null,
  requester_email text null,
  requester_name text null,
  subject text not null,
  message text not null,
  category text not null default 'general',
  source text not null default 'app',
  status text not null default 'open' check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to_user_id uuid null references auth.users(id) on delete set null,
  resolution_note text null,
  resolved_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists support_tickets_company_idx on support_tickets(company_account_id);
create index if not exists support_tickets_status_idx on support_tickets(status);
create index if not exists support_tickets_created_idx on support_tickets(created_at desc);

create or replace function set_support_tickets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_support_tickets_updated_at on support_tickets;
create trigger trg_support_tickets_updated_at
before update on support_tickets
for each row execute function set_support_tickets_updated_at();
