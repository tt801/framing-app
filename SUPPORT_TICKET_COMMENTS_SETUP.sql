-- Support ticket comments timeline
-- Run this after SUPPORT_TICKETS_SETUP.sql

create table if not exists support_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  company_account_id uuid null references company_accounts(id) on delete set null,
  author_user_id uuid null references auth.users(id) on delete set null,
  author_name text null,
  author_email text null,
  body text not null,
  visibility text not null default 'internal' check (visibility in ('internal', 'customer')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists support_ticket_comments_ticket_idx on support_ticket_comments(ticket_id, created_at asc);
create index if not exists support_ticket_comments_company_idx on support_ticket_comments(company_account_id);
