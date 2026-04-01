-- Stripe integration setup for Framers App
-- Run this in Supabase SQL Editor after TRIAL_SETUP.sql

-- Extend company_accounts table with Stripe fields
alter table if exists public.company_accounts
add column if not exists stripe_customer_id text,
add column if not exists stripe_subscription_id text,
add column if not exists stripe_price_id text,
add column if not exists subscription_renewed_at timestamptz,
add column if not exists subscription_cancel_at timestamptz;

alter table if exists public.company_accounts
drop constraint if exists company_accounts_plan_status_check;

alter table if exists public.company_accounts
add constraint company_accounts_plan_status_check
check (plan_status in ('trialing', 'active', 'past_due', 'expired'));

-- Create an index for quick Stripe customer lookup
create index if not exists idx_company_accounts_stripe_customer_id
  on public.company_accounts(stripe_customer_id);

-- Create a webhook log table for debugging
create table if not exists public.stripe_webhook_logs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now(),
  company_account_id uuid references public.company_accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed'))
);

create index if not exists idx_stripe_webhook_logs_event_id
  on public.stripe_webhook_logs(event_id);

create index if not exists idx_stripe_webhook_logs_status
  on public.stripe_webhook_logs(status);

-- RLS for webhook logs (admin only, or we keep this internal)
alter table public.stripe_webhook_logs enable row level security;

create policy "Webhook logs are internal only"
  on public.stripe_webhook_logs
  for select
  using (false); -- No user reads this
