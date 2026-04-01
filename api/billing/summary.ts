import { createClient } from "@supabase/supabase-js";
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();

  try {
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
  } catch (error) {
    console.error("[billing-summary] Error:", error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}