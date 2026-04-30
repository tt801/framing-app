import React, { useEffect, useState } from "react";
import { useTrialStatus } from "@/lib/trial";

export default function BillingSuccess() {
  const { refresh, trial } = useTrialStatus(true);
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");

  useEffect(() => {
    const checkSubscription = async () => {
      try {
        // Wait a moment for webhook to process
        await new Promise((r) => setTimeout(r, 2000));

        // Refresh trial status to get latest from DB
        await refresh();
        setStatus("success");
      } catch (e) {
        console.error("[BillingSuccess]", e);
        setStatus("error");
      }
    };

    checkSubscription();
  }, [refresh]);

  if (status === "checking") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          </div>
          <p className="text-sm text-slate-600">Confirming your subscription...</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-bold uppercase tracking-[0.15em] text-red-600">Error</p>
          <h1 className="mt-2 text-2xl font-black text-slate-900">Payment confirmation failed</h1>
          <p className="mt-3 text-sm text-slate-600">
            There was an issue confirming your subscription. Please contact support.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#/app" className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white">
              Return to App
            </a>
            <a href="#/support?auto=1&source=billing&subject=Billing%20support%20request" className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-900">
              Contact Support
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <span className="text-lg">✓</span>
          </div>
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-emerald-600">Success!</p>
        <h1 className="mt-2 text-2xl font-black text-slate-900">Subscription activated</h1>
        <p className="mt-3 text-sm text-slate-600">
          Welcome to {trial?.companyName}! You're all set to use Framers App. {trial?.isFounder ? "Your Founder lifetime access is active." : "Your subscription is active."}
        </p>
        <div className="mt-6">
          <a href="#/dashboard" className="inline-block rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-black">
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
