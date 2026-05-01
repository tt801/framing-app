import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin, requirePlatformAdmin, platformAdminError } from "../lib/platformAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    await requirePlatformAdmin(req);

    const [
      { count: totalCompanies },
      { data: planRows },
      { count: totalMembers },
      { count: activeMembers },
      { count: openTickets },
      { count: totalTickets },
      { data: recentCompanies },
    ] = await Promise.all([
      getSupabaseAdmin().from("company_accounts").select("id", { count: "exact", head: true }),
      getSupabaseAdmin().from("company_accounts").select("plan_status"),
      getSupabaseAdmin().from("company_members").select("id", { count: "exact", head: true }),
      getSupabaseAdmin()
        .from("company_members")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      getSupabaseAdmin()
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
      getSupabaseAdmin().from("support_tickets").select("id", { count: "exact", head: true }),
      getSupabaseAdmin()
        .from("company_accounts")
        .select("id,company_name,plan_status,created_at")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    const planCounts = (planRows || []).reduce<Record<string, number>>((acc, row) => {
      const s = (row.plan_status as string) || "unknown";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    return res.status(200).json({
      totalCompanies: totalCompanies ?? 0,
      totalMembers: totalMembers ?? 0,
      activeMembers: activeMembers ?? 0,
      openTickets: openTickets ?? 0,
      totalTickets: totalTickets ?? 0,
      planCounts,
      recentCompanies: recentCompanies ?? [],
    });
  } catch (err) {
    const { status, message } = platformAdminError(err);
    return res.status(status).json({ error: message });
  }
}
