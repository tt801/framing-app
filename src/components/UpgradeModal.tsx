import React, { useState } from "react";
import { useStripeCheckout } from "@/lib/trial";

interface UpgradeModalProps {
  onClose?: () => void;
  embedded?: boolean;
}

type PlanId = "starter" | "growth" | "pro" | "founder";

const PLANS: {
  id: PlanId;
  name: string;
  subtitle: string;
  price: string;
  period: string;
  featured?: boolean;
  badge?: string;
  oneTime?: boolean;
  priceId: string;
  features: string[];
}[] = [
  {
    id: "starter",
    name: "Starter",
    subtitle: "For solo framers",
    price: "£19",
    period: "/month",
    priceId: import.meta.env.VITE_STRIPE_PRICE_STARTER || "",
    features: [
      "Unlimited quotes & invoices",
      "Stock catalogue",
      "Room visualizer",
      "Professional PDFs",
      "Single user",
      "Email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    subtitle: "For growing teams",
    price: "£35",
    period: "/month",
    featured: true,
    priceId: import.meta.env.VITE_STRIPE_PRICE_GROWTH || "",
    features: [
      "Everything in Starter",
      "Up to 5 team seats",
      "Follow-up automations",
      "Mailchimp integration",
      "Priority support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    subtitle: "For established studios",
    price: "£59",
    period: "/month",
    priceId: import.meta.env.VITE_STRIPE_PRICE_PRO || "",
    features: [
      "Everything in Growth",
      "Unlimited team seats",
      "Xero & QuickBooks sync",
      "Advanced API integrations",
      "Dedicated onboarding",
    ],
  },
  {
    id: "founder",
    name: "Founder",
    subtitle: "Lifetime access",
    price: "£299",
    period: " once",
    badge: "Limited offer",
    oneTime: true,
    priceId: import.meta.env.VITE_STRIPE_PRICE_FOUNDER || "",
    features: [
      "Lifetime access to all features",
      "All future updates included",
      "Up to 5 team seats",
      "Locked-in pricing forever",
      "Founding member status",
    ],
  },
];

export default function UpgradeModal({ onClose, embedded = false }: UpgradeModalProps) {
  const { startCheckout, loading, error } = useStripeCheckout();
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("growth");

  const selected = PLANS.find((p) => p.id === selectedPlan)!;

  const handleCheckout = async () => {
    if (selected.priceId) {
      await startCheckout(selected.priceId, selected.oneTime ?? false);
    }
  };

  return (
    <div className={embedded ? "w-full" : "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"}>
      <div className={`w-full max-w-4xl rounded-2xl border border-white/20 bg-slate-900 p-6 shadow-2xl sm:p-10 ${embedded ? "mx-auto" : ""}`}>
        <h2 className="font-display text-2xl text-white sm:text-3xl">Choose your plan</h2>
        <p className="mt-2 text-sm text-slate-300">
          Your free trial has ended. Select a plan to continue using Framers App.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelectedPlan(plan.id)}
              className={`rounded-2xl border p-5 text-left transition ${
                selectedPlan === plan.id
                  ? plan.id === "founder"
                    ? "border-amber-300/60 bg-amber-300/10 ring-2 ring-amber-300/30"
                    : "border-cyan-300/60 bg-cyan-300/10 ring-2 ring-cyan-300/30"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              {plan.featured && (
                <span className="mb-2 inline-block rounded-full bg-cyan-300 px-2.5 py-0.5 text-[10px] font-black uppercase text-slate-950">
                  Most popular
                </span>
              )}
              {plan.badge && (
                <span className="mb-2 inline-block rounded-full bg-amber-300 px-2.5 py-0.5 text-[10px] font-black uppercase text-slate-950">
                  {plan.badge}
                </span>
              )}
              <p className="font-display text-lg text-white">{plan.name}</p>
              <p className="mt-0.5 text-xs text-slate-400">{plan.subtitle}</p>
              <p className="mt-3 text-2xl font-black text-white">
                {plan.price}
                <span className="text-xs font-bold text-slate-400">{plan.period}</span>
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-200">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <span className="mt-0.5 text-emerald-400">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        {error && <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleCheckout}
            disabled={loading || !selected.priceId}
            className={`flex-1 rounded-lg px-6 py-3 text-sm font-bold transition disabled:opacity-50 ${
              selected.id === "founder"
                ? "bg-amber-300 text-slate-950 hover:bg-amber-200"
                : "bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            }`}
          >
            {loading
              ? "Redirecting to Stripe..."
              : selected.oneTime
              ? `Buy ${selected.name} — ${selected.price}`
              : `Start ${selected.name} Plan — ${selected.price}${selected.period}`}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
            >
              Not now
            </button>
          )}
        </div>
        {!selected.oneTime && (
          <p className="mt-2 text-center text-xs text-slate-600">No commitment · Cancel anytime</p>
        )}
      </div>
    </div>
  );
}
