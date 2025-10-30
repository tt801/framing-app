// src/pages/Customers.tsx
import React, { useState, useMemo } from "react";
import { useCatalog } from "../lib/store";
import { useCustomers } from "../lib/customers";
import { useInvoices } from "../lib/invoices";
import { exportInvoicePDF } from "../lib/pdf/invoicePdf";
// Optional CSV export for filtered view (these exist in your lib/customers)
import { customersToCSV, downloadCSV } from "../lib/customers";

type DateRange = { from?: string; to?: string };

type CustStats = {
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  invoiceCount: number;
  lastInvoiceDate?: string;
};

function parseISODate(d?: string) {
  if (!d) return undefined;
  const t = Date.parse(d);
  return isNaN(t) ? undefined : new Date(t);
}

function withinRange(dateISO?: string, range?: DateRange) {
  if (!range || (!range.from && !range.to)) return true;
  const d = parseISODate(dateISO);
  if (!d) return false;
  if (range.from && d < new Date(range.from)) return false;
  if (range.to) {
    // add 1 day to include the "to" date fully
    const toEnd = new Date(range.to);
    toEnd.setDate(toEnd.getDate() + 1);
    if (d >= toEnd) return false;
  }
  return true;
}

export default function CustomersPage() {
  const { catalog } = useCatalog();
  const { customers, update: updateCustomer } = useCustomers();
  const { invoices } = useInvoices();

  // -------- UI state (filters/search/sort) --------
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [range, setRange] = useState<DateRange>({});
  const [onlyOwing, setOnlyOwing] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "spend" | "recent">("name");

  // -------- money helper --------
  const money = (n: number) => {
    const code = catalog.settings.currencyCode || "ZAR";
    const sym = catalog.settings.currencySymbol || "R ";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(n ?? 0);
    } catch {
      return `${sym}${(n ?? 0).toFixed(2)}`;
    }
  };

  // -------- pre-index invoices by customer (apply date-range filter here) --------
  const invByCustomer = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const inv of invoices) {
      const created = inv.createdAt || inv.dateISO;
      if (!withinRange(created, range)) continue;
      const list = map.get(inv.customerId) || [];
      list.push(inv);
      map.set(inv.customerId, list);
    }
    return map;
  }, [invoices, range]);

  // -------- stats per customer (based on filtered invoices) --------
  const statsMap = useMemo(() => {
    const map = new Map<string, CustStats>();
    for (const [custId, list] of invByCustomer.entries()) {
      const s: CustStats = {
        totalInvoiced: 0,
        totalPaid: 0,
        outstanding: 0,
        invoiceCount: list.length,
        lastInvoiceDate: undefined,
      };
      for (const inv of list) {
        const total = Number(inv.total ?? inv.subtotal ?? 0);
        s.totalInvoiced += total;
        const paid = (inv.payments || []).reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);
        s.totalPaid += paid;
        const created = inv.createdAt || inv.dateISO || "";
        if (!s.lastInvoiceDate || (created && created > s.lastInvoiceDate)) {
          s.lastInvoiceDate = created;
        }
      }
      s.outstanding = Math.max(0, s.totalInvoiced - s.totalPaid);
      map.set(custId, s);
    }
    return map;
  }, [invByCustomer]);

  // -------- search + filter + sort customers (left pane) --------
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let arr = [...customers];

    if (needle) {
      arr = arr.filter((c) => {
        const hay = `${c.firstName} ${c.lastName} ${c.email} ${c.company ?? ""}`.toLowerCase();
        return hay.includes(needle);
      });
    }
    if (onlyOwing) {
      arr = arr.filter((c) => (statsMap.get(c.id)?.outstanding ?? 0) > 0);
    }

    // sorting
    arr.sort((a, b) => {
      if (sortBy === "name") {
        const an = `${a.firstName} ${a.lastName}`.toLowerCase();
        const bn = `${b.firstName} ${b.lastName}`.toLowerCase();
        return an.localeCompare(bn);
      } else if (sortBy === "spend") {
        const sa = statsMap.get(a.id)?.totalInvoiced ?? 0;
        const sb = statsMap.get(b.id)?.totalInvoiced ?? 0;
        return sb - sa; // desc
      } else {
        // recent
        const da = statsMap.get(a.id)?.lastInvoiceDate ?? "";
        const db = statsMap.get(b.id)?.lastInvoiceDate ?? "";
        return db.localeCompare(da); // newest first
      }
    });
    return arr;
  }, [customers, q, onlyOwing, sortBy, statsMap]);

  const selectedCustomer = useMemo(
    () => list.find((c) => c.id === selectedId) || null,
    [list, selectedId]
  );
  const selectedInvoices = useMemo(
    () => (selectedCustomer ? invByCustomer.get(selectedCustomer.id) || [] : []),
    [selectedCustomer, invByCustomer]
  );
  const selectedStats: CustStats =
    (selectedCustomer && statsMap.get(selectedCustomer.id)) || {
      totalInvoiced: 0,
      totalPaid: 0,
      outstanding: 0,
      invoiceCount: 0,
    };

  // -------- actions --------
  async function onExportInvoice(inv: any, cust: any) {
    await exportInvoicePDF({
      invoice: {
        id: inv.id,
        number: inv.number || inv.id,
        dateISO: inv.createdAt || inv.dateISO || new Date().toISOString(),
        dueDateISO: inv.dueDateISO,
        items: inv.items || [],
        subtotal:
          inv.subtotal ??
          (inv.items || []).reduce((s: number, it: any) => s + (it.unitPrice || 0) * (it.qty || 1), 0),
        total: inv.total ?? inv.subtotal ?? 0,
        notes: inv.notes || "",
        payments: inv.payments || [],
      },
      customer: {
        id: cust.id,
        firstName: cust.firstName,
        lastName: cust.lastName,
        email: cust.email,
        phone: cust.phone,
        company: cust.company,
      },
      settings: {
        companyName: catalog.settings.companyName,
        companyEmail: catalog.settings.companyEmail,
        companyPhone: catalog.settings.companyPhone,
        companyAddress: catalog.settings.companyAddress,
        logoDataUrl: (catalog.settings as any).companyLogoDataUrl,
        currencySymbol: catalog.settings.currencySymbol,
        currencyCode: catalog.settings.currencyCode,
        themeColor: catalog.settings.themeColor,
        bankDetails: (catalog.settings as any).bankDetails,
        taxNumber: (catalog.settings as any).taxNumber,
        invoiceFooterNote: (catalog.settings as any).invoiceFooterNote,
      },
    });
  }

  function onSaveCustomer(c: any) {
    if (!c.firstName?.trim() || !c.lastName?.trim() || !c.email?.trim()) {
      alert("First name, last name, and email are required.");
      return;
    }
    updateCustomer({ id: c.id, ...c });
    alert("Customer saved.");
  }

  function exportFilteredCSV() {
    // Exports the *visible* customer list (left pane) as CSV
    const rows = list.map((c) => ({
      ...c,
      // helpful extra columns
      totalInvoiced: statsMap.get(c.id)?.totalInvoiced ?? 0,
      totalPaid: statsMap.get(c.id)?.totalPaid ?? 0,
      outstanding: statsMap.get(c.id)?.outstanding ?? 0,
      invoiceCount: statsMap.get(c.id)?.invoiceCount ?? 0,
    }));

    // Convert to CSV using existing helpers (keeps header stable)
    // If you want these extra columns included, we can extend customersToCSV;
    // for now, just export the base fields:
    const csv = customersToCSV(rows as any);
    downloadCSV("customers_filtered.csv", csv);
  }

  return (
    <div className="p-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* LEFT: Filters + customer list */}
      <aside className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
        <h2 className="text-base font-semibold mb-3">Customers</h2>

        {/* Filters */}
        <div className="grid gap-2 mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border p-2 text-sm"
            placeholder="Search name, email, company…"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs mb-1">From (invoice date)</label>
              <input
                type="date"
                className="w-full rounded-lg border p-2 text-sm"
                value={range.from || ""}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value || undefined }))}
              />
            </div>
            <div>
              <label className="block text-xs mb-1">To (invoice date)</label>
              <input
                type="date"
                className="w-full rounded-lg border p-2 text-sm"
                value={range.to || ""}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value || undefined }))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={onlyOwing}
                onChange={(e) => setOnlyOwing(e.target.checked)}
              />
              Outstanding &gt; 0
            </label>
            <select
              className="rounded-lg border p-2 text-sm"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="name">Sort: Name</option>
              <option value="spend">Sort: Top spenders</option>
              <option value="recent">Sort: Most recent</option>
            </select>
          </div>

          <button
            onClick={exportFilteredCSV}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white"
          >
            Export filtered CSV
          </button>
        </div>

        {/* List */}
        <div className="space-y-1 max-h-[60vh] overflow-auto">
          {list.map((c) => {
            const s = statsMap.get(c.id);
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left rounded-lg border px-3 py-2 text-sm hover:bg-black/5 transition ${
                  selectedId === c.id ? "border-black" : "border-slate-300"
                }`}
              >
                <div className="font-medium truncate">
                  {c.firstName} {c.lastName}
                </div>
                <div className="text-xs text-slate-600 truncate">{c.email}</div>
                {s && (
                  <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-slate-700">
                    <div>Inv: <b>{s.invoiceCount}</b></div>
                    <div>Paid: <b>{money(s.totalPaid)}</b></div>
                    <div>Owing: <b>{money(s.outstanding)}</b></div>
                  </div>
                )}
              </button>
            );
          })}
          {!list.length && <div className="text-sm text-slate-500">No customers match your filters.</div>}
        </div>
      </aside>

      {/* RIGHT: Details + inline edit + invoices */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 min-h-[60vh]">
        {selectedCustomer ? (
          <CustomerDetails
            customer={selectedCustomer}
            stats={selectedStats}
            invoices={selectedInvoices}
            money={money}
            onSave={onSaveCustomer}
            onExportInvoice={onExportInvoice}
          />
        ) : (
          <div className="text-sm text-slate-500">Select a customer to view details.</div>
        )}
      </section>
    </div>
  );
}

// ---------------- Subcomponent: Right pane ----------------

function CustomerDetails({
  customer,
  stats,
  invoices,
  money,
  onSave,
  onExportInvoice,
}: {
  customer: any;
  stats: CustStats;
  invoices: any[];
  money: (n: number) => string;
  onSave: (c: any) => void;
  onExportInvoice: (inv: any, cust: any) => Promise<void>;
}) {
  const [edit, setEdit] = useState(() => ({
    firstName: customer.firstName || "",
    lastName: customer.lastName || "",
    company: customer.company || "",
    email: customer.email || "",
    phone: customer.phone || "",
    notes: customer.notes || "",
  }));

  return (
    <>
      {/* Header + totals */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            {customer.firstName} {customer.lastName}
          </h3>
          <div className="text-sm text-slate-600">{customer.email}</div>
          {customer.company && <div className="text-sm text-slate-600">{customer.company}</div>}
        </div>
        <div className="text-right text-sm">
          <div>Total invoiced: <b>{money(stats.totalInvoiced)}</b></div>
          <div>Total paid: <b>{money(stats.totalPaid)}</b></div>
          <div>Outstanding: <b>{money(stats.outstanding)}</b></div>
        </div>
      </div>

      {/* Inline editable customer fields */}
      <div className="mt-4 grid sm:grid-cols-2 gap-2">
        <input
          className="rounded-lg border p-2 text-sm"
          placeholder="First name"
          value={edit.firstName}
          onChange={(e) => setEdit((s) => ({ ...s, firstName: e.target.value }))}
        />
        <input
          className="rounded-lg border p-2 text-sm"
          placeholder="Last name"
          value={edit.lastName}
          onChange={(e) => setEdit((s) => ({ ...s, lastName: e.target.value }))}
        />
        <input
          className="rounded-lg border p-2 text-sm"
          placeholder="Company"
          value={edit.company}
          onChange={(e) => setEdit((s) => ({ ...s, company: e.target.value }))}
        />
        <input
          className="rounded-lg border p-2 text-sm"
          placeholder="Email"
          value={edit.email}
          onChange={(e) => setEdit((s) => ({ ...s, email: e.target.value }))}
        />
        <input
          className="rounded-lg border p-2 text-sm"
          placeholder="Phone"
          value={edit.phone}
          onChange={(e) => setEdit((s) => ({ ...s, phone: e.target.value }))}
        />
        <textarea
          className="rounded-lg border p-2 text-sm sm:col-span-2"
          placeholder="Notes"
          rows={3}
          value={edit.notes}
          onChange={(e) => setEdit((s) => ({ ...s, notes: e.target.value }))}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white"
          onClick={() => onSave({ id: customer.id, ...edit })}
        >
          Save customer
        </button>
      </div>

      {/* Invoices list */}
      <div className="mt-6">
        <h4 className="text-sm font-semibold mb-2">Invoices</h4>
        <div className="divide-y">
          {invoices.map((inv) => {
            const total = Number(inv.total ?? inv.subtotal ?? 0);
            const paid = (inv.payments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            const owing = Math.max(0, total - paid);
            return (
              <div key={inv.id} className="py-2 flex items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-medium">#{inv.number || inv.id}</span>{" • "}
                  {new Date(inv.createdAt || inv.dateISO || Date.now()).toLocaleDateString()}{" • "}
                  {money(total)}{" "}
                  <span className="text-slate-500">(paid {money(paid)}, owing {money(owing)})</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onExportInvoice(inv, customer)}
                    className="rounded-lg border px-2 py-1 text-xs hover:bg-black hover:text-white"
                  >
                    PDF
                  </button>
                  {/* Placeholder for record payment flow if/when you expose the API in useInvoices */}
                  {/* <button className="rounded-lg border px-2 py-1 text-xs hover:bg-black hover:text-white">Record payment</button> */}
                </div>
              </div>
            );
          })}
          {!invoices.length && (
            <div className="py-6 text-sm text-slate-500">No invoices for this customer.</div>
          )}
        </div>
      </div>
    </>
  );
}
