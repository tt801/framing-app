import React from "react";
import type { TrialStatus } from "@/lib/trial";

type TrialBannerProps = {
  trial: TrialStatus | null;
  loading?: boolean;
};

export default function TrialBanner({ trial, loading = false }: TrialBannerProps) {
  if (loading || !trial) return null;

  if (trial.expired) {
    return (
      <div className="border-b border-rose-200 bg-rose-50 text-rose-900">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <p className="text-sm font-semibold">
            Trial expired for {trial.companyName}. Upgrade to continue using Framers App.
          </p>
          <a
            href="#/"
            className="inline-flex items-center justify-center rounded-full bg-rose-600 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white hover:bg-rose-700"
          >
            View Pricing
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-cyan-200 bg-cyan-50 text-cyan-900">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <p className="text-sm">
          <span className="font-bold">Free trial:</span> {trial.daysRemaining} day{trial.daysRemaining === 1 ? "" : "s"} left for {trial.companyName}.
        </p>
        <a
          href="#/billing"
          className="inline-flex items-center justify-center rounded-full border border-cyan-300 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-cyan-900 hover:bg-cyan-100"
        >
          Upgrade Now
        </a>
      </div>
    </div>
  );
}
