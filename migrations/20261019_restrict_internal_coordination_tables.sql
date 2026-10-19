BEGIN;

REVOKE ALL PRIVILEGES
  ON TABLE public.stripe_checkout_attempts
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.stripe_checkout_attempts
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE public.stripe_subscription_reconciliation_locks
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.stripe_subscription_reconciliation_locks
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE public.catalog_stock_adjustments
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.catalog_stock_adjustments
  ENABLE ROW LEVEL SECURITY;

COMMIT;
