-- Extend only the plan-status check to match Stripe/webhook and application states.
BEGIN;
ALTER TABLE public.company_accounts
  DROP CONSTRAINT company_accounts_plan_status_check,
  ADD CONSTRAINT company_accounts_plan_status_check
    CHECK (plan_status IN ('trialing', 'active', 'past_due', 'expired'));
COMMIT;
