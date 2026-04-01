/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
// src/pages/Jobs.tsx
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useJobs } from "@/lib/jobs";
import { useCustomers } from "@/lib/customers";
import { useCatalog } from "@/lib/store";
import { exportJobCardPDF } from "@/lib/pdf/jobCardPdf";
import { useToast } from "@/lib/toast";
import { useHistory } from "@/lib/history";
import { useFavorites } from "@/lib/favorites";
import StatusBadge from "@/components/StatusBadge";

type Job = any;

type ConfirmModal = {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

type JobStatus = "new" | "in-progress" | "ready" | "completed";

const fmt = (
  n: number | undefined,
  currencyCode?: string,
  currencySymbol?: string
) => {
  const v = Number(n ?? 0);
  if (currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
      }).format(v);
    } catch {
      /* fall back to symbol below */
    }
  }
  return `${currencySymbol ?? ""}${v.toFixed(2)}`;
};

const rid = () => Math.random().toString(36).slice(2, 9);

// --- phone utils for WhatsApp deep-link ---
function cleanPhone(raw?: string): string {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits.slice(1) : digits;
}

// --- CSV export helper ---
function jobsToCSV(jobs: any[]): string {
  const headers = [
    "Job ID",
    "Customer Name",
    "Status",
    "Created Date",
    "Due Date",
    "Frame",
    "Glazing",
    "Subtotal",
    "Total",
    "Currency",
    "Checklist Progress",
    "Notes",
  ];

  const rows = jobs.map((j) => [
    j.id || "",
    j.customerName || "",
    j.status || "new",
    j.createdAt ? new Date(j.createdAt).toLocaleDateString() : "",
    j.__raw?.dueDate ? new Date(j.__raw.dueDate).toLocaleDateString() : "",
    j.frameName || "",
    j.glazingName || "",
    j.costs?.subtotal ?? "",
    j.costs?.total ?? "",
    j.costs?.currency?.code || "",
    Array.isArray(j.checklist)
      ? `${j.checklist.filter((i: any) => i.done).length}/${j.checklist.length}`
      : "0/0",
    j.__raw?.notes || "",
  ]);

  const allRows = [headers, ...rows];
  return allRows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function downloadCSV(filename: string, csv: string) {
  const link = document.createElement("a");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// --- Timeline/History type ---
type JobTimelineEvent = {
  id: string;
  jobId: string;
  timestamp: string;
  type: "status_change" | "due_date_set" | "note_added" | "template_applied" | "message_sent";
  oldValue?: string;
  newValue?: string;
  message?: string;
};

// --- Job Template type ---
type JobTemplate = {
  id: string;
  name: string;
  frameName: string;
  glazingName: string;
  notes?: string;
  createdAt: string;
  description?: string;
};

// ---------- normalization helpers ----------
function parseDetails(job: Job) {
  // details (object) or detailsJson (string)
  let d = job?.details;
  if (!d && typeof job?.detailsJson === "string") {
    try {
      d = JSON.parse(job.detailsJson);
    } catch { /* ignore parse errors */ }
  }
  return d || null;
}

function normalizeJob(job: Job, catalogSettings?: any) {
  const d = parseDetails(job);

  // currency fallbacks
  const currencyCode =
    job?.currency?.code ??
    d?.settings?.currencyCode ??
    catalogSettings?.currencyCode ??
    "ZAR";
  const currencySymbol =
    job?.currency?.symbol ??
    d?.settings?.currencySymbol ??
    catalogSettings?.currencySymbol ??
    "R ";

  // customer snapshot or lookup info stored on the job
  const customer =
    job?.customerSnapshot ||
    job?.customer || // some shapes store it here
    null;

  // names
  const frameName =
    job?.frameName || d?.frame?.name || job?.frame?.name || "Frame";

  const glazingName =
    job?.glazingName || d?.glazing?.name || job?.glazing?.name || "Glazing";

  // artwork URL (many shapes)
  const artworkUrl =
    job?.artworkUrl ||
    d?.artworkUrl ||
    d?.art?.imageUrl ||
    job?.artwork?.imageUrl ||
    "";

  // dimensions (prefer nested; fall back to legacy)
  const unit = d?.dims?.unit || job?.unit || "metric";

  const dims = {
    unit,
    artWcm: d?.dims?.art?.widthCm ?? job?.artWcm ?? 0,
    artHcm: d?.dims?.art?.heightCm ?? job?.artHcm ?? 0,
    visWcm: d?.dims?.visible?.widthCm ?? job?.visibleWcm ?? 0,
    visHcm: d?.dims?.visible?.heightCm ?? job?.visibleHcm ?? 0,
    faceWcm: d?.dims?.frameFaceWidthCm ?? job?.faceWidthCm ?? 0,
  };

  // costs (prefer nested; fall back to legacy)
  const costs = {
    subtotal: d?.costs?.subtotal ?? job?.subtotal ?? 0,
    total: d?.costs?.total ?? job?.total ?? 0,
    taxRate: d?.costs?.taxRate ?? job?.taxRate ?? 0,
    currency: { code: currencyCode, symbol: currencySymbol },
    lineItems: (d?.costs?.lineItems as any[]) ?? job?.lineItems ?? [],
  };

  // checklist: keep whatever is there
  const checklist = Array.isArray(job?.checklist) ? job.checklist : [];

  // simple “mats summary” for header cards
  const hasMat1 = !!(d?.mats?.hasMat1 ?? (job?.hasMat1 ?? false));
  const hasMat2 = !!(d?.mats?.hasMat2 ?? (job?.hasMat2 ?? false));
  const matsSummary =
    hasMat1 || hasMat2
      ? `${hasMat1 ? "Mat1" : ""}${
          hasMat1 && hasMat2 ? " + " : ""
        }${hasMat2 ? "Mat2" : ""}`
      : "No mats";

  // customer display name
  const customerName =
    [customer?.firstName, customer?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    customer?.company ||
    "Anonymous";

  return {
    id: job?.id,
    status: job?.status ?? "new",
    createdAt: job?.createdAt,
    title: job?.description || `Framing job — ${frameName}`,
    customer,
    customerName,
    frameName,
    glazingName,
    matsSummary,
    dims,
    costs,
    artworkUrl,
    checklist,
    // expose raw for debug box
    __raw: job,
  };
}

export default function JobsPage() {
  const jobsStore = useJobs() as any;
  const { customers } = useCustomers();
  const { catalog } = useCatalog();
  const { add: toast } = useToast();
  const { add: addToHistory } = useHistory();
  const { isFavorited, toggle: toggleFavorite } = useFavorites();

  // Try common shapes; fall back to array itself
  const jobs: Job[] = (jobsStore?.list?.() ??
    jobsStore?.jobs ??
    jobsStore ??
    []) as Job[];

  const FILTER_KEY = "jobs.filters.v1";

  // Default selection (first job)
  const [selectedId, setSelectedId] = useState<string | null>(
    jobs?.[0]?.id ?? null
  );

  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "in-progress" | "ready" | "completed" | "favorites" | "due-soon" | "overdue">("all");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "customer" | "value" | "due-date">("recent");
  const [confirmModal, setConfirmModal] = useState<ConfirmModal>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  const handleNewJob = useCallback(() => {
    setSearchInput("");
    setSearchTerm("");
    setStatusFilter("all");
    setSortBy("recent");

    const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    jobsStore?.add?.({
      id,
      status: "new",
      customer: {},
      artwork: {},
      frame: {},
      checklist: [],
      notes: "",
    });

    setSelectedId(id);
    toast("New job created. Fill in the job details on the right.", "success");
  }, [jobsStore, toast]);

    // Phase 3: Timeline, templates, communication log
    const [timeline, setTimeline] = useState<Record<string, JobTimelineEvent[]>>(() => {
      try {
        const stored = localStorage.getItem("jobs.timeline.v1");
        return stored ? JSON.parse(stored) : {};
      } catch {
        return {};
      }
    });



    // Persist timeline to localStorage whenever it changes
    useEffect(() => {
      localStorage.setItem("jobs.timeline.v1", JSON.stringify(timeline));
    }, [timeline]);



  // Bulk operations helpers
  const toggleSelectJob = (jobId: string) => {
    const newSet = new Set(selectedJobIds);
    if (newSet.has(jobId)) {
      newSet.delete(jobId);
    } else {
      newSet.add(jobId);
    }
    setSelectedJobIds(newSet);
  };

  const toggleSelectAll = (jobList: any[]) => {
    if (selectedJobIds.size === jobList.length) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(jobList.map((j) => j.id)));
    }
  };

  const bulkDelete = () => {
    const count = selectedJobIds.size;
    setConfirmModal({
      isOpen: true,
      title: "Delete Jobs",
      message: `Are you sure you want to delete ${count} job${count === 1 ? "" : "s"}? This cannot be undone.`,
      onCancel: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        selectedJobIds.forEach((id) => remove(id));
        setSelectedJobIds(new Set());
        toast(`${count} job${count === 1 ? "" : "s"} deleted`, "success");
      },
    });
  };

  const bulkChangeStatus = (newStatus: JobStatus) => {
    selectedJobIds.forEach((id) => {
      upsert({ id, status: newStatus });
    });
    const count = selectedJobIds.size;
    toast(`${count} job${count === 1 ? "" : "s"} updated to ${newStatus}`, "success");
    setSelectedJobIds(new Set());
  };
  // Update version with timeline tracking
  const bulkChangeStatusWithTimeline = (newStatus: JobStatus) => {
    selectedJobIds.forEach((id) => {
      const job = jobs.find((j) => j.id === id);
      if (job && job.status !== newStatus) {
        upsert({ id, status: newStatus });
        addTimelineEvent(id, "status_change", { fromStatus: job.status, toStatus: newStatus });
      }
    });
    const count = selectedJobIds.size;
    toast(`${count} job${count === 1 ? "" : "s"} updated to ${newStatus}`, "success");
    setSelectedJobIds(new Set());
  };

  // Helper: check if due date is soon or overdue
  const getDueDateStatus = (dueDate?: string): "overdue" | "due-soon" | null => {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const now = new Date();
    const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilDue < 0) return "overdue";
    if (daysUntilDue <= 7) return "due-soon";
    return null;
  };

    // Phase 3: Timeline tracking
    const addTimelineEvent = (jobId: string, type: "status_change" | "due_date_set" | "note_added" | "template_applied" | "message_sent", data: any) => {
      const event: JobTimelineEvent = {
        id: Math.random().toString(36).substr(2, 9),
        type,
        timestamp: new Date().toISOString(),
        data,
      };
      setTimeline((prev) => ({
        ...prev,
        [jobId]: [...(prev[jobId] || []), event],
      }));
    };



  // If we navigated here from the calendar, auto-select that job
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("frameit_select_job");
      if (pending) {
        setSelectedId(pending);
        sessionStorage.removeItem("frameit_select_job");
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onGlobalNew = (event: Event) => {
      const detail = (event as CustomEvent).detail as { type?: string };
      if (detail?.type === "job") {
        handleNewJob();
      }
    };

    window.addEventListener("frameapp:new", onGlobalNew as EventListener);
    return () => window.removeEventListener("frameapp:new", onGlobalNew as EventListener);
  }, [handleNewJob]);

  // Persist filters
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.search === "string") {
        setSearchInput(parsed.search);
        setSearchTerm(parsed.search);
      }
      if (parsed.statusFilter) setStatusFilter(parsed.statusFilter);
      if (parsed.sortBy) setSortBy(parsed.sortBy);
    } catch (e) {
      console.warn("Failed to read job filters from storage", e);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
    }, 200);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        FILTER_KEY,
        JSON.stringify({ search: searchInput, statusFilter, sortBy })
      );
    } catch (e) {
      console.warn("Failed to persist job filters", e);
    }
  }, [searchInput, statusFilter, sortBy]);
  
  // --- Safe store helpers (support different store shapes) ---
  const upsert = (patch: Partial<Job> & { id: string }) =>
    jobsStore?.update?.(patch) ??
    jobsStore?.patch?.(patch) ??
    (() => {
      const bag = (jobsStore?.jobs ?? jobs) as Job[];
      const idx = bag.findIndex((j: Job) => j.id === patch.id);
      if (idx >= 0 && jobsStore?.jobs)
        jobsStore.jobs[idx] = { ...jobsStore.jobs[idx], ...patch };
      return patch.id;
    })();

  const remove = (id: string) =>
    jobsStore?.remove?.(id) ??
    jobsStore?.delete?.(id) ??
    jobsStore?.splice?.(
      (jobs as Job[]).findIndex((j: Job) => j.id === id),
      1
    );

  const handleDelete = (job: Job, jobView: any) => {
    const displayName = jobView?.title || jobView?.customerName || `Job ${String(job.id).slice(0, 6)}`;
    setConfirmModal({
      isOpen: true,
      title: "Delete Job",
      message: `Are you sure you want to delete "${displayName}"? This cannot be undone.`,
      onCancel: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        remove(job.id);
        if (selectedId === job.id) setSelectedId(null);
        toast("Job deleted successfully", "success");
      },
    });
  };

  const toggleComplete = (job: Job) => {
    const currentStatus = String(job.status || "").toLowerCase();
    const isCompleted = currentStatus === "completed";
    if (isCompleted) {
      // Move back to in-progress
      upsert({ id: job.id, status: "in-progress", completedAt: undefined });
    } else {
      const when = new Date().toISOString();
      upsert({
        id: job.id,
        status: "completed",
        completedAt: job.completedAt ?? when,
      });
    }
  };
  const toggleCompleteWithTimeline = (job: Job) => {
    const currentStatus = String(job.status || "").toLowerCase();
    const isCompleted = currentStatus === "completed";
    if (isCompleted) {
      upsert({ id: job.id, status: "in-progress", completedAt: undefined });
      addTimelineEvent(job.id, "status_change", { fromStatus: "completed", toStatus: "in-progress" });
    } else {
      const when = new Date().toISOString();
      upsert({
        id: job.id,
        status: "completed",
        completedAt: job.completedAt ?? when,
      });
      addTimelineEvent(job.id, "status_change", { fromStatus: currentStatus, toStatus: "completed" });
    }
  };

  const openPDF = async (job: Job) => {
    try {
      const liveCustomer =
        (job?.customerId &&
          (customers ?? []).find((c: any) => c.id === job.customerId)) ||
        null;

      const customer =
        liveCustomer || job?.customer || job?.customerSnapshot || null;

      await exportJobCardPDF({
        job,
        customer,
        settings: {
          companyName: catalog?.settings?.companyName,
          companyEmail: catalog?.settings?.companyEmail,
          companyPhone: catalog?.settings?.companyPhone,
          companyAddress: catalog?.settings?.companyAddress,
          logoDataUrl: (catalog?.settings as any)?.companyLogoDataUrl,
          currencySymbol: catalog?.settings?.currencySymbol,
          currencyCode: catalog?.settings?.currencyCode,
          themeColor: catalog?.settings?.themeColor,
          bankDetails: (catalog?.settings as any)?.bankDetails,
          taxNumber: (catalog?.settings as any)?.taxNumber,
          jobCardFooterNote: (catalog?.settings as any)?.jobCardFooterNote,
        },
      });
    } catch (e) {
      console.error("[Jobs] Job card PDF export failed", e);
      alert("Job Card PDF export failed; see console for details.");
    }
  };

  // normalized list + selected
  const allViews = useMemo(
    () => jobs.map((j) => normalizeJob(j, catalog?.settings)),
    [jobs, catalog?.settings]
  );

  // Filter counts
  const filterCounts = useMemo(() => {
    let newCount = 0;
    let inProgressCount = 0;
    let readyCount = 0;
    let completedCount = 0;
    let favCount = 0;
    let dueSoonCount = 0;
    let overdueCount = 0;

    for (const v of allViews) {
      const status = String(v.status || "").toLowerCase();
      if (status === "new") newCount += 1;
      else if (status === "in-progress") inProgressCount += 1;
      else if (status === "ready") readyCount += 1;
      else if (status === "completed") completedCount += 1;
      if (isFavorited(v.id)) favCount += 1;
      const dueStatus = getDueDateStatus(v.__raw?.dueDate);
      if (dueStatus === "due-soon") dueSoonCount += 1;
      if (dueStatus === "overdue") overdueCount += 1;
    }

    return {
      all: allViews.length,
      new: newCount,
      "in-progress": inProgressCount,
      ready: readyCount,
      completed: completedCount,
      favorites: favCount,
      "due-soon": dueSoonCount,
      overdue: overdueCount,
    };
  }, [allViews, isFavorited, getDueDateStatus]);

  // Filtered and sorted views
  const views = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    let arr = [...allViews];

    // Filter by status
    if (statusFilter === "favorites") {
      arr = arr.filter((v) => isFavorited(v.id));
    } else if (statusFilter === "due-soon") {
      arr = arr.filter((v) => getDueDateStatus(v.__raw?.dueDate) === "due-soon");
    } else if (statusFilter === "overdue") {
      arr = arr.filter((v) => getDueDateStatus(v.__raw?.dueDate) === "overdue");
    } else if (statusFilter !== "all") {
      arr = arr.filter((v) => {
        const status = String(v.status || "").toLowerCase();
        return status === statusFilter;
      });
    }

    // Search filter
    if (needle) {
      arr = arr.filter((v) => {
        const hay = [
          v.title,
          v.customerName,
          v.customer?.email,
          v.customer?.phone,
          v.frameName,
          v.glazingName,
          v.id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      });
    }

    // Sort
    arr.sort((a, b) => {
      if (sortBy === "recent") {
        const dateA = a.createdAt || "";
        const dateB = b.createdAt || "";
        return dateB.localeCompare(dateA);
      } else if (sortBy === "oldest") {
        const dateA = a.createdAt || "";
        const dateB = b.createdAt || "";
        return dateA.localeCompare(dateB);
      } else if (sortBy === "customer") {
        return a.customerName.localeCompare(b.customerName);
      } else if (sortBy === "value") {
        return (b.costs?.total ?? 0) - (a.costs?.total ?? 0);
      } else if (sortBy === "due-date") {
        const aDue = a.__raw?.dueDate || "9999-12-31";
        const bDue = b.__raw?.dueDate || "9999-12-31";
        return aDue.localeCompare(bDue);
      }
      return 0;
    });

    return arr;
  }, [allViews, statusFilter, searchTerm, sortBy, isFavorited]);

  // Phase 3.4: CSV export for filtered views
  const handleExportCSV = useCallback(() => {
    if (!views || views.length === 0) {
      toast("No jobs to export", "info");
      return;
    }
    const csv = jobsToCSV(views as any);
    downloadCSV("jobs.csv", csv);
    toast(`Exported ${views.length} job${views.length === 1 ? "" : "s"} to CSV`, "success");
  }, [views, toast]);

  const selected = useMemo(
    () => views.find((v) => v.id === selectedId) ?? null,
    [views, selectedId]
  );

  // try to enrich with live customer record if we only had an id
  const liveCustomer =
    (selected?.__raw?.customerId &&
      (customers ?? []).find(
        (c: any) => c.id === selected.__raw.customerId
      )) ||
    null;

  const currencyCode =
    selected?.costs?.currency?.code ??
    catalog?.settings?.currencyCode ??
    "ZAR";
  const currencySymbol =
    selected?.costs?.currency?.symbol ??
    catalog?.settings?.currencySymbol ??
    "R ";

  // ------- overview stats (work in progress & completed) -------
  const overview = useMemo(() => {
    let totalJobs = 0;
    let wipCount = 0;
    let completedCount = 0;
    let wipValue = 0;
    let completedValue = 0;

    allViews.forEach((view) => {
      totalJobs += 1;
      const status = String(view.status || "").toLowerCase();
      const isCompleted = status === "completed";
      const total = Number(view.costs?.total ?? 0);
      if (isCompleted) {
        completedCount += 1;
        completedValue += total;
      } else {
        wipCount += 1;
        wipValue += total;
      }
    });

    return { totalJobs, wipCount, completedCount, wipValue, completedValue };
  }, [allViews]);

  // ------- Message builders -------
  function buildReadyMessage(jobView: any, asPlain = false) {
    const c = liveCustomer || jobView?.customer || {};
    const custName =
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      c.company ||
      "Customer";

    const orderNo = String(jobView?.id ?? rid()).slice(0, 6).toUpperCase();
    const companyName =
      catalog?.settings?.companyName ?? "Our Framing Studio";
    const companyEmail = catalog?.settings?.companyEmail ?? "";
    const companyPhone = catalog?.settings?.companyPhone ?? "";
    const companyAddress = catalog?.settings?.companyAddress ?? "";
    const bankDetails = (catalog?.settings as any)?.bankDetails ?? "";
    const taxNumber = (catalog?.settings as any)?.taxNumber ?? "";

    const totalStr = fmt(jobView?.costs?.total, currencyCode, currencySymbol);

    const lines = [
      `Hi ${custName},`,
      ``,
      `Great news — your framing order (Ref ${orderNo}) is ready for collection.`,
      ``,
      `Total due: ${totalStr}`,
      ``,
      bankDetails ? `Bank details:\n${bankDetails}\n` : ``,
      companyAddress ? `Collection address:\n${companyAddress}\n` : ``,
      `If you have any questions, just reply to this message.`,
      ``,
      `Kind regards,`,
      companyName,
      companyPhone ? `Tel: ${companyPhone}` : ``,
      companyEmail ? `Email: ${companyEmail}` : ``,
      taxNumber ? `Tax/VAT: ${taxNumber}` : ``,
    ].filter(Boolean);

    if (asPlain) return lines.join("\n");

    const subject = `Your framing order is ready for collection — Ref ${orderNo}`;
    const body = lines.join("\n");
    return { subject, body };
  }

  function buildMailto(jobView: any) {
    const c = liveCustomer || jobView?.customer || {};
    const msg = buildReadyMessage(jobView) as {
      subject: string;
      body: string;
    };
    const to = encodeURIComponent(c?.email ?? "");
    const subject = encodeURIComponent(msg.subject);
    const body = encodeURIComponent(msg.body);
    return `mailto:${to}?subject=${subject}&body=${body}`;
  }

  function buildWhatsAppLink(jobView: any) {
    const c = liveCustomer || jobView?.customer || {};
    const phoneFromCustomer = cleanPhone(c?.phone);
    const phoneFromSettings = cleanPhone(
      (catalog?.settings as any)?.companyWhatsAppTo ?? ""
    );
    const phone = phoneFromCustomer || phoneFromSettings || "";
    const text = encodeURIComponent(buildReadyMessage(jobView, true));
    return phone
      ? `https://wa.me/${phone}?text=${text}`
      : `https://wa.me/?text=${text}`;
  }

  // ------- Checklist helpers (persist toggle & bulk ops) -------
  function toggleChecklist(jobView: any, itemId: string) {
    const list = Array.isArray(jobView?.checklist)
      ? jobView.checklist.slice()
      : [];
    const idx = list.findIndex((i: any) => i?.id === itemId);
    if (idx === -1) return;
    list[idx] = { ...list[idx], done: !list[idx].done };
    // patch raw job
    upsert({ id: jobView.id, checklist: list });
  }

  // when marking ALL done, also mark the job as completed
  function markAllChecklist(jobView: any, done: boolean) {
    const list = (
      Array.isArray(jobView?.checklist) ? jobView.checklist : []
    ).map((i: any) => ({
      ...i,
      done,
    }));

    if (done) {
      const when = new Date().toISOString();
      upsert({
        id: jobView.id,
        checklist: list,
        status: "completed",
        completedAt: jobView.__raw?.completedAt ?? when,
      });
    } else {
      upsert({ id: jobView.id, checklist: list });
    }
  }

  const selectedChecklist = (Array.isArray(selected?.checklist)
    ? selected?.checklist
    : []) as {
    id: string;
    text: string;
    done?: boolean;
  }[];
  const doneCount = selectedChecklist.filter((i) => i.done).length;
  const totalCount = selectedChecklist.length;
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  const showDebug =
    typeof window !== "undefined" &&
    window.location.hash.includes("debug=1");

  const selectedStatus = String(selected?.status || "").toLowerCase();
  const selectedIsCompleted = selectedStatus === "completed";

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="w-full p-6 space-y-6">
        <header className="pb-6 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-1">💼 Jobs</h1>
              <p className="text-sm text-slate-600">
                Track job progress, deadlines, and production status in one place.
              </p>
            </div>
            <button
              onClick={handleNewJob}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs md:text-sm hover:bg-slate-50"
            >
              New job
            </button>
          </div>
        </header>
        {/* OVERVIEW SECTION – matches Quotes style */}
        <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base md:text-lg font-semibold">
              Job overview
            </h3>
            {/* label removed */}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {/* Work in progress */}
            <div className="rounded-xl ring-1 ring-slate-200 bg-amber-50 px-4 py-3">
              <div className="text-xs text-amber-800">Work in progress</div>
              <div className="mt-0.5 text-xl font-semibold text-amber-900 tabular-nums">
                {overview.wipCount}
              </div>
              {overview.wipValue > 0 && (
                <div className="text-[11px] text-amber-800 tabular-nums">
                  {fmt(overview.wipValue, currencyCode, currencySymbol)}
                </div>
              )}
            </div>

            {/* Completed */}
            <div className="rounded-xl ring-1 ring-slate-200 bg-green-50 px-4 py-3">
              <div className="text-xs text-green-700">Completed</div>
              <div className="mt-0.5 text-xl font-semibold text-green-800 tabular-nums">
                {overview.completedCount}
              </div>
              {overview.completedValue > 0 && (
                <div className="text-[11px] text-green-800 tabular-nums">
                  {fmt(
                    overview.completedValue,
                    currencyCode,
                    currencySymbol
                  )}
                </div>
              )}
            </div>

            {/* Total jobs */}
            <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">Total jobs</div>
              <div className="mt-0.5 text-xl font-semibold tabular-nums">
                {overview.totalJobs}
              </div>
            </div>

            {/* Completion % */}
            <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">Completed %</div>
              <div className="mt-0.5 text-xl font-semibold tabular-nums">
                {overview.totalJobs
                  ? Math.round(
                      (overview.completedCount / overview.totalJobs) * 100
                    )
                  : 0}
                %
              </div>
            </div>
          </div>
        </section>

        {/* MAIN GRID: Jobs list + Detail - responsive for mobile */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* LEFT: Jobs list */}
          <aside className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Jobs</h2>
              <span className="text-xs text-slate-500">
                {filterCounts.all} total
              </span>
            </div>

            <div className="relative max-h-[calc(100vh-270px)] overflow-auto pr-1 space-y-2">
              <div className="sticky top-0 z-10 bg-white pb-2 space-y-2">
                {/* Search */}
                <div className="relative">
                  <input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search by customer, job ID…"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={() => setSearchInput("")}
                      className="absolute inset-y-0 right-2 px-2 text-xs text-slate-500 hover:text-slate-700"
                      aria-label="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Status Filters */}
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {(
                    [
                      { key: "all" as const, label: "All", count: filterCounts.all },
                      { key: "new" as const, label: "New", count: filterCounts.new },
                      { key: "in-progress" as const, label: "In Progress", count: filterCounts["in-progress"] },
                      { key: "ready" as const, label: "Ready", count: filterCounts.ready },
                      { key: "completed" as const, label: "Completed", count: filterCounts.completed },
                      { key: "favorites" as const, label: "Favourites", count: filterCounts.favorites },
                      { key: "overdue" as const, label: "Overdue", count: filterCounts.overdue },
                      { key: "due-soon" as const, label: "Due soon", count: filterCounts["due-soon"] },
                    ]
                  ).map(({ key, label, count }) => {
                    const active = statusFilter === key;
                    const base =
                      "rounded-full px-3 py-1.5 border transition flex items-center gap-1";
                    const activeCls =
                      "bg-slate-900 text-white border-slate-900";
                    const idleCls =
                      "bg-white text-slate-700 border-slate-300 hover:bg-slate-50";
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setStatusFilter(key as any)}
                        className={`${base} ${active ? activeCls : idleCls}`}
                      >
                        <span>{label}</span>
                        <span className="tabular-nums">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Sort dropdown */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
                  title="Sort jobs"
                >
                  <option value="recent">Sort: Most recent</option>
                  <option value="oldest">Sort: Oldest first</option>
                  <option value="customer">Sort: Customer name</option>
                  <option value="value">Sort: Highest value</option>
                  <option value="due-date">Sort: Due date</option>
                </select>

                {/* CSV Export */}
                <button
                  onClick={handleExportCSV}
                  className="w-full inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 text-white px-3 py-2 text-sm font-semibold hover:bg-slate-800"
                  title="Export filtered jobs to CSV"
                >
                  Export CSV
                </button>
              </div>

              <div className="grid gap-2">
              {/* Select all checkbox (visible only if there are jobs) */}
              {!views || views.length === 0 ? null : (
                <div className="flex items-center gap-2 px-2 py-1.5 border-b sticky top-0 bg-white z-10">
                  <input
                    type="checkbox"
                    checked={selectedJobIds.size > 0 && selectedJobIds.size === views.length}
                    onChange={() => toggleSelectAll(views)}
                    className="h-4 w-4 rounded border-slate-300"
                    title="Select all visible jobs"
                  />
                  <span className="text-xs text-slate-500 font-medium">
                    {selectedJobIds.size > 0 ? `${selectedJobIds.size} selected` : ""}
                  </span>
                </div>
              )}
              {!views || views.length === 0 ? (
                <div className="text-sm text-slate-500 p-6 text-center">
                  No jobs yet. Create one from the Visualizer using “Add to
                  Jobs”.
                </div>
              ) : (
                <ul className="space-y-2">
                  {views.map((view) => {
                    const isSel = view.id === selectedId;
                    const isFav = isFavorited(view.id);
                    const when = view?.createdAt
                      ? new Date(view.createdAt)
                      : null;
                    const whenStr = when ? when.toLocaleDateString() : "";
                    const totalStr = fmt(
                      view?.costs?.total,
                      view?.costs?.currency?.code,
                      view?.costs?.currency?.symbol
                    );
                    
                    const status = String(view.status || "new").toLowerCase() as JobStatus;

                    // Mini progress for row
                    const cl = Array.isArray(view?.checklist)
                      ? view.checklist
                      : [];
                    const dc = cl.filter((i: any) => i.done).length;
                    const tc = cl.length;

                    return (
                      <li
                        key={view.id}
                        className={`rounded-lg border p-3 transition ${
                          isSel
                            ? "border-slate-900 bg-slate-50 shadow-sm"
                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                        } ${selectedJobIds.has(view.id) ? "ring-2 ring-blue-500" : ""}`}
                        onClick={() => setSelectedId(view.id)}
                      >
                        <div className="flex items-start gap-2 mb-2">
                          <input
                            type="checkbox"
                            checked={selectedJobIds.has(view.id)}
                            onChange={() => toggleSelectJob(view.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300"
                          />
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(view.id);
                              }}
                              className="text-lg hover:scale-125 transition-transform flex-shrink-0"
                            >
                              {isFav ? "⭐" : "☆"}
                            </button>
                            <div className="text-sm font-medium truncate">
                              {view.customerName}
                            </div>
                          </div>
                          <StatusBadge status={status} />
                        </div>
                        
                        <div className="text-xs text-slate-500 mb-1 pl-6">
                          {whenStr}
                          {view.__raw?.dueDate && (
                            <> • Due: <span className={getDueDateStatus(view.__raw.dueDate) === "overdue" ? "text-red-600 font-medium" : getDueDateStatus(view.__raw.dueDate) === "due-soon" ? "text-orange-600 font-medium" : ""}>
                              {new Date(view.__raw.dueDate).toLocaleDateString()}
                            </span></>
                          )}
                        </div>
                        <div className="text-xs text-slate-600 mb-2">
                          Total:{" "}
                          <span className="font-medium">
                            {totalStr}
                          </span>
                        </div>

                        {tc > 0 && (
                          <div className="mt-1 mb-2">
                            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500"
                                style={{
                                  width: `${Math.round(
                                    (dc / tc) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              Checklist: {dc}/{tc}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
                            onClick={() => setSelectedId(view.id)}
                            title="View Detail"
                          >
                            View
                          </button>
                          <button
                            className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
                            onClick={() => openPDF(view.__raw)}
                            title="Export Job Card PDF"
                          >
                            PDF
                          </button>
                          <button
                            className="rounded-xl border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
                            onClick={() => handleDelete(view.__raw, view)}
                            title="Delete Job"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              </div>
            </div>
          </aside>

          {/* RIGHT: Detail pane - hidden on mobile when sidebar visible */}
          <main className="hidden lg:block bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 min-h-[60vh]">
            {!selected ? (
              <div className="text-sm text-slate-500">
                Select a job to view details.
              </div>
            ) : (
              <div className="space-y-5">
                <header className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Details</h2>
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                      {selected.createdAt
                        ? new Date(
                            selected.createdAt
                          ).toLocaleDateString()
                        : ""}
                      <StatusBadge status={String(selected.status || "new").toLowerCase() as JobStatus} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="px-3 py-1.5 text-xs rounded-lg ring-1 ring-slate-300 hover:bg-slate-50"
                      onClick={() => openPDF(selected.__raw)}
                    >
                      PDF
                    </button>

                    {/* Mirror row button text: "Completed" / "Mark complete" */}
                    <button
                      className={`px-3 py-1.5 text-xs rounded-lg ring-1 ring-emerald-300 text-emerald-700 ${
                        selectedIsCompleted
                          ? "bg-emerald-50 hover:bg-emerald-100"
                          : "hover:bg-emerald-50"
                      }`}
                      onClick={() => toggleCompleteWithTimeline(selected.__raw)}
                      title={
                        selectedIsCompleted
                          ? "Mark as in progress"
                          : "Mark as completed"
                      }
                    >
                      {selectedIsCompleted ? "Completed" : "Mark complete"}
                    </button>
                  </div>
                </header>

                {/* Totals & Customer */}
                <section className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-slate-500 mb-1">
                      Customer
                    </div>
                    {liveCustomer || selected.customer ? (
                      <div className="space-y-0.5">
                        <div className="font-medium">
                          {selected.customerName}
                        </div>
                        {(liveCustomer?.email ||
                          selected.customer?.email) && (
                          <div className="text-xs">
                            {liveCustomer?.email ??
                              selected.customer?.email}
                          </div>
                        )}
                        {(liveCustomer?.phone ||
                          selected.customer?.phone) && (
                          <div className="text-xs">
                            {liveCustomer?.phone ??
                              selected.customer?.phone}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-slate-500">—</div>
                    )}
                  </div>

                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-slate-500 mb-1">
                      Due date
                    </div>
                    <input
                      type="date"
                      value={selected.__raw?.dueDate?.split('T')[0] || ""}
                      onChange={(e) => {
                        if (e.target.value) {
                          const newIso = new Date(e.target.value).toISOString();
                          upsert({ id: selected.id, dueDate: newIso });
                          addTimelineEvent(selected.id, "due_date_set", { dueDate: newIso });
                        }
                      }}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                    />
                    {selected.__raw?.dueDate && (
                      <div className="text-xs mt-1">
                        <span className={`font-medium ${{ 
                          "overdue": "text-red-600",
                          "due-soon": "text-orange-600"
                        }[getDueDateStatus(selected.__raw.dueDate) || ""] || ""}`}>
                          {getDueDateStatus(selected.__raw.dueDate) === "overdue" 
                            ? "OVERDUE" 
                            : getDueDateStatus(selected.__raw.dueDate) === "due-soon"
                            ? "Due within 7 days"
                            : "On track"}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border p-3 col-span-2">
                    <div className="text-xs text-slate-500 mb-1">
                      Totals
                    </div>
                    <div className="space-y-0.5">
                      <div>
                        Subtotal:{" "}
                        <span className="font-medium">
                          {fmt(
                            selected.costs.subtotal,
                            currencyCode,
                            currencySymbol
                          )}
                        </span>
                      </div>
                      <div>
                        Tax:{" "}
                        <span className="font-medium">
                          {fmt(
                            (selected.costs.subtotal ?? 0) *
                              (selected.costs.taxRate ?? 0),
                            currencyCode,
                            currencySymbol
                          )}
                        </span>
                      </div>
                      <div>
                        Total:{" "}
                        <span className="font-semibold">
                          {fmt(
                            selected.costs.total,
                            currencyCode,
                            currencySymbol
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Checklist */}
                <section className="rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        Checklist
                      </div>
                      <div className="text-xs text-slate-600">
                        {doneCount}/{totalCount} complete
                      </div>
                    </div>
                  </div>

                  {totalCount === 0 ? (
                    <div className="text-sm text-slate-500 mt-3">
                      No checklist items on this job.
                    </div>
                  ) : (
                    <>
                      <ul className="mt-3 space-y-2">
                        {selectedChecklist.map((it) => (
                          <li
                            key={it.id}
                            className="flex items-start gap-2"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-slate-300"
                              checked={!!it.done}
                              onChange={() =>
                                toggleChecklist(selected, it.id)
                              }
                            />
                            <span
                              className={`text-sm ${
                                it.done
                                  ? "line-through text-slate-500"
                                  : ""
                              }`}
                            >
                              {it.text}
                            </span>
                          </li>
                        ))}
                      </ul>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="px-3 py-1.5 text-xs rounded-lg ring-1 ring-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          onClick={() =>
                            markAllChecklist(selected, true)
                          }
                          title="Marks all items done and completes the job"
                        >
                          Mark all done
                        </button>
                        <button
                          className="px-3 py-1.5 text-xs rounded-lg ring-1 ring-slate-300 hover:bg-slate-50"
                          onClick={() =>
                            markAllChecklist(selected, false)
                          }
                        >
                          Clear all
                        </button>
                      </div>

                      <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <p className="text-xs text-blue-700">
                          💡 <strong>Tip:</strong> Edit the checklist template from{" "}
                          <a
                            href="#/admin"
                            className="underline font-semibold hover:text-blue-900"
                          >
                            Admin &gt; Jobs
                          </a>
                          {" "}to customize items for all new jobs.
                        </p>
                      </div>
                    </>
                  )}
                </section>

                {/* Artwork preview - centered with white border */}
                {selected.artworkUrl && (
                  <section className="rounded-lg border p-3">
                    <div className="text-xs text-slate-500 mb-2">
                      Artwork
                    </div>
                    <div className="mt-2 flex justify-center">
                      <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                        <img
                          src={selected.artworkUrl}
                          alt="Artwork preview"
                          className="max-h-56 max-w-full object-contain rounded-md"
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* Notify customer flow (appears after completion) */}
                {selectedIsCompleted && (
                  <section className="rounded-xl border p-3 bg-emerald-50/40 ring-1 ring-emerald-200">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          Notify customer
                        </div>
                        <div className="text-xs text-slate-600">
                          Send a pre-filled message that the order is ready
                          for collection.
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <a
                        href={buildMailto(selected)}
                        className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-medium border border-transparent bg-slate-900 text-white hover:bg-slate-800"
                      >
                        Email customer
                      </a>
                      <a
                        href={buildWhatsAppLink(selected)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-medium border border-transparent bg-emerald-500 text-white hover:bg-emerald-600"
                        title="Opens WhatsApp Desktop/Web/App with a pre-filled message"
                      >
                        WhatsApp
                      </a>
                    </div>
                  </section>
                )}

                  {/* PHASE 3.1: Timeline/History view */}
                  <section className="rounded-2xl ring-1 ring-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-semibold mb-3">Timeline</div>
                    {!timeline[selected.id] || timeline[selected.id].length === 0 ? (
                      <div className="text-xs text-slate-500">No history yet</div>
                    ) : (
                      <ul className="space-y-2">
                        {timeline[selected.id].map((event) => (
                          <li key={event.id} className="flex gap-3 text-xs">
                            <div className="text-slate-400 min-w-fit">
                              {new Date(event.timestamp).toLocaleTimeString()}
                            </div>
                            <div className="flex-1">
                              {event.type === "status_change" && (
                                <div className="text-slate-700">
                                  Status changed: <span className="font-semibold">{event.data.fromStatus}</span> → <span className="font-semibold">{event.data.toStatus}</span>
                                </div>
                              )}
                              {event.type === "due_date_set" && (
                                <div className="text-slate-700">
                                  Due date: <span className="font-semibold">{new Date(event.data.dueDate).toLocaleDateString()}</span>
                                </div>
                              )}
                              {event.type === "template_applied" && (
                                <div className="text-slate-700">
                                  Template applied: <span className="font-semibold">{event.data.templateName}</span>
                                </div>
                              )}
                              {event.type === "message_sent" && (
                                <div className="text-slate-700">
                                  Message sent ({event.data.type})
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

  

                {/* Debug boxes (use #/jobs?debug=1) */}
                {showDebug && (
                  <section className="grid md:grid-cols-2 gap-3 text-xs">
                    <pre className="p-2 rounded border bg-slate-50 overflow-auto">
                      {JSON.stringify(selected.__raw, null, 2)}
                    </pre>
                    <pre className="p-2 rounded border bg-slate-50 overflow-auto">
                      {JSON.stringify(selected, null, 2)}
                    </pre>
                  </section>
                )}
              </div>
            )}
          </main>
        </div>
      </main>

      {/* CONFIRM DELETE MODAL */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm mx-4 ring-1 ring-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {confirmModal.title}
            </h3>
            <p className="text-slate-600 mb-6 text-sm">
              {confirmModal.message}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-red-500 hover:bg-red-600 text-white transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Actions Toolbar - appears when jobs selected */}
      {selectedJobIds.size > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 bg-white rounded-2xl shadow-lg ring-1 ring-slate-200 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-medium text-slate-900">
              {selectedJobIds.size} job{selectedJobIds.size === 1 ? "" : "s"} selected
            </div>
            <div className="flex gap-2 flex-wrap">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    bulkChangeStatusWithTimeline(e.target.value as JobStatus);
                    e.target.value = "";
                  }
                }}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-slate-400"
                title="Change status for selected jobs"
              >
                <option value="">Change status...</option>
                <option value="new">Mark as New</option>
                <option value="in-progress">Mark as In Progress</option>
                <option value="ready">Mark as Ready</option>
                <option value="completed">Mark as Completed</option>
              </select>
              <button
                onClick={() => setSelectedJobIds(new Set())}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 hover:bg-slate-50 transition"
              >
                Deselect all
              </button>
              <button
                onClick={bulkDelete}
                className="px-3 py-1.5 text-xs rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 transition font-medium"
              >
                Delete {selectedJobIds.size}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
