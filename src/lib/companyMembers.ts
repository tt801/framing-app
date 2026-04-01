import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabase";
import type { AppUserRole } from "@/lib/users";

export type CompanyMemberStatus = "invited" | "active" | "inactive";

export type CompanyMember = {
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

type CompanyMemberResponse = {
  account: {
    id: string;
    company_name: string | null;
    owner_user_id: string;
  };
  members: CompanyMember[];
};

async function fetchWithAuth<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data as T;
}

export function useCompanyMembers(enabled = true) {
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await fetchWithAuth<CompanyMemberResponse>("/api/admin/users", { method: "GET" });
      setMembers(data.members);
      setCompanyName(data.account.company_name);
      setError(null);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load company members";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    void load();
  }, [enabled]);

  return { members, companyName, loading, error, refresh: load, setMembers };
}

export async function inviteCompanyMember(input: {
  email: string;
  fullName?: string;
  phone?: string;
  role: AppUserRole;
}) {
  return fetchWithAuth<{ member: CompanyMember; warning?: string; note?: string }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateCompanyMember(input: {
  memberId: string;
  role?: AppUserRole;
  status?: CompanyMemberStatus;
  fullName?: string;
  phone?: string;
}) {
  return fetchWithAuth<{ member: CompanyMember }>("/api/admin/users", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteCompanyMember(memberId: string) {
  return fetchWithAuth<{ success: boolean }>("/api/admin/users", {
    method: "DELETE",
    body: JSON.stringify({ memberId }),
  });
}
