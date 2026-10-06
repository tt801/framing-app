import React, { useEffect, useState } from "react";
import { confirmCheckout, type CheckoutConfirmation } from "@/lib/billing";

type Confirmation = Extract<CheckoutConfirmation, { status: "confirmed" }>;

export default function BillingSuccess() {
  const sessionId = new URLSearchParams(window.location.hash.split("?")[1] || "").get("session_id");
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const poll = async (attempt: number) => {
      try {
        const result = await confirmCheckout(sessionId);
        if (cancelled) return;
        if (result.status === "confirmed" && (result.kind === "founder" || result.kind === "recurring")) {
          setConfirmation(result);
          setStatus("success");
          return;
        }
        if (result.status === "rejected") {
          setStatus("error");
          return;
        }
      } catch {
        // Network/processing errors cannot prove payment. Retry a bounded
        // number of times, then leave the customer in a pending state.
      }
      if (!cancelled && attempt < 4) timeout = setTimeout(() => { void poll(attempt + 1); }, 2000);
    };
    setStatus("checking");
    setConfirmation(null);
    void poll(1);
    return () => { cancelled = true; if (timeout) clearTimeout(timeout); };
  }, [sessionId]);

  if (status === "checking") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          </div>
          <p className="text-sm text-slate-600">Confirming your payment... If this takes longer, return to Billing to refresh your access.</p>
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
          <p className="mt-3 text-sm text-slate-600">This Checkout could not be confirmed for your company. Please contact support if you were charged.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#/app" className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white">Return to App</a>
            <a href="#/support" className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-900">Contact Support</a>
          </div>
        </div>
      </div>
    );
  }

  const founder = confirmation?.kind === "founder";
  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 flex justify-center"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100"><span className="text-lg">✓</span></div></div>
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-emerald-600">Success!</p>
        <h1 className="mt-2 text-2xl font-black text-slate-900">{founder ? "Founder lifetime access activated" : "Subscription activated"}</h1>
        <p className="mt-3 text-sm text-slate-600">
          Welcome to {confirmation?.companyName || "Framers App"}! {founder ? "Your Founder lifetime access is active." : "Your recurring subscription is active."}
        </p>
        <div className="mt-6"><a href="#/dashboard" className="inline-block rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-black">Go to Dashboard</a></div>
      </div>
    </div>
  );
}
