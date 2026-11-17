# Controlled-pilot checkout control

`POST /api/billing/create-checkout` is disabled by default on the server.

## Pilot deployment

Leave `STRIPE_CHECKOUT_ENABLED` unset or set it to `false` in the intended Vercel environment. Only the exact, case-sensitive string `true` enables checkout. This is a server-only variable: do not use a `VITE_` prefix. No environment change is required to obtain the fail-closed default when the variable is absent.

Disabled POST requests return HTTP 403 with code `CHECKOUT_DISABLED` and message `Subscription checkout is unavailable during the controlled pilot.` The handler checks this before constructing Stripe/Supabase clients, checking account data, reserving checkout capacity, returning an existing payable session or creating a Stripe customer/session. Request bodies, headers and query parameters cannot override the server setting. Non-POST requests retain HTTP 405.

This disables both recurring subscription checkout and Founder one-time checkout through this endpoint. Manual invoice payments, payment recording, commercial documents, billing summary, portal and webhook handlers are unchanged. It does not cancel previously issued Stripe sessions or existing subscriptions; those remain a separate operational review/approval boundary.

## Future activation (requires explicit approval)

Set the server-side variable `STRIPE_CHECKOUT_ENABLED=true` for the specifically approved Vercel project/environment (and branch when appropriate), then deploy the reviewed code with that setting. No variable or deployment has been changed by this implementation.

Before activation, separately verify intended Stripe mode/prices, database and webhook compatibility, public-access policy and payment acceptance. Enabling this variable opens both recurring and Founder checkout, subject to the existing authentication, eligibility and capacity checks. Do not enable it for the controlled pilot.

To disable new checkout again, remove the setting or set it to `false` and deploy with that configuration. Previously issued sessions and subscriptions are not revoked by this switch.
