import { useEffect, useMemo, useState } from "react";
import { supabase, getCurrentUser } from "@/lib/supabase";

export const TRIAL_DAYS = 14;

export type PlanStatus = "trialing" | "active" | "expired";

type CompanyAccountRecord = {
  id: string;
  owner_user_id: string;
  company_name: string | null;
  trial_started_at: string;
  trial_ends_at: string;
  plan_status: PlanStatus;
};

export type TrialStatus = {
  companyName: string;
  planStatus: PlanStatus;
  trialStartedAt: string;
  trialEndsAt: string;
  daysRemaining: number;
  expired: boolean;
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

const toTrialStatus = (record: CompanyAccountRecord): TrialStatus => {
  const daysRemaining = daysRemainingFromEndDate(record.trial_ends_at);
  const expiredByDate = new Date(record.trial_ends_at).getTime() < Date.now();
  const expiredByStatus = record.plan_status === "expired";
  return {
    companyName: record.company_name || "My Framing Business",
    planStatus: record.plan_status,
    trialStartedAt: record.trial_started_at,
    trialEndsAt: record.trial_ends_at,
    daysRemaining,
    expired: expiredByDate || expiredByStatus,
  };
};

export const ensureCompanyTrialAccount = async (): Promise<TrialStatus | null> => {
  if (!supabase) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("company_accounts")
    .select("id, owner_user_id, company_name, trial_started_at, trial_ends_at, plan_status")
    .eq("owner_user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  if (!data) {
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
      .select("id, owner_user_id, company_name, trial_started_at, trial_ends_at, plan_status")
      .single();

    if (createError) {
      throw createError;
    }

    return toTrialStatus(created as CompanyAccountRecord);
  }

  const trialStatus = toTrialStatus(data as CompanyAccountRecord);

  if (trialStatus.expired && data.plan_status !== "expired") {
    await supabase
      .from("company_accounts")
      .update({ plan_status: "expired" })
      .eq("id", data.id);

    return {
      ...trialStatus,
      planStatus: "expired",
      expired: true,
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
