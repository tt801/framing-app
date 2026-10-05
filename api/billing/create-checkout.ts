import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const founderPriceId = process.env.VITE_STRIPE_PRICE_FOUNDER || "";
const allowedPriceIds = new Set(
  [
    process.env.VITE_STRIPE_PRICE_STARTER,
    process.env.VITE_STRIPE_PRICE_GROWTH,
    process.env.VITE_STRIPE_PRICE_PRO,
    founderPriceId,
  ].filter((value): value is string => Boolean(value))
);
const founderMaxPurchases = Number(process.env.FOUNDER_MAX_PURCHASES || 10);

// ─ Verify auth and get user/company
async function requireBillingUser(req: VercelRequest) {
  const authHeader = req.headers.authorization || "";
  const authArray = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const auth = authArray.split(" ")[1];
  if (!auth) throw new Error("Unauthorized");

  const { data, error } = await supabase.auth.getUser(auth);
  if (error || !data.user) throw new Error("Invalid token");

  const { data: account, error: acErr } = await supabase
    .from("company_accounts")
    .select("*")
    .eq("owner_user_id", data.user.id)
    .single();

  if (acErr || !account) throw new Error("No company account");
  return { user: data.user, account };
}

function getBaseUrl(req: VercelRequest) {
  const configured = (process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;

  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const host = req.headers.host;

  if (proto && host) {
    return `${proto}://${host}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:5173";
}

async function releaseExpiredFounderReservations() {
  const { data: stale, error } = await supabase.from('stripe_checkout_attempts')
    .select('id,company_account_id,session_id,expires_at')
    .eq('founder_reserved', true).eq('status', 'pending')
    .lte('expires_at', new Date().toISOString());
  if (error) throw error;
  for (const attempt of stale || []) {
    if (attempt.session_id) {
      const session = await stripe.checkout.sessions.retrieve(attempt.session_id);
      // A timestamp alone cannot release a slot: payment may precede a late
      // webhook. Only Stripe's terminal expired/unpaid state is safe to free.
      if (session.status !== 'expired' || session.payment_status === 'paid') continue;
    }
    const { data: released, error: releaseError } = await supabase.rpc('expire_stripe_checkout_attempt', {
      p_attempt_id: attempt.id, p_company_account_id: attempt.company_account_id,
    });
    if (releaseError || released !== true) throw releaseError || new Error('Founder reservation could not be released');
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  let unreturnedFounderAttempt: { id: string; companyId: string } | null = null;
  try {
    const { user, account } = await requireBillingUser(req);
    const { priceId, isOneTime } = req.body;

    if (!priceId) throw new Error("priceId required");
    if (!allowedPriceIds.has(priceId)) throw new Error("Invalid priceId");

    const isFounderCheckout = priceId === founderPriceId;
    if (Boolean(isOneTime) !== isFounderCheckout) {
      throw new Error("Invalid plan configuration");
    }

    let idempotencyKey = isFounderCheckout
      ? `checkout:${account.id}:${priceId}:${randomUUID()}`
      : `checkout:${account.id}:${priceId}`;
    const beginAttempt = () => supabase.rpc("begin_stripe_checkout_v2", {
      p_company_account_id: account.id,
      p_price_id: priceId,
      p_idempotency_key: idempotencyKey,
      p_is_founder: isFounderCheckout,
      p_founder_max: founderMaxPurchases,
    });
    let { data: attempt, error: attemptError } = await beginAttempt();
    if (attemptError) throw attemptError;
    let checkoutAttempt = Array.isArray(attempt) ? attempt[0] : attempt;
    if (isFounderCheckout && checkoutAttempt?.reason === 'Founder plan is sold out') {
      await releaseExpiredFounderReservations();
      ({ data: attempt, error: attemptError } = await beginAttempt());
      if (attemptError) throw attemptError;
      checkoutAttempt = Array.isArray(attempt) ? attempt[0] : attempt;
    }
    if (!checkoutAttempt?.allowed && isFounderCheckout && checkoutAttempt?.reason?.startsWith('Stripe session status must be confirmed') && !checkoutAttempt.existing_session_id) {
      await releaseExpiredFounderReservations();
      ({ data: attempt, error: attemptError } = await beginAttempt());
      if (attemptError) throw attemptError;
      checkoutAttempt = Array.isArray(attempt) ? attempt[0] : attempt;
    }
    if (!checkoutAttempt?.allowed && checkoutAttempt?.reason?.startsWith("Stripe session status must be confirmed") && checkoutAttempt.existing_session_id) {
      const existing = await stripe.checkout.sessions.retrieve(checkoutAttempt.existing_session_id);
      if (existing.status === "expired" && existing.payment_status !== "paid") {
        const { data: expired, error: expireError } = await supabase.rpc("expire_stripe_checkout_attempt", { p_attempt_id: checkoutAttempt.attempt_id, p_company_account_id: account.id });
        if (expireError || expired !== true) throw expireError || new Error("Checkout expiry could not be confirmed");
        idempotencyKey = `checkout:${account.id}:${priceId}:${randomUUID()}`;
        ({ data: attempt, error: attemptError } = await beginAttempt());
        if (attemptError) throw attemptError;
        checkoutAttempt = Array.isArray(attempt) ? attempt[0] : attempt;
      } else {
        if (!existing.url) throw new Error("Checkout status is unresolved; retry later");
        return res.status(200).json({ sessionId: existing.id, url: existing.url });
      }
    }
    if (!checkoutAttempt?.allowed) throw new Error(checkoutAttempt?.reason || "Checkout is unavailable");
    if (checkoutAttempt.existing_session_id) return res.status(200).json({ sessionId: checkoutAttempt.existing_session_id, url: checkoutAttempt.existing_session_url });
    if (isFounderCheckout) unreturnedFounderAttempt = { id: checkoutAttempt.attempt_id, companyId: account.id };

    // Create or retrieve Stripe customer
    let customerId = account.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          company_account_id: account.id,
          owner_user_id: user.id,
        },
      }, { idempotencyKey: `customer:${account.id}` });
      customerId = customer.id;

      // Save Stripe customer to Supabase
      const { error: customerSaveError } = await supabase
        .from("company_accounts")
        .update({ stripe_customer_id: customerId })
        .eq("id", account.id)
        .select("id")
        .single();
      if (customerSaveError) throw customerSaveError;
    }

    // Create checkout session
    // Founder plan is a one-time payment, all others are recurring subscriptions
    const baseUrl = getBaseUrl(req);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: isFounderCheckout ? "payment" : "subscription",
      ...(isFounderCheckout ? { expires_at: Math.floor(Date.now() / 1000) + 35 * 60 } : {}),
      success_url: `${baseUrl}#/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}#/app`,
      ...(isFounderCheckout
        ? {
            payment_intent_data: {
              metadata: { company_account_id: account.id },
            },
          }
        : {
            subscription_data: {
              metadata: { company_account_id: account.id },
            },
          }),
    }, { idempotencyKey: checkoutAttempt.idempotency_key });

    const { data: sessionSaved, error: sessionSaveError } = await supabase.rpc("save_stripe_checkout_session", {
      p_attempt_id: checkoutAttempt.attempt_id,
      p_company_account_id: account.id,
      p_session_id: session.id,
      p_session_url: session.url,
      p_customer_id: customerId,
      p_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    if (sessionSaveError || sessionSaved !== true) throw sessionSaveError || new Error("Checkout session could not be recorded");

    if (!session.url) throw new Error("Stripe checkout URL missing");
    unreturnedFounderAttempt = null;
    res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (error) {
    if (unreturnedFounderAttempt) {
      try {
        const { data: released, error: releaseError } = await supabase.rpc('expire_stripe_checkout_attempt', {
          p_attempt_id: unreturnedFounderAttempt.id, p_company_account_id: unreturnedFounderAttempt.companyId,
        });
        if (releaseError || released !== true) console.error('[create-checkout] Founder release failed:', releaseError || 'not released');
      } catch (releaseError) {
        console.error('[create-checkout] Founder release failed:', releaseError);
      }
    }
    console.error("[create-checkout] Error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
