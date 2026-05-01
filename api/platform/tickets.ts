import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin, requirePlatformAdmin, platformAdminError } from "../lib/platformAdmin.js";

type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";

async function handleList(req: VercelRequest, res: VercelResponse) {
  await requirePlatformAdmin(req);
  const rawStatus = req.query.status;
  const status = (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus || "all") as "all" | TicketStatus;

  let query = getSupabaseAdmin()
    .from("support_tickets")
    .select("id,ticket_number,subject,message,category,status,priority,requester_email,requester_name,company_account_id,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data: tickets, error } = await query;
  if (error) throw error;

  const accountIds = Array.from(new Set((tickets || []).map((t) => t.company_account_id).filter(Boolean)));
  let companyMap: Record<string, string> = {};
  if (accountIds.length) {
    const { data: companies, error: companiesError } = await getSupabaseAdmin()
      .from("company_accounts")
      .select("id,company_name")
      .in("id", accountIds);

    if (companiesError) throw companiesError;
    companyMap = Object.fromEntries((companies || []).map((c) => [c.id, c.company_name || ""]));
  }

  const enriched = (tickets || []).map((t) => ({
    ...t,
    company_name: t.company_account_id ? companyMap[t.company_account_id] || null : null,
  }));

  return res.status(200).json({ tickets: enriched });
}

async function handleUpdate(req: VercelRequest, res: VercelResponse) {
  await requirePlatformAdmin(req);
  const { ticketId, status, priority, resolutionNote } = req.body || {};

  if (!ticketId) throw new Error("ticketId is required");

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (status) {
    patch.status = status as TicketStatus;
    if (status === "resolved" || status === "closed") {
      patch.resolved_at = new Date().toISOString();
    }
  }

  if (priority) patch.priority = priority as TicketPriority;
  if (resolutionNote !== undefined) patch.resolution_note = resolutionNote;

  const { data, error } = await getSupabaseAdmin()
    .from("support_tickets")
    .update(patch)
    .eq("id", ticketId)
    .select("id,ticket_number,subject,message,category,status,priority,requester_email,requester_name,company_account_id,created_at,updated_at")
    .single();

  if (error) throw error;

  let companyName: string | null = null;
  if (data.company_account_id) {
    const { data: company } = await getSupabaseAdmin()
      .from("company_accounts")
      .select("company_name")
      .eq("id", data.company_account_id)
      .maybeSingle();
    companyName = company?.company_name || null;
  }

  return res.status(200).json({ ticket: { ...data, company_name: companyName } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") return await handleList(req, res);
    if (req.method === "PATCH") return await handleUpdate(req, res);
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const { status, message } = platformAdminError(error);
    return res.status(status).json({ error: message });
  }
}
