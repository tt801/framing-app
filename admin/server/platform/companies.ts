import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { PlatformDependencies } from "./dependencies.js";

export function createHandler({ getSupabaseAdmin, requirePlatformAdmin, platformAdminError }: PlatformDependencies) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    await requirePlatformAdmin(req);

    const { data: companies, error } = await getSupabaseAdmin()
      .from("company_accounts")
      .select(
        "id,company_name,owner_user_id,plan_status,stripe_price_id,stripe_customer_id,stripe_subscription_id,has_ever_paid_recurring,subscription_renewed_at,subscription_cancel_at,trial_started_at,trial_ends_at,created_at"
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    const ids = (companies ?? []).map((c: { id: string }) => c.id as string);

    // Member counts and open ticket counts in parallel
    const [{ data: memberRows }, { data: ticketRows }] = await Promise.all([
      ids.length
        ? getSupabaseAdmin()
            .from("company_members")
            .select("company_account_id")
            .in("company_account_id", ids)
            .eq("status", "active")
        : Promise.resolve({ data: [] }),
      ids.length
        ? getSupabaseAdmin()
            .from("support_tickets")
            .select("company_account_id")
            .in("company_account_id", ids)
            .eq("status", "open")
        : Promise.resolve({ data: [] }),
    ]);

    const memberCounts = (memberRows ?? []).reduce((acc: Record<string, number>, r: { company_account_id: string }) => {
      acc[r.company_account_id as string] = (acc[r.company_account_id as string] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const ticketCounts = (ticketRows ?? []).reduce((acc: Record<string, number>, r: { company_account_id: string | null }) => {
      if (r.company_account_id)
        acc[r.company_account_id as string] =
          (acc[r.company_account_id as string] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const enriched = (companies ?? []).map((c: { id: string; stripe_price_id: string | null; plan_status: string }) => ({
      ...c,
      plan_name: c.stripe_price_id === "founder_lifetime" ? "Founder Lifetime" :
        (["STARTER", "GROWTH", "PRO"] as const).find((name) =>
          process.env[`VITE_STRIPE_PRICE_${name}`] && process.env[`VITE_STRIPE_PRICE_${name}`] === c.stripe_price_id
        )?.toLowerCase() ?? (c.plan_status === "trialing" ? "Trial" : "Subscription"),
      member_count: memberCounts[c.id as string] ?? 0,
      open_tickets: ticketCounts[c.id as string] ?? 0,
    }));

    return res.status(200).json({ companies: enriched });
  } catch (err) {
    const { status, message } = platformAdminError(err);
    return res.status(status).json({ error: message });
  }
}
}
