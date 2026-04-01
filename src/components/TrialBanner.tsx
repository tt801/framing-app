import React from "react";
import type { TrialStatus } from "@/lib/trial";

type TrialBannerProps = {
  trial: TrialStatus | null;
  loading?: boolean;
};

export default function TrialBanner({ trial, loading = false }: TrialBannerProps) {
  if (loading || !trial) return null;

  if (trial.isPastDue) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 text-amber-950">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <p className="text-sm font-semibold">
            Payment issue for {trial.companyName}. You still have read-only access, but premium features and edits are blocked until billing is fixed.
          </p>
          <a
            href="#/billing"
            className="inline-flex items-center justify-center rounded-full bg-amber-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white hover:bg-amber-600"
          >
            Fix Billing
          </a>
        </div>
      </div>
    );
  }

  if (trial.expired) {
    return (
      <div className="border-b border-rose-200 bg-rose-50 text-rose-900">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <p className="text-sm font-semibold">
            Subscription expired for {trial.companyName}. You still have read-only access, but edits and premium features are locked until you upgrade.
          </p>
          <a
            href="#/billing"
            className="inline-flex items-center justify-center rounded-full bg-rose-600 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white hover:bg-rose-700"
          >
            Upgrade Now
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-cyan-200 bg-cyan-50 text-cyan-900">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <p className="text-sm">
          <span className="font-bold">{trial.isFounder ? "Founder plan:" : trial.planStatus === "active" ? "Subscription:" : "Free trial:"}</span>{" "}
          {trial.isFounder
            ? `Lifetime access active for ${trial.companyName}.`
            : trial.planStatus === "active"
            ? `Your subscription is active for ${trial.companyName}.`
            : `${trial.daysRemaining} day${trial.daysRemaining === 1 ? "" : "s"} left for ${trial.companyName}.`}
        </p>
        {!trial.hasFullAccess || trial.planStatus === "trialing" ? (
          <a
            href="#/billing"
            className="inline-flex items-center justify-center rounded-full border border-cyan-300 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-cyan-900 hover:bg-cyan-100"
          >
            {trial.hasFullAccess ? "Upgrade Now" : "Manage Billing"}
          </a>
        ) : null}
      </div>
    </div>
  );
}
