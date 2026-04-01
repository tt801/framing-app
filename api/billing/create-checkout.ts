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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { user, account } = await requireBillingUser(req);
    const { priceId, isOneTime } = req.body;

    if (!priceId) throw new Error("priceId required");
    if (!allowedPriceIds.has(priceId)) throw new Error("Invalid priceId");

    const isFounderCheckout = priceId === founderPriceId;
    if (Boolean(isOneTime) !== isFounderCheckout) {
      throw new Error("Invalid plan configuration");
    }

    if (isFounderCheckout) {
      const { count, error: founderError } = await supabase
        .from("company_accounts")
        .select("id", { count: "exact", head: true })
        .eq("stripe_price_id", "founder_lifetime");

      if (founderError) throw founderError;
      if ((count || 0) >= founderMaxPurchases) {
        throw new Error("Founder plan is sold out");
      }
    }

    // Create or retrieve Stripe customer
    let customerId = account.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          company_account_id: account.id,
          owner_user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save Stripe customer to Supabase
      await supabase
        .from("company_accounts")
        .update({ stripe_customer_id: customerId })
        .eq("id", account.id);
    }

    // Create checkout session
    // Founder plan is a one-time payment, all others are recurring subscriptions
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5173";

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
    });

    res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error("[create-checkout] Error:", error);
    res.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
