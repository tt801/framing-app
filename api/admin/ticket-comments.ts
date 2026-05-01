import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupportNotificationRecipients, sendSupportEmail } from "../lib/notifications";

type AppUserRole = "owner" | "manager" | "sales" | "workshop" | "staff";

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
  if (ownedAccount?.id) return { accountId: ownedAccount.id as string, user };

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

  return { accountId: membership.company_account_id as string, user, role: membership.role as AppUserRole };
}

async function handleList(req: VercelRequest, res: VercelResponse) {
  const { accountId } = await requireAdminAccess(req);
  const raw = req.query.ticketId;
  const ticketId = Array.isArray(raw) ? raw[0] : raw;
  if (!ticketId) throw new Error("ticketId is required");

  const { data: ticket, error: ticketError } = await supabase
    .from("support_tickets")
    .select("id, ticket_number, subject, requester_email")
    .eq("id", ticketId)
    .eq("company_account_id", accountId)
    .maybeSingle();

  if (ticketError || !ticket) throw new Error("Ticket not found");

  const { data, error } = await supabase
    .from("support_ticket_comments")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return res.status(200).json({ comments: data || [] });
}

async function handleCreate(req: VercelRequest, res: VercelResponse) {
  const { accountId, user } = await requireAdminAccess(req);
  const { ticketId, body, visibility = "internal" } = req.body || {};

  if (!ticketId || !body) throw new Error("ticketId and body are required");

  const { data: ticket, error: ticketError } = await supabase
    .from("support_tickets")
    .select("id")
    .eq("id", ticketId)
    .eq("company_account_id", accountId)
    .maybeSingle();

  if (ticketError || !ticket) throw new Error("Ticket not found");

  const insert = {
    ticket_id: ticketId,
    company_account_id: accountId,
    author_user_id: user.id,
    author_name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
    author_email: user.email || null,
    body: String(body),
    visibility: visibility === "customer" ? "customer" : "internal",
  };

  const { data, error } = await supabase.from("support_ticket_comments").insert(insert).select("*").single();
  if (error || !data) throw error || new Error("Could not save comment");

  try {
    const recipients = new Set<string>(getSupportNotificationRecipients());
    if (visibility === "customer" && ticket.requester_email) {
      recipients.add(ticket.requester_email);
    }

    await sendSupportEmail({
      to: Array.from(recipients),
      subject: `[Support] Comment on ${ticket.ticket_number}: ${ticket.subject}`,
      text: [
        `A comment was added to a support ticket.`,
        ``,
        `Ticket: ${ticket.ticket_number}`,
        `Subject: ${ticket.subject}`,
        `Visibility: ${data.visibility}`,
        `Author: ${data.author_name || data.author_email || "Support"}`,
        ``,
        `${data.body}`,
      ].join("\n"),
    });
  } catch (notifyError) {
    console.error("[admin-ticket-comments] Notification error:", notifyError);
  }

  return res.status(200).json({ comment: data });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") return await handleList(req, res);
    if (req.method === "POST") return await handleCreate(req, res);
    return res.status(405).end();
  } catch (error) {
    console.error("[admin-ticket-comments] Error:", error);
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
