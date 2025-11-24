// src/pages/Marketing.tsx
import React, { useMemo, useState } from "react";
import { useQuotes } from "@/lib/quotes";
import { useCustomers } from "@/lib/customers";
import { useJobs } from "@/lib/jobs";

/** Minimal inline icons (no external deps) */
const Icon = {
  Mail: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M4 4h16v16H4z" />
      <path d="m4 7 8 5 8-5" />
    </svg>
  ),
  Link2: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 12" />
      <path d="M14 11a5 5 0 0 1 0 7L12.5 20.5a5 5 0 0 1-7-7L7 12" />
    </svg>
  ),
  MessageSquare: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M21 15a4 4 0 0 1-4 4H8l-4 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
    </svg>
  ),
  ShoppingCart: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="9" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
      <path d="M3 3h2l2 12h11l2-8H6" />
    </svg>
  ),
  Megaphone: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M3 11v2a3 3 0 0 0 3 3h1l3 4v-7l10-4V7L10 11H6a3 3 0 0 1-3-3" />
    </svg>
  ),
  Phone: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07A19.5 19.5 0 0 1 3.15 9.81 19.86 19.86 0 0 1 .08 1.18 2 2 0 0 1 2.05 0h3a2 2 0 0 1 2 1.72c.12.89.31 1.76.57 2.6a2 2 0 0 1-.45 2.11L6 8a16 16 0 0 0 10 10l1.57-1.17a2 2 0 0 1 2.11-.45c.84.26 1.71.45 2.6.57A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  Star: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="m12 17.27 6.18 3.73-1.64-7.03 5.46-4.73-7.19-.62L12 2 9.19 8.62l-7.19.62 5.46 4.73L5.82 21z" />
    </svg>
  ),
  Calendar: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  Zap: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M13 2 3 14h7l-1 8 11-12h-7l1-8z" />
    </svg>
  ),
  Users: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Target: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M2 12h2M20 12h2M12 20v2" />
    </svg>
  ),
  CheckCircle: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
};

type CardProps = {
  title: string;
  icon: keyof typeof Icon;
  children: React.ReactNode;
};

function Card({ title, icon, children }: CardProps) {
  const Ico = Icon[icon];
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center gap-2">
        <Ico width={18} height={18} className="text-slate-700" />
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

type Campaign = {
  id: string;
  name: string;
  channel: string;
  start: string;
  status: "Planned" | "Live" | "Completed";
};

export default function MarketingPage() {
  // Defensive access to stores so we don't break anything
  const quotesStore: any = useQuotes();
  const customersStore: any = useCustomers();
  const jobsStore: any = useJobs();

  const quotes: any[] = quotesStore?.quotes || quotesStore?.items || [];
  const customers: any[] = customersStore?.customers || customersStore?.items || [];
  const jobs: any[] = jobsStore?.jobs || jobsStore?.items || [];

  const [campaigns, setCampaigns] = useState<Campaign[]>([
    {
      id: rid(),
      name: "Graduation & Year-end framing",
      channel: "Email + Instagram",
      start: nextMonthIso(),
      status: "Planned",
    },
  ]);

  const [reviewLinks, setReviewLinks] = useState({
    google: "",
    facebook: "",
    instagram: "",
  });

  const metrics = useMemo(() => {
    const n = (v: any, fb = 0) => {
      const x = typeof v === "string" ? parseFloat(v) : Number(v);
      return Number.isFinite(x) ? x : fb;
    };

    const parseDate = (v: any): Date | null => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const days30ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const quotesThisMonth = quotes.filter((q) => {
      const d = parseDate(q?.createdAt || q?.date || q?.updatedAt);
      return d && d >= startOfMonth;
    });

    const jobsThisMonth = jobs.filter((j) => {
      const d = parseDate(j?.createdAt || j?.date || j?.updatedAt);
      return d && d >= startOfMonth;
    });

    const conversion =
      quotesThisMonth.length > 0
        ? Math.round((jobsThisMonth.length / quotesThisMonth.length) * 100)
        : 0;

    const avgJobValue = (() => {
      const totals = jobs
        .map((j) => n(j?.total || j?.grandTotal || j?.amount))
        .filter((v) => v > 0);
      if (!totals.length) return 0;
      const sum = totals.reduce((a, b) => a + b, 0);
      return Math.round((sum / totals.length) * 10) / 10;
    })();

    const activeCustomers = customers.filter((c) => {
      const d = parseDate(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);
      return d && d >= days30ago;
    }).length;

    return {
      quotesThisMonth: quotesThisMonth.length,
      jobsThisMonth: jobsThisMonth.length,
      conversion,
      avgJobValue,
      activeCustomers,
    };
  }, [quotes, jobs, customers]);

  // Audience segments (simple, based on counts + dates)
  const segments = useMemo(() => {
    const parseDate = (v: any): Date | null => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const now = new Date();
    const days30ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const days180ago = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    let warmLeads = 0;
    let lapsed = 0;
    let vip = 0;

    customers.forEach((c) => {
      const jobsCount = c?.jobCount ?? c?.jobs?.length ?? 0;
      const d = parseDate(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);

      if (jobsCount >= 3) vip += 1;
      if (d && d >= days30ago) warmLeads += 1;
      if (d && d < days180ago) lapsed += 1;
    });

    return { warmLeads, lapsed, vip };
  }, [customers]);

  const addCampaign = () => {
    setCampaigns((prev) => [
      ...prev,
      {
        id: rid(),
        name: "",
        channel: "",
        start: "",
        status: "Planned",
      },
    ]);
  };

  const updateCampaign = (id: string, patch: Partial<Campaign>) => {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeCampaign = (id: string) => {
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  };

  const exportLapsedCustomersCSV = () => {
    const now = new Date();
    const days180ago = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    const parseDate = (v: any): Date | null => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const lapsedList = customers.filter((c) => {
      const d = parseDate(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);
      return d && d < days180ago;
    });

    if (!lapsedList.length) {
      window.alert("No lapsed customers found (6+ months since last job/invoice).");
      return;
    }

    const rows: string[][] = [];
    rows.push(["name", "email", "phone", "lastActivityDate", "notes"]);

    lapsedList.forEach((c) => {
      const firstName = c?.firstName || "";
      const lastName = c?.lastName || "";
      const combined = `${firstName} ${lastName}`.trim();
      const name = c?.name || c?.fullName || combined || "Customer";

      const email =
        c?.email || c?.emailAddress || c?.contactEmail || c?.primaryEmail || "";
      const phone =
        c?.phone || c?.mobile || c?.mobileNumber || c?.phoneNumber || "";

      const d = parseDate(c?.lastJobDate || c?.lastInvoiceDate || c?.updatedAt);
      const lastActivityDate = d ? d.toISOString().slice(0, 10) : "";

      const notes = "Segment: Lapsed (6+ months since last job/invoice)";

      rows.push([
        csvEscape(name),
        csvEscape(email),
        csvEscape(phone),
        csvEscape(lastActivityDate),
        csvEscape(notes),
      ]);
    });

    const csv = rows.map((r) => r.join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "frameit-lapsed-customers.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    window.alert(
      `Exported ${lapsedList.length} lapsed customers.\n\nYou can upload this CSV to Mailchimp, WhatsApp broadcast lists, SMS tools, or your email platform to run a win-back campaign.`
    );
  };

  const quickAction = (type: string) => {
    if (type === "graduates") {
      window.alert(
        "This would create a campaign targeting recent customers + leads for graduation framing.\n\nFuture: open a wizard pre-loaded with a subject line, email template, Instagram caption, and a short customer list based on recent quotes."
      );
    } else if (type === "reviews") {
      window.alert(
        "This would send a review request message to customers who completed jobs in the last 30 days.\n\nFuture: choose channel (WhatsApp / SMS / Email) and auto-fill your Google/Facebook links."
      );
    } else if (type === "lapsed") {
      exportLapsedCustomersCSV();
    } else if (type === "artists") {
      window.alert(
        "This would start an outreach list for artists/galleries.\n\nFuture: filter customers tagged as artists/galleries and create a recurring WhatsApp/email broadcast."
      );
    }
  };

  const copyReviewMessage = () => {
    const text = [
      "Hi! We hope you're enjoying your framed piece.",
      "If you have a moment, we'd really appreciate a quick review:",
      reviewLinks.google && `⭐ Google: ${reviewLinks.google}`,
      reviewLinks.facebook && `📘 Facebook: ${reviewLinks.facebook}`,
      reviewLinks.instagram && `📸 Instagram: ${reviewLinks.instagram}`,
    ]
      .filter(Boolean)
      .join("\n");

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        window.alert("Review message copied:\n\n" + text);
      });
    } else {
      window.alert("Review message copied:\n\n" + text);
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Marketing</h1>
          <p className="text-sm text-slate-600">
            Turn your quotes, jobs, and customers into repeat business and referrals.
          </p>
        </div>
      </header>

      {/* KPI tiles */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Quotes this month"
          value={metrics.quotesThisMonth}
          sub="Top of funnel"
          icon="Target"
        />
        <MetricTile
          label="Jobs this month"
          value={metrics.jobsThisMonth}
          sub="Work booked in"
          icon="CheckCircle"
        />
        <MetricTile
          label="Quote → job conversion"
          value={metrics.conversion ? `${metrics.conversion}%` : "–"}
          sub="This month"
          icon="Zap"
        />
        <MetricTile
          label="Active customers (30d)"
          value={metrics.activeCustomers}
          sub="Recently engaged"
          icon="Users"
        />
      </section>

      {/* Two-column row: Quick wins + Audience segments */}
      <section className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Quick wins" icon="Zap">
          <p className="mb-3 text-xs text-slate-500">
            Simple actions that a non-marketer can run weekly to keep work flowing.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <QuickAction
              title="Follow-up open quotes"
              description="Nudge people who asked for a quote but didn’t book yet."
              onClick={() => quickAction("graduates")}
              emphasis="Email / WhatsApp"
            />
            <QuickAction
              title="Ask for Google reviews"
              description="Message customers who completed jobs recently."
              onClick={() => quickAction("reviews")}
              emphasis="WhatsApp / SMS"
            />
            <QuickAction
              title="Win back lapsed customers"
              description="Download a CSV of lapsed clients for a win-back campaign."
              onClick={() => quickAction("lapsed")}
              emphasis="Email / broadcast"
            />
            <QuickAction
              title="Invite local artists/galleries"
              description="Reach out to artists and galleries for ongoing work."
              onClick={() => quickAction("artists")}
              emphasis="WhatsApp / in-person"
            />
          </div>
        </Card>

        <Card title="Audience segments" icon="Users">
          <p className="mb-3 text-xs text-slate-500">
            Simple slices of your customer base to target with specific offers.
          </p>
          <div className="grid gap-3">
            <SegmentRow
              label="Warm leads (active in last 30 days)"
              value={segments.warmLeads}
              idea="Send a simple ‘anything else you’d like framed?’ message."
            />
            <SegmentRow
              label="Lapsed customers (6+ months)"
              value={segments.lapsed}
              idea="Offer a free clean/re-mount with a new piece."
            />
            <SegmentRow
              label="VIPs (3+ jobs)"
              value={segments.vip}
              idea="Early access to new mouldings or priority turnaround."
            />
          </div>
        </Card>
      </section>

      {/* Full-width: Reviews & referrals */}
      <section className="mb-6">
        <Card title="Reviews & referrals" icon="Star">
          <p className="mb-3 text-xs text-slate-500">
            Save your review links once, then reuse them in WhatsApp, SMS, and email.
          </p>
          <div className="space-y-2 text-xs">
            <LabeledInput
              label="Google review link"
              placeholder="https://g.page/r/your-short-link"
              value={reviewLinks.google}
              onChange={(v) => setReviewLinks((r) => ({ ...r, google: v }))}
            />
            <LabeledInput
              label="Facebook page link"
              placeholder="https://facebook.com/your-page"
              value={reviewLinks.facebook}
              onChange={(v) => setReviewLinks((r) => ({ ...r, facebook: v }))}
            />
            <LabeledInput
              label="Instagram profile"
              placeholder="https://instagram.com/your-handle"
              value={reviewLinks.instagram}
              onChange={(v) => setReviewLinks((r) => ({ ...r, instagram: v }))}
            />
          </div>
          <button
            onClick={copyReviewMessage}
            className="mt-3 inline-flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-black hover:text-white"
          >
            <Icon.MessageSquare width={14} height={14} />
            Copy review request message
          </button>
          <p className="mt-2 text-[11px] text-slate-500">
            Paste this into WhatsApp, SMS, or email right after a job is marked as completed to
            keep reviews flowing.
          </p>
        </Card>
      </section>

      {/* Full-width: Campaign planner */}
      <section className="mb-8">
        <Card title="Campaign planner" icon="Calendar">
          <p className="mb-3 text-xs text-slate-500">
            Rough plan of what you&apos;re promoting and where. Keep it simple but visible.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-xs">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="px-2 py-2 text-left">Campaign</th>
                  <th className="px-2 py-2 text-left">Channel</th>
                  <th className="px-2 py-2 text-left">Start</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded border px-2 py-1"
                        value={c.name}
                        onChange={(e) => updateCampaign(c.id, { name: e.target.value })}
                        placeholder="e.g. Mother's Day framing"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className="w-full rounded border px-2 py-1"
                        value={c.channel}
                        onChange={(e) => updateCampaign(c.id, { channel: e.target.value })}
                        placeholder="e.g. Email + Insta"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        className="w-full rounded border px-2 py-1"
                        value={c.start}
                        onChange={(e) => updateCampaign(c.id, { start: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        className="w-full rounded border px-2 py-1 bg-white"
                        value={c.status}
                        onChange={(e) =>
                          updateCampaign(c.id, {
                            status: e.target.value as Campaign["status"],
                          })
                        }
                      >
                        <option value="Planned">Planned</option>
                        <option value="Live">Live</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={() => removeCampaign(c.id)}
                        className="rounded border px-2 py-1 text-[11px] hover:bg-black hover:text-white"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {!campaigns.length && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-2 py-4 text-center text-slate-500 text-xs"
                    >
                      No campaigns yet. Add your first one below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <button
            onClick={addCampaign}
            className="mt-3 rounded border px-3 py-1.5 text-xs hover:bg-black hover:text-white"
          >
            Add campaign
          </button>
        </Card>
      </section>

      {/* Strategy library (original guidance + integrations) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Playbooks by business size
        </h2>
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <Card title="Small studio" icon="Zap">
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
              <li>Google Business Profile: keep hours, photos, and reviews fresh.</li>
              <li>Instagram &amp; Facebook posts 2–3×/week (before/after shots).</li>
              <li>WhatsApp click-to-chat from website.</li>
              <li>Monthly email to past customers (top 3 offers).</li>
            </ul>
          </Card>

          <Card title="Growing shop" icon="Megaphone">
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
              <li>Meta/Google ads for “custom framing + {'{city}'}”.</li>
              <li>Automated abandoned-quote follow-ups (email/SMS).</li>
              <li>Seasonal campaigns (graduations, weddings, holidays).</li>
              <li>Simple referral program with coupon codes.</li>
            </ul>
          </Card>

          <Card title="Multi-location" icon="ShoppingCart">
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
              <li>CRM segmentation (homeowners, artists, galleries, corporates).</li>
              <li>Product feeds for e-comm (popular sizes, ready-mades).</li>
              <li>Review syndication &amp; NPS → remarketing audiences.</li>
              <li>ROAS dashboards; POS/stock → ads &amp; promos.</li>
            </ul>
          </Card>
        </div>

        <h2 className="mb-3 text-sm font-semibold text-slate-800">Integrations & data</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Messaging & reviews" icon="MessageSquare">
            <div className="grid gap-3 sm:grid-cols-2">
              <Integration label="WhatsApp (manual for now)" icon="Phone" />
              <Integration label="SMS gateway (future)" icon="Phone" />
              <Integration label="Google Reviews" icon="Star" />
              <Integration label="Facebook/Instagram DM" icon="MessageSquare" />
            </div>
          </Card>

          <Card title="Email & links" icon="Mail">
            <div className="grid gap-3 sm:grid-cols-2">
              <Integration label="Mailchimp / Sendgrid (future)" icon="Mail" />
              <Integration label="Website CTA buttons" icon="Link2" />
              <Integration label="Booking (Calendly)" icon="Calendar" />
              <Integration label="Simple campaign exports" icon="Link2" />
            </div>
          </Card>
        </div>
      </section>
    </main>
  );
}

/* --- Small subcomponents --- */

function MetricTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: keyof typeof Icon;
}) {
  const Ico = Icon[icon];
  return (
    <div className="flex items-start justify-between rounded-2xl border border-slate-100 bg-white px-3 py-3 text-sm shadow-sm">
      <div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-1 text-lg font-semibold">{value}</div>
        {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
      </div>
      <Ico width={20} height={20} className="text-slate-400" />
    </div>
  );
}

function QuickAction({
  title,
  description,
  emphasis,
  onClick,
}: {
  title: string;
  description: string;
  emphasis: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left text-xs hover:bg-slate-900 hover:text-white transition-colors"
    >
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-[11px] opacity-90">{description}</div>
      <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-700">
        <Icon.Zap width={12} height={12} />
        <span>{emphasis}</span>
      </div>
    </button>
  );
}

function SegmentRow({
  label,
  value,
  idea,
}: {
  label: string;
  value: number;
  idea: string;
}) {
  return (
    <div className="flex items-start justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-xs">
      <div>
        <div className="font-medium text-slate-800">{label}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">{idea}</div>
      </div>
      <div className="ml-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-800">
        {value}
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <input
        className="rounded border px-2 py-1 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Integration({ label, icon }: { label: string; icon: keyof typeof Icon }) {
  const Ico = Icon[icon];
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <Ico width={16} height={16} className="text-slate-700" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/* --- Helpers --- */

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function nextMonthIso(): string {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return next.toISOString().slice(0, 10);
}

function csvEscape(value: any): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
