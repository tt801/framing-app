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
      "id, company_name, plan_status, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_renewed_at, subscription_cancel_at, trial_started_at, trial_ends_at"
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

  const founderPurchasedCount = count || 0;
  const founderRemaining = Math.max(founderMaxPurchases - founderPurchasedCount, 0);

  return res.status(200).json({
    account,
    founder: {
      maxPurchases: founderMaxPurchases,
      purchasedCount: founderPurchasedCount,
      remaining: founderRemaining,
      soldOut: founderRemaining === 0,
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const action = getAction(req);

    if (action === "summary") {
      return await handleSummary(req, res);
    }

    if (action === "create-portal") {
      return await handleCreatePortal(req, res);
    }

    return res.status(404).json({ error: "Unknown billing action" });
  } catch (error) {
    console.error("[billing-manage] Error:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}