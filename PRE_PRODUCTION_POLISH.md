# FramersApp — Pre-Production Polish Register

Last reconciled: 2026-11-12
Branch: restart-development
Reference HEAD: 4f0deb7

## Purpose

Track final improvements required before production launch.

Keep implementation, testing, visual acceptance and deployment
status separate. Do not repeat previously completed work.

## Status Definitions

- COMMITTED: Implementation exists in the development branch.
- ACCEPTED: Relevant version has passed acceptance.
- VERIFY: Inspect existing implementation or evidence first.
- TODO: Work remains to be implemented.
- DEFERRED: Intentionally postponed.
- BLOCKER: Must be resolved before production approval.

## 1. PDF Documents

### Quote PDF
- Implementation: COMMITTED
- Commit: 826af3f (2026-11-05)
- Latest visual acceptance: VERIFY

### Invoice PDF
- Implementation: COMMITTED
- Commit: 826af3f (2026-11-05)
- Historical visual acceptance: PASS (2026-09-16)
- Latest redesigned version acceptance: VERIFY

### Job Card PDF
- Implementation: COMMITTED
- Commit: 826af3f (2026-11-05)
- Historical visual acceptance: PASS (2026-09-16)
- Latest redesigned version acceptance: VERIFY

Do not redesign these documents again without identifying a
specific defect or requested improvement.

## 2. Emails and Customer Communications

### Support emails and customer-message drafts
- Implementation: COMMITTED
- Commit: 3fc1ed7 (2026-11-05)
- Final acceptance: VERIFY

### Other transactional and confirmation emails
- Status: VERIFY
- Check whether the November polishing commit covers all
  previously identified basic confirmation emails.
- Only create new work items for gaps actually found.

## 3. Branding

### Stripe-hosted screens
- Status: VERIFY
- Confirm FramersApp logo and branding in the intended
  Stripe environment.
- Do not modify live Stripe settings without approval.

### Sign-up screen logo
- Requirement: FramersApp logo should be white.
- Status: VERIFY

### Login screen logo
- Requirement: FramersApp logo should be white.
- User reported incorrect colour in November 2026.
- Status: VERIFY / POTENTIAL DEFECT

## 4. Dialogs and Notifications

### Application-wide consistency
- Requirement: Replace native browser alerts, prompts,
  confirmations and similar popups with polished in-app
  modals, toasts or snackbars matching FramersApp styling.
- Status: VERIFY / TODO
- Includes the previously reported Settings save popup.
- Audit existing code before implementing changes.
- Preserve confirmation and error-handling behaviour.

## 5. Platform Administration

### Standalone Platform Admin password recovery
- Priority: BLOCKER until verified.
- Requirement: Forgot password on Platform Admin login,
  secure Supabase password-reset flow, correct redirect,
  and successful recovery without exposing credentials.
- Status: VERIFY
- Do not assume ordinary customer password recovery
  covers Platform Admin recovery.

## 6. Release Verification

- Confirm current UAT Preview commit and Sandbox mapping.
- Confirm committed polishing changes are deployed to UAT.
- Check visual acceptance only for materially changed
  PDF/email/UI versions.
- Preserve previous functional UAT passes.
- Confirm no test configuration or credentials are exposed
  to Production.
- Obtain explicit production release approval.

## 7. Working Rules

1. Inspect existing code and evidence before creating work.
2. Do not treat a committed feature as an outstanding build task.
3. Do not treat historical acceptance as approval of a newer design.
4. Avoid repeating passed tests without a specific reason.
5. Record each decision with date, commit and evidence.
6. Do not modify Production or live Stripe without approval.

## Related Documents

- UAT_TEST_REGISTER.md
- RELEASE_READINESS_CHECKLIST.md
- RELEASE_RUNBOOK.md
- BILLING_VERIFICATION.md
