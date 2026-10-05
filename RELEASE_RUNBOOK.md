# Release Runbook

Use a hosted, isolated Supabase preview project with managed Auth, a separate Stripe sandbox configuration/account, separate provider credentials, and a preview frontend URL. A hosted preview cannot reach localhost services. Never use vanilla PostgreSQL for the baseline scripts.

## Fresh Installation Versus Upgrade

For a fresh installation only, apply the five baseline scripts below to a new Supabase-initialized database. For an existing database, do not rerun them: back up, verify the current schema, and apply only the thirteen forward migrations.

Required active configuration names: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_BASE_URL` or platform URL fallback, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLIC_KEY`, `VITE_STRIPE_PRICE_STARTER`, `VITE_STRIPE_PRICE_GROWTH`, `VITE_STRIPE_PRICE_PRO`, `VITE_STRIPE_PRICE_FOUNDER`.

Optional/feature-specific names: `FOUNDER_MAX_PURCHASES`, `VERCEL_URL`, `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL`, `SUPPORT_TICKET_NOTIFY_TO`, `PLATFORM_ADMIN_EMAILS`. `CRON_SECRET` is not required while scheduled automation is disabled.

Provider credentials remain user-owned records; do not move them into campaign/template data or browser storage.

## Database Order

The verified local sequence used committed baseline blobs from `d58721b9fa994ddbe76aca02e1ff36c95d85f50c`, then the current forward migrations. Baseline files are for a new database only:

1. `TRIAL_SETUP.sql`
2. `TEAM_ACCESS_SETUP.sql`
3. `STRIPE_SETUP.sql`
4. `SUPPORT_TICKETS_SETUP.sql`
5. `SUPPORT_TICKET_COMMENTS_SETUP.sql`

Apply forward migrations in this exact order:

1. `migrations/20260914_block1_access_controls.sql`
2. `migrations/20260914_block2a_customers.sql`
3. `migrations/20260914_block2b_quotes.sql`
4. `migrations/20260914_block2c_invoices.sql`
5. `migrations/20260914_block2d_jobs.sql`
6. `migrations/20260914_block3a_webhooks.sql`
7. `migrations/20260914_block3b_checkout.sql`
8. `migrations/20260914_block6a_company_settings.sql`
9. `migrations/20260914_block6b_catalog.sql`
10. `migrations/20260914_block6c_calendar_events.sql`
11. `migrations/20260915_block6d_calendar_assignments.sql`
12. `migrations/20260915_block6e_presets.sql`
13. `migrations/20260915_block6f_marketing.sql`

Before upgrade, verify Supabase Auth and these baseline objects exist: `auth.users`, `public.company_accounts`, `public.company_members`, Stripe webhook tables, support tables, and baseline helper functions. Apply one migration at a time with transactional error stopping; verify RPC signatures, grants, RLS, policies, triggers, and representative reads afterward.

## Billing EXPAND/DEPLOY Gate (Not Yet Approved)

Alex verified the newly enabled Stripe **Live** account has zero subscriptions,
payments, Checkout sessions, products/prices, and webhook destinations. Production
Supabase has no stored Stripe customer/subscription/price IDs, Founder accounts,
or Checkout attempts; its five historical webhook objects are test-mode. This is
**CASE 1: no existing Live billing state**, not proof that sandbox sessions are
closed or that Live will remain empty. Recheck both provider and database counts
immediately before any approved release. Do not build historical live-event
replay or customer migration for nonexistent Live billing state.

`migrations/20261001_founder_paid_history.sql` is an **unapplied EXPAND proposal**
beyond the thirteen-migration sequence above. It adds nullable paid history,
server-owned eligibility, v2 reservation/Founder completion functions, and a
trigger that rejects direct Founder activation without a completed reservation.
The legacy begin signature remains for recurring Checkout but denies Founder;
the legacy four-argument Founder completion remains callable only by the
service role and fails closed. The new API uses explicit v2 RPCs. No CONTRACT
migration or production migration is approved. The old deployed `main` Checkout
creates a Founder Stripe session without a database RPC: do **not** configure
payable Live Founder pricing while old checkout or webhook instances can serve.
A database-only bridge cannot prevent that old Stripe session creation.

Approved design order, **not execution authority**:
1. Complete the isolated Stripe **test-mode** lifecycle against the proposed v2
   code/schema using existing sandbox resources; no preview infrastructure or
   Live Stripe configuration is authorized in this step. Verify Founder expiry,
   concurrent final-slot reservation, paid completion, invoice history, and
   session-specific return. Resolve any open sandbox sessions before changing
   the sandbox endpoint or credentials.
2. Recheck Stripe Live remains empty and production Supabase prerequisites match;
   obtain separate approval, snapshot/backup, then apply EXPAND transactionally
   with error stopping. Verify column/trigger, old and v2 signatures, grants,
   legacy Founder denial and ordinary recurring behavior. No Live payable
   products/endpoint exist during the old-code overlap.
3. With separate deployment approval, deploy v2 API/frontend and verify the new
   billing routes, webhook signature handling and instance drain. Keep Live
   purchasing unavailable until the matching endpoint and prices are configured.
   Old browser tabs must reload before Live launch.
4. Only with later separate approval, create **Live** recurring and Founder
   products/prices, configure the production webhook for
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, and `invoice.payment_succeeded`, and supply
   the correct Live environment-variable names/scopes without exposing values.
   Verify all four event subscriptions and signed delivery, then allow payable
   Live Checkout; ensure old webhook/checkout instances are no longer serving.
   Never enable paid recurring Checkout before invoice event handling is ready.
5. Remove obsolete compatibility RPCs in a separately reviewed CONTRACT
   migration only after old instances and pending old sessions are drained.

The paid-history rule assumes card-only recurring Checkout without application-
configured trials or promotion codes. Credit-funded, zero-value, asynchronous,
or alternate payment provenance requires reviewing the trust rule first.

## Coordination And Recovery

1. Create and verify a backup/snapshot and record schema and Stripe Live state.
2. Apply approved forward migrations in order, stopping on error; EXPAND must
   precede the v2 deployment, with no Live payable Checkout during overlap.
3. Deploy the API/frontend built against the verified schema only with separate
   approval; verify v2 RPCs and webhook handling before configuring Live billing.
4. Require existing tabs to reload; old tabs may hold stale revisions and company context.

Do not roll back to an old billing deployment after new payable sessions or paid
history exist. On failure, keep Live Checkout disabled, preserve payment/event
records, and prefer a reviewed forward fix; never drop paid history or release a
reservation just because its timestamp passed.

## Required Preview Checks

- Admin invitation/acceptance, owner/member authorization, and onboarding save failure/retry.
- Starter sandbox checkout/webhook, Founder purchase, billing portal, cancellation, renewal, and past-due/recovery behavior.
- Browser account switching for Dashboard, Calendar, Marketing, presets, catalog, customers, quotes, invoices, and jobs.
- Visual inspection of invoice and job-card PDFs.
- Explicit legacy imports, source preservation, collision handling, and no provider calls during import.
- Disabled scheduled automation remains unavailable and does not process old local scheduled entries.

## Reviewable Release Files

Include reviewed application/API fixes, the thirteen files under `migrations/`, focused tests under `tests/`, and `RELEASE_READINESS_CHECKLIST.md` plus this runbook. Exclude `.env*`, service keys, disposable PDFs, local Supabase folders, generated previews, and `C:\Users\thomp\release-migration-tests` artifacts. Review unrelated working-tree changes separately; do not stage them as release work.
