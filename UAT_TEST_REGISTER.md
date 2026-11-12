# FramersApp — UAT Test Register

Last reconciled: 2026-11-12
Repository: tt801/framing-app
Development branch: restart-development
Reference HEAD: 4f0deb7

## Purpose

This is the permanent register of FramersApp testing evidence.

Do not repeat previously passed tests unless a relevant code change,
regression, environment change, or missing critical acceptance evidence
provides a specific reason.

Keep historical test results separate from current deployment verification.

## Status Definitions

- PASS: Explicit positive acceptance evidence recovered.
- TESTED / VERDICT PENDING: Test executed, but final acceptance not recovered.
- LOCAL PASS: Passed in isolated/local testing, not necessarily hosted UAT.
- IMPLEMENTED: Code committed; deployment or acceptance may remain unverified.
- NOT VERIFIED: Evidence insufficient to establish completion.
- DEFERRED: Intentionally postponed.
- BLOCKED: Confirmed release-blocking issue.

## Historical UAT Coverage

| Area | Status | Evidence / Qualification |
|---|---|---|
| Block 1 access controls and memberships | PASS | September local SQL/RLS, authentication and invitation tests; RELEASE_READINESS_CHECKLIST.md |
| Onboarding save failure/retry | PASS | September isolated browser testing |
| Onboarding Skip for now | TESTED / VERDICT PENDING | October hosted UAT; HTTP 201 settings write, HTTP 200 reads and dashboard reload observed |
| Onboarding printable-address regression | TESTED / VERDICT PENDING | Hosted regression observed corrected address and exact city; final database verdict not recovered |
| Onboarding Finish | TESTED / VERDICT PENDING | Finish C company established and used successfully in subsequent hosted workflows |
| Customer, quote, job and invoice lifecycle | PASS | Hosted Finish C commercial workflow explicitly recorded as passed |
| Cross-company commercial UI isolation | PASS | Two-way UI checks across commercial records |
| Foreign-record direct URL isolation | PASS | Quote, Job and Invoice direct-ID checks |
| Authenticated commercial RLS | PASS | Customers, Quotes, Jobs and Invoices |
| Staff role restrictions | PASS | Permitted commercial access and denied Admin/Billing access |
| Local SaaS billing lifecycle | LOCAL PASS | October Block 3 local acceptance recorded as complete |
| Starter Stripe webhook recovery | PASS | September isolated adapter: processed webhook, duplicate replay and active billing state |
| Billing portal availability display | PASS | September isolated browser reload displayed portal availability |
| Founder purchase hosted acceptance | NOT VERIFIED | No completed hosted lifecycle result recovered |
| Subscription cancellation and renewal hosted acceptance | NOT VERIFIED | No completed hosted lifecycle result recovered |
| Past-due recovery hosted acceptance | NOT VERIFIED | No completed hosted lifecycle result recovered |
| Billing Portal end-to-end actions | NOT VERIFIED | Display acceptance does not prove portal actions |
| Live Stripe acceptance | DEFERRED | Historical record explicitly describes it as a separate later acceptance track |
| Supplier Phase 5E database checks | LOCAL PASS | Disposable SCV22 Supabase/PostgreSQL testing |
| Supplier batch integration | LOCAL PASS | 3 of 3 isolated integration tests passed |
| Supplier execution integration | LOCAL PASS | 5 of 5 isolated integration tests passed |
| Supplier live-feed activation | NOT VERIFIED | No live supplier activation performed |

## PDF and Email Evidence

- September 16: user visually approved the documented invoice and
  job-card samples in RELEASE_READINESS_CHECKLIST.md.
- November 5: PDF redesign committed as 826af3f.
- November 5: email and customer-message polish committed as 3fc1ed7.
- Both commits are ancestors of restart-development HEAD 4f0deb7.
- Acceptance of the latest designs and their presence in the current
  hosted Preview must be tracked separately from implementation.

## Deployment Evidence

- Historical hosted Preview acceptance used a Sandbox Supabase project.
- A historical Preview deployment on commit a4b6772 was recorded READY.
- Current local restart-development HEAD: 4f0deb7.
- Current Preview deployment identity and full environment mapping:
  NOT VERIFIED against this register.
- Do not assume a local test pass proves a hosted deployment pass.

## Historical Evidence Locations

- RELEASE_READINESS_CHECKLIST.md
- RELEASE_RUNBOOK.md
- BILLING_VERIFICATION.md
- BLOCK1_ACCESS_CONTROL_TEST_PROCEDURE.md
- Hermes history: /opt/data/.hermes_history
- Supplier artifacts: /opt/data/framersapp-uat/phase5d/
- Repository tests/ and admin/tests/
- Vercel deployment history
- Stripe Test Mode records where applicable

## Retesting Policy

1. Check this register before proposing a test.
2. Identify the exact existing evidence and tested environment.
3. Identify the specific change or missing acceptance evidence.
4. Prefer existing automated tests or read-only inspection.
5. Repeat manual hosted UAT only when justified.
6. Record date, environment, commit, result and evidence after testing.
7. Never infer PASS solely from an instruction requesting a PASS report.

## Open Evidence-Reconciliation Items

- Recover final Skip/Finish onboarding acceptance verdicts if available.
- Establish whether hosted Stripe Test Mode lifecycle was subsequently run.
- Verify which commit and Supabase project current UAT Preview uses.
- Reconcile latest PDF/email visual acceptance with committed versions.
- Link final polishing status from PRE_PRODUCTION_POLISH.md.

## Safety

Production is excluded from UAT unless explicitly authorized.
Do not perform database writes, Stripe transactions, deployments,
commits, pushes, cleanup or destructive testing without approval.
