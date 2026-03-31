import React from "react";

const landingContent = {
  brandName: "Framers App",
  brandTagline: "Business OS for modern framing studios",
  heroBadge: "Built for custom framers",
  heroTitle: "Spend more time framing and less time managing.",
  heroBody:
    "Framers App combines quoting, jobs, invoicing, stock, customer history, and follow-up automations in one focused tool for independent framing businesses.",
  aboutTitle: "About Framers App",
  aboutBody:
    "Framers App is built specifically for independent framing studios that need professional workflows without enterprise complexity. It brings quoting, job tracking, invoicing, stock control, and follow-up campaigns into one practical workspace your team can use every day.",
  proofQuote:
    "We replaced four tools and now send quotes in under 10 minutes.",
  sectionTabs: [
    { label: "About", id: "about" },
    { label: "Pricing", id: "pricing" },
    { label: "Features", id: "features" },
  ],
  stats: [
    { label: "Quoting time saved", value: "63%" },
    { label: "Avg. monthly jobs", value: "+41" },
    { label: "Repeat customers", value: "2.2x" },
  ],
  features: [
    {
      title: "Quote-to-Job Pipeline",
      text: "Move from first enquiry to approved quote to job card without copy/paste admin.",
    },
    {
      title: "Visual Room Mockups",
      text: "Show clients a framed preview inside a room scene so approvals happen faster.",
    },
    {
      title: "Automation That Nudges",
      text: "Send review requests and quote follow-ups automatically from inside your workflow.",
    },
    {
      title: "Team-Ready Controls",
      text: "Separate users, credentials, and activity so each shop can run like a real business.",
    },
  ],
  pricingPlans: [
    {
      name: "Starter",
      subtitle: "For solo framers and new studios",
      price: "R499",
      period: "/month",
      featured: false,
      bullets: [
        "Quotes, jobs, invoices, stock",
        "Room visualizer + PDF exports",
        "One business account",
      ],
    },
    {
      name: "Growth",
      subtitle: "For busy teams scaling operations",
      price: "R999",
      period: "/month",
      featured: true,
      bullets: [
        "Everything in Starter",
        "Multi-user teams + activity tracking",
        "Automations and API integrations",
      ],
    },
  ],
};

export default function WebsiteLanding() {
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="landing-root min-h-dvh text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        <header className="mb-12 flex flex-col gap-4 sm:mb-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/30 backdrop-blur">
                <span className="text-lg font-black">F</span>
              </div>
              <div>
                <p className="font-display text-sm uppercase tracking-[0.22em] text-cyan-200/90">{landingContent.brandName}</p>
                <p className="text-xs text-slate-300/80">{landingContent.brandTagline}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="#/dashboard"
                className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 backdrop-blur transition hover:border-white/40 hover:bg-white/10"
              >
                Login
              </a>
              <a
                href="#/app"
                className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-extrabold text-slate-950 transition hover:bg-cyan-200"
              >
                Live Demo
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {landingContent.sectionTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => scrollToSection(tab.id)}
                className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-100 transition hover:border-white/40 hover:bg-white/10"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        <section className="reveal-up grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="mb-4 inline-flex rounded-full border border-cyan-300/40 bg-cyan-300/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-cyan-100">
              {landingContent.heroBadge}
            </p>
            <h1 className="font-display text-4xl leading-[1.05] text-white sm:text-5xl lg:text-6xl">
              {landingContent.heroTitle}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-200/90 sm:text-lg">
              {landingContent.heroBody}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#/dashboard"
                className="rounded-full bg-white px-6 py-3 text-sm font-black uppercase tracking-wide text-slate-950 transition hover:bg-slate-100"
              >
                Start Free Trial
              </a>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection("features");
                }}
                className="rounded-full border border-white/25 px-6 py-3 text-sm font-bold uppercase tracking-wide text-slate-100 transition hover:border-white/50 hover:bg-white/5"
              >
                Explore Features
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 rounded-[2rem] bg-gradient-to-br from-cyan-400/25 to-orange-300/20 blur-3xl" />
            <div className="relative rounded-[1.6rem] border border-white/20 bg-slate-900/70 p-4 shadow-2xl backdrop-blur">
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
                <p className="font-display text-sm uppercase tracking-[0.15em] text-cyan-100">Today at a glance</p>
                <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[11px] font-bold text-emerald-200">Live</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {landingContent.stats.map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-2xl font-black text-white">{item.value}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-300">{item.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-white/10 bg-gradient-to-r from-orange-300/25 to-cyan-400/20 p-3 text-xs leading-5 text-slate-100">
                "{landingContent.proofQuote}"
              </div>
            </div>
          </div>
        </section>

        <section id="about" className="mt-14 reveal-up" style={{ animationDelay: "90ms" }}>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8 backdrop-blur-sm">
            <p className="font-display text-xl text-white sm:text-2xl">{landingContent.aboutTitle}</p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-200/90 sm:text-base">
              {landingContent.aboutBody}
            </p>
          </div>
        </section>

        <section id="features" className="mt-16 grid gap-4 sm:grid-cols-2 reveal-up" style={{ animationDelay: "120ms" }}>
          {landingContent.features.map((feature) => (
            <article key={feature.title} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-cyan-200/40 hover:bg-white/10">
              <h3 className="font-display text-xl text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-200/85">{feature.text}</p>
            </article>
          ))}
        </section>

        <section id="pricing" className="mt-14 grid gap-4 sm:grid-cols-2 reveal-up" style={{ animationDelay: "160ms" }}>
          {landingContent.pricingPlans.map((plan) => (
            <article
              key={plan.name}
              className={
                plan.featured
                  ? "rounded-3xl border border-cyan-300/40 bg-cyan-300/10 p-6 backdrop-blur-sm"
                  : "rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
              }
            >
              <p className="font-display text-2xl text-white">{plan.name}</p>
              <p className={plan.featured ? "mt-1 text-sm text-slate-200" : "mt-1 text-sm text-slate-300"}>{plan.subtitle}</p>
              <p className="mt-4 text-4xl font-black text-white">
                {plan.price}
                <span className={plan.featured ? "text-base font-bold text-slate-200" : "text-base font-bold text-slate-300"}>{plan.period}</span>
              </p>
              <ul className={plan.featured ? "mt-4 space-y-2 text-sm text-slate-100/95" : "mt-4 space-y-2 text-sm text-slate-200/90"}>
                {plan.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="mt-14 reveal-up" style={{ animationDelay: "200ms" }}>
          <div className="rounded-3xl border border-orange-200/25 bg-gradient-to-r from-orange-300/20 via-amber-200/10 to-cyan-300/20 p-6 sm:p-8">
            <p className="font-display text-xl text-white sm:text-2xl">Ready to run your framing business like a modern studio?</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200/90">
              Launch with your team, import your customers, and start sending professional quotes today.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a href="#/dashboard" className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-black uppercase tracking-wide text-cyan-100 hover:bg-black">
                Create Account
              </a>
              <a href="#/api-settings" className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white hover:bg-white/10">
                Connect APIs
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
