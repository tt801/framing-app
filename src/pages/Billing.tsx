import React from "react";
import UpgradeModal from "@/components/UpgradeModal";
import { useToast } from "@/lib/toast";
import { useBillingSummary, useBillingPortal } from "@/lib/billing";
import { useTrialStatus } from "@/lib/trial";

const formatDate = (value?: string | null) => {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return parsed.toLocaleDateString();
};

export default function BillingPage() {
  const { add: toast } = useToast();
  const { trial } = useTrialStatus(true);
  const { summary, loading, error, refresh } = useBillingSummary(true);
  const { openPortal, loading: portalLoading } = useBillingPortal();

  const handleOpenPortal = async () => {
    try {
      await openPortal();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open billing portal";
      toast(message, "error");
    }
  };

  const showUpgradeOptions = !trial?.isFounder;

  return (
    <div className="min-h-dvh w-full bg-slate-50 text-slate-900">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Billing</p>
              <h1 className="mt-2 text-3xl font-black text-slate-950">Manage your plan</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Review your current access, manage your Stripe subscription, and track Founder availability.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-slate-500">Loading billing details...</p>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          ) : summary ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    {trial?.isFounder ? "Founder" : summary.account.plan_status.replace("_", " ")}
                  </span>
                  {summary.portalEligible ? (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      Stripe portal available
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Company</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {summary.account.company_name || "My Framing Business"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Renews / Access until</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {trial?.isFounder ? "Lifetime access" : formatDate(summary.account.subscription_renewed_at || summary.account.trial_ends_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Cancellation date</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {formatDate(summary.account.subscription_cancel_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Founder slots left</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {summary.founder.remaining} of {summary.founder.maxPurchases}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleOpenPortal}
                    disabled={!summary.portalEligible || portalLoading}
                    className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {portalLoading ? "Opening portal..." : "Manage subscription"}
                  </button>
                  <a
                    href="#/api-settings"
                    className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    API settings
                  </a>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Founder tracker</p>
                <h2 className="mt-2 text-xl font-black text-slate-950">Limited lifetime offer</h2>
                <p className="mt-2 text-sm text-slate-700">
                  {summary.founder.purchasedCount} sold, {summary.founder.remaining} remaining.
                  {summary.founder.soldOut ? " Founder is sold out." : " Once the cap is reached, new Founder checkouts are blocked automatically."}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        {showUpgradeOptions ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
            <UpgradeModal embedded />
          </section>
        ) : null}
      </main>
    </div>
  );
}