import { useEffect, useMemo, useState } from "react";
import { supabase, getCurrentUser } from "@/lib/supabase";
import type { BillingAccess } from "@/lib/billingAccess";
import type { AppUserRole } from "@/lib/users";

export const TRIAL_DAYS = 14;

export type PlanStatus = "trialing" | "active" | "past_due" | "expired";

type CompanyAccountRecord = {
  id: string;
  owner_user_id: string;
  company_name: string | null;
  trial_started_at: string;
  trial_ends_at: string;
  plan_status: PlanStatus;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_price_id?: string | null;
  subscription_renewed_at?: string | null;
  subscription_cancel_at?: string | null;
};

type CompanyMemberRecord = {
  id: string;
  company_account_id: string;
  user_id: string | null;
  email: string;
  role: AppUserRole;
  status: "invited" | "active" | "inactive";
  invited_at: string;
  joined_at?: string | null;
};

export type TrialStatus = {
  companyAccountId: string;
  companyName: string;
  workspaceRole: AppUserRole;
  planStatus: PlanStatus;
  trialStartedAt: string;
  trialEndsAt: string;
  daysRemaining: number;
  expired: boolean;
  readOnly: boolean;
  hasFullAccess: boolean;
  canUsePremiumFeatures: boolean;
  isFounder: boolean;
  isPastDue: boolean;
  statusMessage: string;
};

const FOUNDER_PRICE_ID = "founder_lifetime";

const normalizeEmail = (email?: string | null) => (email || "").trim().toLowerCase();
const isCompanyMembersMissing = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message || "") : "";
  return code === "42P01" || code === "PGRST205" || message.toLowerCase().includes("company_members");
};

export const getBillingAccessFromRecord = (
  record: Pick<
    CompanyAccountRecord,
    "plan_status" | "stripe_price_id" | "company_name"
  >
): BillingAccess => {
  const isFounder = record.stripe_price_id === FOUNDER_PRICE_ID;
  const hasFullAccess =
    isFounder || record.plan_status === "trialing" || record.plan_status === "active";
  const isPastDue = record.plan_status === "past_due";
  const readOnly = !hasFullAccess;

  let statusMessage = "";
  if (isFounder) {
    statusMessage = "Founder access active.";
  } else if (record.plan_status === "trialing") {
    statusMessage = "Free trial active.";
  } else if (record.plan_status === "active") {
    statusMessage = "Subscription active.";
  } else if (isPastDue) {
    statusMessage = "Billing issue detected. Your account is read-only until payment is fixed.";
  } else {
    statusMessage = "Subscription expired. Your account is read-only until you upgrade.";
  }

  return {
    readOnly,
    hasFullAccess,
    canUsePremiumFeatures: hasFullAccess,
    isFounder,
    isPastDue,
    statusMessage,
  };
};

const addDays = (date: Date, days: number) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

const getCompanyFallbackName = (email?: string | null) => {
  if (!email) return "My Framing Business";
  const prefix = email.split("@")[0] || "My Framing Business";
  return prefix
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const daysRemainingFromEndDate = (trialEndsAtIso: string) => {
  const now = Date.now();
  const end = new Date(trialEndsAtIso).getTime();
  const ms = end - now;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
};

const toTrialStatus = (record: CompanyAccountRecord, workspaceRole: AppUserRole): TrialStatus => {
  const daysRemaining = daysRemainingFromEndDate(record.trial_ends_at);
  const expiredByDate = new Date(record.trial_ends_at).getTime() < Date.now();
  const expiredByStatus = record.plan_status === "expired";
  const billingAccess = getBillingAccessFromRecord(record);
  return {
    companyAccountId: record.id,
    companyName: record.company_name || "My Framing Business",
    workspaceRole,
    planStatus: record.plan_status,
    trialStartedAt: record.trial_started_at,
    trialEndsAt: record.trial_ends_at,
    daysRemaining,
    expired: expiredByDate || expiredByStatus,
    ...billingAccess,
  };
};

const ensureOwnerMembership = async (record: CompanyAccountRecord, user: Awaited<ReturnType<typeof getCurrentUser>>) => {
  if (!supabase || !user?.email) return;

  const { error } = await supabase.from("company_members").upsert(
    {
      company_account_id: record.id,
      user_id: user.id,
      email: normalizeEmail(user.email),
      full_name:
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : null,
      role: "owner",
      status: "active",
      invited_at: new Date().toISOString(),
      joined_at: new Date().toISOString(),
      last_invite_sent_at: new Date().toISOString(),
    },
    { onConflict: "company_account_id,email" }
  );

  if (error && !isCompanyMembersMissing(error)) {
    throw error;
  }
};

const fetchMembershipForUser = async (user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) => {
  if (!supabase) return null;

  const { data: directMembership, error: directMembershipError } = await supabase
    .from("company_members")
    .select("id, company_account_id, user_id, email, role, status, invited_at, joined_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (directMembershipError) {
    if (isCompanyMembersMissing(directMembershipError)) return null;
    throw directMembershipError;
  }
  if (directMembership) return directMembership as CompanyMemberRecord;

  if (!user.email) return null;

  const { data: emailMembership, error: emailMembershipError } = await supabase
    .from("company_members")
    .select("id, company_account_id, user_id, email, role, status, invited_at, joined_at")
    .eq("email", normalizeEmail(user.email))
    .maybeSingle();

  if (emailMembershipError) {
    if (isCompanyMembersMissing(emailMembershipError)) return null;
    throw emailMembershipError;
  }
  if (!emailMembership) return null;

  const { data: claimedMembership, error: claimError } = await supabase
    .from("company_members")
    .update({
      user_id: user.id,
      status: emailMembership.status === "inactive" ? "inactive" : "active",
      joined_at: emailMembership.joined_at || new Date().toISOString(),
    })
    .eq("id", emailMembership.id)
    .select("id, company_account_id, user_id, email, role, status, invited_at, joined_at")
    .single();

  if (claimError) {
    if (isCompanyMembersMissing(claimError)) return null;
    throw claimError;
  }
  return claimedMembership as CompanyMemberRecord;
};

export const ensureCompanyTrialAccount = async (): Promise<TrialStatus | null> => {
  if (!supabase) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("company_accounts")
    .select(
      "id, owner_user_id, company_name, trial_started_at, trial_ends_at, plan_status, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_renewed_at, subscription_cancel_at"
    )
    .eq("owner_user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  if (data) {
    await ensureOwnerMembership(data as CompanyAccountRecord, user);
  }

  if (!data) {
    const membership = await fetchMembershipForUser(user);

    if (membership && membership.status !== "inactive") {
      const { data: memberAccount, error: memberAccountError } = await supabase
        .from("company_accounts")
        .select(
          "id, owner_user_id, company_name, trial_started_at, trial_ends_at, plan_status, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_renewed_at, subscription_cancel_at"
        )
        .eq("id", membership.company_account_id)
        .single();

      if (memberAccountError) throw memberAccountError;
      return toTrialStatus(memberAccount as CompanyAccountRecord, membership.role);
    }

    const now = new Date();
    const trialEndsAt = addDays(now, TRIAL_DAYS).toISOString();
    const companyNameFromMetadata =
      typeof user.user_metadata?.company_name === "string"
        ? user.user_metadata.company_name
        : null;

    const insertPayload = {
      owner_user_id: user.id,
      company_name: companyNameFromMetadata || getCompanyFallbackName(user.email),
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEndsAt,
      plan_status: "trialing" as PlanStatus,
    };

    const { data: created, error: createError } = await supabase
      .from("company_accounts")
      .insert(insertPayload)
      .select(
        "id, owner_user_id, company_name, trial_started_at, trial_ends_at, plan_status, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_renewed_at, subscription_cancel_at"
      )
      .single();

    if (createError) {
      throw createError;
    }

    await ensureOwnerMembership(created as CompanyAccountRecord, user);
    return toTrialStatus(created as CompanyAccountRecord, "owner");
  }

  const trialStatus = toTrialStatus(data as CompanyAccountRecord, "owner");

  // Auto-expire if past end date AND no active subscription
  if (trialStatus.expired && data.plan_status === "trialing") {
    await supabase
      .from("company_accounts")
      .update({ plan_status: "expired" })
      .eq("id", data.id);

    return {
      ...trialStatus,
      planStatus: "expired",
      expired: true,
      readOnly: true,
      hasFullAccess: false,
      canUsePremiumFeatures: false,
      isFounder: false,
      isPastDue: false,
      statusMessage: "Subscription expired. Your account is read-only until you upgrade.",
    };
  }

  return trialStatus;
};

export const useTrialStatus = (enabled = true) => {
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        const status = await ensureCompanyTrialAccount();
        if (!mounted) return;
        setTrial(status);
        setError(null);
      } catch (e: unknown) {
        if (!mounted) return;
        const message = e instanceof Error ? e.message : "Failed to load trial status";
        setError(message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [enabled]);

  const isExpired = useMemo(() => Boolean(trial?.expired), [trial]);

  return {
    trial,
    loading,
    error,
    isExpired,
    refresh: async () => {
      const status = await ensureCompanyTrialAccount();
      setTrial(status);
    },
  };
};

export const useStripeCheckout = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async (priceId: string, isOneTime = false) => {
    setLoading(true);
    setError(null);

    try {
      const session = await getCurrentUser();
      if (!session) throw new Error("Not authenticated");

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("No session token");

      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ priceId, isOneTime }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create checkout session");
      }

      const data = await res.json();

      if (data.url && typeof data.url === "string") {
        window.location.assign(data.url);
        return;
      }

      throw new Error("Stripe checkout URL missing");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Checkout failed";
      setError(msg);
      console.error("[useStripeCheckout]", msg);
    } finally {
      setLoading(false);
    }
  };

  return { startCheckout, loading, error };
};
