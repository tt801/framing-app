import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabase";

export type SupportTicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

export type SupportTicket = {
  id: string;
  ticket_number: string;
  subject: string;
  message: string;
  category: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  requester_email: string | null;
  requester_name: string | null;
  company_account_id: string | null;
  assigned_to_user_id: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

export type SupportTicketComment = {
  id: string;
  ticket_id: string;
  company_account_id: string | null;
  author_user_id: string | null;
  author_name: string | null;
  author_email: string | null;
  body: string;
  visibility: "internal" | "customer";
  created_at: string;
};

async function fetchWithAuth<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data as T;
}

export async function createSupportTicket(input: {
  subject: string;
  message: string;
  category?: string;
  priority?: SupportTicketPriority;
  requesterEmail?: string;
  requesterName?: string;
  source?: string;
}) {
  return fetchWithAuth<{ ticket: SupportTicket }>("/api/support/tickets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function useAdminSupportTickets(enabled = true) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const data = await fetchWithAuth<{ tickets: SupportTicket[] }>("/api/admin/tickets", { method: "GET" });
      setTickets(data.tickets || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load support tickets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [enabled]);

  return { tickets, loading, error, refresh, setTickets };
}

export async function updateAdminSupportTicket(input: {
  ticketId: string;
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
  assignedToUserId?: string | null;
  resolutionNote?: string | null;
}) {
  return fetchWithAuth<{ ticket: SupportTicket }>("/api/admin/tickets", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function listAdminTicketComments(ticketId: string) {
  const qs = new URLSearchParams({ ticketId });
  return fetchWithAuth<{ comments: SupportTicketComment[] }>(`/api/admin/ticket-comments?${qs.toString()}`, {
    method: "GET",
  });
}

export async function createAdminTicketComment(input: {
  ticketId: string;
  body: string;
  visibility?: "internal" | "customer";
}) {
  return fetchWithAuth<{ comment: SupportTicketComment }>("/api/admin/ticket-comments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
