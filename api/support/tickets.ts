import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupportNotificationRecipients, sendSupportEmail } from "../lib/notifications.js";

type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function getBearerToken(req: VercelRequest) {
  const header = req.headers.authorization || "";
  const value = Array.isArray(header) ? header[0] : header;
  return value.split(" ")[1] || null;
}

async function getContext(req: VercelRequest) {
  const token = getBearerToken(req);
  if (!token) return { user: null, accountId: null };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { user: null, accountId: null };

  const user = data.user;

  const { data: owned } = await supabase
    .from("company_accounts")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (owned?.id) return { user, accountId: owned.id as string };

  const { data: member } = await supabase
    .from("company_members")
    .select("company_account_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  return { user, accountId: (member?.company_account_id as string | null) || null };
}

function makeTicketNumber() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SUP-${stamp}-${suffix}`;
}

async function handleCreate(req: VercelRequest, res: VercelResponse) {
  const { user, accountId } = await getContext(req);
  const {
    subject,
    message,
    category = "general",
    priority = "normal",
    requesterEmail,
    requesterName,
    source = "app",
  } = req.body || {};

  if (!subject || !message) {
    throw new Error("subject and message are required");
  }

  const normalizedPriority: TicketPriority = ["low", "normal", "high", "urgent"].includes(priority)
    ? priority
    : "normal";

  const insert = {
    ticket_number: makeTicketNumber(),
    company_account_id: accountId,
    requester_user_id: user?.id || null,
    requester_email: requesterEmail || user?.email || null,
    requester_name:
      requesterName ||
      (typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null),
    subject: String(subject),
    message: String(message),
    category: String(category),
    status: "open" as TicketStatus,
    priority: normalizedPriority,
    source: String(source),
  };

  const { data, error } = await supabase.from("support_tickets").insert(insert).select("*").single();
  if (error || !data) throw error || new Error("Could not create support ticket");

  try {
    await sendSupportEmail({
      to: getSupportNotificationRecipients(),
      subject: `[Support] New ticket ${data.ticket_number}: ${data.subject}`,
      text: [
        `A new support ticket was created.`,
        ``,
        `Ticket: ${data.ticket_number}`,
        `Subject: ${data.subject}`,
        `Priority: ${data.priority}`,
        `Category: ${data.category}`,
        `Requester: ${data.requester_name || "Unknown"} <${data.requester_email || "no-email"}>`,
        `Source: ${data.source}`,
        ``,
        `${data.message}`,
      ].join("\n"),
    });
  } catch (notifyError) {
    console.error("[support-tickets] Notification error:", notifyError);
  }

  return res.status(200).json({ ticket: data });
}

async function handleList(req: VercelRequest, res: VercelResponse) {
  const { user, accountId } = await getContext(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const query = supabase
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  const scoped = accountId ? query.eq("company_account_id", accountId) : query.eq("requester_user_id", user.id);
  const { data, error } = await scoped;
  if (error) throw error;
  return res.status(200).json({ tickets: data || [] });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "POST") return await handleCreate(req, res);
    if (req.method === "GET") return await handleList(req, res);
    return res.status(405).end();
  } catch (error) {
    console.error("[support-tickets] Error:", error);
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
