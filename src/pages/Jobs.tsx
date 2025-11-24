// src/pages/Jobs.tsx
import React, { useMemo, useState, useEffect } from "react";
import { useJobs } from "@/lib/jobs";
import { useCustomers } from "@/lib/customers";
import { useCatalog } from "@/lib/store";
import { exportJobCardPDF } from "@/lib/pdf/jobCardPdf";

type Job = any;

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

// ---------- normalization helpers ----------
function parseDetails(job: Job) {
  // details (object) or detailsJson (string)
  let d = job?.details;
  if (!d && typeof job?.detailsJson === "string") {
    try {
      d = JSON.parse(job.detailsJson);
    } catch {}
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

  // Try common shapes; fall back to array itself
  const jobs: Job[] = (jobsStore?.list?.() ??
    jobsStore?.jobs ??
    jobsStore ??
    []) as Job[];

  // Default selection (first job)
  const [selectedId, setSelectedId] = useState<string | null>(
    jobs?.[0]?.id ?? null
  );

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
  const views = useMemo(
    () => jobs.map((j) => normalizeJob(j, catalog?.settings)),
    [jobs, catalog?.settings]
  );

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

    views.forEach((view) => {
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
  }, [views]);

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
      <main className="w-full p-4 space-y-4">
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

        {/* MAIN GRID: Jobs list + Detail */}
        <div className="grid gap-4 lg:grid-cols-[minmax(440px,1fr)_minmax(420px,520px)]">
          {/* LEFT: Jobs list */}
          <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200">
            <header className="px-4 py-3 border-b">
              <h1 className="text-lg font-semibold">Jobs</h1>
              <p className="text-xs text-slate-500">
                Manage production and customer handover
              </p>
            </header>

            <div className="p-3 overflow-auto">
              {!views || views.length === 0 ? (
                <div className="text-sm text-slate-500 p-6 text-center">
                  No jobs yet. Create one from the Visualizer using “Add to
                  Jobs”.
                </div>
              ) : (
                <ul className="space-y-3">
                  {views.map((view) => {
                    const isSel = view.id === selectedId;
                    const when = view?.createdAt
                      ? new Date(view.createdAt)
                      : null;
                    const whenStr = when ? when.toLocaleString() : "";
                    const totalStr = fmt(
                      view?.costs?.total,
                      view?.costs?.currency?.code,
                      view?.costs?.currency?.symbol
                    );
                    const isCompleted =
                      String(view.status || "").toLowerCase() ===
                      "completed";

                    // Mini progress for row
                    const cl = Array.isArray(view?.checklist)
                      ? view.checklist
                      : [];
                    const dc = cl.filter((i: any) => i.done).length;
                    const tc = cl.length;

                    return (
                      <li
                        key={view.id}
                        className={`rounded-xl border p-3 ${
                          isSel
                            ? "border-black ring-1 ring-black/10 bg-slate-50"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {view.title}
                            </div>
                            <div className="text-xs text-slate-500">
                              {whenStr} • {view.status ?? "new"}
                            </div>
                            <div className="text-xs text-slate-600">
                              Total:{" "}
                              <span className="font-medium">
                                {totalStr}
                              </span>
                            </div>

                            {tc > 0 && (
                              <div className="mt-1">
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
                          </div>

                          {/* 2x2 button grid per job */}
                          <div className="grid grid-cols-2 gap-2 shrink-0">
                            <button
                              className="px-3 py-1.5 text-xs rounded-lg ring-1 ring-slate-300 hover:bg-slate-50"
                              onClick={() => setSelectedId(view.id)}
                              title="View Detail"
                            >
                              View Detail
                            </button>

                            <button
                              className="px-3 py-1.5 text-xs rounded-lg ring-1 ring-slate-300 hover:bg-slate-50"
                              onClick={() => openPDF(view.__raw)}
                              title="Export Job Card PDF"
                            >
                              PDF
                            </button>

                            {/* Toggle complete / in progress */}
                            <button
                              className={`px-3 py-1.5 text-xs rounded-lg ring-1 ${
                                isCompleted
                                  ? "ring-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                                  : "ring-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              }`}
                              onClick={() => toggleComplete(view.__raw)}
                              title={
                                isCompleted
                                  ? "Mark as in progress"
                                  : "Mark as completed"
                              }
                            >
                              {isCompleted
                                ? "Completed"
                                : "Mark complete"}
                            </button>

                            <button
                              className="px-3 py-1.5 text-xs rounded-lg ring-1 ring-rose-300 text-rose-700 hover:bg-rose-50"
                              onClick={() => {
                                if (
                                  confirm(
                                    "Delete this job? This cannot be undone."
                                  )
                                ) {
                                  remove(view.id);
                                  if (selectedId === view.id)
                                    setSelectedId(null);
                                }
                              }}
                              title="Delete Job"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* RIGHT: Detail pane */}
          <aside className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
            {!selected ? (
              <div className="text-sm text-slate-500">
                Select a job to view details.
              </div>
            ) : (
              <div className="space-y-5">
                <header className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Details</h2>
                    <div className="text-xs text-slate-500">
                      {selected.createdAt
                        ? new Date(
                            selected.createdAt
                          ).toLocaleString()
                        : ""}{" "}
                      • Status:{" "}
                      <span className="font-medium">
                        {selected.status ?? "new"}
                      </span>
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
                      onClick={() => toggleComplete(selected.__raw)}
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
          </aside>
        </div>
      </main>
    </div>
  );
}
