# Block 1 Access-Control Regression Procedure

Run this only against a local or disposable Supabase project after applying `migrations/20260914_block1_access_controls.sql`. Do not run these checks against production data.

## Setup

Create or identify these test users and capture their JWTs and user IDs:

- `OWNER_A`: owns `COMPANY_A`.
- `STAFF_A`: active staff member of `COMPANY_A`.
- `USER_B`: unrelated user with no membership in `COMPANY_A`.
- `INVITED_C`: has a confirmed auth email and a pending `company_members` row for `COMPANY_A` with that exact email.

Use the anon key for direct browser-style Supabase requests. Use the service-role key only to seed test rows and to clean them up.

## Checks

1. Unrelated user cannot join another company.

   As an anonymous client, try to insert a `company_members` row for `COMPANY_A`. Expected result: authentication/RLS denial.

   As `USER_B` with the anon client, try to insert a `company_members` row for `COMPANY_A` with `role = 'owner'` and `status = 'active'`. Expected result: request is denied by privileges/RLS.

   Then call `rpc('accept_company_invitation')` as `USER_B`. Expected result: `No pending invitation found for authenticated user`.

2. Staff cannot promote or reactivate themselves.

   As `STAFF_A` with the anon client, try to update their own `company_members` row with `role = 'owner'`, `status = 'active'`, or a different `company_account_id`. Expected result: role/status/company changes are denied because only `full_name` and `phone` are granted for direct member updates.

   Seed a second staff row for `STAFF_A` with `status = 'inactive'`, then as `STAFF_A` try to update it to `status = 'active'`. Expected result: denied; inactive memberships cannot self-reactivate.

   As `STAFF_A`, update only `full_name` or `phone`. Expected result: succeeds while membership role, status, user ID, email, and company ID are unchanged.

3. Owner cannot directly change billing fields.

   As `OWNER_A` with the anon client, try to update `company_accounts.plan_status`, `trial_started_at`, `trial_ends_at`, `trial_extended_days`, `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `subscription_renewed_at`, or `subscription_cancel_at`. Expected result: denied by column grants or preserved by the client-field guard trigger.

   As `OWNER_A`, update only `company_name`. Expected result: succeeds.

4. Valid signup still works.

   As a new authenticated user with no account and no active invitation, call `rpc('create_company_trial_account', { p_company_name: 'Access Test Frames' })`. Expected result: returns a new company account with `plan_status = 'trialing'`, default trial dates, no Stripe IDs, and an active owner membership for the authenticated user's email.

   Call the same RPC again as the same user, including with a different `p_company_name`. Expected result: returns the existing account and does not restart or extend `trial_started_at` or `trial_ends_at`.

   Start two near-simultaneous calls to the same RPC as the same new user. Expected result: at most one account is created for the user; any returned rows use the same `owner_user_id` account and original trial window.

   Seed a pending invite for a new user's email, then as that user call `rpc('create_company_trial_account')` before accepting the invite. Expected result: `Existing company membership or invitation found`; no separate owner account is created.

5. Valid invitation acceptance still works.

   Seed an invited `company_members` row for `INVITED_C` using service-role code. As `INVITED_C`, call `rpc('accept_company_invitation')`. Expected result: the existing invitation changes to `status = 'active'`, sets `user_id` to `INVITED_C`, preserves its original `role` and `company_account_id`, and sets `joined_at` if it was null.

   Repeat with an authenticated but unconfirmed email account. Expected result: rejected with an authentication/confirmed-email error.

   Seed an inactive row for `INVITED_C` and call the same RPC. Expected result: rejected; inactive/revoked invitations are not reactivated.

   Seed an invitation with `user_id` already set to a different auth user, then call the RPC as `INVITED_C`. Expected result: rejected; the caller cannot claim another user's membership.

   As an anonymous client, call `rpc('accept_company_invitation')`. Expected result: authentication error.

6. Concurrent revocation versus acceptance is safe.

   Use two SQL sessions against the disposable database. In session A, begin a transaction and lock the invitation row as an administrator with `select * from public.company_members where id = '<invite_id>' for update;`, but do not commit yet. In session B, call `rpc('accept_company_invitation')` as `INVITED_C`; it should wait on the row lock. In session A, update the invitation to `status = 'inactive'` and commit. Expected result: session B completes with `No pending invitation found for authenticated user`, and the row remains inactive with no new `user_id` claim.

   Reset the row to a pending invitation. Start two simultaneous `rpc('accept_company_invitation')` calls as `INVITED_C` from separate authenticated clients. Expected result: one call activates the invitation; the other fails or returns no row after the lock is released. The final row preserves the original company and role and has exactly one authenticated `user_id`.

7. Support records and internal comments are not browser-accessible.

   As unauthenticated and as `USER_B`, try direct anon-client selects/inserts/updates/deletes on `support_tickets` and `support_ticket_comments`. Expected result: denied.

   As `OWNER_A`, `STAFF_A`, and `INVITED_C`, try direct anon-client reads of `support_ticket_comments`, including `visibility = 'internal'` rows. Expected result: denied; support access goes through server handlers only.

   Through `/api/support/tickets`, create and list tickets as an authenticated company user. Expected result: server handler succeeds and lists only that user's company/requester tickets.

   Through `/api/admin/ticket-comments`, create an internal comment as an owner or manager. Expected result: server handler succeeds. Direct anon-client reads of `support_ticket_comments` still fail, including for unrelated companies.

## Cleanup

Use service-role cleanup in the disposable project to delete the test support records, memberships, and company accounts created during these checks.

## Rollout

The final enforcement migration is not compatible with already-open old browser clients. Once restrictions are enforced, old clients that create company accounts, claim invites, or write owner membership rows directly will fail until they reload the deployed frontend that uses the RPCs. The new frontend also expects the RPCs to exist, so do not deploy it ahead of database preparation outside a controlled window.

Concrete maintenance-window sequence for the current single migration:

1. Announce a short maintenance window for signup and invited-member onboarding.
2. During the window, prevent or pause user-facing signup and invited-member onboarding traffic.
3. Apply the full enforcement migration transactionally.
4. Deploy the frontend that uses `create_company_trial_account`, `accept_company_invitation`, `ensure_owner_membership`, and `get_company_billing_access` immediately after the migration completes.
5. Ask users with open app tabs to refresh. Users who hit an old-client failure can safely recover by refreshing and retrying signup or invitation acceptance; the migration does not delete existing account, membership, or support rows.
6. Run the regression checks above in staging before applying the same sequence to production.

An additive compatibility phase is possible only if it creates the new RPCs without installing the account-field trigger or revoking old direct-write grants. That phase must be followed by the controlled enforcement migration; keeping legacy direct-write grants is not an acceptable final state.