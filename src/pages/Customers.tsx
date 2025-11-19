// src/pages/Customers.tsx
import React, { useState, useMemo, useRef } from "react";
import { useCatalog } from "../lib/store";
import { useCustomers } from "../lib/customers";
import { useInvoices } from "../lib/invoices";
import { exportInvoicePDF } from "../lib/pdf/invoicePdf";
import { customersToCSV, downloadCSV } from "../lib/customers";

type CustStats = {
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  invoiceCount: number;
  lastInvoiceDate?: string;
};

/** Nicely join address parts if present */
const formatAddress = (c: any) =>
  [c?.address1, c?.address2, c?.city, c?.postcode || c?.postalCode, c?.country]
    .filter(Boolean)
    .join(", ");

export default function CustomersPage() {
  const { catalog } = useCatalog();
  const custStore = useCustomers() as any;
  const customers: any[] = custStore.customers ?? [];
  const { invoices } = useInvoices();

  const updateCustomer: (c: any) => void =
    custStore.update ||
    custStore.updateCustomer ||
    custStore.setCustomer ||
    ((c: any) => {
      console.warn("No updateCustomer function found on customers store", c);
    });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "spend" | "recent">("name");
  const [showImportMenu, setShowImportMenu] = useState(false);

  const settings = catalog.settings || {};
  const companyName: string = settings.companyName || "Our workshop";
  const fallbackWhatsAppTo: string = settings.companyWhatsAppTo || "";

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // -------- money helper (match Quotes style) --------
  const money = (n: number) => {
    const code = settings.currencyCode || "ZAR";
    const sym = settings.currencySymbol || "R ";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
      }).format(n ?? 0);
    } catch {
      return `${sym}${(n ?? 0).toFixed(2)}`;
    }
  };

  // -------- pre-index invoices by customer --------
  const invByCustomer = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const inv of invoices) {
      const list = map.get(inv.customerId) || [];
      list.push(inv);
      map.set(inv.customerId, list);
    }
    return map;
  }, [invoices]);

  // -------- stats per customer --------
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
        const paid = (inv.payments || []).reduce(
          (acc: number, p: any) => acc + Number(p.amount || 0),
          0
        );
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

  // -------- top-level overview (similar to Quotes header card) --------
  const overview = useMemo(() => {
    const totalCustomers = customers.length;
    let totalInvoiced = 0;
    let totalOutstanding = 0;
    let topCustomerId: string | null = null;
    let topCustomerValue = 0;
    let owingCount = 0;

    for (const c of customers as any[]) {
      const s = statsMap.get(c.id);
      if (!s) continue;
      totalInvoiced += s.totalInvoiced;
      totalOutstanding += s.outstanding;
      if (s.outstanding > 0) owingCount += 1;
      if (s.totalInvoiced > topCustomerValue) {
        topCustomerValue = s.totalInvoiced;
        topCustomerId = c.id;
      }
    }

    let topCustomerName = "";
    if (topCustomerId) {
      const c = (customers as any[]).find((x) => x.id === topCustomerId);
      if (c) {
        topCustomerName =
          `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.company || "";
      }
    }

    return {
      totalCustomers,
      totalInvoiced,
      totalOutstanding,
      owingCount,
      topCustomerName,
      topCustomerValue,
    };
  }, [customers, statsMap]);

  // -------- filtered/sorted customer list (left pane) --------
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let arr = [...customers];

    if (needle) {
      arr = arr.filter((c: any) => {
        const hay = [
          c.firstName,
          c.lastName,
          c.email,
          c.company,
          c.address1,
          c.address2,
          c.city,
          c.postcode,
          c.postalCode,
          c.country,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      });
    }

    arr.sort((a, b) => {
      if (sortBy === "name") {
        const an = `${a.firstName} ${a.lastName}`.toLowerCase();
        const bn = `${b.firstName} ${b.lastName}`.toLowerCase();
        return an.localeCompare(bn);
      } else if (sortBy === "spend") {
        const sa = statsMap.get(a.id)?.totalInvoiced ?? 0;
        const sb = statsMap.get(b.id)?.totalInvoiced ?? 0;
        return sb - sa;
      } else {
        const da = statsMap.get(a.id)?.lastInvoiceDate ?? "";
        const db = statsMap.get(b.id)?.lastInvoiceDate ?? "";
        return db.localeCompare(da);
      }
    });

    return arr;
  }, [customers, q, sortBy, statsMap]);

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
          (inv.items || []).reduce(
            (s: number, it: any) => s + (it.unitPrice || 0) * (it.qty || 1),
            0
          ),
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
        address1: cust.address1,
        address2: cust.address2,
        city: cust.city,
        postcode: cust.postcode || cust.postalCode,
        country: cust.country,
      },
      settings: {
        companyName: settings.companyName,
        companyEmail: settings.companyEmail,
        companyPhone: settings.companyPhone,
        companyAddress: settings.companyAddress,
        logoDataUrl: (settings as any).companyLogoDataUrl,
        currencySymbol: settings.currencySymbol,
        currencyCode: settings.currencyCode,
        themeColor: settings.themeColor,
        bankDetails: (settings as any).bankDetails,
        taxNumber: (settings as any).taxNumber,
        invoiceFooterNote: (settings as any).invoiceFooterNote,
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
    const rows = list.map((c) => ({
      ...c,
      totalInvoiced: statsMap.get(c.id)?.totalInvoiced ?? 0,
      totalPaid: statsMap.get(c.id)?.totalPaid ?? 0,
      outstanding: statsMap.get(c.id)?.outstanding ?? 0,
      invoiceCount: statsMap.get(c.id)?.invoiceCount ?? 0,
    }));

    const csv = customersToCSV(rows as any);
    downloadCSV("customers_filtered.csv", csv);
  }

  // ---- helper: add customer into store (used by "New" and CSV import) ----
  function addCustomerToStore(base: any) {
    const id =
      base.id ||
      (typeof crypto !== "undefined" &&
      (crypto as any).randomUUID &&
      typeof (crypto as any).randomUUID === "function"
        ? (crypto as any).randomUUID()
        : `cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

    const blank: any = {
      id,
      firstName: base.firstName || "",
      lastName: base.lastName || "",
      email: base.email || "",
      phone: base.phone || "",
      company: base.company || "",
      address1: base.address1 || "",
      address2: base.address2 || "",
      city: base.city || "",
      postcode: base.postcode || base.postalCode || "",
      country: base.country || "",
      notes: base.notes || "",
    };

    try {
      if (typeof custStore.addCustomer === "function") {
        custStore.addCustomer(blank);
      } else if (typeof custStore.add === "function") {
        custStore.add(blank);
      } else if (typeof custStore.createCustomer === "function") {
        custStore.createCustomer(blank);
      } else if (typeof custStore.setCustomers === "function") {
        custStore.setCustomers((rows: any[]) => [...rows, blank]);
      } else {
        updateCustomer(blank);
      }
    } catch (e) {
      console.warn("Failed to create/import customer", e);
      updateCustomer(blank);
    }

    return blank.id as string;
  }

  function handleNewCustomer() {
    const id = addCustomerToStore({});
    setSelectedId(id);
  }

  function handleDeleteCustomer(id: string) {
    const customer = customers.find((c) => c.id === id);
    const displayName =
      customer &&
      (`${customer.firstName || ""} ${customer.lastName || ""}`.trim() ||
        customer.company ||
        customer.email ||
        id);

    const ok = window.confirm(
      `Delete customer ${displayName || id}? This cannot be undone.`
    );
    if (!ok) return;

    try {
      if (typeof custStore.removeCustomer === "function") {
        custStore.removeCustomer(id);
      } else if (typeof custStore.deleteCustomer === "function") {
        custStore.deleteCustomer(id);
      } else if (typeof custStore.remove === "function") {
        custStore.remove(id);
      } else if (typeof custStore.delete === "function") {
        custStore.delete(id);
      } else if (typeof custStore.setCustomers === "function") {
        custStore.setCustomers((rows: any[]) =>
          rows.filter((r: any) => r.id !== id)
        );
      } else {
        console.warn("No delete method found on customers store");
      }
    } catch (e) {
      console.warn("Failed to delete customer", e);
    }

    const idx = list.findIndex((c) => c.id === id);
    const next = list[idx + 1] || list[idx - 1] || null;
    setSelectedId(next ? next.id : null);
  }

  // -------- IMPORT: CSV parsing + Gmail/Outlook stubs --------

  function importCustomersFromCsv(text: string): number {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return 0;

    const headerLine = lines[0];
    const headers = headerLine
      .split(",")
      .map((h) => h.trim().toLowerCase());

    let imported = 0;

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const cols = line.split(",");
      if (cols.every((c) => !c.trim())) continue;

      const rec: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rec[h] = (cols[idx] ?? "").trim();
      });

      const get = (...keys: string[]) => {
        for (const k of keys) {
          const v = rec[k.toLowerCase()];
          if (v) return v;
        }
        return "";
      };

      const fullName = get("name", "full name", "fullname");
      let firstName = get("first name", "firstname", "given name", "givenname");
      let lastName = get("last name", "lastname", "surname");

      if (!firstName && !lastName && fullName) {
        const parts = fullName.split(" ").filter(Boolean);
        firstName = parts[0] || "";
        lastName = parts.slice(1).join(" ");
      }

      const email = get("email", "email address", "e-mail");
      const phone = get("phone", "phone number", "mobile", "telephone");
      const company = get("company", "organisation", "organization", "business");

      const address1 = get("address1", "address line 1", "street", "street address");
      const address2 = get("address2", "address line 2", "suburb");
      const city = get("city", "town");
      const postcode = get("postcode", "postal code", "zip", "zip code");
      const country = get("country", "nation");
      const notes = get("notes", "note");

      // Skip completely empty rows (no name & no email)
      if (!email && !firstName && !lastName && !company) continue;

      const id = addCustomerToStore({
        firstName,
        lastName,
        email,
        phone,
        company,
        address1,
        address2,
        city,
        postcode,
        country,
        notes,
      });

      imported += 1;
      setSelectedId(id);
    }

    return imported;
  }

  function handleImportCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const count = importCustomersFromCsv(text);
      alert(
        count === 0
          ? "No customers were imported. Check the CSV headers (name, email, etc.)."
          : `Imported ${count} customer${count === 1 ? "" : "s"} from CSV.`
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setShowImportMenu(false);
    };
    reader.readAsText(file);
  }

  function handleImportFromGmail() {
    alert(
      "Gmail import would start a 'Connect to Google Contacts' flow here (OAuth + Google People API).\n\n" +
        "For now, you can export contacts from Gmail as CSV and use 'export customers'."
    );
    setShowImportMenu(false);
  }

  function handleImportFromOutlook() {
    alert(
      "Outlook import would start a 'Connect to Outlook / Microsoft 365 contacts' flow here.\n\n" +
        "For now, you can export contacts from Outlook as CSV and use 'import customers'."
    );
    setShowImportMenu(false);
  }

  return (
    <div className="p-4 space-y-4">
      {/* ===== CUSTOMER OVERVIEW ===== */}
      <section className="rounded-2xl ring-1 ring-slate-200 bg-white p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base md:text-lg font-semibold">Customer overview</h3>
          <span className="text-xs md:text-sm text-slate-500">
            {overview.totalCustomers} customer
            {overview.totalCustomers === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Total customers</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
              {overview.totalCustomers}
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 bg-green-50 px-4 py-3">
            <div className="text-xs text-green-700">Total invoiced</div>
            <div className="mt-0.5 text-xl font-semibold text-green-800 tabular-nums">
              {money(overview.totalInvoiced)}
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 bg-rose-50 px-4 py-3">
            <div className="text-xs text-rose-700">Total outstanding</div>
            <div className="mt-0.5 text-xl font-semibold text-rose-800 tabular-nums">
              {money(overview.totalOutstanding)}
            </div>
            <div className="text-[11px] text-rose-700 tabular-nums">
              {overview.owingCount} customer
              {overview.owingCount === 1 ? "" : "s"} owing
            </div>
          </div>

          <div className="rounded-xl ring-1 ring-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">Top spender</div>
            {overview.topCustomerName ? (
              <>
                <div className="mt-0.5 text-sm font-semibold truncate">
                  {overview.topCustomerName}
                </div>
                <div className="text-[13px] text-slate-600">
                  {money(overview.topCustomerValue)}
                </div>
              </>
            ) : (
              <div className="mt-0.5 text-sm text-slate-400">No data yet</div>
            )}
          </div>
        </div>
      </section>

      {/* ===== TWO-COLUMN LAYOUT ===== */}
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* LEFT: Filters + customer list */}
        <aside className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Customers</h2>
            <button
              onClick={handleNewCustomer}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs md:text-sm hover:bg-slate-50"
            >
              New customer
            </button>
          </div>

          <div className="grid gap-2 mb-3">
            {/* Search */}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, email, company…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
            />

            {/* export/import customers row, both full width */}
            <div className="flex gap-2 relative">
              <button
                onClick={exportFilteredCSV}
                className="flex-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs md:text-sm whitespace-nowrap hover:bg-slate-50"
              >
                export customers
              </button>

              <div className="relative flex-1">
                <button
                  onClick={() => setShowImportMenu((prev) => !prev)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs md:text-sm whitespace-nowrap hover:bg-slate-50"
                >
                  import customers
                </button>

                {showImportMenu && (
                  <div className="absolute right-0 mt-1 w-48 rounded-xl border border-slate-200 bg-white shadow-lg z-10 text-sm">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50"
                    >
                      Import CSV
                    </button>
                    <button
                      type="button"
                      onClick={handleImportFromGmail}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50"
                    >
                      Import from Gmail
                    </button>
                    <button
                      type="button"
                      onClick={handleImportFromOutlook}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50"
                    >
                      Import from Outlook
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Sort dropdown full width */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
              title="Sort customers"
            >
              <option value="name">Sort: Name</option>
              <option value="spend">Sort: Top spenders</option>
              <option value="recent">Sort: Most recent</option>
            </select>
          </div>

          {/* Hidden file input for CSV upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImportCsvFile}
          />

          <div className="grid gap-2 max-h-[calc(100vh-270px)] overflow-auto pr-1">
            {list.map((c: any) => {
              const s = statsMap.get(c.id);
              const isSelected = selectedCustomer?.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`text-left rounded-xl border px-3 py-2 transition shadow-sm ${
                    isSelected
                      ? "border-slate-900 bg-slate-50"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                  title={`View ${c.firstName} ${c.lastName}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium truncate">
                      {c.firstName} {c.lastName}
                    </div>
                    {s && s.outstanding > 0 && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                        Owing
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {c.email}
                  </div>
                  {s ? (
                    <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-slate-700">
                      <div>
                        Inv: <b>{s.invoiceCount}</b>
                      </div>
                      <div>
                        Paid: <b>{money(s.totalPaid)}</b>
                      </div>
                      <div>
                        Owing: <b>{money(s.outstanding)}</b>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-slate-500">
                      Add new customer details
                    </div>
                  )}
                </button>
              );
            })}

            {!list.length && (
              <div className="text-sm text-slate-500 py-6 text-center">
                No customers match your filters.
              </div>
            )}
          </div>
        </aside>

        {/* RIGHT: Details pane */}
        <main className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 min-h-[60vh]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Details</h2>
          </div>

          {!selectedCustomer ? (
            <div className="text-sm text-slate-500">
              Select a customer from the left, or click{" "}
              <span className="font-medium">New customer</span> to add one.
            </div>
          ) : (
            <CustomerDetails
              key={selectedCustomer.id}
              customer={selectedCustomer}
              stats={selectedStats}
              invoices={selectedInvoices}
              money={money}
              onSave={onSaveCustomer}
              onExportInvoice={onExportInvoice}
              onDelete={handleDeleteCustomer}
              companyName={companyName}
              fallbackWhatsAppTo={fallbackWhatsAppTo}
            />
          )}
        </main>
      </div>
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
  onDelete,
  companyName,
  fallbackWhatsAppTo,
}: {
  customer: any;
  stats: CustStats;
  invoices: any[];
  money: (n: number) => string;
  onSave: (c: any) => void;
  onExportInvoice: (inv: any, cust: any) => Promise<void>;
  onDelete: (id: string) => void;
  companyName: string;
  fallbackWhatsAppTo: string;
}) {
  const [edit, setEdit] = useState(() => ({
    firstName: customer.firstName || "",
    lastName: customer.lastName || "",
    company: customer.company || "",
    email: customer.email || "",
    phone: customer.phone || "",
    address1: customer.address1 || "",
    address2: customer.address2 || "",
    city: customer.city || "",
    postcode: customer.postcode || customer.postalCode || "",
    country: customer.country || "",
    notes: customer.notes || "",
  }));

  const [invoiceFilter, setInvoiceFilter] = useState<"all" | "owing" | "paid">(
    "all"
  );

  const { filteredInvoices, summary } = useMemo(() => {
    let total = 0;
    let paidTotal = 0;
    let owingTotal = 0;

    const extended = invoices.map((inv) => {
      const total = Number(inv.total ?? inv.subtotal ?? 0);
      const paid = (inv.payments || []).reduce(
        (s: number, p: any) => s + Number(p.amount || 0),
        0
      );
      const owing = Math.max(0, total - paid);
      return { inv, total, paid, owing };
    });

    for (const e of extended) {
      total += e.total;
      paidTotal += e.paid;
      owingTotal += e.owing;
    }

    return {
      filteredInvoices: extended,
      summary: {
        total,
        paidTotal,
        owingTotal,
        count: invoices.length,
      },
    };
  }, [invoices]);

  const visibleInvoices = useMemo(() => {
    if (invoiceFilter === "all") return filteredInvoices;
    if (invoiceFilter === "paid") {
      return filteredInvoices.filter((e) => e.owing <= 0 && e.total > 0);
    }
    return filteredInvoices.filter((e) => e.owing > 0);
  }, [filteredInvoices, invoiceFilter]);

  const isNewBlankCustomer =
    !customer.firstName &&
    !customer.lastName &&
    !customer.email &&
    !customer.company &&
    !customer.address1 &&
    !customer.address2 &&
    !customer.city &&
    !(customer.postcode || customer.postalCode) &&
    !customer.country;

  function getStatusLabel(
    total: number,
    paid: number,
    owing: number,
    inv: any
  ) {
    if (total <= 0) return "Draft";
    if (owing <= 0) return "Paid";

    const due = inv.dueDateISO ? new Date(inv.dueDateISO) : null;
    const now = new Date();
    if (due && due < now && owing > 0) return "Overdue";
    if (paid > 0 && owing > 0) return "Part paid";
    return "Unpaid";
  }

  function statusClasses(label: string) {
    switch (label) {
      case "Paid":
        return "bg-emerald-50 text-emerald-700 ring-emerald-100";
      case "Overdue":
        return "bg-red-50 text-red-700 ring-red-100";
      case "Part paid":
        return "bg-amber-50 text-amber-700 ring-amber-100";
      case "Draft":
        return "bg-slate-50 text-slate-600 ring-slate-100";
      case "Unpaid":
      default:
        return "bg-orange-50 text-orange-700 ring-orange-100";
    }
  }

  const contactName =
    `${edit.firstName || customer.firstName || ""} ${
      edit.lastName || customer.lastName || ""
    }`.trim() ||
    customer.company ||
    "there";

  const emailTo = edit.email || customer.email || "";
  const phoneRaw = edit.phone || customer.phone || fallbackWhatsAppTo || "";
  const phoneDigits = phoneRaw.replace(/\D/g, "");

  const notifyBody =
    `Hi ${contactName},\n\n` +
    `Just a quick update from ${companyName}. ` +
    (stats.outstanding > 0
      ? `Our records show a current outstanding balance of ${money(
          stats.outstanding
        )} on your account. `
      : `Thank you for your business. `) +
    `If you have any questions or need anything framed, just reply to this message.\n\n` +
    `Best regards,\n${companyName}`;

  const whatsappText = notifyBody;

  const mailtoHref = emailTo
    ? `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(
        `Update from ${companyName}`
      )}&body=${encodeURIComponent(notifyBody)}`
    : "#";

  const whatsappHref = phoneDigits
    ? `https://wa.me/${encodeURIComponent(phoneDigits)}?text=${encodeURIComponent(
        whatsappText
      )}`
    : "#";

  return (
    <section className="grid gap-4">
      {/* Header + totals */}
      <div className="rounded-2xl ring-1 ring-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-600">
              Customer details
            </div>
            <div className="mt-0.5 text-base font-semibold">
              {customer.firstName} {customer.lastName}
            </div>
            <div className="text-sm text-slate-600">{customer.email}</div>
            {customer.company && (
              <div className="text-sm text-slate-600">{customer.company}</div>
            )}
            {formatAddress(customer) && (
              <div className="mt-1 text-sm text-slate-700 whitespace-pre-line">
                {[
                  [customer.address1, customer.address2]
                    .filter(Boolean)
                    .join("\n"),
                  [customer.city, customer.postcode || customer.postalCode]
                    .filter(Boolean)
                    .join(" "),
                  customer.country,
                ]
                  .filter(Boolean)
                  .join("\n")}
              </div>
            )}
          </div>
          <div className="text-right text-sm">
            <div>
              Total invoiced: <b>{money(stats.totalInvoiced)}</b>
            </div>
            <div>
              Total paid: <b>{money(stats.totalPaid)}</b>
            </div>
            <div>
              Outstanding: <b>{money(stats.outstanding)}</b>
            </div>
          </div>
        </div>
      </div>

      {/* Editable customer fields */}
      <div className="rounded-2xl ring-1 ring-slate-200 p-4">
        <div className="text-sm font-medium mb-2">Customer info</div>
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            className="rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="First name"
            value={edit.firstName}
            onChange={(e) =>
              setEdit((s) => ({ ...s, firstName: e.target.value }))
            }
          />
          <input
            className="rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="Last name"
            value={edit.lastName}
            onChange={(e) =>
              setEdit((s) => ({ ...s, lastName: e.target.value }))
            }
          />
          <input
            className="rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="Company"
            value={edit.company}
            onChange={(e) =>
              setEdit((s) => ({ ...s, company: e.target.value }))
            }
          />
          <input
            className="rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="Email"
            value={edit.email}
            onChange={(e) =>
              setEdit((s) => ({ ...s, email: e.target.value }))
            }
          />
          <input
            className="rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="Phone"
            value={edit.phone}
            onChange={(e) =>
              setEdit((s) => ({ ...s, phone: e.target.value }))
            }
          />

          <input
            className="rounded-lg border border-slate-300 p-2 text-sm sm:col-span-2 focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="Address line 1"
            value={edit.address1}
            onChange={(e) =>
              setEdit((s) => ({ ...s, address1: e.target.value }))
            }
          />
          <input
            className="rounded-lg border border-slate-300 p-2 text-sm sm:col-span-2 focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="Address line 2"
            value={edit.address2}
            onChange={(e) =>
              setEdit((s) => ({ ...s, address2: e.target.value }))
            }
          />
          <input
            className="rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="City"
            value={edit.city}
            onChange={(e) =>
              setEdit((s) => ({ ...s, city: e.target.value }))
            }
          />
          <input
            className="rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="Postcode"
            value={edit.postcode}
            onChange={(e) =>
              setEdit((s) => ({ ...s, postcode: e.target.value }))
            }
          />
          <input
            className="rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="Country"
            value={edit.country}
            onChange={(e) =>
              setEdit((s) => ({ ...s, country: e.target.value }))
            }
          />

          <textarea
            className="rounded-lg border border-slate-300 p-2 text-sm sm:col-span-2 focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder="Notes (internal, not shown on invoices)"
            rows={3}
            value={edit.notes}
            onChange={(e) =>
              setEdit((s) => ({ ...s, notes: e.target.value }))
            }
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <button
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50"
            onClick={() => onSave({ id: customer.id, ...edit })}
          >
            Save customer
          </button>
          <button
            className="inline-flex items-center justify-center rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 shadow-sm hover:bg-rose-50"
            onClick={() => onDelete(customer.id)}
          >
            Delete
          </button>

          <a
            href={mailtoHref}
            onClick={(e) => {
              if (!emailTo) e.preventDefault();
            }}
            className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border shadow-sm ${
              emailTo
                ? "border-transparent bg-slate-900 text-white hover:bg-slate-800"
                : "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
            }`}
          >
            Email customer
          </a>
          <a
            href={whatsappHref}
            onClick={(e) => {
              if (!phoneDigits) e.preventDefault();
            }}
            className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border shadow-sm ${
              phoneDigits
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

      {/* Invoices list */}
      <div className="rounded-2xl ring-1 ring-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Invoices</div>
          {summary.count > 0 && (
            <div className="text-[11px] text-slate-600 text-right">
              <div>
                Invoices: <b>{summary.count}</b>
              </div>
              <div>
                Paid: <b>{money(summary.paidTotal)}</b> · Owing:{" "}
                <b>{money(summary.owingTotal)}</b>
              </div>
            </div>
          )}
        </div>

        {summary.count > 0 && (
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {(["all", "owing", "paid"] as const).map((key) => {
              const label =
                key === "all"
                  ? "All"
                  : key === "owing"
                  ? "Owing"
                  : "Paid";
              const active = invoiceFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setInvoiceFilter(key)}
                  className={`rounded-full px-3 py-1 border text-xs transition ${
                    active
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {visibleInvoices.map(({ inv, total, paid, owing }) => {
            const statusLabel = getStatusLabel(total, paid, owing, inv);
            const badgeClass = statusClasses(statusLabel);
            return (
              <div
                key={inv.id}
                className="py-2 flex items-center justify-between gap-3"
              >
                <div className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      #{inv.number || inv.id}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(
                        inv.createdAt || inv.dateISO || Date.now()
                      ).toLocaleDateString()}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${badgeClass}`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-700">
                    {money(total)}{" "}
                    <span className="text-slate-500">
                      (paid {money(paid)}, owing {money(owing)})
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onExportInvoice(inv, customer)}
                    className="rounded-xl border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                  >
                    PDF
                  </button>
                </div>
              </div>
            );
          })}
          {summary.count === 0 && (
            <div className="py-6 text-sm text-slate-500">
              {isNewBlankCustomer
                ? "Add new customer details"
                : "No invoices for this customer yet."}
            </div>
          )}
          {summary.count > 0 && visibleInvoices.length === 0 && (
            <div className="py-6 text-sm text-slate-500">
              No invoices match this filter.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
