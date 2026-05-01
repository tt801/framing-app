import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

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

  if (!allowed.length) throw new Error("PLATFORM_ADMIN_EMAILS not configured");
  if (!allowed.includes(email)) throw new Error("You do not have platform admin access");

  return data.user;
}

async function handleList(req: VercelRequest, res: VercelResponse) {
  await requirePlatformAdmin(req);
  const raw = req.query.ticketId;
  const ticketId = Array.isArray(raw) ? raw[0] : raw;

  if (!ticketId) throw new Error("ticketId is required");

  const { data, error } = await supabase
    .from("support_ticket_comments")
    .select("id,ticket_id,author_name,author_email,body,visibility,created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return res.status(200).json({ comments: data || [] });
}

async function handleCreate(req: VercelRequest, res: VercelResponse) {
  const user = await requirePlatformAdmin(req);
  const { ticketId, body, visibility = "internal" } = req.body || {};

  if (!ticketId || !body) throw new Error("ticketId and body are required");

  const { data, error } = await supabase
    .from("support_ticket_comments")
    .insert({
      ticket_id: ticketId,
      author_user_id: user.id,
      author_name: user.user_metadata?.full_name || user.email,
      author_email: user.email,
      body,
      visibility,
    })
    .select("id,ticket_id,author_name,author_email,body,visibility,created_at")
    .single();

  if (error) throw error;
  return res.status(200).json({ comment: data });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") return await handleList(req, res);
    if (req.method === "POST") return await handleCreate(req, res);
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    return res.status(400).json({ error: message });
  }
}
