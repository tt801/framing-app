# Release Readiness Checklist

Status: blocked from production approval; migration compatibility is verified on an isolated local Supabase instance. Preview still requires the manual gates below.

## Evidence Completed

- Block 1 access controls and company memberships: local SQL/RLS checks and focused authentication tests.
- Blocks 2A-2D customer, quote, invoice, and job tenancy: focused hooks/UI flows and local SQL checks completed in prior blocks.
- Blocks 3A-3B webhook/checkout logic: focused mocked tests completed; no Stripe sandbox lifecycle was run.
- Block 4 launch controls: focused tests verify disabled unfinished automation routes.
- Blocks 5A-5B messaging authorization and React error boundary: focused tests completed.
- Blocks 6A-6F company settings, catalog/stock, calendar, members, presets, and marketing data: focused hook/component tests plus transactional local SQL authorization harnesses are present under `tests/`.
- Last known focused checks: preset hook/control tests, marketing hook/action tests, and database RPC harnesses passed in the disposable local Supabase database.
- `npm run build` and `git diff --check` passed during the latest feature blocks.
- Clean local Supabase upgrade sequence executed on 2026-09-15 from committed baseline `d58721b9fa994ddbe76aca02e1ff36c95d85f50c` (`admin: company detail drawer with members and tickets`): five committed baseline setup scripts followed by all thirteen current forward migrations. Seeded account, membership, Stripe webhook, support ticket, and support comment records survived. Final RPC signatures, grants, RLS, triggers, and policy/function regression checks passed.
- Local HTTP admin invitation lifecycle executed on 2026-09-15 against isolated Supabase API/Auth/Inbucket: owner invitation, local-email capture, confirmation callback, invitee password/session completion, `accept_company_invitation()` role activation, ordinary-staff and cross-company denial, revoked-invitation rejection, and invalid-invite feedback passed. No external email was sent.

## Confirmed Defects Or Release Blockers

- A fresh install requires a Supabase-initialized database with its Auth schema. Vanilla PostgreSQL is unsupported for the baseline scripts; this is an environment prerequisite, not a migration incompatibility.
- Older setup guides still need consolidation around the ordered sequence in `RELEASE_RUNBOOK.md`.
- Marketing retains browser-local `marketing.automation.settings.v1`; it is not company-scoped business data. Legacy scheduled-send helper functions remain in `Marketing.tsx`, though the UI control is disabled and the processing timer was removed.
- Existing Starter webhook recovery completed on 2026-09-16 after correcting the isolated adapter launch environment: event `evt_1UGHGj4PYXZ7QbRFngRKZ6Co` is `processed` at `2026-09-16T11:45:00.669761Z`; `Stripe Checkout Company` stores customer `cus_VGorM1531ETgXF`, subscription `sub_1UGHGh4PYXZ7QbRFJep29BQq`, Starter price `price_1TH4B24PYXZ7QbRFY7GS9ASi`, and active status. One duplicate replay left the event processed (attempt count 2) and account state unchanged. Browser Billing reload subsequently displayed active access through `2026-10-16`.
- Browser Billing reload verification completed on 2026-09-16 using the existing isolated frontend at `localhost:55400`: `Stripe Checkout Company` displayed `active`, `Stripe portal available`, and access through `2026-10-16` after reload. No checkout was created.
- PDF visual review PASS, confirmed by user inspection on 2026-09-16, for the normal invoice, unresolved-customer invoice, and job-card artifacts listed below.
- Adapter initialization defect diagnosed and corrected on 2026-09-16: static Stripe-dependent imports occurred before startup validation, and detached Windows child launches did not reliably inherit the test key. `billing-adapter.ts` now validates required isolated settings before delayed Windows-compatible handler imports and rejects missing/non-test keys without exposing values.

## Not Executed

- Founder purchase and subscription cancellation/renewal or past-due/recovery lifecycle.
- Billing portal end-to-end redirect/action.
- Any additional provider lifecycle beyond the completed Starter checkout and duplicate webhook replay.

## Preview Gate

Proceed only after a new isolated Supabase preview project has its Auth schema initialized and every manual check in `RELEASE_RUNBOOK.md` passes.

## Browser Smoke Attempt

- On 2026-09-15, a separate browser context loaded the isolated Vite app at `http://localhost:55400/#/login`, configured to use the local release Supabase API at port `55321`.
- The authenticated Admin invitation UI was executed through a temporary release-only Vite proxy from `localhost:55400/api/admin/users` to the real local handler adapter at `127.0.0.1:55401`. A synthetic owner completed onboarding; the canonical owner record loaded, a synthetic Staff invite was created, the UI showed one pending invite, and the server-backed success toast appeared. The local callback allow-list includes `localhost:55400/auth/callback`.
- Browser onboarding save failure/retry and A/B Dashboard, Calendar, and Marketing reader checks were executed in the isolated app; the temporary proxy and adapter were test-only and must not be used for production.
- Browser Invitee acceptance completed on 2026-09-15 using a fresh local Admin invite. The newest Inbucket link targeted `http://localhost:55400/auth/callback`; Auth established the invite session, the callback accepted the existing Staff membership, the user set an initial password, and subsequent sign-out/sign-in returned to `Browser Release Company` dashboard without creating another company.
