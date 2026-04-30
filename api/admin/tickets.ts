import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

type AppUserRole = "owner" | "manager" | "sales" | "workshop" | "staff";
type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function getBearerToken(req: VercelRequest) {
  const header = req.headers.authorization || "";
  const value = Array.isArray(header) ? header[0] : header;
  return value.split(" ")[1] || null;
}

async function requireAdminAccess(req: VercelRequest) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing bearer token");

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid or expired token");

  const user = data.user;

  const { data: ownedAccount, error: ownedError } = await supabase
    .from("company_accounts")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (ownedError) throw ownedError;
  if (ownedAccount?.id) return { accountId: ownedAccount.id as string, userId: user.id };

  const { data: membership, error: memberError } = await supabase
    .from("company_members")
    .select("company_account_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (memberError || !membership) throw new Error("You do not have admin access");
  if (membership.role !== "owner" && membership.role !== "manager") {
    throw new Error("You do not have admin access");
  }

  return { accountId: membership.company_account_id as string, userId: user.id, role: membership.role as AppUserRole };
}

async function handleList(req: VercelRequest, res: VercelResponse) {
  const { accountId } = await requireAdminAccess(req);
  const { data, error } = await supabase
    .from("support_tickets")
    .select("*")
    .eq("company_account_id", accountId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return res.status(200).json({ tickets: data || [] });
}

async function handleUpdate(req: VercelRequest, res: VercelResponse) {
  const { accountId } = await requireAdminAccess(req);
  const { ticketId, status, priority, assignedToUserId, resolutionNote } = req.body || {};
  if (!ticketId) throw new Error("ticketId is required");

  const patch: Record<string, unknown> = {};
  if (status && ["open", "in_progress", "waiting_customer", "resolved", "closed"].includes(status)) {
    patch.status = status as TicketStatus;
  }
  if (priority && ["low", "normal", "high", "urgent"].includes(priority)) {
    patch.priority = priority as TicketPriority;
  }
  if (typeof assignedToUserId !== "undefined") {
    patch.assigned_to_user_id = assignedToUserId || null;
  }
  if (typeof resolutionNote !== "undefined") {
    patch.resolution_note = resolutionNote || null;
  }
  if (status === "resolved" || status === "closed") {
    patch.resolved_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("support_tickets")
    .update(patch)
    .eq("id", ticketId)
    .eq("company_account_id", accountId)
    .select("*")
    .single();

  if (error || !data) throw error || new Error("Could not update ticket");
  return res.status(200).json({ ticket: data });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") return await handleList(req, res);
    if (req.method === "PATCH") return await handleUpdate(req, res);
    return res.status(405).end();
  } catch (error) {
    console.error("[admin-tickets] Error:", error);
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
