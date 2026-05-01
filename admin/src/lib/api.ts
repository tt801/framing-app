import { getAccessToken } from "@/lib/supabase";

const API_BASE = (import.meta.env.VITE_PLATFORM_API_BASE || "").replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export type PlatformTicket = {
  id: string;
  ticket_number: string;
  subject: string;
  message: string;
  category: string;
  status: TicketStatus;
  priority: TicketPriority;
  requester_email: string | null;
  requester_name: string | null;
  company_account_id: string | null;
  created_at: string;
  updated_at: string;
  company_name: string | null;
};

export type TicketComment = {
  id: string;
  ticket_id: string;
  author_name: string | null;
  author_email: string | null;
  body: string;
  visibility: "internal" | "customer";
  created_at: string;
};

export type PlatformStats = {
  totalCompanies: number;
  totalMembers: number;
  activeMembers: number;
  openTickets: number;
  totalTickets: number;
  planCounts: Record<string, number>;
  recentCompanies: Array<{
    id: string;
    company_name: string | null;
    plan_status: string;
    created_at: string;
  }>;
};

export type PlatformCompany = {
  id: string;
  company_name: string | null;
  owner_user_id: string;
  plan_status: string;
  stripe_price_id: string | null;
  stripe_subscription_id: string | null;
  subscription_renewed_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
  member_count: number;
  open_tickets: number;
};

export type PlatformMember = {
  id: string;
  company_account_id: string;
  user_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  status: string;
  invited_at: string;
  joined_at: string | null;
  company_name: string | null;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  is_published: boolean;
  target_plan: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });

  const raw = await response.text();
  let json: unknown = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error?: string }).error || "Request failed")
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  if (!json || typeof json !== "object") {
    throw new Error(`Invalid API response for ${path}`);
  }

  return json as T;
}

// ─── Tickets ──────────────────────────────────────────────────────────────────

export async function listPlatformTickets(status: "all" | TicketStatus = "all") {
  const qs = status === "all" ? "" : `?status=${status}`;
  return apiFetch<{ tickets: PlatformTicket[] }>(`/api/platform/tickets${qs}`);
}

export async function updatePlatformTicket(input: {
  ticketId: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  resolutionNote?: string;
}) {
  return apiFetch<{ ticket: PlatformTicket }>("/api/platform/tickets", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function listPlatformTicketComments(ticketId: string) {
  return apiFetch<{ comments: TicketComment[] }>(
    `/api/platform/ticket-comments?ticketId=${encodeURIComponent(ticketId)}`
  );
}

export async function createPlatformTicketComment(input: {
  ticketId: string;
  body: string;
  visibility?: "internal" | "customer";
}) {
  return apiFetch<{ comment: TicketComment }>("/api/platform/ticket-comments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getPlatformStats() {
  const d = await apiFetch<Partial<PlatformStats>>("/api/platform/stats");
  return {
    totalCompanies: Number(d.totalCompanies ?? 0),
    totalMembers: Number(d.totalMembers ?? 0),
    activeMembers: Number(d.activeMembers ?? 0),
    openTickets: Number(d.openTickets ?? 0),
    totalTickets: Number(d.totalTickets ?? 0),
    planCounts: d.planCounts ?? {},
    recentCompanies: Array.isArray(d.recentCompanies) ? d.recentCompanies : [],
  } satisfies PlatformStats;
}

// ─── Companies ────────────────────────────────────────────────────────────────

export async function getPlatformCompanies() {
  return apiFetch<{ companies: PlatformCompany[] }>("/api/platform/companies");
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function getPlatformMembers(companyId?: string) {
  const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  return apiFetch<{ members: PlatformMember[] }>(`/api/platform/members${qs}`);
}

// ─── CMS ─────────────────────────────────────────────────────────────────────

export async function listAnnouncements() {
  return apiFetch<{ announcements: Announcement[]; tableExists: boolean }>(
    "/api/platform/cms"
  );
}

export async function createAnnouncement(input: {
  title: string;
  body: string;
  isPublished?: boolean;
  targetPlan?: string | null;
}) {
  return apiFetch<{ announcement: Announcement }>("/api/platform/cms", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAnnouncement(input: {
  id: string;
  title?: string;
  body?: string;
  isPublished?: boolean;
  targetPlan?: string | null;
}) {
  return apiFetch<{ announcement: Announcement }>("/api/platform/cms", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteAnnouncement(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/platform/cms?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
