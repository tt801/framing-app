## Stripe Payment Integration Setup

This document describes future setup; it is **not authorization to configure Stripe Live**. Alex verified the newly enabled Live account has no subscriptions, payments, Checkout sessions, products/prices or webhook destinations. All prior Stripe work was test-mode. Run the isolated sandbox lifecycle against the v2 implementation first. Then follow [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)'s approved EXPAND → deploy → Live-configuration sequence, with separate approval for each production change. Recheck the Live account before release; do not reuse sandbox price IDs, signing secrets or keys in Live.

---

## Step 1: Create a Stripe Account

1. Go to [stripe.com](https://stripe.com) and click **Start now** (or sign in if you already have an account)
2. Complete the signup with your business details
3. Verify your email
4. You'll land in the Stripe Dashboard

---

## Step 2: Install Dependencies

In your project root, run:

```bash
npm install
```

This installs `stripe` (backend) and `@stripe/stripe-js` (frontend) packages.

---

## Step 3: Get API Keys

1. In Stripe Dashboard, go to **Developers** (top-right corner)
2. Click on **API keys** (left sidebar)
3. You'll see:
   - **Publishable key** (starts with `pk_`)
   - **Secret key** (starts with `sk_`)

4. Copy both keys and save them securely

---

## Step 4: Create Products & Prices in Stripe

### Create Starter Plan:

1. In Stripe Dashboard, go to **Products** (left sidebar under Billing)
2. Click **+ Add product**
3. Fill in:
   - **Name**: `Framers App - Starter`
   - **Description**: `For solo framers and small studios`
   - **Pricing model**: Recurring (subscription)
   - **Billing period**: Monthly
   - **Price**: Enter your price in ZAR (e.g., `499` for R499)
   - **Currency**: ZAR

4. Click **Save product**
5. You'll see a **Price ID** at the top — copy it. Format: `price_xxx...`

### Create Growth Plan:

Repeat the above but for the Growth plan:
- **Name**: `Framers App - Growth`
- **Description**: `For growing teams`
- **Price**: `999` (or your chosen price)

---

## Step 5: Update Your Environment Variables

### In Vercel (Production; only after the sandbox lifecycle and separate Alex approval):

1. Go to your Vercel project → **Settings** → **Environment Variables**
2. Add:

```
STRIPE_SECRET_KEY=sk_live_xxx...     (your secret key)
STRIPE_WEBHOOK_SECRET=whsec_xxx...   (empty for now, fill after Step 6)
VITE_STRIPE_PUBLIC_KEY=pk_live_xxx... (your publishable key)
VITE_STRIPE_PRICE_STARTER=price_xxx...
VITE_STRIPE_PRICE_GROWTH=price_xxx...
VITE_STRIPE_PRICE_PRO=price_xxx...
VITE_STRIPE_PRICE_FOUNDER=price_xxx...
FOUNDER_MAX_PURCHASES=10
```

### In `.env.local` (Local Development):

Create or update `.env.local` in your project root:

```
STRIPE_SECRET_KEY=sk_test_xxx...
STRIPE_WEBHOOK_SECRET=whsec_test_xxx...  (empty for now)
VITE_STRIPE_PUBLIC_KEY=pk_test_xxx...
VITE_STRIPE_PRICE_STARTER=price_xxx...
VITE_STRIPE_PRICE_GROWTH=price_xxx...
VITE_STRIPE_PRICE_PRO=price_xxx...
VITE_STRIPE_PRICE_FOUNDER=price_xxx...
FOUNDER_MAX_PURCHASES=10
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

---

## Step 6: Run Database Migration

1. For a **fresh** installation only, use the baseline sequence in `RELEASE_RUNBOOK.md` (including `STRIPE_SETUP.sql`). Do not rerun baseline SQL on an existing production database.
2. For an existing installation, apply only approved ordered forward migrations; the proposed `20261001_founder_paid_history.sql` EXPAND is not yet approved and must precede the v2 deployment.
3. Check transactional error stopping, signatures, grants and trigger behavior before moving to deployment.

---

## Step 7: Set Up Webhooks Locally (Development)

For local testing, you need to forward Stripe webhooks to your machine:

### Install Stripe CLI:

**macOS (Homebrew):**
```bash
brew install stripe/stripe-cli/stripe
```

**Windows (Chocolatey):**
```bash
choco install stripe
```

**Or download directly:** [stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)

### Login & Forward:

```bash
stripe login
```

Follow the prompt to authenticate your Stripe account.

Then forward webhooks:

```bash
stripe listen --forward-to localhost:5173/api/billing/webhook
```

This will output a **webhook signing secret** (starts with `whsec_test_`). Copy it.

Add to your `.env.local`:
```
STRIPE_WEBHOOK_SECRET=whsec_test_...
```

---

## Step 8: Set Up Webhooks for Production (Later, With Separate Approval)

The Stripe Live account currently has **no webhook endpoint**. Only configure
one after the sandbox lifecycle, approved EXPAND and v2 deployment, and after
old checkout/webhook instances have drained. Then, in the **Live** Dashboard:

1. In Stripe Dashboard, go to **Developers** → **Webhooks** (left sidebar)
2. Click **+ Add endpoint**
3. Fill in:
   - **Endpoint URL**: `https://framersapp.com/api/billing/webhook` (verify the deployed route first)
   - **Events to send**: Replace default with just these events:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded` **(required for durable recurring paid-history)**

4. Click **Add endpoint**
5. You'll see the new endpoint. Click it.
6. Scroll down to **Signing secret**. Click **Reveal**. Copy it.
7. Go to Vercel → **Settings** → **Environment Variables**
8. Update `STRIPE_WEBHOOK_SECRET` with this production secret

Before enabling Live Checkout, verify the **actual live endpoint** is subscribed
to all four events and signed delivery reaches the v2 webhook. The source guide
does not prove event configuration. Create the recurring Starter/Growth/Pro
products/prices and Founder lifetime one-time product/price only after separate
Alex approval, and verify amount, currency, active status and mode before wiring
Live price IDs. Do not enable paid recurring Checkout before
`invoice.payment_succeeded` is being handled.

The current `has_ever_paid_recurring` trust rule records a signed, positive-amount
`invoice.payment_succeeded` for the matched FramersApp customer and recurring
subscription. It assumes card-only subscription Checkout, with no application-
configured trial or promotion codes. Adding credit-balance-funded service, free/
zero-value arrangements, asynchronous payment methods, or another payment
provenance requires revisiting this trust rule **before enabling the capability**.

---

## Step 9: Test the Flow Locally

1. Make sure Stripe CLI is running (`stripe listen --forward-to ...`)
2. Start your dev server: `npm run dev`
3. Go to `http://localhost:5173` and click **Start Free Trial**
4. Sign up with a test email
5. Wait 14 days (or manually update `trial_ends_at` in Supabase to test)
6. When trial expires, click **Upgrade**
7. Select a plan and click **Upgrade to...**
8. You'll be redirected to Stripe Checkout
9. Use Stripe's test card: `4242 4242 4242 4242`
   - Expiry: any future date (e.g., `12/30`)
   - CVC: any 3 digits (e.g., `123`)
10. Complete the payment
11. You'll be redirected to `/billing/success`
12. The webhook will update your `company_accounts` row to `plan_status = 'active'`

---

## Step 10: Release Gate (Do Not Deploy Without Approval)

Review the development-branch changes and tests; complete isolated sandbox
validation first, then obtain Alex's explicit approvals for EXPAND, deployment
and eventual Live Stripe setup separately. The Live account currently has no
products, prices or endpoint to validate. Never push directly to `main`.
Verify the required Vercel variable **names/scopes** without exposing values:
`STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLIC_KEY`, the recurring and Founder price
IDs, `STRIPE_WEBHOOK_SECRET`, and `FOUNDER_MAX_PURCHASES` when configured.

---

## Troubleshooting

### Webhook not triggering?
- Ensure Stripe CLI is running locally during testing
- Check webhook URL in Stripe Dashboard → Webhooks
- View webhook logs in Supabase: `stripe_webhook_logs` table
- Use [BILLING_VERIFICATION.md](BILLING_VERIFICATION.md) for production verification and SQL checks after deploys

### Checkout redirects to wrong URL?
- Verify `VITE_STRIPE_PUBLIC_KEY` is set in `.env.local`
- Verify `VITE_STRIPE_PRICE_STARTER`, `VITE_STRIPE_PRICE_GROWTH`, `VITE_STRIPE_PRICE_PRO`, and `VITE_STRIPE_PRICE_FOUNDER` match your Stripe price IDs
- If Founder checkout is blocked unexpectedly, verify `FOUNDER_MAX_PURCHASES` is higher than the number of existing `founder_lifetime` accounts in `company_accounts`

### Trial check shows "not authenticated"?
- Ensure user is logged in before accessing upgrade flow
- Check that `company_accounts` row exists for the user

### Can't find price IDs?
- In Stripe Dashboard → Products
- Open a product
- In the Pricing section, you'll see the Price ID (format: `price_xxx...`)

---

## Stripe Test Cards

For testing in development:

| Card | Number | CVC | Expiry |
|------|--------|-----|--------|
| Visa (success) | 4242 4242 4242 4242 | any | any future |
| Visa (decline) | 4000 0000 0000 0002 | any | any future |
| Amex (success) | 3782 822463 10005 | any 4 digits | any future |

---

## Files Changed

- ✅ `STRIPE_SETUP.sql` — Database schema for Stripe integration
- ✅ `api/billing/create-checkout.ts` — Creates Stripe checkout sessions
- ✅ `api/billing/webhook.ts` — Handles Stripe webhook events
- ✅ `src/lib/trial.ts` — Updated to include `useStripeCheckout` hook
- ✅ `src/components/UpgradeModal.tsx` — UI modal for plan selection
- ✅ `src/pages/BillingSuccess.tsx` — Success page after payment
- ✅ `src/App.tsx` — Added billing success route
- ✅ `package.json` — Added `stripe` and `@stripe/stripe-js` packages

---

## Next Steps

1. **Monitor webhooks**: After going live, check `stripe_webhook_logs` table occasionally to ensure payments are processed
2. **Email receipts**: Add email templates to Stripe → Settings → Email to send receipts automatically
3. **Refund handling**: Set up a refund flow (or manual process) for users who want to cancel
4. **Upgrade on dashboard**: Add an "Upgrade" button in the app dashboard for users nearing trial end

---

## Support

- **Stripe Docs**: [stripe.com/docs](https://stripe.com/docs)
- **Webhook Events**: [stripe.com/docs/api/events/object](https://stripe.com/docs/api/events/object)
- **Checkout Session**: [stripe.com/docs/api/checkout/sessions](https://stripe.com/docs/api/checkout/sessions)
