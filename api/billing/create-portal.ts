import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { VercelRequest, VercelResponse } from "@vercel/node";

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
    .select("id, stripe_customer_id, stripe_subscription_id, stripe_price_id")
    .eq("owner_user_id", data.user.id)
    .single();

  if (acErr || !account) throw new Error("No company account");
  return { user: data.user, account };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { account } = await requireBillingUser(req);

    if (!account.stripe_customer_id || !account.stripe_subscription_id) {
      throw new Error("No active subscription to manage");
    }

    if (account.stripe_price_id === "founder_lifetime") {
      throw new Error("Founder plan does not use the billing portal");
    }

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5173";

    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: `${baseUrl}#/billing`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("[billing-portal] Error:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}