import React from "react";

const stats = [
  { label: "Quoting time saved", value: "63%" },
  { label: "Avg. monthly jobs", value: "+41" },
  { label: "Repeat customers", value: "2.2x" },
];

const features = [
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
];

export default function WebsiteLanding() {
  return (
    <div className="landing-root min-h-dvh text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        <header className="mb-12 flex flex-col gap-4 sm:mb-16 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/30 backdrop-blur">
              <span className="text-lg font-black">F</span>
            </div>
            <div>
              <p className="font-display text-sm uppercase tracking-[0.22em] text-cyan-200/90">FrameFlow</p>
              <p className="text-xs text-slate-300/80">Business OS for modern framing studios</p>
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
        </header>

        <section className="reveal-up grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="mb-4 inline-flex rounded-full border border-cyan-300/40 bg-cyan-300/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-cyan-100">
              Built for custom framers
            </p>
            <h1 className="font-display text-4xl leading-[1.05] text-white sm:text-5xl lg:text-6xl">
              Sell more framing jobs.
              <br />
              Spend less time in spreadsheets.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-200/90 sm:text-lg">
              FrameFlow combines quoting, jobs, invoicing, stock, customer history, and follow-up automations in one focused tool for independent framing businesses.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#/dashboard"
                className="rounded-full bg-white px-6 py-3 text-sm font-black uppercase tracking-wide text-slate-950 transition hover:bg-slate-100"
              >
                Start Free Trial
              </a>
              <a
                href="#features"
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
                {stats.map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-2xl font-black text-white">{item.value}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-300">{item.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-white/10 bg-gradient-to-r from-orange-300/25 to-cyan-400/20 p-3 text-xs leading-5 text-slate-100">
                "We replaced four tools and now send quotes in under 10 minutes."
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="mt-16 grid gap-4 sm:grid-cols-2 reveal-up" style={{ animationDelay: "120ms" }}>
          {features.map((feature) => (
            <article key={feature.title} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-cyan-200/40 hover:bg-white/10">
              <h3 className="font-display text-xl text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-200/85">{feature.text}</p>
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
