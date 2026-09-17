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

## Coordination And Recovery

1. Create and verify a backup/snapshot and record the current schema state.
2. Apply forward migrations in a maintenance window.
3. Deploy the frontend built against the verified schema.
4. Run preview smoke checks before reopening writes.
5. Require already-open tabs to reload; old tabs may hold stale revisions and company context.

Do not roll back to an old frontend after incompatible RLS, RPC, or enforcement changes unless it is explicitly compatible. Keep old tabs read-only or require reload. If migration/deployment fails, stop, preserve the previous deployment where compatible, restore the backup or use a reviewed forward repair, and do not automatically reverse migrations.

## Required Preview Checks

- Admin invitation/acceptance, owner/member authorization, and onboarding save failure/retry.
- Starter sandbox checkout/webhook, Founder purchase, billing portal, cancellation, renewal, and past-due/recovery behavior.
- Browser account switching for Dashboard, Calendar, Marketing, presets, catalog, customers, quotes, invoices, and jobs.
- Visual inspection of invoice and job-card PDFs.
- Explicit legacy imports, source preservation, collision handling, and no provider calls during import.
- Disabled scheduled automation remains unavailable and does not process old local scheduled entries.

## Reviewable Release Files

Include reviewed application/API fixes, the thirteen files under `migrations/`, focused tests under `tests/`, and `RELEASE_READINESS_CHECKLIST.md` plus this runbook. Exclude `.env*`, service keys, disposable PDFs, local Supabase folders, generated previews, and `C:\Users\thomp\release-migration-tests` artifacts. Review unrelated working-tree changes separately; do not stage them as release work.
