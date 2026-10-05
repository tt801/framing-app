import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { VercelRequest, VercelResponse } from "@vercel/node";

type CompanyAccount = {
  id: string;
  company_name: string | null;
  plan_status: "trialing" | "active" | "past_due" | "expired";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  subscription_renewed_at: string | null;
  subscription_cancel_at: string | null;
  trial_started_at: string;
  trial_ends_at: string;
  has_ever_paid_recurring: boolean | null;
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function requireBillingUser(req: VercelRequest) {
  const authHeader = req.headers.authorization || "";
  const authArray = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const auth = authArray.split(" ")[1];
  if (!auth) throw new Error("Unauthorized");

  const { data, error } = await supabase.auth.getUser(auth);
  if (error || !data.user) throw new Error("Invalid token");

  const { data: account, error: acErr } = await supabase
    .from("company_accounts")
    .select(
      "id, company_name, plan_status, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_renewed_at, subscription_cancel_at, trial_started_at, trial_ends_at, has_ever_paid_recurring"
    )
    .eq("owner_user_id", data.user.id)
    .single();

  if (acErr || !account) throw new Error("No company account");
  return { user: data.user, account: account as CompanyAccount };
}

const getAction = (req: VercelRequest) => {
  const action = req.query?.billingAction;
  return Array.isArray(action) ? action[0] : action;
};

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

async function handleSummary(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const { account } = await requireBillingUser(req);
  const founderMaxPurchases = Number(process.env.FOUNDER_MAX_PURCHASES || 10);

  const { count, error } = await supabase
    .from("company_accounts")
    .select("id", { count: "exact", head: true })
    .eq("stripe_price_id", "founder_lifetime");

  if (error) throw error;

  const { count: reservedCount, error: reservationError } = await supabase
    .from("stripe_checkout_attempts")
    .select("id", { count: "exact", head: true })
    .eq("founder_reserved", true)
    .eq("status", "pending");
  if (reservationError) throw reservationError;
  if (count === null || reservedCount === null || !Number.isInteger(founderMaxPurchases) || founderMaxPurchases < 1) {
    throw new Error("Founder capacity is unavailable");
  }

  const founderPurchasedCount = count;
  const founderRemaining = Math.max(founderMaxPurchases - founderPurchasedCount - reservedCount, 0);
  const now = Date.now();
  const trialStart = Date.parse(account.trial_started_at);
  const trialEnd = Date.parse(account.trial_ends_at);
  const founderEligible = founderRemaining > 0 && account.plan_status === "trialing" &&
    account.has_ever_paid_recurring === false && account.stripe_subscription_id === null &&
    account.stripe_price_id !== "founder_lifetime" && Number.isFinite(trialStart) && Number.isFinite(trialEnd) &&
    trialStart <= now && now < trialEnd && now < trialStart + 14 * 24 * 60 * 60 * 1000;

  const planNames: Array<[string | undefined, string]> = [
    [process.env.VITE_STRIPE_PRICE_STARTER, "Starter"],
    [process.env.VITE_STRIPE_PRICE_GROWTH, "Growth"],
    [process.env.VITE_STRIPE_PRICE_PRO, "Pro"],
  ];
  const planName = account.stripe_price_id === "founder_lifetime" ? "Founder Lifetime"
    : account.stripe_price_id
      ? planNames.find(([id]) => id && id === account.stripe_price_id)?.[1] || "Subscription"
      : "Free trial";
  let plan: { name: string; unitAmount: number | null; currency: string | null; interval: string | null; intervalCount: number | null } =
    { name: planName, unitAmount: null, currency: null, interval: null, intervalCount: null };
  if (account.stripe_subscription_id && account.stripe_price_id && account.stripe_price_id !== "founder_lifetime") {
    try {
      const price = await stripe.prices.retrieve(account.stripe_price_id);
      if (price.id === account.stripe_price_id && price.recurring) {
        plan = { name: planName, unitAmount: price.unit_amount, currency: price.currency,
          interval: price.recurring.interval, intervalCount: price.recurring.interval_count };
      }
    } catch {
      // Entitlement comes from the account, not availability of Stripe price metadata.
    }
  }

  return res.status(200).json({
    account,
    plan,
    founder: {
      maxPurchases: founderMaxPurchases,
      purchasedCount: founderPurchasedCount,
      remaining: founderRemaining,
      soldOut: founderRemaining === 0,
      eligible: founderEligible,
    },
    portalEligible: Boolean(
      account.stripe_customer_id &&
        account.stripe_subscription_id &&
        account.stripe_price_id !== "founder_lifetime"
    ),
  });
}

async function handleCreatePortal(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { account } = await requireBillingUser(req);

  if (!account.stripe_customer_id || !account.stripe_subscription_id) {
    throw new Error("No active subscription to manage");
  }

  if (account.stripe_price_id === "founder_lifetime") {
    throw new Error("Founder plan does not use the billing portal");
  }

  const baseUrl = getBaseUrl(req);

  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripe_customer_id,
    return_url: `${baseUrl}#/billing`,
  });

  return res.status(200).json({ url: session.url });
}

// Read-only confirmation: a returned URL is not proof of payment or entitlement.
// Look up the session under the authenticated owner's company before contacting
// Stripe, then require this exact session's payment and matching persisted access.
async function handleConfirmCheckout(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();
  const { account } = await requireBillingUser(req);
  const raw = req.query?.session_id;
  const sessionId = Array.isArray(raw) ? null : raw;
  if (typeof sessionId !== "string" || !/^cs_[a-zA-Z0-9_]{1,220}$/.test(sessionId)) {
    return res.status(400).json({ error: "Invalid Checkout session" });
  }
  const { data: attempt, error } = await supabase.from("stripe_checkout_attempts")
    .select("company_account_id,session_id,customer_id,price_id,status,founder_reserved")
    .eq("company_account_id", account.id).eq("session_id", sessionId).maybeSingle();
  if (error) throw error;
  if (!attempt) return res.status(404).json({ error: "Checkout session not found" });
  if (!account.stripe_customer_id || attempt.customer_id !== account.stripe_customer_id) {
    return res.status(409).json({ error: "Checkout customer mismatch" });
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (session.id !== sessionId || customerId !== account.stripe_customer_id) {
    return res.status(409).json({ error: "Checkout identity mismatch" });
  }
  const founder = attempt.price_id === process.env.VITE_STRIPE_PRICE_FOUNDER && Boolean(process.env.VITE_STRIPE_PRICE_FOUNDER);
  if ((founder && session.mode !== "payment") || (!founder && session.mode !== "subscription")) {
    return res.status(409).json({ error: "Checkout mode mismatch" });
  }
  if (attempt.status === "failed" || session.status === "expired") {
    return res.status(200).json({ status: "rejected" });
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    return res.status(200).json({ status: "pending" });
  }
  if (founder) {
    if (attempt.status === "completed" && account.plan_status === "active" && account.stripe_price_id === "founder_lifetime") {
      return res.status(200).json({ status: "confirmed", kind: "founder", companyName: account.company_name });
    }
  } else {
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (subscriptionId && account.plan_status === "active" && account.stripe_subscription_id === subscriptionId &&
        account.stripe_price_id === attempt.price_id) {
      return res.status(200).json({ status: "confirmed", kind: "recurring", companyName: account.company_name });
    }
  }
  return res.status(200).json({ status: "pending" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const action = getAction(req);

    if (action === "summary") {
      return await handleSummary(req, res);
    }

    if (action === "create-portal") {
      return await handleCreatePortal(req, res);
    }
    if (action === "confirm-checkout") {
      return await handleConfirmCheckout(req, res);
    }

    return res.status(404).json({ error: "Unknown billing action" });
  } catch (error) {
    console.error("[billing-manage] Error:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}