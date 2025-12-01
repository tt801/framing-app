// src/pages/Dashboard.tsx
import React, { useMemo, useState, useEffect } from "react";
import { useQuotes } from "@/lib/quotes";
import { useInvoices } from "@/lib/invoices";
import { useJobs } from "@/lib/jobs";
import { useCustomers } from "@/lib/customers";
import { useCatalog } from "@/lib/store";

/* ------------ Types ------------ */
type ActivityItem = {
  id: string;
  type: "quote" | "job" | "invoice";
  label: string;
  date: Date;
};

type TopCustomer = {
  name: string;
  jobs: number;
  total: number;
};

type UpcomingJob = {
  id: string;
  label: string;
  date: Date;
  status: string;
};

type RecentQuote = {
  id: string;
  label: string;
  customer: string;
  status: string;
  total: number;
  date: Date | null;
};

type DashboardWidgetKey =
  | "quotesPipeline"
  | "jobsPipeline"
  | "overdueInvoices"
  | "stockAlerts"
  | "activity"
  | "topCustomers"
  | "upcomingJobs"
  | "recentQuotes"
  | "marketingInsights";

type DashboardPrefs = Record<DashboardWidgetKey, boolean>;

type DashboardConfigState = {
  visible: DashboardPrefs;
  order: DashboardWidgetKey[];
};

const ALL_WIDGET_KEYS: DashboardWidgetKey[] = [
  "quotesPipeline",
  "jobsPipeline",
  "overdueInvoices",
  "stockAlerts",
  "activity",
  "topCustomers",
  "upcomingJobs",
  "recentQuotes",
  "marketingInsights",
];

const DEFAULT_VISIBLE: DashboardPrefs = {
  quotesPipeline: true,
  jobsPipeline: true,
  overdueInvoices: true,
  stockAlerts: true,
  activity: true,
  topCustomers: true,
  upcomingJobs: true,
  recentQuotes: true,
  marketingInsights: true,
};

const DASHBOARD_CONFIG_KEY = "frameit.dashboard.config.v1";

/* ------------ Config hook (visibility + order) ------------ */

function useDashboardConfig(): {
  visible: DashboardPrefs;
  setVisible: (key: DashboardWidgetKey, value: boolean) => void;
  order: DashboardWidgetKey[];
  setOrder: (
    updater:
      | DashboardWidgetKey[]
      | ((prev: DashboardWidgetKey[]) => DashboardWidgetKey[])
  ) => void;
} {
  const [state, setState] = useState<DashboardConfigState>(() => {
    if (typeof window === "undefined") {
      return { visible: DEFAULT_VISIBLE, order: ALL_WIDGET_KEYS };
    }
    try {
      const raw = window.localStorage.getItem(DASHBOARD_CONFIG_KEY);
      if (!raw) {
        return { visible: DEFAULT_VISIBLE, order: ALL_WIDGET_KEYS };
      }
      const parsed = JSON.parse(raw) as Partial<DashboardConfigState>;
      const visible: DashboardPrefs = {
        ...DEFAULT_VISIBLE,
        ...(parsed.visible || {}),
      };
      const storedOrder = parsed.order || [];
      const cleanedOrder: DashboardWidgetKey[] = [
        // keep only known keys
        ...storedOrder.filter((k: any) =>
          (ALL_WIDGET_KEYS as string[]).includes(k)
        ),
        // append any new keys we added later
        ...ALL_WIDGET_KEYS.filter((k) => !storedOrder.includes(k)),
      ];
      return { visible, order: cleanedOrder };
    } catch {
      return { visible: DEFAULT_VISIBLE, order: ALL_WIDGET_KEYS };
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(DASHBOARD_CONFIG_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state]);

  const setVisible = (key: DashboardWidgetKey, value: boolean) => {
    setState((prev) => ({
      ...prev,
      visible: { ...prev.visible, [key]: value },
    }));
  };

  const setOrder = (
    updater:
      | DashboardWidgetKey[]
      | ((prev: DashboardWidgetKey[]) => DashboardWidgetKey[])
  ) => {
    setState((prev) => {
      const nextOrder =
        typeof updater === "function" ? updater(prev.order) : updater;
      return { ...prev, order: nextOrder };
    });
  };

  return { visible: state.visible, setVisible, order: state.order, setOrder };
}

/* ------------ Component ------------ */

export default function DashboardPage() {
  const quotesStore: any = useQuotes();
  const invoicesStore: any = useInvoices();
  const jobsStore: any = useJobs();
  const customersStore: any = useCustomers();
  const { catalog } = useCatalog();

  const quotes: any[] = quotesStore?.quotes || quotesStore?.items || [];
  const invoices: any[] = invoicesStore?.invoices || invoicesStore?.items || [];
  const jobs: any[] = jobsStore?.jobs || jobsStore?.items || [];
  const customers: any[] =
    customersStore?.customers || customersStore?.items || [];

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const { visible, setVisible, order, setOrder } = useDashboardConfig();
  const [editing, setEditing] = useState(false);
  const [dragKey, setDragKey] = useState<DashboardWidgetKey | null>(null);

  const {
    todayJobs,
    openQuotes,
    overdueInvoices,
    stockAlerts,
    monthlySales,
    jobsThisWeek,
    conversion,
    activeCustomers,
    quotePipeline,
    jobPipeline,
    recentActivity,
    topCustomers,
    upcomingJobs,
    recentQuotes,
    marketingStats,
  } = useMemo(() => {
    const n = (v: any, fb = 0) => {
      const x = typeof v === "string" ? parseFloat(v) : Number(v);
      return Number.isFinite(x) ? x : fb;
    };

    const parseDate = (v: any): Date | null => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const isSameDay = (d: Date | null, ref: Date) => {
      if (!d) return false;
      return (
        d.getFullYear() === ref.getFullYear() &&
        d.getMonth() === ref.getMonth() &&
        d.getDate() === ref.getDate()
      );
    };

    const startOfWeek = (() => {
      const d = new Date();
      const day = d.getDay(); // 0=Sun
      const diff = (day + 6) % 7; // Monday
      d.setDate(d.getDate() - diff);
      d.setHours(0, 0, 0, 0);
      return d;
    })();

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const days30ago = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Today jobs
    const todayJobsInner = jobs.filter((j) => {
      const d =
        parseDate(j?.dueDate) ||
        parseDate(j?.scheduledFor) ||
        parseDate(j?.date) ||
        parseDate(j?.createdAt);
      return isSameDay(d, today);
    });

    // Open quotes
    const openStatuses = new Set(["Draft", "Open", "Sent", "Pending"]);
    const openQuotesInner = quotes.filter((q) => {
      const status: string =
        q?.status || q?.state || q?.quoteStatus || "Draft";
      return openStatuses.has(status);
    });

    // Overdue invoices
    const overdueInvoicesInner = invoices.filter((inv) => {
      const status: string =
        inv?.status || inv?.state || (inv?.isPaid ? "Paid" : "Open");
      const isPaid =
        status.toLowerCase() === "paid" ||
        status.toLowerCase() === "settled" ||
        inv?.isPaid ||
        !!inv?.paidAt;
      if (isPaid) return false;
      const d =
        parseDate(inv?.dueDate) ||
        parseDate(inv?.date) ||
        parseDate(inv?.createdAt);
      return d ? d < today : false;
    });

    // Sales this month
    const monthlySalesInner = invoices
      .filter((inv) => {
        const d = parseDate(inv?.date || inv?.createdAt);
        if (!d) return false;
        return d >= startOfMonth && d <= today;
      })
      .reduce(
        (sum, inv) => sum + n(inv?.total || inv?.grandTotal || inv?.amount),
        0
      );

    // Jobs this week
    const jobsThisWeekInner = jobs.filter((j) => {
      const d =
        parseDate(j?.dueDate) ||
        parseDate(j?.scheduledFor) ||
        parseDate(j?.date) ||
        parseDate(j?.createdAt);
      if (!d) return false;
      return d >= startOfWeek && d <= today;
    }).length;

    // Conversion
    const quotesThisMonth = quotes.filter((q) => {
      const d = parseDate(q?.createdAt || q?.date || q?.updatedAt);
      return d && d >= startOfMonth;
    });
    const jobsThisMonth = jobs.filter((j) => {
      const d = parseDate(j?.createdAt || j?.date || j?.updatedAt);
      return d && d >= startOfMonth;
    });
    const conversionInner =
      quotesThisMonth.length > 0
        ? Math.round((jobsThisMonth.length / quotesThisMonth.length) * 100)
        : 0;

    // Active customers (30d)
    const activeCustomersInner = customers.filter((c) => {
      const d =
        parseDate(c?.lastJobDate) ||
        parseDate(c?.lastInvoiceDate) ||
        parseDate(c?.updatedAt);
      return d && d >= days30ago;
    }).length;

    // Quote pipeline
    const pipeline = { draft: 0, sent: 0, accepted: 0, lost: 0 };
    quotes.forEach((q) => {
      const status: string =
        (q?.status || q?.state || "Draft").toString().toLowerCase();
      if (status === "draft" || status === "open") pipeline.draft += 1;
      else if (status === "sent") pipeline.sent += 1;
      else if (status === "accepted") pipeline.accepted += 1;
      else if (
        status === "declined" ||
        status === "expired" ||
        status === "lost"
      )
        pipeline.lost += 1;
      else pipeline.draft += 1;
    });

    // Job pipeline
    const jobPipe = {
      booked: 0,
      inProgress: 0,
      ready: 0,
      completed: 0,
    };
    jobs.forEach((j) => {
      const status: string =
        (j?.status || j?.state || "").toString().toLowerCase();
      if (status === "completed" || status === "done" || status === "finished")
        jobPipe.completed += 1;
      else if (status === "ready" || status === "ready_for_collection")
        jobPipe.ready += 1;
      else if (
        status === "in_progress" ||
        status === "in progress" ||
        status === "working"
      )
        jobPipe.inProgress += 1;
      else jobPipe.booked += 1;
    });

    // Stock alerts
    const stock = catalog?.stock || {};
    const alerts: string[] = [];
    const addAlert = (msg: string) => alerts.push(msg);

    (stock.frames || []).forEach((f: any) => {
      const avail = n(f?.metersAvailable);
      const min = n(f?.minThreshold);
      if (min > 0 && avail < min) {
        addAlert(`Frame ${f?.profileId || "Unknown"}: ${avail}m < ${min}m`);
      }
    });
    (stock.sheets || []).forEach((s: any) => {
      const qty = n(s?.qty);
      const min = n(s?.minThreshold);
      if (min > 0 && qty < min) {
        addAlert(`Sheet ${s?.sku || s?.id || "Unknown"}: ${qty} < ${min}`);
      }
    });
    (stock.rolls || []).forEach((r: any) => {
      const metres = n(r?.metersRemaining);
      const min = n(r?.minThreshold);
      if (min > 0 && metres < min) {
        addAlert(`Roll ${r?.materialId || "Unknown"}: ${metres}m < ${min}m`);
      }
    });

    // Activity
    const activity: ActivityItem[] = [];
    const addActivity = (
      arr: any[],
      type: ActivityItem["type"],
      idField: string,
      prefix: string
    ) => {
      arr.forEach((item) => {
        const d =
          parseDate(item?.updatedAt) ||
          parseDate(item?.dueDate) ||
          parseDate(item?.date) ||
          parseDate(item?.createdAt);
        if (!d) return;
        const id = item[idField] || item?.id || "";
        const status = item?.status || item?.state || "";
        activity.push({
          id: String(id || Math.random()),
          type,
          label: `${prefix} ${id || ""} ${status ? `· ${status}` : ""}`,
          date: d,
        });
      });
    };
    addActivity(quotes, "quote", "quoteNumber", "Quote");
    addActivity(jobs, "job", "jobNumber", "Job");
    addActivity(invoices, "invoice", "invoiceNumber", "Invoice");
    activity.sort((a, b) => b.date.getTime() - a.date.getTime());
    const recentActivityInner = activity.slice(0, 6);

    // Top customers (by job value)
    const customerMap = new Map<string, TopCustomer>();
    jobs.forEach((j) => {
      const total = n(j?.total || j?.grandTotal || j?.amount);
      if (!total) return;
      const name =
        j?.customerName ||
        j?.customer?.name ||
        `${j?.customer?.firstName || ""} ${
          j?.customer?.lastName || ""
        }`.trim() ||
        "Customer";
      const key = name.toLowerCase() || "customer";
      const existing = customerMap.get(key) || { name, jobs: 0, total: 0 };
      existing.jobs += 1;
      existing.total += total;
      customerMap.set(key, existing);
    });
    const topCustomersInner = Array.from(customerMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Upcoming jobs
    const upcomingJobsInner: UpcomingJob[] = jobs
      .map((j) => {
        const d =
          parseDate(j?.dueDate) ||
          parseDate(j?.scheduledFor) ||
          parseDate(j?.date) ||
          parseDate(j?.createdAt);
        if (!d) return null;
        return {
          id: String(j?.id || j?.jobNumber || Math.random()),
          label:
            j?.jobNumber ||
            j?.title ||
            j?.description ||
            "Framing job",
          date: d,
          status: j?.status || j?.state || "",
        };
      })
      .filter((x): x is UpcomingJob => !!x)
      .filter((j) => j.date >= today)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 5);

    // Recent open quotes
    const recentQuotesInner: RecentQuote[] = openQuotesInner
      .map((q) => {
        const d =
          parseDate(q?.updatedAt) ||
          parseDate(q?.createdAt) ||
          parseDate(q?.date);
        const id = q?.quoteNumber || q?.id || "Quote";
        const status = q?.status || q?.state || "Open";
        const total = n(q?.total || q?.grandTotal || q?.amount);
        const customer =
          q?.customerName ||
          q?.customer?.name ||
          `${q?.customer?.firstName || ""} ${
            q?.customer?.lastName || ""
          }`.trim() ||
          "Customer";
        return { id: String(id), label: String(id), customer, status, total, date: d };
      })
      .sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.getTime() - a.date.getTime();
      })
      .slice(0, 5);

    // Simple "marketing" stats
    const completedJobs30 = jobs.filter((j) => {
      const d =
        parseDate(j?.completedAt) ||
        parseDate(j?.updatedAt) ||
        parseDate(j?.date);
      const status: string =
        (j?.status || j?.state || "").toString().toLowerCase();
      return (
        d &&
        d >= days30ago &&
        (status === "completed" ||
          status === "done" ||
          status === "finished")
      );
    }).length;

    const quotesSent30 = quotes.filter((q) => {
      const d =
        parseDate(q?.updatedAt) ||
        parseDate(q?.sentAt) ||
        parseDate(q?.date);
      const status: string =
        (q?.status || q?.state || "").toString().toLowerCase();
      return (
        d &&
        d >= days30ago &&
        (status === "sent" || status === "accepted")
      );
    }).length;

    const customersWithEmail = customers.filter((c) => {
      const email =
        c?.email ||
        c?.emailAddress ||
        c?.primaryEmail ||
        c?.contactEmail;
      return !!(email && String(email).includes("@"));
    }).length;

    const totalCustomers = customers.length;
    const marketingStatsInner = {
      completedJobs30,
      quotesSent30,
      customersWithEmail,
      totalCustomers,
    };

    return {
      todayJobs: todayJobsInner,
      openQuotes: openQuotesInner,
      overdueInvoices: overdueInvoicesInner,
      stockAlerts: alerts,
      monthlySales: monthlySalesInner,
      jobsThisWeek: jobsThisWeekInner,
      conversion: conversionInner,
      activeCustomers: activeCustomersInner,
      quotePipeline: pipeline,
      jobPipeline: jobPipe,
      recentActivity: recentActivityInner,
      topCustomers: topCustomersInner,
      upcomingJobs: upcomingJobsInner,
      recentQuotes: recentQuotesInner,
      marketingStats: marketingStatsInner,
    };
  }, [quotes, invoices, jobs, customers, catalog, today]);

  const visibleOrderedWidgets = order.filter((k) => visible[k]);

  const handleReorder = (targetKey: DashboardWidgetKey) => {
    if (!dragKey || dragKey === targetKey) return;
    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragKey);
      const to = next.indexOf(targetKey);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragKey);
      return next;
    });
  };

  return (
    <main className="min-h-[calc(100vh-56px)] w-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-3 sm:px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-7xl rounded-3xl border border-slate-800 bg-slate-950/60 p-4 sm:p-6 shadow-2xl shadow-black/40">
        {/* TITLE + EDIT */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Last 30 days · {todayIso}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] transition ${
              editing
                ? "border-pink-400 bg-pink-500/20 text-pink-100 shadow-inner shadow-pink-500/40"
                : "border-slate-600 bg-slate-900/40 text-slate-100 hover:bg-slate-800/80"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>{editing ? "Done" : "Edit dashboard"}</span>
          </button>
        </div>

        {/* EDIT PANEL */}
        {editing && (
          <section className="mb-5 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-[11px] text-slate-100">
            <div className="mb-2 font-medium text-slate-100">
              Visible widgets
            </div>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {ALL_WIDGET_KEYS.map((key) => (
                <Toggle
                  key={key}
                  label={labelForWidget(key)}
                  checked={visible[key]}
                  onChange={(v) => setVisible(key, v)}
                />
              ))}
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              Tip: when edit mode is on you can drag any card to reorder the
              layout.
            </p>
          </section>
        )}

        {/* HERO STRIP */}
        <section className="mb-6 rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 px-4 py-4 text-xs shadow-inner shadow-black/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">
                Today overview
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-50">
                {todayJobs.length} jobs · {openQuotes.length} open quotes ·{" "}
                {overdueInvoices.length} overdue invoices
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="#/app"
                className="inline-flex items-center rounded-full bg-pink-500 px-3 py-1.5 text-[11px] font-medium text-white shadow-md shadow-pink-500/40 hover:bg-pink-400"
              >
                Open visualizer
              </a>
              <a
                href="#/quotes"
                className="inline-flex items-center rounded-full border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-[11px] font-medium text-slate-100 hover:bg-slate-800/90"
              >
                New quote
              </a>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span>
              Stock alerts:{" "}
              {stockAlerts.length ? `${stockAlerts.length}` : "0"}
            </span>
            <span className="hidden sm:inline">•</span>
            <span>FrameIT · live data</span>
          </div>
        </section>

        {/* KPI STRIP */}
        <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Sales (month)" value={formatCurrency(monthlySales)} />
          <KpiCard label="Jobs (week)" value={jobsThisWeek} />
          <KpiCard
            label="Quote → job"
            value={conversion ? `${conversion}%` : "–"}
          />
          <KpiCard label="Active customers" value={activeCustomers} />
        </section>

        {/* MAIN GRID: draggable widgets */}
        <section className="grid gap-6 lg:grid-cols-3">
          {visibleOrderedWidgets.map((widgetKey) => (
            <div
              key={widgetKey}
              draggable={editing}
              onDragStart={(e) => {
                if (!editing) return;
                setDragKey(widgetKey);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", widgetKey);
              }}
              onDragOver={(e) => {
                if (!editing) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                if (!editing) return;
                e.preventDefault();
                handleReorder(widgetKey);
                setDragKey(null);
              }}
              onDragEnd={() => setDragKey(null)}
              className={editing ? "cursor-move" : ""}
            >
              {renderWidgetCard({
                widgetKey,
                quotePipeline,
                jobPipeline,
                overdueInvoices,
                stockAlerts,
                recentActivity,
                topCustomers,
                upcomingJobs,
                recentQuotes,
                marketingStats,
              })}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

/* ------------ Widget rendering ------------ */

function labelForWidget(key: DashboardWidgetKey): string {
  switch (key) {
    case "quotesPipeline":
      return "Quotes pipeline";
    case "jobsPipeline":
      return "Jobs pipeline";
    case "overdueInvoices":
      return "Overdue invoices";
    case "stockAlerts":
      return "Stock alerts";
    case "activity":
      return "Recent activity";
    case "topCustomers":
      return "Top customers";
    case "upcomingJobs":
      return "Upcoming jobs";
    case "recentQuotes":
      return "Recent quotes";
    case "marketingInsights":
      return "Marketing insights";
    default:
      return key;
  }
}

function renderWidgetCard(params: {
  widgetKey: DashboardWidgetKey;
  quotePipeline: { draft: number; sent: number; accepted: number; lost: number };
  jobPipeline: {
    booked: number;
    inProgress: number;
    ready: number;
    completed: number;
  };
  overdueInvoices: any[];
  stockAlerts: string[];
  recentActivity: ActivityItem[];
  topCustomers: TopCustomer[];
  upcomingJobs: UpcomingJob[];
  recentQuotes: RecentQuote[];
  marketingStats: {
    completedJobs30: number;
    quotesSent30: number;
    customersWithEmail: number;
    totalCustomers: number;
  };
}) {
  const {
    widgetKey,
    quotePipeline,
    jobPipeline,
    overdueInvoices,
    stockAlerts,
    recentActivity,
    topCustomers,
    upcomingJobs,
    recentQuotes,
    marketingStats,
  } = params;

  switch (widgetKey) {
    case "quotesPipeline":
      return (
        <Card title="Quotes pipeline">
          <Pipeline
            items={[
              {
                label: "Draft",
                value: quotePipeline.draft,
                color: "bg-slate-500",
              },
              {
                label: "Sent",
                value: quotePipeline.sent,
                color: "bg-sky-500",
              },
              {
                label: "Accepted",
                value: quotePipeline.accepted,
                color: "bg-emerald-500",
              },
              {
                label: "Lost",
                value: quotePipeline.lost,
                color: "bg-rose-500",
              },
            ]}
          />
        </Card>
      );

    case "jobsPipeline":
      return (
        <Card title="Jobs pipeline">
          <Pipeline
            items={[
              {
                label: "Booked",
                value: jobPipeline.booked,
                color: "bg-slate-500",
              },
              {
                label: "In progress",
                value: jobPipeline.inProgress,
                color: "bg-amber-500",
              },
              {
                label: "Ready",
                value: jobPipeline.ready,
                color: "bg-sky-500",
              },
              {
                label: "Done",
                value: jobPipeline.completed,
                color: "bg-emerald-500",
              },
            ]}
          />
        </Card>
      );

    case "overdueInvoices":
      return (
        <Card title="Overdue invoices">
          {overdueInvoices.length === 0 ? (
            <EmptyLabel>None 🎉</EmptyLabel>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {overdueInvoices.slice(0, 6).map((inv) => {
                const id = inv?.invoiceNumber || inv?.id || "INV";
                const amount =
                  inv?.total || inv?.grandTotal || inv?.amount || 0;
                const dueDate =
                  inv?.dueDate || inv?.date || inv?.createdAt || "Unknown date";
                return (
                  <li
                    key={String(inv?.id || inv?.invoiceNumber || Math.random())}
                    className="flex items-center justify-between rounded-lg border border-rose-600/60 bg-rose-950/50 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                      <span className="text-[11px] font-medium text-rose-100">
                        {id}
                      </span>
                    </div>
                    <div className="text-right text-[11px] text-rose-100">
                      <div>{formatCurrency(amount)}</div>
                      <div className="opacity-70">
                        Due {formatShortDate(dueDate)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      );

    case "stockAlerts":
      return (
        <Card title="Stock alerts">
          {stockAlerts.length === 0 ? (
            <EmptyLabel>All above minimum</EmptyLabel>
          ) : (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {stockAlerts.slice(0, 8).map((msg, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/60 bg-amber-950/50 px-2 py-0.5 text-amber-100"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {msg}
                </span>
              ))}
            </div>
          )}
        </Card>
      );

    case "activity":
      return (
        <Card title="Recent activity">
          {recentActivity.length === 0 ? (
            <EmptyLabel>Waiting for activity</EmptyLabel>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {recentActivity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pink-400/60 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-pink-400" />
                    </span>
                    <span className="text-[11px] text-slate-200">
                      {item.label}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {item.date.toISOString().slice(5, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );

    case "topCustomers":
      return (
        <Card title="Top customers">
          {topCustomers.length === 0 ? (
            <EmptyLabel>Visible once jobs are booked</EmptyLabel>
          ) : (
            <ValueList
              items={topCustomers.map((c) => ({
                label: c.name,
                value: c.total,
                extra: `${c.jobs} job${c.jobs === 1 ? "" : "s"}`,
              }))}
            />
          )}
        </Card>
      );

    case "upcomingJobs":
      return (
        <Card title="Upcoming jobs">
          {upcomingJobs.length === 0 ? (
            <EmptyLabel>No future jobs</EmptyLabel>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {upcomingJobs.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1.5"
                >
                  <div className="text-[11px] text-slate-200">
                    <div className="font-medium">{j.label}</div>
                    <div className="text-slate-500">
                      {j.status || "Scheduled"}
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-100">
                    {j.date.toISOString().slice(5, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );

    case "recentQuotes":
      return (
        <Card title="Recent quotes">
          {recentQuotes.length === 0 ? (
            <EmptyLabel>None open</EmptyLabel>
          ) : (
            <ValueList
              items={recentQuotes.map((q) => ({
                label: `Quote ${q.label}`,
                value: q.total,
                extra: q.customer,
              }))}
            />
          )}
        </Card>
      );

    case "marketingInsights": {
      const {
        completedJobs30,
        quotesSent30,
        customersWithEmail,
        totalCustomers,
      } = marketingStats;
      const emailPct =
        totalCustomers > 0
          ? Math.round((customersWithEmail / totalCustomers) * 100)
          : 0;

      return (
        <Card title="Marketing insights">
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300">
                Jobs to request reviews
              </span>
              <span className="text-[11px] text-slate-100">
                {completedJobs30}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300">
                Quotes to follow up
              </span>
              <span className="text-[11px] text-slate-100">
                {quotesSent30}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-slate-300">
              Email coverage
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-slate-900">
              <div
                className="h-1.5 rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-pink-400"
                style={{ width: `${emailPct || 0}%` }}
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
              <span>{customersWithEmail} with email</span>
              <span>{totalCustomers} customers total</span>
            </div>
          </div>
        </Card>
      );
    }

    default:
      return null;
  }
}

/* ------------ Small visual subcomponents ------------ */

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 shadow-inner shadow-black/60">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-3 text-sm shadow-inner shadow-black/60">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-slate-400">
          {label}
        </div>
        <div className="mt-1 text-lg font-semibold text-slate-50">
          {value}
        </div>
      </div>
      <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-pink-500/40 via-slate-800 to-sky-500/40" />
    </div>
  );
}

function Pipeline({
  items,
}: {
  items: { label: string; value: number; color: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-1 rounded-full bg-slate-900/80 p-1">
        {items.map((i) => {
          const width = `${(i.value / max) * 100 || 0}%`;
          return (
            <div
              key={i.label}
              className={`flex items-center justify-center rounded-full text-[10px] text-white ${i.color} shadow-sm shadow-black/40`}
              style={{ width: width || "0%" }}
            >
              {i.value > 0 ? i.value : ""}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${i.color}`} />
            <span>{i.label}</span>
            <span className="text-slate-500">({i.value})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-xs text-slate-500">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
      <span>{children}</span>
    </div>
  );
}

function ValueList({
  items,
}: {
  items: { label: string; value: number; extra?: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value || 0));
  return (
    <ul className="space-y-1.5 text-xs">
      {items.map((i) => {
        const width = `${(i.value / max) * 100 || 0}%`;
        return (
          <li key={i.label}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-100">
                {i.label}
              </span>
              <span className="text-[11px] text-slate-400">
                {i.value ? formatCurrency(i.value) : "–"}
              </span>
            </div>
            {i.extra && (
              <div className="text-[10px] text-slate-500">{i.extra}</div>
            )}
            <div className="mt-1 h-1.5 w-full rounded-full bg-slate-900">
              <div
                className="h-1.5 rounded-full bg-gradient-to-r from-pink-500 via-sky-500 to-emerald-500"
                style={{ width: width || "0%" }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* Sliding toggle switch */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950/60 px-2.5 py-1.5">
      <span className="text-[11px] text-slate-200">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition ${
          checked ? "bg-emerald-400/80" : "bg-slate-600"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-slate-950 shadow transition-transform ${
            checked ? "translate-x-3" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

/* ------------ Helpers ------------ */

function formatCurrency(v: number): string {
  if (!v) return "0";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "ZAR",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return v.toFixed(0);
  }
}

function formatShortDate(input: any): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input || "");
  return d.toISOString().slice(0, 10);
}
