import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requirePlatformAdmin, supabaseAdmin, platformAdminError } from "../_lib/platformAdmin";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    await requirePlatformAdmin(req);

    const { data: companies, error } = await supabaseAdmin
      .from("company_accounts")
      .select(
        "id,company_name,owner_user_id,plan_status,stripe_price_id,stripe_subscription_id,subscription_renewed_at,trial_ends_at,created_at"
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    const ids = (companies ?? []).map((c) => c.id as string);

    // Member counts and open ticket counts in parallel
    const [{ data: memberRows }, { data: ticketRows }] = await Promise.all([
      ids.length
        ? supabaseAdmin
            .from("company_members")
            .select("company_account_id")
            .in("company_account_id", ids)
            .eq("status", "active")
        : Promise.resolve({ data: [] }),
      ids.length
        ? supabaseAdmin
            .from("support_tickets")
            .select("company_account_id")
            .in("company_account_id", ids)
            .eq("status", "open")
        : Promise.resolve({ data: [] }),
    ]);

    const memberCounts = (memberRows ?? []).reduce<Record<string, number>>((acc, r) => {
      acc[r.company_account_id as string] = (acc[r.company_account_id as string] || 0) + 1;
      return acc;
    }, {});

    const ticketCounts = (ticketRows ?? []).reduce<Record<string, number>>((acc, r) => {
      if (r.company_account_id)
        acc[r.company_account_id as string] =
          (acc[r.company_account_id as string] || 0) + 1;
      return acc;
    }, {});

    const enriched = (companies ?? []).map((c) => ({
      ...c,
      member_count: memberCounts[c.id as string] ?? 0,
      open_tickets: ticketCounts[c.id as string] ?? 0,
    }));

    return res.status(200).json({ companies: enriched });
  } catch (err) {
    const { status, message } = platformAdminError(err);
    return res.status(status).json({ error: message });
  }
}
