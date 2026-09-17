import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";
import { useBillingAccess } from "@/lib/billingAccess";
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
  const { companyAccountId } = useBillingAccess();
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    if (!enabled || !supabase || !companyAccountId) { setMembers([]); setCompanyName(null); setError(null); setLoading(false); return { members: [] } as CompanyMemberResponse; }
    try {
      setMembers([]);
      setLoading(true);
      const { data: members, error: readError } = await supabase.from("company_members").select("id,company_account_id,user_id,email,full_name,phone,role,status,invited_at,joined_at,last_invite_sent_at").eq("company_account_id", companyAccountId).order("created_at");
      if (requestRef.current !== request) return { members: [] } as CompanyMemberResponse;
      if (readError) throw readError;
      setMembers((members || []) as CompanyMember[]);
      setCompanyName(null);
      setError(null);
      return { members: (members || []) as CompanyMember[] } as CompanyMemberResponse;
    } catch (err) {
      if (requestRef.current !== request) return { members: [] } as CompanyMemberResponse;
      const message = err instanceof Error ? err.message : "Failed to load company members";
      setError(message);
      throw err;
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [companyAccountId, enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    void load();
  }, [load]);

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
