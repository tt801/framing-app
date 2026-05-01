import { createClient } from "@supabase/supabase-js";
import type { VercelRequest } from "@vercel/node";

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getBearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization || "";
  const value = Array.isArray(header) ? header[0] : header;
  const token = value.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

function getPlatformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function requirePlatformAdmin(req: VercelRequest) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing bearer token");

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid or expired token");

  const email = (data.user.email || "").toLowerCase();
  const allowed = getPlatformAdminEmails();

  if (!allowed.length) throw new Error("PLATFORM_ADMIN_EMAILS not configured on the server");
  if (!allowed.includes(email)) throw new Error("You do not have platform admin access");

  return data.user;
}

export function platformAdminError(err: unknown): { status: number; message: string } {
  const message = err instanceof Error ? err.message : "Server error";
  const isAuth =
    message.includes("platform admin") ||
    message.includes("bearer token") ||
    message.includes("expired token");
  return { status: isAuth ? 403 : 500, message };
}
