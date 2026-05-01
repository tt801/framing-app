import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function getBearerToken(req: VercelRequest) {
  const header = req.headers.authorization || "";
  const value = Array.isArray(header) ? header[0] : header;
  return value.split(" ")[1] || null;
}

function getPlatformAdminEmails() {
  return (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function requirePlatformAdmin(req: VercelRequest) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing bearer token");

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid or expired token");

  const email = (data.user.email || "").toLowerCase();
  const allowed = getPlatformAdminEmails();

  if (!allowed.length) {
    throw new Error("PLATFORM_ADMIN_EMAILS not configured");
  }

  if (!allowed.includes(email)) {
    throw new Error("You do not have platform admin access");
  }

  return data.user;
}

async function handleList(req: VercelRequest, res: VercelResponse) {
  await requirePlatformAdmin(req);
  const rawStatus = req.query.status;
  const status = (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus || "all") as "all" | TicketStatus;

  let query = supabase
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
    const { data: companies, error: companiesError } = await supabase
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

  const { data, error } = await supabase
    .from("support_tickets")
    .update(patch)
    .eq("id", ticketId)
    .select("id,ticket_number,subject,message,category,status,priority,requester_email,requester_name,company_account_id,created_at,updated_at")
    .single();

  if (error) throw error;

  let companyName: string | null = null;
  if (data.company_account_id) {
    const { data: company } = await supabase
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
    const message = error instanceof Error ? error.message : "Server error";
    return res.status(400).json({ error: message });
  }
}
