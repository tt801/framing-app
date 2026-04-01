import React, { useState, useEffect } from "react";
import { useStripeCheckout } from "@/lib/trial";
import { getCurrentUser } from "@/lib/supabase";

// ─── Currency ────────────────────────────────────────────────────────────────
// Base currency is GBP (Stripe billing currency)

const CURRENCY_CODES = ["GBP", "USD", "EUR", "ZAR", "AUD", "CAD"] as const;
type CurrencyCode = (typeof CURRENCY_CODES)[number];

const CURRENCIES: Record<CurrencyCode, { symbol: string; label: string; rate: number }> = {
  GBP: { symbol: "£",   label: "GBP – British Pound",      rate: 1 },
  USD: { symbol: "$",   label: "USD – US Dollar",          rate: 1.27 },
  EUR: { symbol: "€",   label: "EUR – Euro",               rate: 1.17 },
  ZAR: { symbol: "R",   label: "ZAR – South African Rand", rate: 23.5 },
  AUD: { symbol: "A$",  label: "AUD – Australian Dollar",  rate: 1.97 },
  CAD: { symbol: "C$",  label: "CAD – Canadian Dollar",    rate: 1.74 },
};

// Approximate Q1-2026 rates from GBP — update periodically
function detectCurrency(): CurrencyCode {
  const locale = (navigator.language ?? "en-GB").toLowerCase();
  if (locale.includes("-us")) return "USD";
  if (locale.includes("-au") || locale.includes("-nz")) return "AUD";
  if (locale.includes("-ca")) return "CAD";
  if (locale.includes("-za")) return "ZAR";
  if (["de-", "fr-", "nl-", "it-", "es-", "pt-"].some((l) => locale.startsWith(l))) return "EUR";
  return "GBP";
}

function fmtPrice(gbpAmount: number, currency: CurrencyCode): string {
  const { symbol, rate } = CURRENCIES[currency];
  const val = Math.round(gbpAmount * rate);
  return `${symbol}${val}`;
}

// ─── Content config ───────────────────────────────────────────────────────────

const landingContent = {
  brandName: "Framers App",
  brandTagline: "Business OS for modern framing studios",
  heroBadge: "Built for custom framers",
  heroTitle: "Spend more time framing,\nless time on admin.",
  heroBody:
    "Framers App brings quoting, job tracking, invoicing, stock control, room visualisation, and customer follow-ups into one focused workspace built for independent framing studios.",

  stats: [
    { label: "Faster quoting", value: "63%" },
    { label: "Extra jobs / month", value: "+41" },
    { label: "Repeat customer rate", value: "2.2×" },
    { label: "Admin hours saved / week", value: "6 hrs" },
  ],

  steps: [
    {
      num: "01",
      title: "Build a quote in minutes",
      body: "Add the client, the artwork dimensions, and select frame, mat, and glass from your stock catalogue. Pricing calculates automatically from your own markup rules.",
    },
    {
      num: "02",
      title: "Convert to a job with one click",
      body: "When the client says yes, the quote becomes a tracked job card — ready with work notes, due dates, and team assignment already filled in.",
    },
    {
      num: "03",
      title: "Invoice, follow up, and repeat",
      body: "Generate a professional invoice, trigger follow-up emails automatically, and build a client history that keeps repeat business coming back.",
    },
  ],

  features: [
    {
      id: "quotes",
      title: "Quote-to-Job Pipeline",
      tagline: "From first enquiry to approved job — no copy-paste, no spreadsheets.",
      bullets: [
        "Build detailed quotes with frame, mat, mount, glass, and custom labour line items",
        "Pricing auto-calculates from your own markup percentages and live stock costs",
        "Export a branded PDF quote and send it directly from inside the app",
        "One-click conversion from approved quote to active job card",
        "Full quote history per client — duplicate and re-price previous jobs in seconds",
      ],
    },
    {
      id: "jobs",
      title: "Visual Job Board",
      tagline: "See every job at a glance. Never miss a deadline.",
      bullets: [
        "Kanban columns: New Quote → Approved → In Progress → Ready → Collected",
        "Assign jobs to team members, set due dates, and flag priority work",
        "Attach notes, photos, measurements, and special instructions to each job card",
        "Dashboard overview highlights overdue jobs, today's work, and what's ready to collect",
        "Full activity log tracks every status change, edit, and team note",
      ],
    },
    {
      id: "visualizer",
      title: "Room Visualizer",
      tagline: "Help clients say yes faster by showing them the finished result.",
      bullets: [
        "Drop any frame and mat combination into a photorealistic room scene",
        "Choose from multiple room backdrops: living room, bedroom, gallery wall",
        "Preview updates instantly as you change frame style, mat colour, and size",
        "Export the mockup image to share with clients via email or WhatsApp",
        "Include the room preview in your PDF quote for a premium presentation",
      ],
    },
    {
      id: "automation",
      title: "Follow-up Automations",
      tagline: "Win back lost quotes and grow 5-star reviews — on autopilot.",
      bullets: [
        "Auto-send a follow-up email when a quote has been open 3 days with no reply",
        "Send a review request the moment a job is marked Collected",
        "Schedule marketing campaigns to your customer list, all from inside the app",
        "Mailchimp integration syncs your customers to your existing email lists",
        "All emails go out under your business name and branding",
      ],
    },
  ],

  testimonial: {
    quote: "We replaced four tools and now send quotes in under 10 minutes. The job board alone saved us hours every week.",
    author: "Studio owner, Cape Town",
  },

  pricing: [
    {
      name: "Starter",
      subtitle: "For solo framers and small studios",
      gbpPrice: 19,
      period: "/month",
      oneTime: false,
      featured: false,
      bullets: [
        "Unlimited quotes, jobs & invoices",
        "Stock catalogue with markup rules",
        "Room visualizer",
        "Professional PDF exports",
        "Single user account",
        "Email support",
      ],
    },
    {
      name: "Growth",
      subtitle: "For busy studios scaling up",
      gbpPrice: 35,
      period: "/month",
      oneTime: false,
      featured: true,
      bullets: [
        "Everything in Starter",
        "Multi-user teams (up to 5 seats)",
        "Quote follow-up automations",
        "Review request automations",
        "Mailchimp & accounting integrations",
        "Priority support",
      ],
    },
    {
      name: "Pro",
      subtitle: "For established studios with full teams",
      gbpPrice: 59,
      period: "/month",
      oneTime: false,
      featured: false,
      bullets: [
        "Everything in Growth",
        "Unlimited team seats",
        "Advanced API integrations",
        "Xero & QuickBooks sync",
        "Dedicated onboarding",
        "Priority phone support",
      ],
    },
    {
      name: "Founder",
      subtitle: "Lifetime access — limited availability",
      gbpPrice: 299,
      period: " one-off",
      oneTime: true,
      featured: false,
      badge: "Limited offer",
      bullets: [
        "Lifetime access to all features",
        "All future updates included",
        "Up to 5 team seats",
        "Automations & integrations",
        "Founding member badge & community",
        "Locked-in pricing forever",
      ],
    },
  ],

  footer: {
    tagline:
      "Framers App is a business management platform built specifically for independent picture framing studios.",
    company: "Framers App (Pty) Ltd",
    address: "South Africa",
    email: "support@framersapp.co.za",
    social: [
      { label: "X / Twitter", href: "https://x.com/framersapp",                icon: "𝕏" },
      { label: "LinkedIn",    href: "https://linkedin.com/company/framersapp",  icon: "in" },
      { label: "Instagram",   href: "https://instagram.com/framersapp",         icon: "IG" },
    ],
    links: {
      Product: [
        { label: "Features",        href: "#features" },
        { label: "Pricing",         href: "#pricing" },
        { label: "How it works",    href: "#about" },
        { label: "Book a Demo",     href: "#/start-trial" },
      ],
      Account: [
        { label: "Start Free Trial", href: "#/start-trial" },
        { label: "Log In",           href: "#/login" },
        { label: "Contact Support",  href: "mailto:support@framersapp.co.za" },
      ],
      Legal: [
        { label: "Privacy Policy",   href: "#" },
        { label: "Terms of Service", href: "#" },
        { label: "Cookie Policy",    href: "#" },
      ],
    },
  },
};

// ─── App UI Mockups ───────────────────────────────────────────────────────────
// These are CSS representations of the real app screens.
// Replace with actual <img> screenshots once available.

function MockupShell({ children, url }: { children: React.ReactNode; url: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-slate-800/80 px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
        <span className="ml-3 truncate rounded bg-slate-700 px-3 py-0.5 text-[10px] text-slate-400">{url}</span>
      </div>
      {children}
    </div>
  );
}

function QuoteMockup() {
  return (
    <MockupShell url="app.framersapp.co.za / quotes / Q-2847">
      <div className="p-4 text-xs">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="font-bold text-white">Quote #Q-2847</p>
            <p className="text-slate-400">Sarah Mitchell · 48 × 63 cm landscape</p>
          </div>
          <span className="rounded-full bg-cyan-300/20 px-2.5 py-0.5 text-[10px] font-bold text-cyan-200">Awaiting approval</span>
        </div>
        <div className="mb-3 overflow-hidden rounded-lg border border-white/10 bg-slate-800 text-[11px]">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Price</span>
          </div>
          {[
            ["Oak shadowbox frame", "—", "R 420"],
            ["Off-white mat board 2.5 mm", "1", "R 85"],
            ["Conservation clear glass", "1", "R 180"],
            ["Assembly & labour", "—", "R 65"],
          ].map(([item, qty, p]) => (
            <div key={item} className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-white/5 px-3 py-1.5 text-slate-200">
              <span>{item}</span>
              <span className="text-right text-slate-400">{qty}</span>
              <span className="text-right">{p}</span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_auto] gap-x-3 bg-white/5 px-3 py-2 font-bold">
            <span className="text-slate-300">Total (incl. VAT)</span>
            <span className="text-right text-cyan-300">R 750</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="flex-1 rounded-lg bg-cyan-300 py-1.5 text-[11px] font-bold text-slate-950">Accept Quote</button>
          <button className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-slate-300">Export PDF</button>
          <button className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-slate-300">Duplicate</button>
        </div>
      </div>
    </MockupShell>
  );
}

function JobBoardMockup() {
  const cols = [
    {
      label: "New Quote",
      dot: "bg-slate-400",
      cards: ["Wedding artwork — Smith", "A3 landscape — Jones"],
    },
    {
      label: "In Progress",
      dot: "bg-blue-400",
      cards: ["Oval portrait — Chen", "Diploma set — Park", "Abstract 90×60 — Lim"],
    },
    {
      label: "Ready",
      dot: "bg-emerald-400",
      cards: ["Wildlife print — Adams"],
    },
    {
      label: "Collected",
      dot: "bg-slate-600",
      cards: ["4 jobs this week"],
    },
  ];
  return (
    <MockupShell url="app.framersapp.co.za / jobs">
      <div className="flex gap-2 overflow-x-auto p-3 pb-4">
        {cols.map((col) => (
          <div key={col.label} className="w-36 shrink-0">
            <div className="mb-2 flex items-center gap-1.5 px-1">
              <span className={`h-2 w-2 rounded-full ${col.dot}`} />
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{col.label}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {col.cards.map((card) => (
                <div
                  key={card}
                  className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-2 text-[11px] leading-tight text-slate-300"
                >
                  {card}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </MockupShell>
  );
}

function RoomMockup() {
  return (
    <MockupShell url="app.framersapp.co.za / visualizer">
      <div className="p-3">
        <div
          className="relative mb-3 overflow-hidden rounded-xl bg-gradient-to-b from-slate-600 to-slate-800"
          style={{ height: 148 }}
        >
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-slate-500/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-10 bg-amber-900/40" />
          <div
            className="absolute left-1/2 top-6 -translate-x-1/2 rounded border-[5px] border-amber-700 bg-slate-300/30 shadow-2xl"
            style={{ width: 82, height: 68 }}
          >
            <div className="h-full w-full rounded-sm bg-gradient-to-br from-slate-200/30 to-slate-500/20" />
          </div>
          <div className="absolute bottom-2 left-3 rounded-full bg-black/30 px-2 py-0.5 text-[9px] text-white backdrop-blur">
            Oak Natural · Off-white mat
          </div>
          <div className="absolute bottom-2 right-3 rounded-full bg-black/30 px-2 py-0.5 text-[9px] text-white backdrop-blur">
            48 × 63 cm
          </div>
        </div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Frame style</p>
        <div className="flex gap-1.5 text-[10px]">
          {[
            { name: "Oak Natural", active: true },
            { name: "Walnut Dark", active: false },
            { name: "Gloss Black", active: false },
          ].map((f) => (
            <div
              key={f.name}
              className={`flex-1 rounded-lg border py-1 text-center ${
                f.active
                  ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-200"
                  : "border-white/10 text-slate-400"
              }`}
            >
              {f.name}
            </div>
          ))}
        </div>
      </div>
    </MockupShell>
  );
}

function AutomationMockup() {
  return (
    <MockupShell url="app.framersapp.co.za / automations">
      <div className="p-3 text-[11px]">
        <p className="mb-2.5 font-bold text-slate-300">Active Automations</p>
        {[
          {
            label: "Quote follow-up",
            trigger: "3 days after send · no reply",
            stat: "8 sent this month",
            on: true,
          },
          {
            label: "Review request",
            trigger: "Job marked Collected",
            stat: "14 sent this month",
            on: true,
          },
          {
            label: "Re-engagement campaign",
            trigger: "60 days no activity",
            stat: "Paused",
            on: false,
          },
        ].map((a) => (
          <div key={a.label} className="mb-2 rounded-lg border border-white/10 bg-slate-800 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">{a.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                  a.on ? "bg-emerald-400/20 text-emerald-300" : "bg-slate-600/50 text-slate-400"
                }`}
              >
                {a.on ? "Active" : "Paused"}
              </span>
            </div>
            <p className="mt-0.5 text-slate-400">{a.trigger}</p>
            <p className="mt-0.5 text-cyan-300/80">{a.stat}</p>
          </div>
        ))}
      </div>
    </MockupShell>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WebsiteLanding() {
  const [currency, setCurrency] = useState<CurrencyCode>("ZAR");
  const { startCheckout, loading: checkoutLoading } = useStripeCheckout();
  const logoSrc = "/framersapp-logo-lightblue.png";

  const stripePriceIds = {
    Starter: import.meta.env.VITE_STRIPE_PRICE_STARTER || "",
    Growth: import.meta.env.VITE_STRIPE_PRICE_GROWTH || "",
    Pro: import.meta.env.VITE_STRIPE_PRICE_PRO || "",
    Founder: import.meta.env.VITE_STRIPE_PRICE_FOUNDER || "",
  } as const;

  useEffect(() => {
    setCurrency(detectCurrency());
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const startPlanCheckout = async (planName: keyof typeof stripePriceIds, isOneTime: boolean) => {
    const user = await getCurrentUser();
    if (!user) {
      window.location.hash = "#/start-trial";
      return;
    }

    const priceId = stripePriceIds[planName];
    if (!priceId) {
      console.error("[pricing] Missing Stripe price ID for plan:", planName);
      return;
    }

    await startCheckout(priceId, isOneTime);
  };

  return (
    <div className="landing-root min-h-dvh text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6 lg:px-10">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <header className="mb-12 flex flex-col gap-4 sm:mb-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-start">
                <img
                  src={logoSrc}
                  alt={landingContent.brandName}
                  className="h-11 w-auto object-contain"
                />
                <p className="mt-2 text-xs text-slate-300/80">{landingContent.brandTagline}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="#/login"
                className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 backdrop-blur transition hover:border-white/40 hover:bg-white/10"
              >
                Login
              </a>
              <a
                href="#/start-trial"
                className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-extrabold text-slate-950 transition hover:bg-cyan-200"
              >
                Start Free Trial
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "How It Works", id: "about" },
              { label: "Features",     id: "features" },
              { label: "Pricing",      id: "pricing" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => scrollTo(tab.id)}
                className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-100 transition hover:border-white/40 hover:bg-white/10"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <section className="reveal-up grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <p className="mb-4 inline-flex rounded-full border border-cyan-300/40 bg-cyan-300/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-cyan-100">
              {landingContent.heroBadge}
            </p>
            <h1 className="font-display text-4xl leading-[1.06] text-white sm:text-5xl lg:text-6xl" style={{ whiteSpace: "pre-line" }}>
              {landingContent.heroTitle}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-200/90 sm:text-lg">
              {landingContent.heroBody}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#/start-trial"
                className="rounded-full bg-white px-6 py-3 text-sm font-black uppercase tracking-wide text-slate-950 transition hover:bg-slate-100"
              >
                Start Free Trial
              </a>
              <button
                type="button"
                onClick={() => scrollTo("features")}
                className="rounded-full border border-white/25 px-6 py-3 text-sm font-bold uppercase tracking-wide text-slate-100 transition hover:border-white/50 hover:bg-white/5"
              >
                See Features
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              ✓ 14-day free trial &nbsp;·&nbsp; No credit card required &nbsp;·&nbsp; Cancel anytime
            </p>
          </div>
          <div className="relative">
            <div className="absolute -inset-8 rounded-[2rem] bg-gradient-to-br from-cyan-400/25 to-orange-300/20 blur-3xl" />
            <div className="relative">
              <QuoteMockup />
            </div>
          </div>
        </section>

        {/* ── STATS BAR ──────────────────────────────────────────────────── */}
        <section className="mt-14 reveal-up" style={{ animationDelay: "60ms" }}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {landingContent.stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center backdrop-blur-sm">
                <p className="font-display text-3xl font-black text-white">{s.value}</p>
                <p className="mt-1 text-xs text-slate-300">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ───────────────────────────────────────────────── */}
        <section id="about" className="mt-24 scroll-mt-6 reveal-up" style={{ animationDelay: "80ms" }}>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">How it works</p>
          <h2 className="font-display text-3xl text-white sm:text-4xl">Everything connected, end to end.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300/85">
            Framers App is built specifically for independent framing studios that need professional workflows without enterprise complexity. Every part of your workflow — from the first enquiry to the final collection — lives in one place.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {landingContent.steps.map((step) => (
              <div key={step.num} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                <p className="font-display text-4xl font-black text-cyan-300/40">{step.num}</p>
                <p className="mt-2 font-display text-lg text-white">{step.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300/85">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── FEATURE DETAILS ────────────────────────────────────────────── */}
        <section id="features" className="mt-24 scroll-mt-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Features</p>
          <h2 className="font-display text-3xl text-white sm:text-4xl">All the tools. None of the bloat.</h2>

          <div className="mt-12 flex flex-col gap-20">
            {landingContent.features.map((feature, i) => (
              <div key={feature.id} className="reveal-up grid gap-8 lg:grid-cols-2 lg:items-center">
                {/* Text — alternates side */}
                <div className={i % 2 === 1 ? "lg:order-2" : "lg:order-1"}>
                  <p className="font-display text-2xl text-white sm:text-3xl">{feature.title}</p>
                  <p className="mt-2 text-base text-cyan-200/80 italic">{feature.tagline}</p>
                  <ul className="mt-5 space-y-2.5">
                    {feature.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-sm leading-6 text-slate-200/85">
                        <span className="mt-0.5 shrink-0 text-emerald-400">✓</span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* Mockup — alternates side */}
                <div className={`relative ${i % 2 === 1 ? "lg:order-1" : "lg:order-2"}`}>
                  <div className="absolute -inset-6 rounded-3xl bg-gradient-to-br from-cyan-500/10 to-slate-800/5 blur-2xl" />
                  <div className="relative">
                    {feature.id === "quotes"     && <QuoteMockup />}
                    {feature.id === "jobs"        && <JobBoardMockup />}
                    {feature.id === "visualizer"  && <RoomMockup />}
                    {feature.id === "automation"  && <AutomationMockup />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── TESTIMONIAL ────────────────────────────────────────────────── */}
        <section className="mt-20 reveal-up">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-10 text-center backdrop-blur-sm">
            <p className="font-display text-xl text-white sm:text-2xl lg:text-3xl max-w-3xl mx-auto leading-snug">
              "{landingContent.testimonial.quote}"
            </p>
            <p className="mt-4 text-sm text-slate-400">— {landingContent.testimonial.author}</p>
          </div>
        </section>

        {/* ── PRICING ────────────────────────────────────────────────────── */}
        <section id="pricing" className="mt-24 scroll-mt-6 reveal-up">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Pricing</p>
              <h2 className="font-display text-3xl text-white sm:text-4xl">Simple, transparent pricing.</h2>
              <p className="mt-2 text-sm text-slate-300">
                Start free for 14 days. No credit card required.
              </p>
            </div>
            {/* Currency selector */}
            <div className="flex items-center gap-2">
              <label htmlFor="currency-select" className="text-xs text-slate-400 shrink-0">
                Show prices in
              </label>
              <select
                id="currency-select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="rounded-lg border border-white/20 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-300/50 cursor-pointer"
              >
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCIES[c].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {landingContent.pricing.map((plan) => (
              <article
                key={plan.name}
                className={
                  plan.featured
                    ? "relative rounded-3xl border border-cyan-300/40 bg-gradient-to-b from-cyan-300/10 to-transparent p-6 backdrop-blur-sm"
                    : plan.name === "Founder"
                    ? "rounded-3xl border border-amber-300/30 bg-gradient-to-b from-amber-300/10 to-transparent p-6 backdrop-blur-sm"
                    : "rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
                }
              >
                {plan.featured && (
                  <span className="mb-3 inline-block rounded-full bg-cyan-300 px-3 py-0.5 text-[11px] font-black uppercase tracking-wide text-slate-950">
                    Most popular
                  </span>
                )}
                {"badge" in plan && plan.badge && (
                  <span className="mb-3 inline-block rounded-full bg-amber-300 px-3 py-0.5 text-[11px] font-black uppercase tracking-wide text-slate-950">
                    {plan.badge}
                  </span>
                )}
                <p className="font-display text-2xl text-white">{plan.name}</p>
                <p className="mt-1 text-sm text-slate-300">{plan.subtitle}</p>
                <p className="mt-5 text-4xl font-black text-white">
                  {fmtPrice(plan.gbpPrice, currency)}
                  <span className="text-base font-bold text-slate-400">{plan.period}</span>
                </p>
                {currency !== "GBP" && (
                  <p className="mt-1 text-xs text-slate-500">
                    ≈ £{plan.gbpPrice}{plan.oneTime ? " one-off" : "/mo"} · billed in GBP · rates approx.
                  </p>
                )}
                <ul className="mt-6 space-y-2.5">
                  {plan.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-slate-100/90">
                      <span className="mt-0.5 shrink-0 text-emerald-400">✓</span>
                      {b}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => startPlanCheckout(plan.name as keyof typeof stripePriceIds, plan.oneTime)}
                  disabled={checkoutLoading}
                  className={`mt-8 block rounded-full py-3 text-center text-sm font-black uppercase tracking-wide transition ${
                    plan.featured
                      ? "bg-white text-slate-950 hover:bg-slate-100"
                      : plan.name === "Founder"
                      ? "bg-amber-300 text-slate-950 hover:bg-amber-200"
                      : "border border-white/30 text-white hover:bg-white/10"
                  } disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  {checkoutLoading
                    ? "Redirecting..."
                    : plan.oneTime
                    ? "Buy Lifetime Access"
                    : "Start Subscription"}
                </button>
                {!plan.oneTime && (
                  <p className="mt-2 text-center text-xs text-slate-500">
                    Sign in required · Stripe checkout
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>

        {/* ── CTA BANNER ─────────────────────────────────────────────────── */}
        <section className="mt-20 reveal-up">
          <div className="rounded-3xl border border-orange-200/20 bg-gradient-to-r from-orange-300/20 via-amber-200/10 to-cyan-300/20 p-8 text-center sm:p-12">
            <h2 className="font-display text-2xl text-white sm:text-3xl">
              Ready to run your studio like a pro?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-200/80">
              14 days free, fully featured, no credit card needed. Set up takes under 5 minutes.
            </p>
            <a
              href="#/start-trial"
              className="mt-7 inline-block rounded-full bg-white px-10 py-3.5 text-sm font-black uppercase tracking-wide text-slate-950 transition hover:bg-slate-100"
            >
              Start Your Free Trial
            </a>
            <p className="mt-3 text-xs text-slate-500">
              No credit card required · No commitment · Cancel anytime
            </p>
          </div>
        </section>

        {/* ── FOOTER ─────────────────────────────────────────────────────── */}
        <footer className="mt-24 border-t border-white/10 pt-12">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
            {/* Brand */}
            <div>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex flex-col items-start">
                  <img
                    src={logoSrc}
                    alt={landingContent.brandName}
                    className="h-10 w-auto object-contain"
                  />
                  <p className="mt-2 text-xs text-slate-400/90">{landingContent.brandTagline}</p>
                </div>
              </div>
              <p className="max-w-xs text-sm leading-6 text-slate-300/75">
                {landingContent.footer.tagline}
              </p>
              <p className="mt-3 text-xs text-slate-500">
                <a href={`mailto:${landingContent.footer.email}`} className="hover:text-slate-300 transition">
                  {landingContent.footer.email}
                </a>
              </p>
              <div className="mt-5 flex gap-2">
                {landingContent.footer.social.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/5 text-xs font-bold text-slate-300 transition hover:border-white/30 hover:text-white"
                  >
                    {s.icon}
                  </a>
                ))}
              </div>
            </div>

            {/* Link columns */}
            {(Object.entries(landingContent.footer.links) as [string, { label: string; href: string }[]][]).map(
              ([colTitle, links]) => (
                <div key={colTitle}>
                  <p className="mb-4 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {colTitle}
                  </p>
                  <ul className="space-y-2.5">
                    {links.map((link) => (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          className="text-sm text-slate-300 transition hover:text-white"
                        >
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </div>

          <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              © {new Date().getFullYear()} {landingContent.footer.company}. All rights reserved.
            </p>
            <p className="text-xs text-slate-600">{landingContent.footer.address}</p>
          </div>
        </footer>

      </div>
    </div>
  );
}
