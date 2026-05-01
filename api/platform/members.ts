import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin, requirePlatformAdmin, platformAdminError } from "../lib/platformAdmin";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();

  try {
    await requirePlatformAdmin(req);

    const rawCompanyId = req.query.companyId;
    const companyId = Array.isArray(rawCompanyId) ? rawCompanyId[0] : rawCompanyId;

    let query = getSupabaseAdmin()
      .from("company_members")
      .select(
        "id,company_account_id,user_id,email,full_name,phone,role,status,invited_at,joined_at"
      )
      .order("joined_at", { ascending: false, nullsFirst: false });

    if (companyId) {
      query = query.eq("company_account_id", companyId);
    }

    const { data: members, error } = await query;
    if (error) throw error;

    // Enrich with company names
    const accountIds = Array.from(
      new Set((members ?? []).map((m) => m.company_account_id as string).filter(Boolean))
    );

    let companyMap: Record<string, string> = {};
    if (accountIds.length) {
      const { data: companies } = await getSupabaseAdmin()
        .from("company_accounts")
        .select("id,company_name")
        .in("id", accountIds);
      companyMap = Object.fromEntries(
        (companies ?? []).map((c) => [c.id as string, (c.company_name as string) || ""])
      );
    }

    const enriched = (members ?? []).map((m) => ({
      ...m,
      company_name: companyMap[m.company_account_id as string] ?? null,
    }));

    return res.status(200).json({ members: enriched });
  } catch (err) {
    const { status, message } = platformAdminError(err);
    return res.status(status).json({ error: message });
  }
}
