import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/supabase";

export type BillingSummary = {
  account: {
    id: string;
    company_name: string | null;
    plan_status: "trialing" | "active" | "past_due" | "expired";
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_price_id: string | null;
    subscription_renewed_at: string | null;
    subscription_cancel_at: string | null;
    trial_started_at: string;
    trial_ends_at: string;
  };
  founder: {
    maxPurchases: number;
    purchasedCount: number;
    remaining: number;
    soldOut: boolean;
  };
  portalEligible: boolean;
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

export function useBillingSummary(enabled = true) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await fetchWithAuth<BillingSummary>("/api/billing/summary", {
        method: "GET",
      });
      setSummary(data);
      setError(null);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load billing summary";
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

  return { summary, loading, error, refresh: load };
}

export function useBillingPortal() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchWithAuth<{ url: string }>("/api/billing/create-portal", {
        method: "POST",
        body: JSON.stringify({}),
      });
      window.location.assign(data.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open billing portal";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { openPortal, loading, error };
}