import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

type AppUserRole = "owner" | "manager" | "sales" | "workshop" | "staff";
type CompanyMemberStatus = "invited" | "active" | "inactive";

type CompanyAccount = {
  id: string;
  company_name: string | null;
  owner_user_id: string;
};

type CompanyMember = {
  id: string;
  company_account_id: string;
  user_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: AppUserRole;
  status: CompanyMemberStatus;
  invited_at: string;
  joined_at: string | null;
  last_invite_sent_at: string | null;
};

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function isCompanyMembersMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message || "") : "";
  return code === "42P01" || code === "PGRST205" || message.toLowerCase().includes("company_members");
}

function getBearerToken(req: VercelRequest) {
  const header = req.headers.authorization || "";
  const value = Array.isArray(header) ? header[0] : header;
  return value.split(" ")[1] || null;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getBaseUrl(req: VercelRequest) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const host = req.headers.host;

  if (proto && host) {
    return `${proto}://${host}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:5173";
}

async function requireAdminAccess(req: VercelRequest) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing bearer token");

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid or expired token");

  const user = data.user;

  const { data: ownedAccount, error: ownedAccountError } = await supabase
    .from("company_accounts")
    .select("id, company_name, owner_user_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (ownedAccountError) throw ownedAccountError;

  if (ownedAccount) {
    await supabase.from("company_members").upsert(
      {
        company_account_id: ownedAccount.id,
        user_id: user.id,
        email: normalizeEmail(user.email || ""),
        full_name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
        role: "owner",
        status: "active",
        invited_at: new Date().toISOString(),
        joined_at: new Date().toISOString(),
        last_invite_sent_at: new Date().toISOString(),
      },
      { onConflict: "company_account_id,email" }
    );

    return { user, account: ownedAccount as CompanyAccount, role: "owner" as AppUserRole };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("company_members")
    .select("id, company_account_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) throw new Error("You do not have admin access");
  if (membership.role !== "owner" && membership.role !== "manager") {
    throw new Error("You do not have admin access");
  }

  const { data: account, error: accountError } = await supabase
    .from("company_accounts")
    .select("id, company_name, owner_user_id")
    .eq("id", membership.company_account_id)
    .single();

  if (accountError || !account) throw new Error("No company account found");

  return { user, account: account as CompanyAccount, role: membership.role as AppUserRole };
}

async function ensureNotLastOwner(companyAccountId: string, memberId: string, nextRole?: AppUserRole, nextStatus?: CompanyMemberStatus) {
  const { data: target, error: targetError } = await supabase
    .from("company_members")
    .select("id, role, status")
    .eq("id", memberId)
    .eq("company_account_id", companyAccountId)
    .single();

  if (targetError || !target) throw new Error("Member not found");

  const removingOwnerAccess =
    target.role === "owner" &&
    target.status === "active" &&
    ((nextRole && nextRole !== "owner") || (nextStatus && nextStatus !== "active"));

  if (!removingOwnerAccess) return;

  const { count, error: ownerCountError } = await supabase
    .from("company_members")
    .select("id", { count: "exact", head: true })
    .eq("company_account_id", companyAccountId)
    .eq("role", "owner")
    .eq("status", "active");

  if (ownerCountError) throw ownerCountError;
  if ((count || 0) <= 1) throw new Error("You must keep at least one active owner");
}

async function handleList(req: VercelRequest, res: VercelResponse) {
  const { account } = await requireAdminAccess(req);
  const { data, error } = await supabase
    .from("company_members")
    .select("id, company_account_id, user_id, email, full_name, phone, role, status, invited_at, joined_at, last_invite_sent_at")
    .eq("company_account_id", account.id)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return res.status(200).json({ account, members: (data || []) as CompanyMember[] });
}

async function handleInvite(req: VercelRequest, res: VercelResponse) {
  const { user, account } = await requireAdminAccess(req);
  const { email, fullName, phone, role } = req.body || {};

  if (!email || !role) {
    throw new Error("Email and role are required");
  }

  const normalizedEmail = normalizeEmail(email);
  const now = new Date().toISOString();

  const { data: member, error: memberError } = await supabase
    .from("company_members")
    .upsert(
      {
        company_account_id: account.id,
        email: normalizedEmail,
        full_name: fullName || null,
        phone: phone || null,
        role,
        status: "invited",
        invited_by_user_id: user.id,
        invited_at: now,
        last_invite_sent_at: now,
      },
      { onConflict: "company_account_id,email" }
    )
    .select("id, company_account_id, user_id, email, full_name, phone, role, status, invited_at, joined_at, last_invite_sent_at")
    .single();

  if (memberError || !member) throw memberError || new Error("Could not save invite");

  const redirectTo = `${getBaseUrl(req)}/#/auth/callback`;
  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
    redirectTo,
    data: {
      company_name: account.company_name || undefined,
      company_account_id: account.id,
      invited_role: role,
    },
  });

  if (inviteError) {
    return res.status(202).json({
      member,
      warning: inviteError.message,
      note: "Membership saved. If the user already has an account, ask them to sign in with the same email to join the workspace.",
    });
  }

  return res.status(200).json({ member });
}

async function handleUpdate(req: VercelRequest, res: VercelResponse) {
  const { account } = await requireAdminAccess(req);
  const { memberId, role, status, fullName, phone } = req.body || {};
  if (!memberId) throw new Error("memberId is required");

  await ensureNotLastOwner(account.id, memberId, role, status);

  const patch: Record<string, unknown> = {};
  if (role) patch.role = role;
  if (status) patch.status = status;
  if (typeof fullName !== "undefined") patch.full_name = fullName || null;
  if (typeof phone !== "undefined") patch.phone = phone || null;
  if (status === "active") patch.joined_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("company_members")
    .update(patch)
    .eq("id", memberId)
    .eq("company_account_id", account.id)
    .select("id, company_account_id, user_id, email, full_name, phone, role, status, invited_at, joined_at, last_invite_sent_at")
    .single();

  if (error || !data) throw error || new Error("Could not update member");
  return res.status(200).json({ member: data });
}

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const { account } = await requireAdminAccess(req);
  const { memberId } = req.body || {};
  if (!memberId) throw new Error("memberId is required");

  await ensureNotLastOwner(account.id, memberId, "staff", "inactive");

  const { error } = await supabase
    .from("company_members")
    .delete()
    .eq("id", memberId)
    .eq("company_account_id", account.id);

  if (error) throw error;
  return res.status(200).json({ success: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") return await handleList(req, res);
    if (req.method === "POST") return await handleInvite(req, res);
    if (req.method === "PATCH") return await handleUpdate(req, res);
    if (req.method === "DELETE") return await handleDelete(req, res);
    return res.status(405).end();
  } catch (error) {
    console.error("[admin-users] Error:", error);
    if (isCompanyMembersMissing(error)) {
      return res.status(400).json({ error: "Team access is not enabled yet. Run TEAM_ACCESS_SETUP.sql in Supabase first." });
    }
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
