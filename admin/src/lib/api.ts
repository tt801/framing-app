import { getAccessToken } from "@/lib/supabase";

const API_BASE = (import.meta.env.VITE_PLATFORM_API_BASE || "").replace(/\/$/, "");

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

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((json as { error?: string }).error || "Request failed");
  }
  return json as T;
}

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
  return apiFetch<{ comments: TicketComment[] }>(`/api/platform/ticket-comments?ticketId=${encodeURIComponent(ticketId)}`);
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
