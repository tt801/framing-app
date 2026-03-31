import React, { useState } from "react";
import { useStripeCheckout } from "@/lib/trial";

interface UpgradeModalProps {
  onClose?: () => void;
}

// Map plan names to Stripe price IDs
// You'll fill these in after creating prices in Stripe
const STRIPE_PRICES = {
  starter: import.meta.env.VITE_STRIPE_PRICE_STARTER || "",
  growth: import.meta.env.VITE_STRIPE_PRICE_GROWTH || "",
};

export default function UpgradeModal({ onClose }: UpgradeModalProps) {
  const { startCheckout, loading, error } = useStripeCheckout();
  const [selectedPlan, setSelectedPlan] = useState<"starter" | "growth">("growth");

  const handleCheckout = async () => {
    const priceId = STRIPE_PRICES[selectedPlan];
    if (priceId) {
      await startCheckout(priceId);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-white/20 bg-slate-900 p-6 shadow-2xl sm:p-10">
        <h2 className="font-display text-2xl text-white sm:text-3xl">Upgrade your plan</h2>
        <p className="mt-2 text-sm text-slate-300">
          Your free trial has ended. Choose a plan to continue using Framers App.
        </p>

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {[
            {
              id: "starter" as const,
              name: "Starter",
              subtitle: "For solo framers",
              price: "R 499",
              features: [
                "Unlimited quotes & invoices",
                "Stock catalogue",
                "Room visualizer",
                "Professional PDFs",
                "Email support",
              ],
            },
            {
              id: "growth" as const,
              name: "Growth",
              subtitle: "For growing teams",
              price: "R 999",
              featured: true,
              features: [
                "Everything in Starter",
                "Multi-user teams",
                "Follow-up automations",
                "Mailchimp integration",
                "Priority support",
              ],
            },
          ].map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelectedPlan(plan.id)}
              className={`rounded-2xl border p-6 text-left transition ${
                selectedPlan === plan.id
                  ? "border-cyan-300/60 bg-cyan-300/10 ring-2 ring-cyan-300/30"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              {plan.featured && (
                <span className="mb-3 inline-block rounded-full bg-cyan-300 px-2.5 py-0.5 text-[10px] font-black uppercase text-slate-950">
                  Most popular
                </span>
              )}
              <p className="font-display text-xl text-white">{plan.name}</p>
              <p className="mt-0.5 text-xs text-slate-400">{plan.subtitle}</p>
              <p className="mt-3 text-3xl font-black text-white">
                {plan.price}
                <span className="text-sm font-bold text-slate-400">/month</span>
              </p>
              <ul className="mt-4 space-y-2 text-xs text-slate-200">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-emerald-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        {error && <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleCheckout}
            disabled={loading || !STRIPE_PRICES[selectedPlan]}
            className="flex-1 rounded-lg bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 transition disabled:opacity-50"
          >
            {loading ? "Redirecting..." : `Upgrade to ${selectedPlan === "starter" ? "Starter" : "Growth"}`}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
