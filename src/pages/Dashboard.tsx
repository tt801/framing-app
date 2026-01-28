// src/pages/DashboardV2.tsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import { useQuotes } from "@/lib/quotes";
import { useInvoices } from "@/lib/invoices";
import { useJobs } from "@/lib/jobs";
import { useCustomers } from "@/lib/customers";
import { useCatalog } from "@/lib/store";
import { useToast } from "@/lib/toast";
import StatusBadge from "@/components/StatusBadge";
import Breadcrumb from "@/components/Breadcrumb";

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

type DateRange = "today" | "week" | "month" | "30days" | "quarter" | "year" | "custom";

type RecentItem = {
  id: string;
  type: "customer" | "quote" | "invoice" | "job";
  label: string;
  href: string;
};

type SearchResult = {
  id: string;
  type: "customer" | "quote" | "invoice" | "job";
  label: string;
  sublabel: string;
  href: string;
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
  | "marketingInsights"
  | "revenueTrend"
  | "smartAlerts"
  | "performanceInsights";

type KpiCardKey = "sales" | "jobs" | "conversion" | "activeCustomers";

type DashboardPrefs = Record<DashboardWidgetKey, boolean>;
type KpiPrefs = Record<KpiCardKey, boolean>;

type DashboardConfigState = {
  visible: DashboardPrefs;
  order: DashboardWidgetKey[];
  kpiVisible: KpiPrefs;
  kpiOrder: KpiCardKey[];
  dateRange: DateRange;
  autoRefresh: boolean;
  refreshInterval: number; // in seconds
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
  "revenueTrend",
  "smartAlerts",
  "performanceInsights",
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
  revenueTrend: true,
  smartAlerts: true,
  performanceInsights: true,
};

const ALL_KPI_KEYS: KpiCardKey[] = ["sales", "jobs", "conversion", "activeCustomers"];

const DEFAULT_KPI_VISIBLE: KpiPrefs = {
  sales: true,
  jobs: true,
  conversion: true,
  activeCustomers: true,
};

const DASHBOARD_CONFIG_KEY = "frameit.dashboard.v2.config";
const RECENT_ITEMS_KEY = "frameit.dashboard.v2.recent";

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
  kpiVisible: KpiPrefs;
  setKpiVisible: (key: KpiCardKey, value: boolean) => void;
  kpiOrder: KpiCardKey[];
  setKpiOrder: (
    updater: KpiCardKey[] | ((prev: KpiCardKey[]) => KpiCardKey[])
  ) => void;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  autoRefresh: boolean;
  setAutoRefresh: (val: boolean) => void;
  refreshInterval: number;
  setRefreshInterval: (val: number) => void;
} {
  const [state, setState] = useState<DashboardConfigState>(() => {
    if (typeof window === "undefined") {
      return {
        visible: DEFAULT_VISIBLE,
        order: ALL_WIDGET_KEYS,
        kpiVisible: DEFAULT_KPI_VISIBLE,
        kpiOrder: ALL_KPI_KEYS,
        dateRange: "30days",
        autoRefresh: false,
        refreshInterval: 300,
      };
    }
    try {
      const raw = window.localStorage.getItem(DASHBOARD_CONFIG_KEY);
      if (!raw) {
        return {
          visible: DEFAULT_VISIBLE,
          order: ALL_WIDGET_KEYS,
          kpiVisible: DEFAULT_KPI_VISIBLE,
          kpiOrder: ALL_KPI_KEYS,
          dateRange: "30days",
          autoRefresh: false,
          refreshInterval: 300,
        };
      }
      const parsed = JSON.parse(raw) as Partial<DashboardConfigState>;
      const visible: DashboardPrefs = {
        ...DEFAULT_VISIBLE,
        ...(parsed.visible || {}),
      };
      const storedOrder = parsed.order || [];
      const cleanedOrder: DashboardWidgetKey[] = [
        ...storedOrder.filter((k: any) =>
          (ALL_WIDGET_KEYS as string[]).includes(k)
        ),
        ...ALL_WIDGET_KEYS.filter((k) => !storedOrder.includes(k)),
      ];
      const kpiVisible: KpiPrefs = {
        ...DEFAULT_KPI_VISIBLE,
        ...(parsed.kpiVisible || {}),
      };
      const storedKpiOrder = parsed.kpiOrder || [];
      const cleanedKpiOrder: KpiCardKey[] = [
        ...storedKpiOrder.filter((k: any) =>
          (ALL_KPI_KEYS as string[]).includes(k)
        ),
        ...ALL_KPI_KEYS.filter((k) => !storedKpiOrder.includes(k)),
      ];
      return {
        visible,
        order: cleanedOrder,
        kpiVisible,
        kpiOrder: cleanedKpiOrder,
        dateRange: parsed.dateRange || "30days",
        autoRefresh: parsed.autoRefresh || false,
        refreshInterval: parsed.refreshInterval || 300,
      };
    } catch {
      return {
        visible: DEFAULT_VISIBLE,
        order: ALL_WIDGET_KEYS,
        kpiVisible: DEFAULT_KPI_VISIBLE,
        kpiOrder: ALL_KPI_KEYS,
        dateRange: "30days",
        autoRefresh: false,
        refreshInterval: 300,
      };
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

  const setDateRange = (range: DateRange) => {
    setState((prev) => ({ ...prev, dateRange: range }));
  };

  const setAutoRefresh = (val: boolean) => {
    setState((prev) => ({ ...prev, autoRefresh: val }));
  };

  const setRefreshInterval = (val: number) => {
    setState((prev) => ({ ...prev, refreshInterval: val }));
  };

  const setKpiVisible = (key: KpiCardKey, value: boolean) => {
    setState((prev) => ({
      ...prev,
      kpiVisible: { ...prev.kpiVisible, [key]: value },
    }));
  };

  const setKpiOrder = (
    updater: KpiCardKey[] | ((prev: KpiCardKey[]) => KpiCardKey[])
  ) => {
    setState((prev) => {
      const nextOrder =
        typeof updater === "function" ? updater(prev.kpiOrder) : updater;
      return { ...prev, kpiOrder: nextOrder };
    });
  };

  return {
    visible: state.visible,
    setVisible,
    order: state.order,
    setOrder,
    kpiVisible: state.kpiVisible,
    setKpiVisible,
    kpiOrder: state.kpiOrder,
    setKpiOrder,
    dateRange: state.dateRange,
    setDateRange,
    autoRefresh: state.autoRefresh,
    setAutoRefresh,
    refreshInterval: state.refreshInterval,
    setRefreshInterval,
  };
}

/* ------------ Recent items tracker ------------ */
function useRecentItems() {
  const [items, setItems] = useState<RecentItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(RECENT_ITEMS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const addRecentItem = (item: RecentItem) => {
    setItems((prev) => {
      const filtered = prev.filter((i) => i.id !== item.id);
      const updated = [item, ...filtered].slice(0, 5);
      try {
        localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  return { recentItems: items, addRecentItem };
}

/* ------------ Component ------------ */

export default function DashboardV2Page() {
  const quotesStore: any = useQuotes();
  const invoicesStore: any = useInvoices();
  const jobsStore: any = useJobs();
  const customersStore: any = useCustomers();
  const { catalog } = useCatalog();
  const { add: toast } = useToast();

  const quotes: any[] = quotesStore?.quotes || quotesStore?.items || [];
  const invoices: any[] = invoicesStore?.invoices || invoicesStore?.items || [];
  const jobs: any[] = jobsStore?.jobs || jobsStore?.items || [];
  const customers: any[] =
    customersStore?.customers || customersStore?.items || [];

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const {
    visible,
    setVisible,
    order,
    setOrder,
    kpiVisible,
    setKpiVisible,
    kpiOrder,
    setKpiOrder,
    dateRange,
    setDateRange,
    autoRefresh,
    setAutoRefresh,
    refreshInterval,
    setRefreshInterval,
  } = useDashboardConfig();

  const { recentItems, addRecentItem } = useRecentItems();

  const [editing, setEditing] = useState(false);
  const [dragKey, setDragKey] = useState<DashboardWidgetKey | null>(null);
  const [dragKpiKey, setDragKpiKey] = useState<KpiCardKey | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const settings = catalog.settings || {};

  const money = (n: number) => {
    const code = settings.currencyCode || "ZAR";
    const sym = settings.currencySymbol || "R ";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        maximumFractionDigits: 0,
      }).format(n ?? 0);
    } catch {
      return `${sym}${(n ?? 0).toFixed(0)}`;
    }
  };

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      setLastRefresh(new Date());
      toast("Dashboard refreshed", "info");
    }, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval, toast]);

  // Quick search keyboard shortcut (Cmd+K / Ctrl+K handled by CommandPalette)
  // Let's use Cmd+/ or Ctrl+/ for dashboard search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShowSearch((prev) => !prev);
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Date range calculations
  const { startDate, endDate, prevStartDate, prevEndDate } = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    let start = new Date();

    switch (dateRange) {
      case "today":
        start.setHours(0, 0, 0, 0);
        break;
      case "week": {
        const day = start.getDay();
        const diff = (day + 6) % 7;
        start.setDate(start.getDate() - diff);
        start.setHours(0, 0, 0, 0);
        break;
      }
      case "month":
        start = new Date(end.getFullYear(), end.getMonth(), 1);
        break;
      case "30days":
        start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "quarter": {
        const quarter = Math.floor(end.getMonth() / 3);
        start = new Date(end.getFullYear(), quarter * 3, 1);
        break;
      }
      case "year":
        start = new Date(end.getFullYear(), 0, 1);
        break;
      default:
        start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Previous period for comparison
    const duration = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - duration);

    return {
      startDate: start,
      endDate: end,
      prevStartDate: prevStart,
      prevEndDate: prevEnd,
    };
  }, [dateRange]);

  const {
    todayJobs,
    openQuotes,
    overdueInvoices,
    stockAlerts,
    monthlySales,
    prevMonthlySales,
    jobsThisWeek,
    prevJobsThisWeek,
    conversion,
    prevConversion,
    activeCustomers,
    prevActiveCustomers,
    quotePipeline,
    jobPipeline,
    recentActivity,
    topCustomers,
    upcomingJobs,
    recentQuotes,
    marketingStats,
    revenueTrendData,
    smartAlerts,
    performanceInsights,
    dueNext7Days,
    expiringQuotes,
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

    const isInRange = (d: Date | null, start: Date, end: Date) => {
      if (!d) return false;
      return d >= start && d <= end;
    };

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

    // Sales in current period
    const currentSales = invoices
      .filter((inv) => {
        const d = parseDate(inv?.date || inv?.createdAt);
        return isInRange(d, startDate, endDate);
      })
      .reduce(
        (sum, inv) => sum + n(inv?.total || inv?.grandTotal || inv?.amount),
        0
      );

    // Sales in previous period (for comparison)
    const prevSales = invoices
      .filter((inv) => {
        const d = parseDate(inv?.date || inv?.createdAt);
        return isInRange(d, prevStartDate, prevEndDate);
      })
      .reduce(
        (sum, inv) => sum + n(inv?.total || inv?.grandTotal || inv?.amount),
        0
      );

    // Jobs current period
    const currentJobs = jobs.filter((j) => {
      const d =
        parseDate(j?.dueDate) ||
        parseDate(j?.scheduledFor) ||
        parseDate(j?.date) ||
        parseDate(j?.createdAt);
      return isInRange(d, startDate, endDate);
    }).length;

    // Jobs previous period
    const prevJobs = jobs.filter((j) => {
      const d =
        parseDate(j?.dueDate) ||
        parseDate(j?.scheduledFor) ||
        parseDate(j?.date) ||
        parseDate(j?.createdAt);
      return isInRange(d, prevStartDate, prevEndDate);
    }).length;

    // Conversion current
    const quotesCurrentRange = quotes.filter((q) => {
      const d = parseDate(q?.createdAt || q?.date || q?.updatedAt);
      return isInRange(d, startDate, endDate);
    });
    const jobsCurrentRange = jobs.filter((j) => {
      const d = parseDate(j?.createdAt || j?.date || j?.updatedAt);
      return isInRange(d, startDate, endDate);
    });
    const conversionInner =
      quotesCurrentRange.length > 0
        ? Math.round((jobsCurrentRange.length / quotesCurrentRange.length) * 100)
        : 0;

    // Conversion previous
    const quotesPrevRange = quotes.filter((q) => {
      const d = parseDate(q?.createdAt || q?.date || q?.updatedAt);
      return isInRange(d, prevStartDate, prevEndDate);
    });
    const jobsPrevRange = jobs.filter((j) => {
      const d = parseDate(j?.createdAt || j?.date || j?.updatedAt);
      return isInRange(d, prevStartDate, prevEndDate);
    });
    const prevConversionInner =
      quotesPrevRange.length > 0
        ? Math.round((jobsPrevRange.length / quotesPrevRange.length) * 100)
        : 0;

    // Active customers current
    const activeCustomersInner = customers.filter((c) => {
      const d =
        parseDate(c?.lastJobDate) ||
        parseDate(c?.lastInvoiceDate) ||
        parseDate(c?.updatedAt);
      return isInRange(d, startDate, endDate);
    }).length;

    // Active customers previous
    const prevActiveCustomersInner = customers.filter((c) => {
      const d =
        parseDate(c?.lastJobDate) ||
        parseDate(c?.lastInvoiceDate) ||
        parseDate(c?.updatedAt);
      return isInRange(d, prevStartDate, prevEndDate);
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
        if (!d || !isInRange(d, startDate, endDate)) return;
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
      const d = parseDate(j?.createdAt || j?.date);
      if (!isInRange(d, startDate, endDate)) return;
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
            j?.jobNumber || j?.title || j?.description || "Framing job",
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
        return {
          id: String(id),
          label: String(id),
          customer,
          status,
          total,
          date: d,
        };
      })
      .sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.getTime() - a.date.getTime();
      })
      .slice(0, 5);

    // Marketing stats
    const completedJobs = jobs.filter((j) => {
      const d =
        parseDate(j?.completedAt) ||
        parseDate(j?.updatedAt) ||
        parseDate(j?.date);
      const status: string =
        (j?.status || j?.state || "").toString().toLowerCase();
      return (
        isInRange(d, startDate, endDate) &&
        (status === "completed" || status === "done" || status === "finished")
      );
    }).length;

    const quotesSent = quotes.filter((q) => {
      const d =
        parseDate(q?.updatedAt) || parseDate(q?.sentAt) || parseDate(q?.date);
      const status: string =
        (q?.status || q?.state || "").toString().toLowerCase();
      return (
        isInRange(d, startDate, endDate) &&
        (status === "sent" || status === "accepted")
      );
    }).length;

    const customersWithEmail = customers.filter((c) => {
      const email =
        c?.email || c?.emailAddress || c?.primaryEmail || c?.contactEmail;
      return !!(email && String(email).includes("@"));
    }).length;

    const totalCustomers = customers.length;
    const marketingStatsInner = {
      completedJobs,
      quotesSent,
      customersWithEmail,
      totalCustomers,
    };

    // Revenue trend (last 6 months)
    const revenueTrend: { month: string; revenue: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const revenue = invoices
        .filter((inv) => {
          const invDate = parseDate(inv?.date || inv?.createdAt);
          return invDate && invDate >= monthStart && invDate <= monthEnd;
        })
        .reduce(
          (sum, inv) => sum + n(inv?.total || inv?.grandTotal || inv?.amount),
          0
        );
      revenueTrend.push({
        month: monthStart.toLocaleDateString(undefined, { month: "short" }),
        revenue,
      });
    }

    // Smart alerts
    const alerts7Days = invoices.filter((inv) => {
      const status: string =
        inv?.status || inv?.state || (inv?.isPaid ? "Paid" : "Open");
      const isPaid =
        status.toLowerCase() === "paid" ||
        status.toLowerCase() === "settled" ||
        inv?.isPaid ||
        !!inv?.paidAt;
      if (isPaid) return false;
      const d = parseDate(inv?.dueDate || inv?.date || inv?.createdAt);
      if (!d) return false;
      const in7days = new Date();
      in7days.setDate(in7days.getDate() + 7);
      return d >= today && d <= in7days;
    });

    const expiringQuotesInner = quotes.filter((q) => {
      const expiryDate = parseDate(q?.expiryDate || q?.validUntil);
      if (!expiryDate) return false;
      const in7days = new Date();
      in7days.setDate(in7days.getDate() + 7);
      const status = (q?.status || "").toString().toLowerCase();
      return (
        expiryDate >= today &&
        expiryDate <= in7days &&
        status !== "accepted" &&
        status !== "declined"
      );
    });

    const lowStockCount = alerts.length;

    const smartAlertsInner = {
      overdueCount: overdueInvoicesInner.length,
      dueNext7Days: alerts7Days.length,
      expiringQuotes: expiringQuotesInner.length,
      lowStock: lowStockCount,
    };

    // Performance insights
    const jobsByDay = new Map<string, number>();
    jobs.forEach((j) => {
      const d = parseDate(j?.createdAt || j?.date);
      if (!isInRange(d, startDate, endDate) || !d) return;
      const dayName = d.toLocaleDateString(undefined, { weekday: "long" });
      jobsByDay.set(dayName, (jobsByDay.get(dayName) || 0) + 1);
    });

    let busiestDay = "";
    let maxJobs = 0;
    jobsByDay.forEach((count, day) => {
      if (count > maxJobs) {
        maxJobs = count;
        busiestDay = day;
      }
    });

    const avgJobValue = currentJobs > 0
      ? jobs
          .filter((j) => {
            const d = parseDate(j?.createdAt || j?.date);
            return isInRange(d, startDate, endDate);
          })
          .reduce((sum, j) => sum + n(j?.total || j?.grandTotal || j?.amount), 0) /
        currentJobs
      : 0;

    const quoteAcceptanceRate =
      pipeline.sent + pipeline.accepted > 0
        ? Math.round(
            (pipeline.accepted / (pipeline.sent + pipeline.accepted)) * 100
          )
        : 0;

    const performanceInsightsInner = {
      busiestDay: busiestDay || "N/A",
      avgJobValue,
      quoteAcceptanceRate,
    };

    return {
      todayJobs: todayJobsInner,
      openQuotes: openQuotesInner,
      overdueInvoices: overdueInvoicesInner,
      stockAlerts: alerts,
      monthlySales: currentSales,
      prevMonthlySales: prevSales,
      jobsThisWeek: currentJobs,
      prevJobsThisWeek: prevJobs,
      conversion: conversionInner,
      prevConversion: prevConversionInner,
      activeCustomers: activeCustomersInner,
      prevActiveCustomers: prevActiveCustomersInner,
      quotePipeline: pipeline,
      jobPipeline: jobPipe,
      recentActivity: recentActivityInner,
      topCustomers: topCustomersInner,
      upcomingJobs: upcomingJobsInner,
      recentQuotes: recentQuotesInner,
      marketingStats: marketingStatsInner,
      revenueTrendData: revenueTrend,
      smartAlerts: smartAlertsInner,
      performanceInsights: performanceInsightsInner,
      dueNext7Days: alerts7Days,
      expiringQuotes: expiringQuotesInner,
    };
  }, [quotes, invoices, jobs, customers, catalog, today, startDate, endDate, prevStartDate, prevEndDate]);

  // Search functionality
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    customers.forEach((c) => {
      const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
      const searchable = [name, c.email, c.company].join(" ").toLowerCase();
      if (searchable.includes(query)) {
        results.push({
          id: c.id,
          type: "customer",
          label: name || c.company || "Unnamed",
          sublabel: c.email || "",
          href: `#/customers?id=${c.id}`,
        });
      }
    });

    quotes.forEach((q) => {
      const searchable = [
        q.quoteNumber,
        q.id,
        q.customerName,
        q.notes,
      ].join(" ").toLowerCase();
      if (searchable.includes(query)) {
        results.push({
          id: q.id,
          type: "quote",
          label: `Quote #${q.quoteNumber || q.id}`,
          sublabel: q.customerName || "",
          href: `#/quotes?id=${q.id}`,
        });
      }
    });

    invoices.forEach((inv) => {
      const searchable = [
        inv.invoiceNumber || inv.number,
        inv.id,
        inv.customerName,
      ].join(" ").toLowerCase();
      if (searchable.includes(query)) {
        results.push({
          id: inv.id,
          type: "invoice",
          label: `Invoice #${inv.invoiceNumber || inv.number || inv.id}`,
          sublabel: inv.customerName || "",
          href: `#/invoices?id=${inv.id}`,
        });
      }
    });

    jobs.forEach((j) => {
      const searchable = [
        j.jobNumber,
        j.id,
        j.customerName,
        j.title,
        j.description,
      ].join(" ").toLowerCase();
      if (searchable.includes(query)) {
        results.push({
          id: j.id,
          type: "job",
          label: `Job #${j.jobNumber || j.id}`,
          sublabel: j.customerName || j.title || "",
          href: `#/jobs?id=${j.id}`,
        });
      }
    });

    return results.slice(0, 10);
  }, [searchQuery, customers, quotes, invoices, jobs]);

  const visibleOrderedWidgets = order.filter((k) => visible[k]);
  const visibleOrderedKpis = kpiOrder.filter((k) => kpiVisible[k]);

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

  const handleKpiReorder = (targetKey: KpiCardKey) => {
    if (!dragKpiKey || dragKpiKey === targetKey) return;
    setKpiOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragKpiKey);
      const to = next.indexOf(targetKey);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragKpiKey);
      return next;
    });
  };

  const handleExportDashboard = () => {
    const data = {
      generated: new Date().toISOString(),
      dateRange,
      metrics: {
        sales: monthlySales,
        jobs: jobsThisWeek,
        conversion,
        activeCustomers,
      },
      overdueInvoices: overdueInvoices.map((inv) => ({
        number: inv.invoiceNumber || inv.id,
        customer: inv.customerName,
        amount: inv.total,
        dueDate: inv.dueDate,
      })),
      topCustomers,
      stockAlerts,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-export-${todayIso}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Dashboard exported successfully", "success");
  };

  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const dateRangeLabel = () => {
    switch (dateRange) {
      case "today":
        return "Today";
      case "week":
        return "This week";
      case "month":
        return "This month";
      case "30days":
        return "Last 30 days";
      case "quarter":
        return "This quarter";
      case "year":
        return "This year";
      default:
        return "Last 30 days";
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">📊 Dashboard</h1>
          <p className="text-sm text-slate-600 flex items-center gap-2">
            {dateRangeLabel()} · Last updated: {lastRefresh.toLocaleTimeString()}
            {autoRefresh && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Auto-refresh
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSearch((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            title="Quick search (Cmd+/)"
          >
            🔍 Search
          </button>
          <button
            type="button"
            onClick={handleExportDashboard}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            📊 Export
          </button>
          <button
            type="button"
            onClick={() => {
              setLastRefresh(new Date());
              toast("Dashboard refreshed", "success");
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            🔄 Refresh
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
              editing
                ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>{editing ? "Done editing" : "Edit"}</span>
          </button>
        </div>
      </div>

      {/* QUICK SEARCH */}
      {showSearch && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customers, quotes, invoices, jobs..."
              className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-2 px-2 text-xs text-slate-500 hover:text-slate-700"
              >
                ✕
              </button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="mt-3 space-y-1 max-h-64 overflow-auto">
              {searchResults.map((result) => (
                <a
                  key={result.id}
                  href={result.href}
                  className="block rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 transition"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={
                        result.type === "customer"
                          ? "active"
                          : result.type === "quote"
                          ? "draft"
                          : result.type === "invoice"
                          ? "in-progress"
                          : "completed"
                      }
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {result.label}
                      </div>
                      {result.sublabel && (
                        <div className="text-xs text-slate-500 truncate">
                          {result.sublabel}
                        </div>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {/* EDIT PANEL */}
      {editing && (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
          <div>
            <div className="mb-3 text-sm font-medium text-slate-900">
              Visible KPI cards
            </div>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
              {ALL_KPI_KEYS.map((key) => (
                <Toggle
                  key={key}
                  label={labelForKpiCard(key)}
                  checked={kpiVisible[key]}
                  onChange={(v) => setKpiVisible(key, v)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-medium text-slate-900">
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
          </div>

          <div>
            <div className="mb-3 text-sm font-medium text-slate-900">
              Auto-refresh settings
            </div>
            <div className="flex items-center gap-4">
              <Toggle
                label="Auto-refresh"
                checked={autoRefresh}
                onChange={setAutoRefresh}
              />
              {autoRefresh && (
                <select
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
                >
                  <option value={60}>Every 1 minute</option>
                  <option value={300}>Every 5 minutes</option>
                  <option value={600}>Every 10 minutes</option>
                  <option value={1800}>Every 30 minutes</option>
                </select>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-blue-50 border border-blue-200 p-3">
            <div className="flex items-start gap-2">
              <span className="text-lg">💡</span>
              <div className="text-xs text-blue-900">
                <div className="font-medium mb-1">Drag & Drop Instructions:</div>
                <ul className="space-y-0.5 ml-2">
                  <li>• Click and hold any KPI card or widget card</li>
                  <li>• Drag to reorder your dashboard layout</li>
                  <li>• Toggle visibility using checkboxes above</li>
                  <li>• Changes are saved automatically</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* DATE RANGE SELECTOR */}
      <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Date range:</span>
          {(["today", "week", "month", "30days", "quarter", "year"] as DateRange[]).map(
            (range) => {
              const labels = {
                today: "Today",
                week: "This week",
                month: "This month",
                "30days": "30 days",
                quarter: "Quarter",
                year: "Year",
              };
              const active = dateRange === range;
              return (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
                    active
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {labels[range]}
                </button>
              );
            }
          )}
        </div>
      </section>

      {/* QUICK ACTIONS */}
      <section className="rounded-2xl ring-1 ring-slate-200 bg-gradient-to-r from-slate-50 to-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
          {recentItems.length > 0 && (
            <button
              onClick={() => setShowQuickActions((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              {showQuickActions ? "Hide recent" : "Show recent"}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="#/customers"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("frameapp:new", { detail: { type: "customer" } })
              )
            }
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            👤 New customer
          </a>
          <a
            href="#/invoices"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            💰 Record payment
          </a>
          <a
            href="#/jobs"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("frameapp:new", { detail: { type: "job" } })
              )
            }
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            🔨 New job
          </a>
        </div>

        {showQuickActions && recentItems.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <div className="text-xs text-slate-500 mb-2">Recently viewed</div>
            <div className="flex flex-wrap gap-2">
              {recentItems.map((item) => (
                <a
                  key={item.id}
                  href={item.href}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition"
                >
                  {item.type === "customer" && "👤"}
                  {item.type === "quote" && "📄"}
                  {item.type === "invoice" && "💰"}
                  {item.type === "job" && "🔨"}
                  <span>{item.label}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* KPI STRIP WITH COMPARISONS */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {visibleOrderedKpis.map((kpiKey) => {
          const kpiData = {
            sales: {
              label: "Sales",
              value: money(monthlySales),
              change: calculateChange(monthlySales, prevMonthlySales),
              onClick: () => (window.location.hash = "#/invoices"),
            },
            jobs: {
              label: "Jobs",
              value: jobsThisWeek,
              change: calculateChange(jobsThisWeek, prevJobsThisWeek),
              onClick: () => (window.location.hash = "#/jobs"),
            },
            conversion: {
              label: "Quote → job",
              value: conversion ? `${conversion}%` : "–",
              change: conversion - prevConversion,
              onClick: () => (window.location.hash = "#/quotes"),
            },
            activeCustomers: {
              label: "Active customers",
              value: activeCustomers,
              change: calculateChange(activeCustomers, prevActiveCustomers),
              onClick: () => (window.location.hash = "#/customers"),
            },
          };

          const data = kpiData[kpiKey];
          
          return (
            <div
              key={kpiKey}
              draggable={editing}
              onDragStart={(e) => {
                if (!editing) return;
                setDragKpiKey(kpiKey);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", kpiKey);
              }}
              onDragOver={(e) => {
                if (!editing) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                if (!editing) return;
                e.preventDefault();
                handleKpiReorder(kpiKey);
                setDragKpiKey(null);
              }}
              onDragEnd={() => setDragKpiKey(null)}
              className={editing ? "cursor-move" : ""}
            >
              <KpiCardWithChange
                label={data.label}
                value={data.value}
                change={data.change}
                onClick={data.onClick}
              />
            </div>
          );
        })}
      </section>

      {/* MAIN GRID: draggable widgets */}
      <section className="grid gap-4 lg:grid-cols-3">
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
              money,
              revenueTrendData,
              smartAlerts,
              performanceInsights,
              dueNext7Days,
              expiringQuotes,
            })}
          </div>
        ))}
      </section>
    </div>
  );
}

/* ------------ Widget rendering ------------ */

function labelForKpiCard(key: KpiCardKey): string {
  switch (key) {
    case "sales":
      return "Sales";
    case "jobs":
      return "Jobs";
    case "conversion":
      return "Quote → job";
    case "activeCustomers":
      return "Active customers";
    default:
      return key;
  }
}

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
    case "revenueTrend":
      return "Revenue trend";
    case "smartAlerts":
      return "Smart alerts";
    case "performanceInsights":
      return "Performance insights";
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
    completedJobs: number;
    quotesSent: number;
    customersWithEmail: number;
    totalCustomers: number;
  };
  money: (n: number) => string;
  revenueTrendData: { month: string; revenue: number }[];
  smartAlerts: {
    overdueCount: number;
    dueNext7Days: number;
    expiringQuotes: number;
    lowStock: number;
  };
  performanceInsights: {
    busiestDay: string;
    avgJobValue: number;
    quoteAcceptanceRate: number;
  };
  dueNext7Days: any[];
  expiringQuotes: any[];
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
    money,
    revenueTrendData,
    smartAlerts,
    performanceInsights,
  } = params;

  switch (widgetKey) {
    case "quotesPipeline":
      return (
        <ClickableCard
          title="Quotes pipeline"
          onClick={() => (window.location.hash = "#/quotes")}
        >
          <Pipeline
            items={[
              {
                label: "Draft",
                value: quotePipeline.draft,
                color: "bg-slate-400",
              },
              {
                label: "Sent",
                value: quotePipeline.sent,
                color: "bg-blue-500",
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
        </ClickableCard>
      );

    case "jobsPipeline":
      return (
        <ClickableCard
          title="Jobs pipeline"
          onClick={() => (window.location.hash = "#/jobs")}
        >
          <Pipeline
            items={[
              {
                label: "Booked",
                value: jobPipeline.booked,
                color: "bg-slate-400",
              },
              {
                label: "In progress",
                value: jobPipeline.inProgress,
                color: "bg-amber-500",
              },
              {
                label: "Ready",
                value: jobPipeline.ready,
                color: "bg-blue-500",
              },
              {
                label: "Done",
                value: jobPipeline.completed,
                color: "bg-emerald-500",
              },
            ]}
          />
        </ClickableCard>
      );

    case "overdueInvoices":
      return (
        <ClickableCard
          title="Overdue invoices"
          onClick={() => (window.location.hash = "#/invoices?filter=overdue")}
        >
          {overdueInvoices.length === 0 ? (
            <EmptyLabel>None 🎉</EmptyLabel>
          ) : (
            <ul className="space-y-2 text-sm">
              {overdueInvoices.slice(0, 6).map((inv) => {
                const id = inv?.invoiceNumber || inv?.id || "INV";
                const amount =
                  inv?.total || inv?.grandTotal || inv?.amount || 0;
                const dueDate =
                  inv?.dueDate || inv?.date || inv?.createdAt || "Unknown date";
                return (
                  <li
                    key={String(inv?.id || inv?.invoiceNumber || Math.random())}
                    className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                      <span className="text-xs font-medium text-rose-900">
                        {id}
                      </span>
                    </div>
                    <div className="text-right text-xs text-rose-900">
                      <div className="font-medium">{money(amount)}</div>
                      <div className="text-rose-700">
                        Due {formatShortDate(dueDate)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ClickableCard>
      );

    case "stockAlerts":
      return (
        <ClickableCard
          title="Stock alerts"
          onClick={() => (window.location.hash = "#/stock")}
        >
          {stockAlerts.length === 0 ? (
            <EmptyLabel>All above minimum</EmptyLabel>
          ) : (
            <div className="flex flex-wrap gap-2 text-xs">
              {stockAlerts.slice(0, 8).map((msg, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {msg}
                </span>
              ))}
            </div>
          )}
        </ClickableCard>
      );

    case "activity":
      return (
        <Card title="Recent activity">
          {recentActivity.length === 0 ? (
            <EmptyLabel>Waiting for activity</EmptyLabel>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentActivity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={
                        item.type === "quote"
                          ? "draft"
                          : item.type === "job"
                          ? "in-progress"
                          : "completed"
                      }
                      showDot
                    />
                    <span className="text-xs text-slate-700">{item.label}</span>
                  </div>
                  <span className="text-xs text-slate-500">
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
        <ClickableCard
          title="Top customers"
          onClick={() => (window.location.hash = "#/customers?sort=spend")}
        >
          {topCustomers.length === 0 ? (
            <EmptyLabel>Visible once jobs are booked</EmptyLabel>
          ) : (
            <ValueList
              items={topCustomers.map((c) => ({
                label: c.name,
                value: c.total,
                extra: `${c.jobs} job${c.jobs === 1 ? "" : "s"}`,
              }))}
              money={money}
            />
          )}
        </ClickableCard>
      );

    case "upcomingJobs":
      return (
        <ClickableCard
          title="Upcoming jobs"
          onClick={() => (window.location.hash = "#/jobs")}
        >
          {upcomingJobs.length === 0 ? (
            <EmptyLabel>No future jobs</EmptyLabel>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcomingJobs.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="text-xs text-slate-700">
                    <div className="font-medium">{j.label}</div>
                    <div className="text-slate-500">
                      {j.status || "Scheduled"}
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700">
                    {j.date.toISOString().slice(5, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ClickableCard>
      );

    case "recentQuotes":
      return (
        <ClickableCard
          title="Recent quotes"
          onClick={() => (window.location.hash = "#/quotes")}
        >
          {recentQuotes.length === 0 ? (
            <EmptyLabel>None open</EmptyLabel>
          ) : (
            <ValueList
              items={recentQuotes.map((q) => ({
                label: `Quote ${q.label}`,
                value: q.total,
                extra: q.customer,
              }))}
              money={money}
            />
          )}
        </ClickableCard>
      );

    case "marketingInsights": {
      const {
        completedJobs,
        quotesSent,
        customersWithEmail,
        totalCustomers,
      } = marketingStats;
      const emailPct =
        totalCustomers > 0
          ? Math.round((customersWithEmail / totalCustomers) * 100)
          : 0;

      return (
        <ClickableCard
          title="Marketing insights"
          onClick={() => (window.location.hash = "#/marketing")}
        >
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600">
                Jobs to request reviews
              </span>
              <span className="text-xs font-medium text-slate-900">
                {completedJobs}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600">
                Quotes to follow up
              </span>
              <span className="text-xs font-medium text-slate-900">
                {quotesSent}
              </span>
            </div>
            <div className="mt-3 text-xs text-slate-600">Email coverage</div>
            <div className="mt-1 h-2 w-full rounded-full bg-slate-100 ring-1 ring-slate-200">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-emerald-400 via-blue-400 to-slate-900"
                style={{ width: `${emailPct || 0}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>{customersWithEmail} with email</span>
              <span>{totalCustomers} customers total</span>
            </div>
          </div>
        </ClickableCard>
      );
    }

    case "revenueTrend":
      return (
        <Card title="Revenue trend (6 months)">
          <div className="space-y-2">
            {revenueTrendData.map((item, idx) => {
              const maxRevenue = Math.max(
                ...revenueTrendData.map((i) => i.revenue),
                1
              );
              const width = `${(item.revenue / maxRevenue) * 100}%`;
              return (
                <div key={idx}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-600">{item.month}</span>
                    <span className="font-medium text-slate-900 tabular-nums">
                      {money(item.revenue)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 ring-1 ring-slate-200">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-slate-900 transition-all"
                      style={{ width }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      );

    case "smartAlerts":
      return (
        <Card title="Smart alerts">
          <div className="space-y-2 text-sm">
            {smartAlerts.overdueCount > 0 && (
              <button
                onClick={() => (window.location.hash = "#/invoices?filter=overdue")}
                className="w-full text-left flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 hover:bg-rose-100 transition"
              >
                <span className="text-xs text-rose-900">
                  🚨 {smartAlerts.overdueCount} overdue invoice
                  {smartAlerts.overdueCount === 1 ? "" : "s"}
                </span>
              </button>
            )}
            {smartAlerts.dueNext7Days > 0 && (
              <button
                onClick={() => (window.location.hash = "#/invoices?filter=due")}
                className="w-full text-left flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 hover:bg-amber-100 transition"
              >
                <span className="text-xs text-amber-900">
                  ⏰ {smartAlerts.dueNext7Days} invoice{smartAlerts.dueNext7Days === 1 ? "" : "s"} due in 7 days
                </span>
              </button>
            )}
            {smartAlerts.expiringQuotes > 0 && (
              <button
                onClick={() => (window.location.hash = "#/quotes?filter=expiring")}
                className="w-full text-left flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 hover:bg-blue-100 transition"
              >
                <span className="text-xs text-blue-900">
                  📋 {smartAlerts.expiringQuotes} quote{smartAlerts.expiringQuotes === 1 ? "" : "s"} expiring soon
                </span>
              </button>
            )}
            {smartAlerts.lowStock > 0 && (
              <button
                onClick={() => (window.location.hash = "#/stock")}
                className="w-full text-left flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 hover:bg-orange-100 transition"
              >
                <span className="text-xs text-orange-900">
                  📦 {smartAlerts.lowStock} stock alert{smartAlerts.lowStock === 1 ? "" : "s"}
                </span>
              </button>
            )}
            {smartAlerts.overdueCount === 0 &&
              smartAlerts.dueNext7Days === 0 &&
              smartAlerts.expiringQuotes === 0 &&
              smartAlerts.lowStock === 0 && (
                <EmptyLabel>All clear! 🎉</EmptyLabel>
              )}
          </div>
        </Card>
      );

    case "performanceInsights":
      return (
        <Card title="Performance insights">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600">Busiest day</span>
              <span className="text-xs font-medium text-slate-900">
                {performanceInsights.busiestDay}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600">Avg job value</span>
              <span className="text-xs font-medium text-slate-900">
                {money(performanceInsights.avgJobValue)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600">
                Quote acceptance rate
              </span>
              <span className="text-xs font-medium text-slate-900">
                {performanceInsights.quoteAcceptanceRate}%
              </span>
            </div>
          </div>
        </Card>
      );

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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ClickableCard({
  title,
  children,
  onClick,
}: {
  title: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <section
      onClick={onClick}
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${
        onClick ? "cursor-pointer hover:ring-2 hover:ring-slate-300 transition" : ""
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {onClick && (
          <span className="text-xs text-slate-400">→</span>
        )}
      </div>
      {children}
    </section>
  );
}

function KpiCardWithChange({
  label,
  value,
  change,
  onClick,
}: {
  label: string;
  value: string | number;
  change: number;
  onClick?: () => void;
}) {
  const isPositive = change > 0;
  const isNeutral = change === 0;
  const arrow = isPositive ? "↗" : change < 0 ? "↘" : "→";
  const changeColor = isPositive
    ? "text-emerald-600"
    : isNeutral
    ? "text-slate-500"
    : "text-rose-600";

  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between rounded-2xl ring-1 ring-slate-200 bg-white px-4 py-4 shadow-sm ${
        onClick ? "cursor-pointer hover:ring-2 hover:ring-slate-300 transition" : ""
      }`}
    >
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">
          {label}
        </div>
        <div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
          {value}
        </div>
        <div className={`mt-0.5 text-xs font-medium ${changeColor} flex items-center gap-1`}>
          <span>{arrow}</span>
          <span>
            {change > 0 ? "+" : ""}
            {change}%
          </span>
          <span className="text-slate-400">vs prev</span>
        </div>
      </div>
      <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-slate-200 via-slate-100 to-slate-50 ring-1 ring-slate-200" />
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
    <div className="space-y-3 text-sm">
      <div className="flex gap-1 rounded-full bg-slate-100 p-1 ring-1 ring-slate-200">
        {items.map((i) => {
          const width = `${(i.value / max) * 100 || 0}%`;
          return (
            <div
              key={i.label}
              className={`flex items-center justify-center rounded-full text-xs font-medium text-white ${i.color} shadow-sm`}
              style={{
                width: width || "0%",
                minWidth: i.value > 0 ? "2rem" : "0",
              }}
            >
              {i.value > 0 ? i.value : ""}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-1.5">
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
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <span className="h-2 w-2 rounded-full bg-slate-300" />
      <span>{children}</span>
    </div>
  );
}

function ValueList({
  items,
  money,
}: {
  items: { label: string; value: number; extra?: string }[];
  money: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value || 0));
  return (
    <ul className="space-y-2.5 text-sm">
      {items.map((i) => {
        const width = `${(i.value / max) * 100 || 0}%`;
        return (
          <li key={i.label}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-900">
                {i.label}
              </span>
              <span className="text-xs text-slate-600">
                {i.value ? money(i.value) : "–"}
              </span>
            </div>
            {i.extra && (
              <div className="text-[10px] text-slate-500 mt-0.5">{i.extra}</div>
            )}
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 ring-1 ring-slate-200">
              <div
                className="h-1.5 rounded-full bg-gradient-to-r from-slate-900 via-slate-700 to-slate-500"
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
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
      <span className="text-xs text-slate-700">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
          checked ? "bg-slate-900" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

/* ------------ Helpers ------------ */

function formatShortDate(input: any): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input || "");
  return d.toISOString().slice(0, 10);
}
