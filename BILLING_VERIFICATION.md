# Billing Verification Checklist

Use this after each production deploy or Stripe configuration change.

## Live Checks

1. Complete a normal Stripe subscription checkout and verify the app returns to [src/pages/BillingSuccess.tsx](src/pages/BillingSuccess.tsx) without errors.
2. Complete a Founder checkout and verify the user keeps full access and sees Founder status in [src/components/TrialBanner.tsx](src/components/TrialBanner.tsx).
3. Open the billing portal from [src/pages/Billing.tsx](src/pages/Billing.tsx) and confirm Stripe returns to `#/billing` successfully.
4. Retry the same webhook event from Stripe Dashboard and confirm the endpoint returns `200` without duplicating the state change.
5. Simulate `past_due` or a failed renewal and confirm the app becomes read-only while premium API routes return `403`.

## Supabase SQL Checks

Run these in Supabase SQL Editor.

### 1. Inspect account billing state

```sql
select
  id,
  company_name,
  plan_status,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_price_id,
  subscription_renewed_at,
  subscription_cancel_at,
  updated_at
from public.company_accounts
order by updated_at desc
limit 20;
```

### 2. Check Founder usage against the cap

```sql
select
  count(*) as founder_purchased_count
from public.company_accounts
where stripe_price_id = 'founder_lifetime';
```

### 3. Inspect recent webhook processing

```sql
select
  event_id,
  event_type,
  status,
  processed_at
from public.stripe_webhook_logs
order by processed_at desc
limit 25;
```

### 4. Find failed webhook events

```sql
select
  event_id,
  event_type,
  status,
  processed_at,
  payload
from public.stripe_webhook_logs
where status = 'failed'
order by processed_at desc;
```

### 5. Confirm Founder users are marked correctly

```sql
select
  company_name,
  plan_status,
  stripe_price_id,
  subscription_renewed_at
from public.company_accounts
where stripe_price_id = 'founder_lifetime'
order by updated_at desc;
```

## Expected Results

1. Subscription users should show `plan_status = 'active'` with `stripe_subscription_id` and a recurring `stripe_price_id`.
2. Founder users should show `stripe_price_id = 'founder_lifetime'` and keep full access without using the Stripe billing portal.
3. `past_due` and `expired` users should remain able to read data, but shared client mutations and premium server routes should be blocked.
4. Duplicate webhook deliveries should appear once in `stripe_webhook_logs` and should not break billing state updates.