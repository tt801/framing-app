// src/pages/Quotes.tsx
import React, { useMemo, useState } from "react";
import { useQuotes } from "@/lib/quotes";
import { useCustomers } from "@/lib/customers";
import { useCatalog } from "@/lib/store";
import { exportQuotePDF } from "@/lib/pdf/quotePdf";

// -------------------- Types (loose to avoid breaking) --------------------
type Quote = any;
type QuoteStatus = "Draft" | "Open" | "Sent" | "Accepted" | "Declined" | "Expired";

// -------------------- Utility helpers --------------------
const n = (v: any, fallback = 0): number => {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
};

const firstNonEmpty = (...vals: any[]) => {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return undefined;
};

const symbolFor = (code: string | undefined): string => {
  if (!code) return "R ";
  const c = code.toUpperCase();
  if (c === "ZAR") return "R ";
  if (c === "USD") return "$";
  if (c === "GBP") return "£";
  if (c === "EUR") return "€";
  return code + " ";
};

const money = (amount: any, currencyCode?: string, currencySymbol?: string): string => {
  const v = n(amount, 0);
  const code = currencyCode || "ZAR";
  const sym = currencySymbol || symbolFor(code);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(v);
  } catch {
    return `${sym}${v.toFixed(2)}`;
  }
};

const pct = (part: number, total: number): string => {
  if (!total) return "0";
  return ((part / total) * 100).toFixed(0);
};

const safeRowId = (row: any): string =>
  String(
    row?.id ??
      row?.quoteId ??
      row?.quoteID ??
      row?.quote_id ??
      row?.quoteNumber ??
      row?.number ??
      row?.ref ??
      row?.reference ??
      row?.uid ??
      row?._id ??
      Math.random().toString(36).slice(2)
  );

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/* ---------------- Number / formatting helpers ---------------- */

const digitsFromId = (id: any) => {
  const m = String(id ?? "").match(/(\d+)/);
  return m ? m[1] : null;
};

const defaultPrefix = "Q-";

const formatQuoteNumber = (id: any, settings: any): string => {
  const rawId = safeRowId({ id });
  const digits = digitsFromId(rawId) ?? rawId;
  const seq = digits.padStart(n(settings?.quoteNumberDigits ?? 4, 4), 4);
  const prefix = settings?.quoteNumberPrefix ?? defaultPrefix;
  return `${prefix}${seq}`;
};

const displayQuoteNumber = (row: any, settings: any): string => {
  const explicit =
    row?.number ??
    row?.quoteNumber ??
    row?.reference ??
    row?.ref ??
    row?.details?.quoteNumber;
  if (explicit) return String(explicit);
  return formatQuoteNumber(row?.id ?? row, settings);
};

/* ---------------- Status helpers ---------------- */

const normaliseStatus = (row: any): QuoteStatus => {
  const raw: string =
    row?.status ??
    row?.state ??
    row?.quoteStatus ??
    row?.details?.status ??
    row?.details?.state ??
    "Draft";
  const s = String(raw).toLowerCase();

  if (s === "sent" || s === "issued") return "Sent";
  if (s === "accepted" || s === "won" || s === "approved") return "Accepted";
  if (s === "declined" || s === "lost" || s === "rejected") return "Declined";
  if (s === "expired") return "Expired";
  if (s === "open") return "Open";
  return "Draft";
};

/* ---------------- Items helpers ---------------- */

const coerceItem = (raw: any) => {
  const name =
    firstNonEmpty(
      raw?.name,
      raw?.title,
      raw?.item,
      raw?.label,
      raw?.description,
      raw?.productName,
      raw?.product?.name
    ) ?? "—";

  const qty = n(firstNonEmpty(raw?.qty, raw?.quantity, raw?.count, raw?.units, 1), 1);
  const unitPrice = n(
    firstNonEmpty(raw?.unitPrice, raw?.price, raw?.unit_price, raw?.rate, raw?.amountEach),
    0
  );
  const total = n(
    firstNonEmpty(raw?.total, raw?.line_total, raw?.amount, qty * unitPrice),
    qty * unitPrice
  );

  return { name: String(name), qty, unitPrice, total };
};

const pickArray = (v: any): any[] | null => (Array.isArray(v) ? v : null);

const extractItems = (
  row: any
): Array<{ name: string; qty: number; unitPrice: number; total: number }> => {
  const candidates: Array<any[] | null> = [
    pickArray(row?.items),
    pickArray(row?.lineItems),
    pickArray(row?.lines),
    pickArray(row?.details?.items),
    pickArray(row?.details?.lineItems),
    pickArray(row?.cart?.items),
    pickArray(row?.products),
    pickArray(row?.positions),
  ];
  const arr = candidates.find((a) => Array.isArray(a) && a.length > 0) ?? [];
  return (arr as any[]).map(coerceItem);
};

const fmt = (nVal: number | undefined, currencyCode?: string, currencySymbol?: string) =>
  money(nVal, currencyCode, currencySymbol);

/* ---------------- Query / links helpers ---------------- */
const getQueryFlag = (key: string) => {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
};

const buildWhatsAppLink = (phoneE164: string, text: string) =>
  `https://wa.me/${encodeURIComponent(phoneE164.replace(/\D/g, ""))}?text=${encodeURIComponent(
    text
  )}`;

const buildMailto = (email: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;

/* ---------------- Customer helpers ---------------- */
const resolveCustomerName = (row: any, customersList: any[] | undefined) => {
  const list = customersList && Array.isArray(customersList) ? customersList : [];
  const rawId = row?.customerId ?? row?.customer?.id ?? row?.customerSnapshot?.id;

  const fromId = rawId
    ? list.find((x: any) => x.id === rawId)
    : undefined;

  if (fromId) {
    const full = `${(fromId as any).firstName ?? ""} ${(fromId as any).lastName ?? ""}`.trim();
    return (
      full ||
      (fromId as any).company ||
      (fromId as any).email ||
      (fromId as any).name ||
      (fromId as any).id ||
      "—"
    );
  }

  const snap =
    (row as any).customerSnapshot ||
    (row as any).customer ||
    (row as any).details?.customer;

  if (snap) {
    const full = `${snap.firstName ?? ""} ${snap.lastName ?? ""}`.trim();
    return (
      full ||
      snap.company ||
      snap.email ||
      snap.name ||
      row?.customerName ||
      "—"
    );
  }

  return row?.customerName ?? row?.customer ?? row?.details?.customer?.name ?? "—";
};

const resolveCustomerEmail = (row: any, customersList: any[] | undefined) => {
  const list = customersList && Array.isArray(customersList) ? customersList : [];
  const rawId = row?.customerId ?? row?.customer?.id ?? row?.customerSnapshot?.id;

  const fromId = rawId
    ? list.find((x: any) => x.id === rawId)
    : undefined;

  const emailFromId =
    (fromId as any)?.email ??
    (fromId as any)?.primaryEmail ??
    (fromId as any)?.contactEmail;

  if (emailFromId) return emailFromId;

  const snap =
    (row as any).customerSnapshot ||
    (row as any).customer ||
    (row as any).details?.customer;

  return (
    row?.customerEmail ??
    snap?.email ??
    snap?.primaryEmail ??
    snap?.contactEmail ??
    ""
  );
};

const resolveCustomerPhone = (row: any, customersList: any[] | undefined) => {
  const list = customersList && Array.isArray(customersList) ? customersList : [];
  const rawId = row?.customerId ?? row?.customer?.id ?? row?.customerSnapshot?.id;

  const fromId = rawId
    ? list.find((x: any) => x.id === rawId)
    : undefined;

  const phoneFromId =
    (fromId as any)?.phone ??
    (fromId as any)?.mobile ??
    (fromId as any)?.whatsApp ??
    (fromId as any)?.whatsapp ??
    (fromId as any)?.whatsAppNumber;

  if (phoneFromId) return phoneFromId;

  const snap =
    (row as any).customerSnapshot ||
    (row as any).customer ||
    (row as any).details?.customer;

  return (
    row?.customerPhone ??
    snap?.phone ??
    snap?.mobile ??
    snap?.whatsApp ??
    snap?.whatsapp ??
    snap?.whatsAppNumber ??
    ""
  );
};

/* ---------------- Store normalisation ---------------- */

const getAllQuotes = (qStore: any): Quote[] => {
  const base: any[] = [];
  if (Array.isArray(qStore?.quotes)) base.push(...qStore.quotes);
  if (Array.isArray(qStore?.items)) base.push(...qStore.items);

  const byId = new Map<string, any>();
  for (const raw of base) {
    const id = safeRowId(raw);
    if (byId.has(id)) continue;
    byId.set(id, { ...raw, id });
  }
  return Array.from(byId.values());
};

const updateQuoteInStore = (qStore: any, id: string, patch: any) => {
  try {
    if (typeof qStore?.updateQuote === "function") {
      qStore.updateQuote(id, patch);
      return;
    }
    if (typeof qStore?.patchQuote === "function") {
      qStore.patchQuote(id, patch);
      return;
    }
    if (typeof qStore?.setQuotes === "function") {
      qStore.setQuotes((rows: any[]) =>
        rows.map((r) => (safeRowId(r) === id ? { ...r, ...patch } : r))
      );
      return;
    }
  } catch (e) {
    console.warn("Failed to update quote in store", e);
  }
};

const deleteQuoteFromStore = (qStore: any, id: string) => {
  try {
    if (typeof qStore?.removeQuote === "function") {
      qStore.removeQuote(id);
      return;
    }
    if (typeof qStore?.deleteQuote === "function") {
      qStore.deleteQuote(id);
      return;
    }
    if (typeof qStore?.delete === "function") {
      qStore.delete(id);
      return;
    }
    if (typeof qStore?.remove === "function") {
      qStore.remove(id);
      return;
    }
    if (typeof qStore?.setQuotes === "function") {
      qStore.setQuotes((rows: any[]) => rows.filter((r) => safeRowId(r) !== id));
      return;
    }
  } catch (e) {
    console.warn("Failed to delete quote from store", e);
  }
};

/* ====================================================================== */
/* PAGE COMPONENT */
/* ====================================================================== */

export default function QuotesPage() {
  const qStore = useQuotes() as any;
  const c = useCustomers() as any;
  const s = useCatalog() as any;

  const settings = s?.settings || {};
  const settingsCurrencyCode: string | undefined =
    settings.currencyCode ||
    (typeof settings.currency === "string" ? settings.currency : undefined) ||
    "ZAR";
  const settingsCurrencySymbol: string | undefined =
    settings.currencySymbol ||
    (typeof settings.currency === "object" ? settings.currency?.symbol : undefined) ||
    symbolFor(settingsCurrencyCode);

  const storeQuotes = useMemo(() => getAllQuotes(qStore), [qStore]);
  const customersList: any[] = useMemo(() => {
    if (!c) return [];
    const asAny = c as any;
    if (Array.isArray(asAny.customers)) return asAny.customers as any[];
    if (Array.isArray(asAny.items)) return asAny.items as any[];
    if (Array.isArray(asAny.list)) return asAny.list as any[];
    if (typeof asAny.list === "function") {
      try {
        const res = asAny.list();
        if (Array.isArray(res)) return res as any[];
      } catch (err) {
        console.warn("Failed to read customers via list()", err);
      }
    }
    return [];
  }, [c]);
  const debug = !!getQueryFlag("debug");

  // Local UI state
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "All">("All");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "total" | "customer">("date");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<Record<string, QuoteStatus>>({});

  const rows = useMemo(() => {
    const arr = storeQuotes as any[];
    return arr.map((row) => {
      const id = safeRowId(row);
      const status = normaliseStatus(row);
      const customerName = resolveCustomerName(row, customersList);
      const customerEmail = resolveCustomerEmail(row, customersList);
      const customerPhone = resolveCustomerPhone(row, customersList);
      const createdAt =
        row?.createdAt ??
        row?.created_date ??
        row?.date ??
        row?.created ??
        row?.details?.createdAt ??
        row?._createdAt ??
        null;
      const total =
        row?.total ??
        row?.grandTotal ??
        row?.amount ??
        row?.summary?.total ??
        row?.totals?.grandTotal ??
        row?.details?.total ??
        0;

      return {
        ...row,
        id,
        status,
        customerName,
        customerEmail,
        customerPhone,
        createdAt,
        total: n(total, 0),
      };
    });
  }, [storeQuotes, customersList]);

  /* ---------- SEARCH + FILTER + SORT ---------- */
  const filtered = useMemo(() => {
    const sf = statusFilter;
    const needle = search.trim().toLowerCase();

    let arr = [...rows];

    if (sf !== "All") {
      arr = arr.filter((r) => {
        const base: QuoteStatus = (r?.status ?? "Draft") as QuoteStatus;
        const st: QuoteStatus = statusOverride[r.id] ?? base;
        return st === sf;
      });
    }

    if (needle) {
      arr = arr.filter((r) => {
        const blob = [
          r.customerName,
          r.customerEmail,
          r.id,
          displayQuoteNumber(r, settings),
          r.reference,
          r.ref,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return blob.includes(needle);
      });
    }

    arr.sort((a, b) => {
      if (sortBy === "total") {
        return b.total - a.total;
      }
      if (sortBy === "customer") {
        return String(a.customerName || "").localeCompare(String(b.customerName || ""));
      }
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });

    return arr;
  }, [rows, statusFilter, search, sortBy, statusOverride, settings]);

  const selected =
    filtered.find((r: any) => safeRowId(r) === selectedId) ?? filtered[0] ?? null;

  React.useEffect(() => {
    if (!selected && filtered.length > 0) {
      setSelectedId(safeRowId(filtered[0]));
    }
  }, [selected, filtered]);

  const overview = useMemo(() => {
    const counts: Record<string, number> = {
      Draft: 0,
      Open: 0,
      Sent: 0,
      Accepted: 0,
      Declined: 0,
      Expired: 0,
    };
    let total = 0;
    filtered.forEach((row: any) => {
      const base: QuoteStatus = (row?.status ?? "Draft") as QuoteStatus;
      const st: QuoteStatus = statusOverride[row.id] ?? base;
      counts[st] = (counts[st] ?? 0) + 1;
      total += Number(row?.total ?? 0);
    });

    const acceptedValue = filtered
      .filter(
        (row) =>
          (statusOverride[row.id] ??
            ((row?.status as QuoteStatus) ?? "Draft")) === "Accepted"
      )
      .reduce((sum, row) => sum + Number(row?.total ?? 0), 0);

    const declinedValue = filtered
      .filter(
        (row) =>
          (statusOverride[row.id] ??
            ((row?.status as QuoteStatus) ?? "Draft")) === "Declined"
      )
      .reduce((sum, row) => sum + Number(row?.total ?? 0), 0);

    const sentCount = counts["Sent"] ?? 0;

    return {
      count: filtered.length,
      totalValue: total,
      acceptedValue,
      declinedValue,
      sentCount,
      counts,
    };
  }, [filtered, statusOverride]);

  const selectedItems = useMemo(() => (selected ? extractItems(selected) : []), [selected]);

  // Currency for overview widgets: prefer any quote currency, fall back to settings
  const overviewCurrencyCode: string =
    (filtered.find((r) => r.currency)?.currency as string | undefined) ||
    settingsCurrencyCode ||
    "ZAR";
  const overviewCurrencySymbol: string =
    settingsCurrencySymbol || symbolFor(overviewCurrencyCode);

  /* ---------- ACTIONS ---------- */

  const markStatus = (status: QuoteStatus) => {
    if (!selected) return;
    const id = safeRowId(selected);
    setStatusOverride((m) => ({ ...m, [id]: status }));

    const patch: any = { status };
    const now = new Date().toISOString();
    if (status === "Sent") patch.sentAt = now;
    if (status === "Accepted") patch.acceptedAt = now;
    if (status === "Declined") patch.declinedAt = now;

    updateQuoteInStore(qStore, id, patch);
  };

  const onExportPDF = async () => {
    if (!selected) return;

    const items = extractItems(selected);
    const customer =
      customersList.find((cx: any) => cx.id === (selected as any).customerId) ||
      (selected as any).customerSnapshot ||
      (selected as any).customer || {
        firstName: (selected as any).customerName,
        email: (selected as any).customerEmail,
        phone: (selected as any).customerPhone,
      };

    try {
      await exportQuotePDF({
        quote: {
          id: selected.id,
          number: displayQuoteNumber(selected, settings),
          dateISO: selected.createdAt || selected.dateISO || new Date().toISOString(),
          status: normaliseStatus(selected),
          items,
          subtotal: selected.subtotal ?? items.reduce((sum, it) => sum + it.total, 0),
          total: selected.total ?? selected.grandTotal ?? 0,
          notes:
            selected.notes ??
            selected.internalNotes ??
            selected.details?.notes ??
            "",
          currency: selected.currency || overviewCurrencyCode,
        },
        customer,
        settings: {
          companyName: settings.companyName,
          companyEmail: settings.companyEmail,
          companyPhone: settings.companyPhone,
          companyAddress: settings.companyAddress,
          logoDataUrl: (settings as any).companyLogoDataUrl,
          currencySymbol: overviewCurrencySymbol,
          currencyCode: overviewCurrencyCode,
          themeColor: settings.themeColor,
          bankDetails: (settings as any).bankDetails,
          taxNumber: (settings as any).taxNumber,
          quoteFooterNote: (settings as any).quoteFooterNote,
        },
      });
    } catch (err) {
      console.error("Failed to export quote PDF", err);
      alert("Could not generate quote PDF. See console for details.");
    }
  };

  const onDelete = () => {
    if (!selected) return;
    const id = safeRowId(selected);
    const ok = window.confirm(
      `Delete quote ${displayQuoteNumber(selected, settings)}?`
    );
    if (!ok) return;

    deleteQuoteFromStore(qStore, id);

    const idx = filtered.findIndex((r: any) => safeRowId(r) === id);
    const next = filtered[idx + 1] || filtered[idx - 1] || null;
    setSelectedId(next ? safeRowId(next) : null);
  };

  const companyName = settings.companyName || "Our workshop";

  const displayName = selected ? resolveCustomerName(selected, customersList) : "—";
  const email = selected ? resolveCustomerEmail(selected, customersList) : "";
  const phone = selected
    ? resolveCustomerPhone(selected, customersList) || settings.companyWhatsAppTo || ""
    : "";

  const notifyBody =
    `Hi ${displayName},%0D%0A%0D%0A` +
    `Please find your quote ${
      selected ? displayQuoteNumber(selected, settings) : ""
    }: ` +
    `${
      selected
        ? fmt(
            selected.total,
            selected.currency || overviewCurrencyCode,
            overviewCurrencySymbol
          )
        : ""
    }.%0D%0A%0D%0A` +
    `If you have any questions or would like to proceed, just reply to this email.%0D%0A%0D%0A` +
    `Best regards,%0D%0A${companyName}`;

  const whatsappText = safeDecode(notifyBody);

  /* ---------- STATUS CHIP METADATA ---------- */
  const statusSpec: {
    key: QuoteStatus;
    label: string;
    cls: string;
  }[] = [
    { key: "Draft", label: "Draft", cls: "bg-slate-100 text-slate-800 ring-slate-300" },
    { key: "Open", label: "Open", cls: "bg-slate-100 text-slate-800 ring-slate-300" },
    { key: "Sent", label: "Sent", cls: "bg-blue-100 text-blue-800 ring-blue-300" },
    { key: "Accepted", label: "Accepted", cls: "bg-green-100 text-green-800 ring-green-300" },
    { key: "Declined", label: "Declined", cls: "bg-rose-100 text-rose-800 ring-rose-300" },
    { key: "Expired", label: "Expired", cls: "bg-amber-100 text-amber-800 ring-amber-300" },
  ];

  const selStatus: QuoteStatus =
    (selected && (statusOverride[selected.id] ?? normaliseStatus(selected))) || "Draft";

  return (
    <div className="p-4 space-y-4">
      {/* ===== GLOBAL OVERVIEW ===== */}
      <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base md:text-lg font-semibold">Total Quote(s) status</h3>
          <span className="text-xs md:text-sm text-slate-500">
            {overview.count} quote{overview.count === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Total value</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
              {fmt(overview.totalValue, overviewCurrencyCode, overviewCurrencySymbol)}
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 bg-green-50 px-4 py-3">
            <div className="text-xs text-green-700">Accepted value</div>
            <div className="mt-0.5 text-xl font-semibold text-green-800 tabular-nums">
              {fmt(overview.acceptedValue, overviewCurrencyCode, overviewCurrencySymbol)}
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 bg-rose-50 px-4 py-3">
            <div className="text-xs text-rose-700">Declined value</div>
            <div className="mt-0.5 text-xl font-semibold text-rose-800 tabular-nums">
              {fmt(overview.declinedValue, overviewCurrencyCode, overviewCurrencySymbol)}
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Sent (not yet accepted)</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
              {overview.sentCount}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              {pct(overview.sentCount, overview.count)}%
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs text-slate-500 mb-1.5">Status breakdown</div>
          <div className="flex flex-wrap gap-1.5">
            {statusSpec.map(({ key, label, cls }) => {
              const count = overview.counts[key] ?? 0;
              const percent = pct(count, overview.count || 1);
              const dim = count === 0 ? "opacity-50" : "";
              return (
                <span
                  key={key}
                  className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs ring-1 ring-inset ${cls} ${dim}`}
                  title={`${label}: ${count} (${percent}%)`}
                >
                  <span className="font-medium">{label}</span>
                  <span className="tabular-nums">{count}</span>
                  <span className="text-[11px] tabular-nums">({percent}%)</span>
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== MAIN GRID ===== */}
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* LEFT: List + filters */}
        <aside className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Quotes</h2>
          </div>

          <div className="grid gap-2 mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer, email, number…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
            />

            <div className="flex flex-wrap gap-2 text-xs">
              {(["All", "Draft", "Open", "Sent", "Accepted", "Declined", "Expired"] as const).map(
                (sVal) => {
                  const active = statusFilter === sVal;
                  return (
                    <button
                      key={sVal}
                      type="button"
                      onClick={() => setStatusFilter(sVal)}
                      className={`rounded-full px-3 py-1 border transition ${
                        active
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {sVal}
                    </button>
                  );
                }
              )}
            </div>

            <div className="flex gap-2">
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as "date" | "total" | "customer")
                }
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value="date">Sort: Newest</option>
                <option value="total">Sort: Highest value</option>
                <option value="customer">Sort: Customer</option>
              </select>
            </div>
          </div>

          <div className="grid gap-2 max-h-[calc(100vh-270px)] overflow-auto pr-1">
            {filtered.map((row: any) => {
              const id = safeRowId(row);
              const isSelected = selected && safeRowId(selected) === id;
              const status = statusOverride[id] ?? normaliseStatus(row);
              const created = row.createdAt
                ? new Date(row.createdAt).toLocaleDateString()
                : "—";

              const statusCls =
                status === "Accepted"
                  ? "bg-green-100 text-green-800"
                  : status === "Declined"
                  ? "bg-rose-100 text-rose-800"
                  : status === "Sent"
                  ? "bg-blue-100 text-blue-800"
                  : status === "Expired"
                  ? "bg-amber-100 text-amber-800"
                  : status === "Open"
                  ? "bg-slate-100 text-slate-800"
                  : "bg-slate-100 text-slate-800";

              return (
                <button
                  key={id}
                  onClick={() => setSelectedId(id)}
                  className={`text-left rounded-xl border px-3 py-2 transition shadow-sm ${
                    isSelected
                      ? "border-slate-900 bg-slate-50"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium truncate">
                      {displayQuoteNumber(row, settings)}
                    </div>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full ${statusCls}`}
                    >
                      {status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {row.customerName ||
                      resolveCustomerName(row, customersList) ||
                      "No customer"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 flex justify-between">
                    <span>{created}</span>
                    <span className="tabular-nums">
                      {fmt(
                        row.total,
                        row.currency || overviewCurrencyCode,
                        overviewCurrencySymbol
                      )}
                    </span>
                  </div>
                </button>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-sm text-slate-500 py-6 text-center">
                No quotes match your filters.
              </div>
            )}
          </div>
        </aside>

        {/* RIGHT: Details pane */}
        <main className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 min-h-[60vh]">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4">
            <h2 className="text-lg font-semibold">Details</h2>
            {selected && (
              <div className="flex flex-col items-stretch md:items-end gap-1">
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    onClick={onExportPDF}
                    className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                  >
                    PDF
                  </button>
                  <button
                    onClick={() => markStatus("Sent")}
                    className="rounded-xl border border-blue-300 text-blue-700 px-3 py-1.5 text-sm hover:bg-blue-50"
                  >
                    Mark Sent
                  </button>
                  <button
                    onClick={() => markStatus("Accepted")}
                    className="rounded-xl border border-green-300 text-green-700 px-3 py-1.5 text-sm hover:bg-green-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => markStatus("Declined")}
                    className="rounded-xl border border-rose-300 text-rose-700 px-3 py-1.5 text-sm hover:bg-rose-50"
                  >
                    Decline
                  </button>
                  <button
                    onClick={onDelete}
                    className="rounded-xl border border-slate-300 text-slate-700 px-3 py-1.5 text-sm hover:bg-slate-50"
                    title="Delete quote"
                  >
                    Delete
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 text-right">
                  Tip: Use the “Send to customer” section below to email or WhatsApp this
                  quote.
                </p>
              </div>
            )}
          </div>

          {!selected ? (
            <div className="text-sm text-slate-500">Select a quote from the left.</div>
          ) : (
            <section className="grid gap-4">
              {/* Summary + customer + status */}
              <div className="grid md:grid-cols-3 gap-4">
                {/* Summary */}
                <div className="rounded-2xl ring-1 ring-slate-200 p-4 bg-slate-50">
                  <div className="text-sm font-medium mb-1">
                    Quote {displayQuoteNumber(selected, settings)}
                  </div>
                  <div className="text-xs text-slate-500">
                    Created:{" "}
                    {selected.createdAt
                      ? new Date(selected.createdAt).toLocaleString()
                      : "—"}
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Total:</span>
                      <span>
                        {fmt(
                          selected.total,
                          selected.currency || overviewCurrencyCode,
                          overviewCurrencySymbol
                        )}
                      </span>
                    </div>
                    {selected.subtotal != null && (
                      <div className="flex justify-between text-xs mt-0.5">
                        <span className="text-slate-500">Subtotal:</span>
                        <span>
                          {fmt(
                            selected.subtotal,
                            selected.currency || overviewCurrencyCode,
                            overviewCurrencySymbol
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Customer */}
                <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                  <div className="text-sm font-medium mb-1">Customer</div>
                  <div className="text-sm text-slate-800">
                    {resolveCustomerName(selected, customersList) || "No customer"}
                  </div>
                  {email && (
                    <div className="text-xs text-slate-600 mt-1">{email}</div>
                  )}
                  {phone && (
                    <div className="text-xs text-slate-600">{phone}</div>
                  )}
                </div>

                {/* Status */}
                <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                  <div className="text-sm font-medium mb-2">Status</div>
                  <div className="text-sm text-slate-700 space-y-0.5">
                    <div>
                      <span className="text-slate-500">State:</span> {selStatus}
                    </div>
                    <div>
                      <span className="text-slate-500">Created:</span>{" "}
                      {selected?.createdAt
                        ? new Date(selected.createdAt).toLocaleString()
                        : "—"}
                    </div>
                    {selected?.sentAt && (
                      <div>
                        <span className="text-slate-500">Sent:</span>{" "}
                        {new Date(selected.sentAt).toLocaleString()}
                      </div>
                    )}
                    {selected?.acceptedAt && (
                      <div>
                        <span className="text-slate-500">Accepted:</span>{" "}
                        {new Date(selected.acceptedAt).toLocaleString()}
                      </div>
                    )}
                    {selected?.declinedAt && (
                      <div>
                        <span className="text-slate-500">Declined:</span>{" "}
                        {new Date(selected.declinedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Items */}
              <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                <div className="text-sm font-medium mb-2">Items</div>
                {selectedItems.length > 0 ? (
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="py-1 pr-2">Item</th>
                          <th className="py-1 pr-2">Qty</th>
                          <th className="py-1 pr-2">Unit</th>
                          <th className="py-1 pr-2 text-right">Line</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedItems.map((it, idx) => (
                          <tr
                            key={idx}
                            className="border-t border-slate-100"
                          >
                            <td className="py-1 pr-2">{it.name}</td>
                            <td className="py-1 pr-2 tabular-nums">{it.qty}</td>
                            <td className="py-1 pr-2 tabular-nums">
                              {fmt(
                                it.unitPrice,
                                selected.currency || overviewCurrencyCode,
                                overviewCurrencySymbol
                              )}
                            </td>
                            <td className="py-1 pr-2 text-right tabular-nums">
                              {fmt(
                                it.total,
                                selected.currency || overviewCurrencyCode,
                                overviewCurrencySymbol
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">No line items found.</div>
                )}
              </div>

              {/* Notify */}
              <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Send to customer</div>
                  <div className="text-xs text-slate-500">
                    Uses customer contact or company fallback (Admin → Settings).
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={
                      email
                        ? buildMailto(
                            email,
                            `Your quote ${displayQuoteNumber(selected, settings)}`,
                            decodeURIComponent(notifyBody)
                          )
                        : "#"
                    }
                    onClick={(e) => {
                      if (!email) e.preventDefault();
                    }}
                    className={`rounded-xl px-3 py-1.5 text-sm border ${
                      email
                        ? "border-transparent bg-slate-900 text-white hover:bg-slate-800"
                        : "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
                    }`}
                  >
                    Send email
                  </a>
                  <a
                    href={phone ? buildWhatsAppLink(phone, whatsappText) : "#"}
                    onClick={(e) => {
                      if (!phone) e.preventDefault();
                    }}
                    className={`rounded-xl px-3 py-1.5 text-sm border ${
                      phone
                        ? "border-transparent bg-emerald-500 text-white hover:bg-emerald-600"
                        : "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
                    }`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp
                  </a>
                </div>
              </div>

              {debug && (
                <div className="rounded-2xl ring-1 ring-slate-200 p-4 bg-slate-50">
                  <div className="font-medium text-sm mb-2">Debug</div>
                  <pre className="text-xs overflow-auto max-h-64">
                    {JSON.stringify(
                      {
                        storeQuotes: storeQuotes.length,
                        filtered: filtered.length,
                        selectedId,
                        selectedNormalised: selected && {
                          id: selected.id,
                          number: displayQuoteNumber(selected, settings),
                          status: selStatus,
                          customerName: resolveCustomerName(selected, customersList),
                          total: selected.total,
                          currency: selected.currency || overviewCurrencyCode,
                        },
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
