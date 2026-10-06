import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { PlatformDependencies } from "./dependencies.js";

export function createHandler({ getSupabaseAdmin, requirePlatformAdmin, platformAdminError }: PlatformDependencies) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    await requirePlatformAdmin(req);
    const companyId = req.query.companyId;
    if (typeof companyId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) {
      return res.status(400).json({ error: "Invalid company" });
    }
    const { data, error } = await getSupabaseAdmin()
      .from("stripe_checkout_attempts")
      .select("id,price_id,status,founder_reserved,created_at,completed_at")
      .eq("company_account_id", companyId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return res.status(200).json({ attempts: data ?? [] });
  } catch (err) {
    const { status, message } = platformAdminError(err);
    return res.status(status).json({ error: message });
  }
}
}
