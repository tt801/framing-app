// src/pages/Invoices.tsx
import React, { useMemo, useState } from "react";
import { useInvoices } from "@/lib/invoices";
import { useCustomers } from "@/lib/customers";
import { useCatalog } from "@/lib/store";
import { useToast } from "@/lib/toast";
import { useHistory } from "@/lib/history";
import StatusBadge from "@/components/StatusBadge";

// Optional PDF export
let exportInvoicePDF: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  exportInvoicePDF = require("@/lib/pdf/invoicePdf")?.exportInvoicePDF;
} catch {
  /* optional */
}

type Invoice = any;

/* ---------------- Currency helpers ---------------- */
const symbolFor = (code?: string) => {
  const m: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    ZAR: "R ",
    AUD: "A$",
    CAD: "C$",
    NZD: "NZ$",
    JPY: "¥",
    CHF: "CHF ",
    SEK: "kr",
    NOK: "kr",
    DKK: "kr",
    INR: "₹",
    CNY: "¥",
    HKD: "HK$",
  };
  return code ? m[code.toUpperCase()] : undefined;
};

const formatMoney = (
  n: number | undefined,
  code?: string,
  symbol?: string
) => {
  const v = Number(n ?? 0);
  if (code) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
      }).format(v);
    } catch {
      /* fall back */
    }
  }
  const s = symbol ?? symbolFor(code) ?? "";
  return `${s}${v.toFixed(2)}`;
};

/* ---------------- Small helpers ---------------- */
const firstNonEmpty = (...vals: any[]) =>
  vals.find((v) => v != null && v !== "") ?? undefined;

const n = (x: any, d = 0) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : d;
};

const mailto = (email: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;

const buildWhatsAppLink = (phoneE164: string, text: string) =>
  `https://wa.me/${encodeURIComponent(
    phoneE164.replace(/\D/g, "")
  )}?text=${encodeURIComponent(text)}`;

/* ---------------- Customer helpers ---------------- */
const resolveCustomerName = (row: any, customersList: any[] | undefined) => {
  const fromId =
    row?.customerId && customersList
      ? customersList.find((x: any) => x.id === row.customerId)
      : undefined;
  if (fromId) {
    const full = `${(fromId as any).firstName ?? ""} ${
      (fromId as any).lastName ?? ""
    }`.trim();
    return (
      full ||
      (fromId as any).company ||
      (fromId as any).email ||
      (fromId as any).name ||
      (fromId as any).id ||
      "—"
    );
  }
  return (
    row?.customerName ??
    row?.customer ??
    row?.details?.customer?.name ??
    "—"
  );
};

const resolveCustomerEmail = (row: any, customersList: any[] | undefined) => {
  const fromId =
    row?.customerId && customersList
      ? customersList.find((x: any) => x.id === row.customerId)?.email
      : undefined;
  return fromId ?? row?.customerEmail ?? row?.details?.customer?.email ?? "";
};

const resolveCustomerPhone = (row: any, customersList: any[] | undefined) => {
  const fromId =
    row?.customerId && customersList
      ? customersList.find((x: any) => x.id === row.customerId)?.phone
      : undefined;
  return fromId ?? row?.customerPhone ?? row?.details?.customer?.phone ?? "";
};

/* ---------------- Items normaliser ---------------- */
const pickArray = (v: any): any[] | null => (Array.isArray(v) ? v : null);

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
    firstNonEmpty(
      raw?.unitPrice,
      raw?.price,
      raw?.unit_price,
      raw?.rate,
      raw?.amountEach
    ),
    0
  );
  const total = n(
    firstNonEmpty(raw?.total, raw?.line_total, raw?.amount, qty * unitPrice),
    qty * unitPrice
  );
  return { name: String(name), qty, unitPrice, total };
};

const extractItems = (
  row: any
): Array<{ name: string; qty: number; unitPrice: number; total: number }> => {
  const candidates: Array<any[] | null> = [
    pickArray(row?.items),
    pickArray(row?.lines),
    pickArray(row?.lineItems),
    pickArray(row?.details?.items),
    pickArray(row?.details?.lineItems),
  ];
  const arr = candidates.find((a) => Array.isArray(a) && a.length > 0) ?? [];
  return (arr as any[]).map(coerceItem);
};

/* ---------------- Delete helpers ---------------- */
const safeRowId = (row: any) => String(row?.id ?? row?.number ?? "");

const removeInvoiceFromStore = (invStore: any, id: string) => {
  if (typeof invStore?.deleteInvoice === "function") {
    invStore.deleteInvoice(id);
    return true;
  }
  if (typeof invStore?.removeInvoice === "function") {
    invStore.removeInvoice(id);
    return true;
  }
  if (typeof invStore?.delete === "function") {
    invStore.delete(id);
    return true;
  }
  if (typeof invStore?.remove === "function") {
    invStore.remove(id);
    return true;
  }
  if (typeof invStore?.setInvoices === "function") {
    invStore.setInvoices((rows: any[]) =>
      rows.filter((r) => safeRowId(r) !== id)
    );
    return true;
  }
  if (typeof invStore?.setItems === "function") {
    invStore.setItems((rows: any[]) =>
      rows.filter((r) => safeRowId(r) !== id)
    );
    return true;
  }
  console.warn("No delete function available for invoices store");
  return false;
};

/* ---------------- QuickBooks helper (badge only) ---------------- */
const isInvoiceSyncedToQuickBooks = (row: any) => {
  const qbMeta = row?.integrations?.quickbooks;
  return !!qbMeta?.remoteId;
};

/* =======================================================================
   PAGE
   ======================================================================= */
export default function InvoicesPage() {
  const inv = useInvoices() as any;
  const c = useCustomers() as any;
  const { add: toast } = useToast();
  const { add: addToHistory, canUndo, undo } = useHistory();
  const { catalog } = useCatalog() as any;

  // Listen for global "New invoice" event from header
  React.useEffect(() => {
    const onGlobalNew = (event: Event) => {
      const detail = (event as CustomEvent).detail as { type?: string };
      if (detail?.type === "invoice") {
        // Create a new blank invoice with editable fields
        const settings = catalog?.settings || {};
        const currencyCode: string | undefined =
          settings.currencyCode ||
          (typeof settings.currency === "string"
            ? settings.currency
            : undefined) ||
          "ZAR";

        const currencySymbol: string | undefined =
          settings.currencySymbol ||
          (typeof settings.currency === "object"
            ? settings.currency?.symbol
            : undefined) ||
          "$";

        // Normalize taxRate: if > 1, assume it's a percentage (convert to decimal)
        const rawTaxRate = settings?.taxRate ?? 0;
        const normalizedTaxRate = rawTaxRate > 1 ? rawTaxRate / 100 : rawTaxRate;

        const newInvoice = {
          id: Math.random().toString(36).slice(2, 9),
          status: "Draft",
          number: `INV-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          customerId: "",
          customerName: "",
          customerEmail: "",
          customerPhone: "",
          createdAt: new Date().toISOString(),
          dueDateISO: "",
          subtotal: 0,
          taxRate: normalizedTaxRate,
          tax: 0,
          total: 0,
          items: [],
          notes: "",
          payments: [],
          currency: {
            code: currencyCode,
            symbol: currencySymbol,
          },
          currencyCode,
          currencySymbol,
          details: {
            costs: {
              subtotal: 0,
              taxRate: normalizedTaxRate,
              tax: 0,
              total: 0,
              currency: { code: currencyCode, symbol: currencySymbol },
            },
          },
        };
        if (typeof (inv as any).addInvoice === "function") {
          (inv as any).addInvoice(newInvoice);
        } else if (typeof (inv as any).add === "function") {
          (inv as any).add(newInvoice);
        } else if (typeof (inv as any).setInvoices === "function") {
          (inv as any).setInvoices((rows: any[]) => [...rows, newInvoice]);
        }
        // Auto-select the new invoice
        setSelectedId(newInvoice.id);
        toast("New invoice created. Fill in customer details and pricing.", "success");
      }
    };

    window.addEventListener("frameapp:new", onGlobalNew as EventListener);
    return () => window.removeEventListener("frameapp:new", onGlobalNew as EventListener);
  }, [inv, toast, catalog]);

  // 🔑 Match Customers / Quotes: useCatalog returns an object with { catalog }
  const settings = catalog?.settings || {};

  const currencyCode: string | undefined =
    settings.currencyCode ||
    (typeof settings.currency === "string"
      ? settings.currency
      : undefined) ||
    "ZAR";

  const currencySymbol: string | undefined =
    settings.currencySymbol ||
    (typeof settings.currency === "object"
      ? settings.currency?.symbol
      : undefined) ||
    symbolFor(currencyCode);

  const money = (n: number | undefined) =>
    formatMoney(n, currencyCode, currencySymbol);

  const integrations = settings.integrations || {};
  const qbConfig = integrations.quickbooks || {};
  const quickBooksConnected =
    !!qbConfig.enabled &&
    !!qbConfig.realmId &&
    !!qbConfig.clientId &&
    !!qbConfig.connectionStatus &&
    qbConfig.connectionStatus !== "disconnected";

  const allInvoices: Invoice[] = (inv?.invoices ?? inv?.items ?? []) as Invoice[];
  const saveInvoice =
    inv?.saveInvoice ||
    inv?.updateInvoice ||
    inv?.setInvoice ||
    (inv?.setInvoices
      ? (id: string, patch: any) => {
          inv.setInvoices((rows: any[]) =>
            rows.map((row: any) => {
              const rowId = safeRowId(row);
              if (rowId !== id && row?.id !== id) return row;

              const merged = { ...row, ...patch };
              const items = Array.isArray(patch?.items)
                ? patch.items
                : row?.items;

              // Recalculate money fields when items or taxRate change
              if (items || patch?.taxRate !== undefined) {
                const taxRate = n(
                  firstNonEmpty(
                    patch?.taxRate,
                    merged.taxRate,
                    merged.details?.costs?.taxRate,
                    0
                  ),
                  0
                );

                const subtotal = Array.isArray(items)
                  ? items.reduce(
                      (sum: number, it: any) =>
                        sum + (Number(it?.qty) || 0) * (Number(it?.unitPrice) || 0),
                      0
                    )
                  : n(firstNonEmpty(patch?.subtotal, merged.subtotal), 0);

                const tax = subtotal * taxRate;
                const total = subtotal + tax;

                merged.items = items;
                merged.taxRate = taxRate;
                merged.subtotal = subtotal;
                merged.tax = tax;
                merged.total = total;
                merged.details = {
                  ...(merged.details || {}),
                  costs: {
                    ...(merged.details?.costs || {}),
                    subtotal,
                    taxRate,
                    tax,
                    total,
                    currency:
                      merged.details?.costs?.currency ||
                      merged.currency ||
                      merged.currencyCode ||
                      undefined,
                  },
                };
              }

              return merged;
            })
          );
        }
      : (id: string, patch: any) =>
          console.warn("No save function in useInvoices()", { id, patch }));

  const customersList = c?.customers ?? c?.items ?? [];

  const isDebug =
    typeof window !== "undefined" &&
    window.location.search.includes("debug=1");

  const FILTER_KEY = "invoices.filters.v1";

  // UI state
  const [selectedId, setSelectedId] = useState<string | null>(
    allInvoices?.[0]?.id ?? null
  );
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<null | string>(null);
  const [sortKey, setSortKey] = useState<"newest" | "oldest" | "amount">(
    "newest"
  );
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>(
    {}
  );
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  // Persist filters per page
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.search === "string") {
        setSearchInput(parsed.search);
        setSearchTerm(parsed.search);
      }
      if (parsed.statusFilter === null || typeof parsed.statusFilter === "string") {
        setStatusFilter(parsed.statusFilter ?? null);
      }
      if (
        parsed.sortKey === "newest" ||
        parsed.sortKey === "oldest" ||
        parsed.sortKey === "amount"
      ) {
        setSortKey(parsed.sortKey);
      }
    } catch (e) {
      console.warn("Failed to read invoice filters from storage", e);
    }
  }, []);

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
    }, 200);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        FILTER_KEY,
        JSON.stringify({ search: searchInput, statusFilter, sortKey })
      );
    } catch (e) {
      console.warn("Failed to persist invoice filters", e);
    }
  }, [searchInput, statusFilter, sortKey]);

  /* ---------- Filters / selection ---------- */
  const filtered = useMemo(() => {
    let rows = [...(allInvoices ?? [])];

    if (searchTerm.trim()) {
      const sLower = searchTerm.toLowerCase();
      rows = rows.filter((r: any) => {
        const customerName = resolveCustomerName(r, customersList);
        const idText = String(r?.id ?? r?.number ?? "");
        return (
          customerName.toLowerCase().includes(sLower) ||
          idText.toLowerCase().includes(sLower)
        );
      });
    }

    if (statusFilter) {
      rows = rows.filter((r: any) => {
        const effectiveStatus =
          statusOverride[r.id] ?? (r?.status ?? "Draft");
        return effectiveStatus === statusFilter;
      });
    }

    switch (sortKey) {
      case "oldest":
        rows.sort(
          (a: any, b: any) =>
            new Date(a?.createdAt ?? 0).getTime() -
            new Date(b?.createdAt ?? 0).getTime()
        );
        break;
      case "amount":
        rows.sort(
          (a: any, b: any) =>
            Number(b?.total ?? 0) - Number(a?.total ?? 0)
        );
        break;
      default:
        rows.sort(
          (a: any, b: any) =>
            new Date(b?.createdAt ?? 0).getTime() -
            new Date(a?.createdAt ?? 0).getTime()
        );
    }

    return rows;
  }, [allInvoices, customersList, searchTerm, statusFilter, sortKey, statusOverride]);

  const statusCounts = useMemo(() => {
    const base: Record<string, number> = {
      All: allInvoices?.length ?? 0,
      Draft: 0,
      Sent: 0,
      Paid: 0,
      Overdue: 0,
      Void: 0,
    };

    (allInvoices ?? []).forEach((row: any) => {
      const st = (statusOverride[row.id] ?? row?.status ?? "Draft") as string;
      base[st] = (base[st] ?? 0) + 1;
    });

    return base;
  }, [allInvoices, statusOverride]);

  const selected = useMemo(
    () => filtered.find((x: any) => x.id === selectedId) ?? filtered[0],
    [filtered, selectedId]
  );

  const displayName = selected
    ? resolveCustomerName(selected, customersList)
    : "—";
  const email = selected ? resolveCustomerEmail(selected, customersList) : "";
  const phone = selected ? resolveCustomerPhone(selected, customersList) : "";

  /* ---------- Overview (drives top tiles) ---------- */
  const overview = useMemo(() => {
    const counts: Record<string, number> = {
      Draft: 0,
      Sent: 0,
      Paid: 0,
      Overdue: 0,
      Void: 0,
    };
    let total = 0;
    let paid = 0;
    let outstandingOver90 = 0;

    const now = Date.now();
    const ms90 = 90 * 24 * 60 * 60 * 1000;

    filtered.forEach((row: any) => {
      const st = (statusOverride[row.id] ?? row?.status ?? "Draft") as string;
      counts[st] = (counts[st] ?? 0) + 1;

      const invoiceTotal = Number(row?.total ?? 0);

      let invoicePaid = 0;
      if (st === "Paid") {
        invoicePaid = invoiceTotal;
      } else if (Array.isArray(row?.payments)) {
        invoicePaid = row.payments.reduce(
          (s: number, p: any) => s + Number(p?.amount ?? 0),
          0
        );
      }

      const invoiceOutstanding = Math.max(0, invoiceTotal - invoicePaid);

      total += invoiceTotal;
      paid += invoicePaid;

      if (invoiceOutstanding > 0) {
        const dueSource =
          row?.dueDateISO ??
          row?.dueDate ??
          row?.due ??
          row?.invoiceDueDate ??
          row?.createdAt;
        if (dueSource) {
          const t = new Date(dueSource).getTime();
          if (!isNaN(t) && now - t > ms90) {
            outstandingOver90 += invoiceOutstanding;
          }
        }
      }
    });

    const balance = total - paid;

    return {
      count: filtered.length,
      counts,
      total,
      paid,
      balance,
      outstandingOver90,
    };
  }, [filtered, statusOverride]);

  const selStatus =
    (selected && (statusOverride[selected.id] ?? selected.status)) ||
    "Draft";

  const companyName = settings.companyName || "Our workshop";

  const notifySubject = selected
    ? `Invoice ${selected.number ?? selected.id ?? ""} from ${companyName}`
    : `Invoice from ${companyName}`;

  const notifyBody = selected
    ? `Hi ${displayName},

Your invoice ${
        selected.number ?? selected.id ?? ""
      } is ${money(selected.total)}.

Thank you.
— ${companyName}`
    : `Hi,

Please find your invoice attached.

Thank you.
— ${companyName}`;

  const whatsappText = selected
    ? `Hi ${displayName}, your invoice ${
        selected.number ?? selected.id ?? ""
      } is ${money(selected.total)}. Reply here with any questions. — ${companyName}`
    : `Hi, please see your invoice. — ${companyName}`;

  /* ---------- Overview chips ---------- */
  const pct = (val: number, denom: number) =>
    denom > 0 ? Math.round((val / denom) * 100) : 0;

  const statusSpec: Array<{
    key: "Draft" | "Sent" | "Paid" | "Overdue" | "Void";
    label: string;
    cls: string;
  }> = [
    {
      key: "Draft",
      label: "Draft",
      cls: "bg-slate-100 text-slate-800 ring-slate-300",
    },
    {
      key: "Sent",
      label: "Sent",
      cls: "bg-blue-100 text-blue-800 ring-blue-300",
    },
    {
      key: "Paid",
      label: "Paid",
      cls: "bg-green-100 text-green-800 ring-green-300",
    },
    {
      key: "Overdue",
      label: "Overdue",
      cls: "bg-amber-100 text-amber-800 ring-amber-300",
    },
    {
      key: "Void",
      label: "Void",
      cls: "bg-rose-100 text-rose-800 ring-rose-300",
    },
  ];

  /* ---------- Items for selected invoice ---------- */
  const selectedItems = useMemo(
    () => extractItems(selected),
    [selected]
  );

  /* ---------- Actions ---------- */
  const markStatus = (
    status: "Draft" | "Sent" | "Paid" | "Overdue" | "Void"
  ) => {
    if (!selected) return;

    const id = selected.id;
    const patch: any = { status };
    const now = new Date().toISOString();

    if (status === "Paid") {
      const existingPayments = Array.isArray(selected.payments)
        ? selected.payments
        : [];
      const alreadyPaid = existingPayments.reduce(
        (s: number, p: any) => s + Number(p?.amount ?? 0),
        0
      );
      const total = Number(selected.total ?? 0);
      const remaining = Math.max(0, total - alreadyPaid);

      patch.paidAt = now;
      if (remaining > 0) {
        patch.payments = [
          ...existingPayments,
          {
            id: `p_${Date.now()}`,
            amount: remaining,
            method: "Manual",
            createdAt: now,
          },
        ];
      }
    }

    if (status === "Sent") {
      patch.sentAt = now;
    }
    if (status === "Overdue") {
      patch.overdueAt = now;
    }
    if (status === "Void") {
      patch.voidAt = now;
    }

    setStatusOverride((m) => ({ ...m, [id]: status }));
    saveInvoice(id, patch);
  };

  const onExportPDF = async () => {
    if (!selected) return;
    if (!exportInvoicePDF) {
      console.warn(
        "exportInvoicePDF not found. Add '@/lib/pdf/invoicePdf'."
      );
      return;
    }
    try {
      const customer = customersList.find(
        (x: any) => x.id === selected.customerId
      );
      await exportInvoicePDF({ invoice: selected, customer, settings });
    } catch (err) {
      console.error("exportInvoicePDF failed:", err);
      toast("Could not generate invoice PDF. See console for details.", "error");
    }
  };

  const onDelete = () => {
    if (!selected) return;
    const id = safeRowId(selected);
    const invoiceNumber = selected?.number || id;

    setConfirmModal({
      isOpen: true,
      title: "Delete Invoice",
      message: `Are you sure you want to delete invoice ${invoiceNumber}?`,
      onCancel: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        performDeleteInvoice(id, selected, invoiceNumber);
      },
    });
  };

  const performDeleteInvoice = (id: string, invoice: any, invoiceNumber: string) => {
    const did = removeInvoiceFromStore(inv, id);

    const idx = filtered.findIndex((r: any) => safeRowId(r) === id);
    const next = filtered[idx + 1] || filtered[idx - 1] || null;
    setSelectedId(next ? safeRowId(next) : null);

    if (!did) {
      try {
        if (typeof inv?.setInvoices === "function") {
          inv.setInvoices((rows: any[]) =>
            rows.filter((r) => safeRowId(r) !== id)
          );
        }
      } catch (e) {
        console.warn("Local delete fallback failed:", e);
      }
    }

    const backup = invoice;
    addToHistory({
      id: `delete-invoice-${id}`,
      name: `Delete invoice ${invoiceNumber}`,
      undo: () => {
        if (!backup) return;
        if (typeof (inv as any).addInvoice === "function") {
          (inv as any).addInvoice(backup);
        } else if (typeof (inv as any).createInvoice === "function") {
          (inv as any).createInvoice(backup);
        } else if (typeof (inv as any).add === "function") {
          (inv as any).add(backup);
        } else if (typeof (inv as any).setInvoices === "function") {
          (inv as any).setInvoices((rows: any[]) => [...rows, backup]);
        }
      },
      redo: () => {
        removeInvoiceFromStore(inv, id);
      },
      timestamp: Date.now(),
    });

    toast("Invoice deleted successfully", "success");
  };

  /* ===================================================================
     RENDER
     =================================================================== */
  return (
    <div className="p-6 space-y-6">
      <header className="pb-6 border-b border-slate-200">
        <h1 className="text-3xl font-bold text-slate-900 mb-1">🧾 Invoices</h1>
        <p className="text-sm text-slate-600">
          Track outstanding balances, payments, and invoice status at a glance.
        </p>
      </header>
      {/* UNDO BAR */}
      {canUndo() && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-xs font-medium text-blue-900">Last action:</span>
          <button
            onClick={undo}
            className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition"
          >
            ↶ Undo
          </button>
        </div>
      )}

      {/* ===== GLOBAL OVERVIEW ===== */}
      <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base md:text-lg font-semibold">
            Total Invoice(s) status
          </h3>
          <span className="text-xs md:text-sm text-slate-500">
            {overview.count} invoice
            {overview.count === 1 ? "" : "s"} (filtered)
          </span>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Total amount</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
              {money(overview.total)}
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 bg-green-50 px-4 py-3">
            <div className="text-xs text-green-700">Paid to date</div>
            <div className="mt-0.5 text-xl font-semibold text-green-800 tabular-nums">
              {money(overview.paid)}
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-green-100 overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{
                  width: `${pct(
                    overview.paid,
                    Math.max(overview.total, 1)
                  )}%`,
                }}
              />
            </div>
            <div className="text-[11px] text-green-700 mt-0.5 tabular-nums">
              {pct(overview.paid, Math.max(overview.total, 1))}% paid
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 bg-amber-50 px-4 py-3">
            <div className="text-xs text-amber-700">Balance due</div>
            <div className="mt-0.5 text-xl font-semibold text-amber-800 tabular-nums">
              {money(overview.balance)}
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 bg-rose-50 px-4 py-3">
            <div className="text-xs text-rose-700">
              Outstanding &gt; 90 days
            </div>
            <div className="mt-0.5 text-xl font-semibold text-rose-800 tabular-nums">
              {money(overview.outstandingOver90)}
            </div>
          </div>
        </div>

        {/* Status breakdown chips */}
        <div className="mt-4">
          <div className="text-xs text-slate-500 mb-1.5">
            Status breakdown
          </div>
          <div className="flex flex-wrap gap-1.5">
            {statusSpec.map(({ key, label, cls }) => {
              const count = overview.counts[key] ?? 0;
              const percent = pct(count, overview.count);
              const dim = count === 0 ? "opacity-50" : "";
              return (
                <span
                  key={key}
                  className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs ring-1 ring-inset ${cls} ${dim}`}
                  title={`${label}: ${count} (${percent}%)`}
                >
                  <span className="font-medium">{label}</span>
                  <span className="tabular-nums">{count}</span>
                  <span className="text-[11px] tabular-nums">
                    ({percent}%)
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== MAIN GRID ===== */}
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* LEFT: list + filters */}
        <aside className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Invoices</h2>
            <span className="text-xs text-slate-500">
              {filtered.length} total
            </span>
          </div>

          <div className="relative max-h-[calc(100vh-270px)] overflow-auto pr-1 space-y-2">
            <div className="sticky top-0 z-10 bg-white pb-2 space-y-2">
              <div className="relative">
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by customer, invoice no, id..."
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

              <div className="flex flex-wrap gap-1.5 text-xs">
                {[null, "Draft", "Sent", "Paid", "Overdue", "Void"].map((key) => {
                  const isActive = statusFilter === key;
                  const count =
                    key === null
                      ? statusCounts.All
                      : statusCounts[key] ?? 0;
                  const label = key === null ? "All" : key;
                  const base =
                    "rounded-full px-3 py-1.5 border transition flex items-center gap-1";
                  const activeCls =
                    "bg-slate-900 text-white border-slate-900";
                  const idleCls =
                    "bg-white text-slate-700 border-slate-300 hover:bg-slate-50";
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setStatusFilter(key)}
                      className={`${base} ${isActive ? activeCls : idleCls}`}
                    >
                      <span>{label}</span>
                      <span className="tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <select
                  value={sortKey}
                  onChange={(e) =>
                    setSortKey(e.target.value as any)
                  }
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
                  title="Sort"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="amount">Amount</option>
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              {filtered.map((row: any) => {
                const cName = resolveCustomerName(row, customersList);
                const amount = money(row?.total);
                const isSelected = (selected?.id ?? selectedId) === row.id;
                const st =
                  statusOverride[row.id] ?? (row?.status ?? "Draft");
                const synced = isInvoiceSyncedToQuickBooks(row);

                return (
                  <button
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={`text-left rounded-lg border px-3 py-2.5 transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-50 shadow-sm"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                    title={`View ${row.number ?? row.id ?? ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium truncate">
                        {cName || "No customer"}
                      </div>
                      <div className="flex items-center gap-1">
                        {synced && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            QB
                          </span>
                        )}
                        <StatusBadge status={st} />
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex justify-between gap-2">
                      <span className="tabular-nums">{amount}</span>
                      <span className="text-slate-400">#{row.number ?? row.id ?? "—"}</span>
                    </div>
                  </button>
                );
              })}

              {filtered.length === 0 && (
                <div className="text-sm text-slate-500 py-6 text-center">
                  No invoices match your filters.
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* RIGHT: details */}
        <main className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 min-h-[60vh]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Details</h2>
          </div>

          {!selected ? (
            <div className="text-sm text-slate-500">
              Select an invoice from the left.
            </div>
          ) : (
            <section className="grid gap-4">
              {/* Top summary */}
              <div
                className={`rounded-2xl ring-1 p-4 ${
                  selStatus === "Paid"
                    ? "ring-green-200 bg-green-50"
                    : selStatus === "Overdue"
                    ? "ring-amber-200 bg-amber-50"
                    : selStatus === "Void"
                    ? "ring-rose-200 bg-rose-50"
                    : selStatus === "Sent"
                    ? "ring-blue-200 bg-blue-50"
                    : "ring-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <div className="font-medium">{displayName}</div>
                    <div className="text-slate-600">
                      Invoice: {selected.number ?? selected.id ?? "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">
                      Total
                    </div>
                    <div className="text-lg font-semibold">
                      {money(selected?.total)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Customer / Status cards */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                  <div className="text-sm font-medium mb-2">
                    Customer
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <label className="text-slate-500 block mb-1">Search & select customer:</label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Type name or email..."
                          list="customer-list"
                          onChange={(e) => {
                            const needle = e.target.value.toLowerCase();
                            if (needle.length > 2) {
                              const found = customersList.find((c: any) =>
                                [c.firstName, c.lastName, c.email, c.company]
                                  .join(" ")
                                  .toLowerCase()
                                  .includes(needle)
                              );
                              if (found) {
                                saveInvoice(selected.id, {
                                  customerId: found.id,
                                  customerName: `${found.firstName || ""} ${found.lastName || ""}`.trim() || found.company,
                                  customerEmail: found.email,
                                  customerPhone: found.phone,
                                });
                                e.target.value = "";
                              }
                            }
                          }}
                          onInput={(e) => {
                            const needle = (e.currentTarget as any).value.toLowerCase();
                            if (needle.length > 0) {
                              const matches = customersList.filter((c: any) =>
                                [c.firstName, c.lastName, c.email, c.company]
                                  .join(" ")
                                  .toLowerCase()
                                  .includes(needle)
                              );
                              if (matches.length === 0 && needle.length > 2) {
                                console.log("No customer found - user would need to create new");
                              }
                            }
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        />
                        <datalist id="customer-list">
                          {customersList.map((c: any) => (
                            <option key={c.id} value={`${c.firstName} ${c.lastName}`.trim() || c.company || c.email} />
                          ))}
                        </datalist>
                      </div>
                      {!selected?.customerId && (
                        <div className="text-xs text-slate-500 mt-1">
                          No customer selected. Type to search or <button type="button" onClick={() => {}} className="underline hover:text-slate-700">create a new one</button>.
                        </div>
                      )}
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Name"
                        value={selected?.customerName || ""}
                        onChange={(e) =>
                          saveInvoice(selected.id, {
                            customerName: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                    <div>
                      <input
                        type="email"
                        placeholder="Email"
                        value={selected?.customerEmail || ""}
                        onChange={(e) =>
                          saveInvoice(selected.id, {
                            customerEmail: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                    <div>
                      <input
                        type="tel"
                        placeholder="Phone"
                        value={selected?.customerPhone || ""}
                        onChange={(e) =>
                          saveInvoice(selected.id, {
                            customerPhone: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                  <div className="text-sm font-medium mb-2">
                    Status
                  </div>
                  <div className="text-sm text-slate-700 space-y-0.5">
                    <div>
                      <span className="text-slate-500">State:</span>{" "}
                      {selStatus}
                    </div>
                    <div>
                      <span className="text-slate-500">
                        Created:
                      </span>{" "}
                      {selected?.createdAt
                        ? new Date(
                            selected.createdAt
                          ).toLocaleString()
                        : "—"}
                    </div>
                    {selected?.sentAt && (
                      <div>
                        <span className="text-slate-500">
                          Sent:
                        </span>{" "}
                        {new Date(
                          selected.sentAt
                        ).toLocaleString()}
                      </div>
                    )}
                    {selected?.paidAt && (
                      <div>
                        <span className="text-slate-500">
                          Paid:
                        </span>{" "}
                        {new Date(
                          selected.paidAt
                        ).toLocaleString()}
                      </div>
                    )}
                    {selected?.overdueAt && (
                      <div>
                        <span className="text-slate-500">
                          Overdue:
                        </span>{" "}
                        {new Date(
                          selected.overdueAt
                        ).toLocaleString()}
                      </div>
                    )}
                    {selected?.voidAt && (
                      <div>
                        <span className="text-slate-500">
                          Void:
                        </span>{" "}
                        {new Date(
                          selected.voidAt
                        ).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Items */}
              <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                <div className="text-sm font-medium mb-2">Line Items</div>
                <div className="space-y-2 mb-3">
                  {Array.isArray(selected?.items) && selected.items.length > 0 ? (
                    selected.items.map((it: any, idx: number) => (
                      <div key={idx} className="grid grid-cols-4 gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Item name"
                          value={it.name || ""}
                          onChange={(e) => {
                            const newItems = [...(selected?.items || [])];
                            newItems[idx] = { ...newItems[idx], name: e.target.value };
                            saveInvoice(selected.id, { items: newItems });
                          }}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        />
                        <input
                          type="number"
                          placeholder="Qty"
                          value={it.qty || 0}
                          onChange={(e) => {
                            const newItems = [...(selected?.items || [])];
                            const qty = Number(e.target.value) || 0;
                            const unitPrice = newItems[idx].unitPrice || 0;
                            newItems[idx] = { ...newItems[idx], qty, total: qty * unitPrice };
                            saveInvoice(selected.id, { items: newItems });
                          }}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        />
                        <input
                          type="number"
                          placeholder="Unit price"
                          value={it.unitPrice || 0}
                          onChange={(e) => {
                            const newItems = [...(selected?.items || [])];
                            const unitPrice = Number(e.target.value) || 0;
                            const qty = newItems[idx].qty || 0;
                            newItems[idx] = { ...newItems[idx], unitPrice, total: qty * unitPrice };
                            saveInvoice(selected.id, { items: newItems });
                          }}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        />
                        <div className="text-right font-medium">
                          {money((it.total || 0))}
                          <button
                            type="button"
                            onClick={() => {
                              const newItems = (selected?.items || []).filter((_, i: number) => i !== idx);
                              saveInvoice(selected.id, { items: newItems });
                            }}
                            className="block text-xs text-red-600 hover:text-red-800 mt-1"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-500">No line items.</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newItems = Array.isArray(selected?.items) ? [...selected.items] : [];
                    newItems.push({ name: "", qty: 1, unitPrice: 0, total: 0 });
                    saveInvoice(selected.id, { items: newItems });
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  + Add line item
                </button>
              </div>

              {/* Actions */}
              {selected && (
                <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-medium">Actions</div>
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
                        onClick={() => markStatus("Paid")}
                        className="rounded-xl border border-green-300 text-green-700 px-3 py-1.5 text-sm hover:bg-green-50"
                      >
                        Mark Paid
                      </button>
                      <button
                        onClick={() => markStatus("Void")}
                        className="rounded-xl border border-rose-300 text-rose-700 px-3 py-1.5 text-sm hover:bg-rose-50"
                      >
                        Void
                      </button>
                      <button
                        onClick={onDelete}
                        className="rounded-xl border border-slate-300 text-slate-700 px-3 py-1.5 text-sm hover:bg-slate-50"
                        title="Delete invoice"
                      >
                        Delete
                      </button>
                      <a
                        href="#/admin?tab=integrations"
                        className={`rounded-xl border px-3 py-1.5 text-sm flex items-center gap-2 ${
                          quickBooksConnected
                            ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            : "border-slate-300 text-slate-700 hover:bg-slate-50"
                        }`}
                        title="Configure QuickBooks / Xero integrations"
                      >
                        <span>QuickBooks / Xero</span>
                      </a>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Ensure customer details and totals are accurate before sending.
                  </p>
                </div>
              )}

              {/* Totals */}
              <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                <div className="text-sm font-medium mb-2">Totals</div>
                <div className="text-sm text-slate-700 grid gap-0.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Subtotal</span>
                    <span>
                      {money(
                        selected?.subtotal ??
                          (selected?.total ?? 0) -
                            (selected?.tax ?? 0)
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      Tax
                      {selected?.taxRate
                        ? ` (${(
                            Number(selected.taxRate) * 100
                          ).toFixed(0)}%)`
                        : ""}
                    </span>
                    <span>{money(selected?.tax)}</span>
                  </div>

                  {/* Paid & balance derived from payments */}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Paid</span>
                    <span>
                      {money(
                        (Array.isArray(selected.payments)
                          ? selected.payments.reduce(
                              (s: number, p: any) =>
                                s + Number(p?.amount ?? 0),
                              0
                            )
                          : 0) ?? 0
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between font-semibold">
                    <span>Balance due</span>
                    <span>
                      {money(
                        (selected?.total ?? 0) -
                          (Array.isArray(selected.payments)
                            ? selected.payments.reduce(
                                (s: number, p: any) =>
                                  s + Number(p?.amount ?? 0),
                                0
                              )
                            : 0)
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Send to customer */}
              <div className="rounded-2xl ring-1 ring-slate-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">
                    Send to customer
                  </div>
                  <div className="text-xs text-slate-500">
                    Uses customer contact or company fallback (Admin →
                    Settings).
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={
                      email
                        ? mailto(
                            email,
                            notifySubject,
                            notifyBody
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
                    href={
                      phone
                        ? buildWhatsAppLink(phone, whatsappText)
                        : "#"
                    }
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
            </section>
          )}
        </main>
      </div>

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

      {isDebug && (
        <pre className="mt-4 text-xs bg-yellow-50 border border-yellow-200 rounded-lg p-2 overflow-x-auto">
          {JSON.stringify(
            {
              currencyCode,
              currencySymbol,
              settingsCurrencyRaw: settings.currency,
              settingsCurrencyCode: settings.currencyCode,
              settingsCurrencySymbol: settings.currencySymbol,
            },
            null,
            2
          )}
        </pre>
      )}
    </div>
  );
}
