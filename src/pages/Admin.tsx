// src/pages/Admin.tsx
import React, { useMemo, useState } from "react";
import {
  useCatalog,
  newFrame,
  newMat,
  newGlazing,
  newPrintingMaterial,
} from "@/lib/store";
import type {
  Frame,
  Mat,
  Glazing,
  PrintingMaterial,
} from "@/lib/store";
import AddressAutocomplete from "@/components/AddressAutocomplete";

/* ------------------------------------------------------------------
   Currency options (central list)
   ------------------------------------------------------------------ */
const CURRENCIES = [
  { code: "GBP", symbol: "£", label: "GBP – British Pound (£)" },
  { code: "EUR", symbol: "€", label: "EUR – Euro (€)" },
  { code: "USD", symbol: "$", label: "USD – US Dollar ($)" },
  { code: "ZAR", symbol: "R ", label: "ZAR – South African Rand (R)" },
  { code: "AUD", symbol: "A$", label: "AUD – Australian Dollar (A$)" },
  { code: "CAD", symbol: "C$", label: "CAD – Canadian Dollar (C$)" },
  { code: "NZD", symbol: "NZ$", label: "NZD – New Zealand Dollar (NZ$)" },
  { code: "CHF", symbol: "CHF ", label: "CHF – Swiss Franc (CHF)" },
];

/* ------------------------------------------------------------------
   Jobs defaults (checklist + ready message template)
   ------------------------------------------------------------------ */
const DEFAULT_JOB_CHECKLIST: string[] = [
  "Cut frame",
  "Join frame",
  "Cut glazing / glass",
  "Cut mat / mount",
  "Assemble artwork",
  "Fit backing & hardware",
  "Final clean & quality check",
  "Pack for collection",
];

const DEFAULT_READY_MESSAGE = [
  "Hi {{customerName}},",
  "",
  "Your framed order {{jobId}} is now ready for collection from {{companyName}}.",
  "",
  "Collection address:",
  "{{companyAddressLine1}}",
  "{{companyAddressLine2}}",
  "",
  "If you have any questions, just reply to this message.",
  "",
  "Thank you,",
  "{{companyName}}",
].join("\n");

/* ------------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------------ */
const num = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const money = (v: any, symbol = "£") =>
  `${symbol}${num(v, 0).toFixed(2)}`;

/* ------------------------------------------------------------------
   Main page
   ------------------------------------------------------------------ */
type TabId =
  | "company"
  | "settings"
  | "frames"
  | "mats"
  | "glazing"
  | "printing"
  | "jobs"
  | "integrations";

export default function AdminPage() {
  const catHook = useCatalog() as any;
  const catalog = catHook.catalog || catHook || {};

  const saveCatalog = (partial: any) => {
    if (typeof catHook.update === "function") {
      catHook.update(partial);
    } else if (typeof catHook.setCatalog === "function") {
      catHook.setCatalog((prev: any) => ({ ...prev, ...partial }));
    } else {
      console.warn("No update function on useCatalog()", {
        catHook,
        partial,
      });
    }
  };

  const [activeTab, setActiveTab] = useState<TabId>("settings");

  const settings = catalog.settings || {};
  const frames: Frame[] = catalog.frames || [];
  const mats: Mat[] = catalog.mats || [];
  const glazing: Glazing[] = catalog.glazing || [];
  const printingMaterials: PrintingMaterial[] =
    catalog.printingMaterials || [];

  const currencySymbol =
    settings.currencySymbol ||
    CURRENCIES.find((c) => c.code === settings.currencyCode)?.symbol ||
    "£";

  return (
    <main className="mx-auto max-w-6xl p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Admin</h1>
          <p className="text-sm text-slate-500">
            Company info, catalog, and integrations.
          </p>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Tabs */}
        <aside className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-3">
          <nav className="flex flex-col gap-1 text-sm">
            {[
              ["company", "Company"],
              ["settings", "Settings"],
              ["frames", "Frames"],
              ["mats", "Mats"],
              ["glazing", "Glazing"],
              ["printing", "Printing"],
              ["jobs", "Jobs"],
              ["integrations", "Integrations"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as TabId)}
                className={`w-full text-left px-3 py-2 rounded-xl transition ${
                  activeTab === id
                    ? "bg-slate-900 text-white"
                    : "hover:bg-slate-100 text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Panel */}
        <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 md:p-6 space-y-4">
          {activeTab === "company" && (
            <CompanyPanel
              settings={settings}
              onChange={(partial) =>
                saveCatalog({
                  settings: { ...settings, ...partial },
                })
              }
            />
          )}

          {activeTab === "settings" && (
            <SettingsPanel
              settings={settings}
              onSave={(next) =>
                saveCatalog({ settings: { ...settings, ...next } })
              }
            />
          )}

          {activeTab === "frames" && (
            <FramesPanel
              frames={frames}
              currencySymbol={currencySymbol}
              onChange={(next) => saveCatalog({ frames: next })}
            />
          )}

          {activeTab === "mats" && (
            <MatsPanel
              mats={mats}
              currencySymbol={currencySymbol}
              onChange={(next) => saveCatalog({ mats: next })}
            />
          )}

          {activeTab === "glazing" && (
            <GlazingPanel
              glazing={glazing}
              currencySymbol={currencySymbol}
              onChange={(next) => saveCatalog({ glazing: next })}
            />
          )}

          {activeTab === "printing" && (
            <PrintingPanel
              printingMaterials={printingMaterials}
              currencySymbol={currencySymbol}
              onChange={(next) =>
                saveCatalog({ printingMaterials: next })
              }
            />
          )}

          {activeTab === "jobs" && (
            <JobsPanel
              settings={settings}
              onChange={(partial) =>
                saveCatalog({
                  settings: { ...settings, ...partial },
                })
              }
            />
          )}

          {activeTab === "integrations" && (
            <IntegrationsPanel
              settings={settings}
              onChange={(partial) =>
                saveCatalog({
                  settings: { ...settings, ...partial },
                })
              }
            />
          )}
        </section>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------
   Company panel (NOW WITH GOOGLE ADDRESS LOOKUP)
   ------------------------------------------------------------------ */

function CompanyPanel({
  settings,
  onChange,
}: {
  settings: any;
  onChange: (partial: any) => void;
}) {
  const [draft, setDraft] = useState(() => ({
    companyName: settings.companyName || "",
    companyEmail: settings.companyEmail || "",
    companyPhone: settings.companyPhone || "",
    companyAddress: settings.companyAddress || "",
    taxNumber: settings.taxNumber || "",
    bankDetails: settings.bankDetails || "",
  }));

  const save = () => {
    onChange(draft);
    alert("Company settings saved.");
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Company</h2>
      <p className="text-sm text-slate-500">
        Used on invoices, quotes, and PDFs.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Company name
          </label>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={draft.companyName}
            onChange={(e) =>
              setDraft((d) => ({ ...d, companyName: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Company email
          </label>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={draft.companyEmail}
            onChange={(e) =>
              setDraft((d) => ({ ...d, companyEmail: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Company phone
          </label>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={draft.companyPhone}
            onChange={(e) =>
              setDraft((d) => ({ ...d, companyPhone: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Tax number / VAT number
          </label>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={draft.taxNumber}
            onChange={(e) =>
              setDraft((d) => ({ ...d, taxNumber: e.target.value }))
            }
          />
        </div>
      </div>

      {/* Google-powered address lookup */}
      <AddressAutocomplete
        value={draft.companyAddress}
        onChange={(val) =>
          setDraft((d) => ({ ...d, companyAddress: val }))
        }
        onSelect={(addr) => {
          // For company, we keep a multi-line nicely formatted block
          const lines = [
            addr.line1,
            [addr.city, addr.postcode].filter(Boolean).join(" "),
            addr.country,
          ]
            .filter(Boolean)
            .join("\n");

          setDraft((d) => ({
            ...d,
            companyAddress: lines || addr.fullText,
          }));
        }}
        label="Company address (lookup)"
        helperText="Powered by Google Places (if script is loaded). You can edit the text block below after selecting."
      />

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">
          Company address (printed on PDFs)
        </label>
        <textarea
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          value={draft.companyAddress}
          onChange={(e) =>
            setDraft((d) => ({ ...d, companyAddress: e.target.value }))
          }
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">
          Bank details / payment instructions
        </label>
        <textarea
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          value={draft.bankDetails}
          onChange={(e) =>
            setDraft((d) => ({ ...d, bankDetails: e.target.value }))
          }
        />
      </div>

      <button
        onClick={save}
        className="mt-2 inline-flex items-center px-4 py-2 rounded-xl bg-slate-900 text-white text-sm hover:bg-slate-800"
      >
        Save company settings
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------
   Settings panel (with CURRENCY DROPDOWN)
   ------------------------------------------------------------------ */

function SettingsPanel({
  settings,
  onSave,
}: {
  settings: any;
  onSave: (next: any) => void;
}) {
  const initialCurrencyCode: string =
    settings.currencyCode ||
    (typeof settings.currency === "string"
      ? settings.currency
      : "GBP");

  const found = CURRENCIES.find(
    (c) => c.code === initialCurrencyCode
  );

  const [draft, setDraft] = useState(() => ({
    currencyCode: initialCurrencyCode,
    currencySymbol:
      settings.currencySymbol || found?.symbol || "£",
    taxRate: settings.taxRate ?? 0,
    defaultPaymentTerms: settings.defaultPaymentTerms || "Due on receipt",
    invoicePrefix: settings.invoicePrefix || "INV-",
    nextInvoiceNumber: settings.nextInvoiceNumber || 1001,
    themeColor: settings.themeColor || "#0f172a",
    foamBackerEnabled: !!settings.foamBackerEnabled,
    invoiceFooterNote: settings.invoiceFooterNote || "",
  }));

  const selectedCurrency = useMemo(
    () => CURRENCIES.find((c) => c.code === draft.currencyCode),
    [draft.currencyCode]
  );

  const save = () => {
    onSave(draft);
    alert("Settings saved.");
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Settings</h2>
      <p className="text-sm text-slate-500">
        Defaults used across Visualizer, Quotes, Invoices and Customers.
      </p>

      {/* Currency + symbol */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Currency
          </label>
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
            value={draft.currencyCode}
            onChange={(e) => {
              const code = e.target.value;
              const found = CURRENCIES.find((c) => c.code === code);
              setDraft((d) => ({
                ...d,
                currencyCode: code,
                currencySymbol: found?.symbol ?? d.currencySymbol,
              }));
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500">
            Controls how values are formatted everywhere in the app.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Currency symbol
          </label>
          <input
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
            value={draft.currencySymbol}
            readOnly
          />
          <p className="text-[11px] text-slate-500">
            Automatically driven by the currency above.
          </p>
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-600 bg-slate-50/60">
        Example formatting:{" "}
        <span className="font-semibold">
          {draft.currencySymbol}
          123.45
        </span>{" "}
        — current code:{" "}
        <span className="font-mono text-xs">
          {draft.currencyCode}
        </span>
      </div>

      {/* Invoice numbering, tax, terms */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Invoice prefix
          </label>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={draft.invoicePrefix}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                invoicePrefix: e.target.value,
              }))
            }
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Next invoice number
          </label>
          <input
            type="number"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={draft.nextInvoiceNumber}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                nextInvoiceNumber: num(e.target.value, 1001),
              }))
            }
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Default tax rate (%)
          </label>
          <input
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={draft.taxRate}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                taxRate: num(e.target.value, 0),
              }))
            }
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">
          Default payment terms
        </label>
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={draft.defaultPaymentTerms}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              defaultPaymentTerms: e.target.value,
            }))
          }
        />
      </div>

      {/* Foam backer + theme colour */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={draft.foamBackerEnabled}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                foamBackerEnabled: e.target.checked,
              }))
            }
          />
          Enable foam-backer option in Visualizer
        </label>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">
            Theme colour
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-9 w-12 rounded-lg border border-slate-300"
              value={draft.themeColor}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  themeColor: e.target.value || "#0f172a",
                }))
              }
            />
            <span className="text-xs text-slate-500 font-mono">
              {draft.themeColor}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">
          Invoice / quote footer note
        </label>
        <textarea
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={2}
          value={draft.invoiceFooterNote}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              invoiceFooterNote: e.target.value,
            }))
          }
        />
        <p className="text-[11px] text-slate-500">
          Printed at the bottom of all invoices and quotes.
        </p>
      </div>

      <button
        onClick={save}
        className="mt-2 inline-flex items-center px-4 py-2 rounded-xl bg-slate-900 text-white text-sm hover:bg-slate-800"
      >
        Save settings
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------
   Frames panel
   ------------------------------------------------------------------ */

function FramesPanel({
  frames,
  currencySymbol,
  onChange,
}: {
  frames: Frame[];
  currencySymbol: string;
  onChange: (next: Frame[]) => void;
}) {
  const addFrame = () => {
    const f = newFrame() as any;
    f.name = "New frame";
    onChange([...(frames || []), f]);
  };

  const updateFrameRow = (idx: number, patch: Partial<Frame>) => {
    const next = [...frames];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const remove = (idx: number) => {
    if (!window.confirm("Delete this frame profile?")) return;
    const next = frames.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Frame profiles</h2>
        <button
          onClick={addFrame}
          className="rounded-xl bg-slate-900 text-white px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          Add frame
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Cost per meter is used in Visualizer and job costing.
      </p>

      {frames.length === 0 && (
        <div className="text-sm text-slate-500">
          No frames yet. Click &ldquo;Add frame&rdquo; to create one.
        </div>
      )}

      {frames.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Code</th>
                <th className="py-1 pr-2">Colour</th>
                <th className="py-1 pr-2">Cost / m</th>
                <th className="py-1 pr-2">Markup %</th>
                <th className="py-1 pr-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {frames.map((f, idx) => (
                <tr key={f.id ?? idx} className="border-b last:border-0">
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(f as any).name || ""}
                      onChange={(e) =>
                        updateFrameRow(idx, { name: e.target.value } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(f as any).code || ""}
                      onChange={(e) =>
                        updateFrameRow(idx, { code: e.target.value } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(f as any).colour || (f as any).color || ""}
                      onChange={(e) =>
                        updateFrameRow(idx, { colour: e.target.value } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">
                        {currencySymbol}
                      </span>
                      <input
                        type="number"
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                        value={(f as any).costPerMeter ?? ""}
                        onChange={(e) =>
                          updateFrameRow(idx, {
                            costPerMeter: num(e.target.value, 0),
                          } as any)
                        }
                      />
                    </div>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(f as any).markupPercent ?? ""}
                      onChange={(e) =>
                        updateFrameRow(idx, {
                          markupPercent: num(e.target.value, 0),
                        } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2 text-right">
                    <button
                      onClick={() => remove(idx)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Mats panel
   ------------------------------------------------------------------ */

function MatsPanel({
  mats,
  currencySymbol,
  onChange,
}: {
  mats: Mat[];
  currencySymbol: string;
  onChange: (next: Mat[]) => void;
}) {
  const addMat = () => {
    const m = newMat() as any;
    m.name = "New mat";
    onChange([...(mats || []), m]);
  };

  const updateMatRow = (idx: number, patch: Partial<Mat>) => {
    const next = [...mats];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const remove = (idx: number) => {
    if (!window.confirm("Delete this mat board?")) return;
    const next = mats.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mats</h2>
        <button
          onClick={addMat}
          className="rounded-xl bg-slate-900 text-white px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          Add mat
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Cost per square meter, used for single / multi-aperture layouts.
      </p>

      {mats.length === 0 && (
        <div className="text-sm text-slate-500">
          No mats yet. Click &ldquo;Add mat&rdquo; to create one.
        </div>
      )}

      {mats.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Colour</th>
                <th className="py-1 pr-2">Cost / m²</th>
                <th className="py-1 pr-2">Markup %</th>
                <th className="py-1 pr-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {mats.map((m, idx) => (
                <tr key={m.id ?? idx} className="border-b last:border-0">
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(m as any).name || ""}
                      onChange={(e) =>
                        updateMatRow(idx, { name: e.target.value } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(m as any).colour || (m as any).color || ""}
                      onChange={(e) =>
                        updateMatRow(idx, { colour: e.target.value } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">
                        {currencySymbol}
                      </span>
                      <input
                        type="number"
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                        value={(m as any).costPerSqm ?? ""}
                        onChange={(e) =>
                          updateMatRow(idx, {
                            costPerSqm: num(e.target.value, 0),
                          } as any)
                        }
                      />
                    </div>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(m as any).markupPercent ?? ""}
                      onChange={(e) =>
                        updateMatRow(idx, {
                          markupPercent: num(e.target.value, 0),
                        } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2 text-right">
                    <button
                      onClick={() => remove(idx)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Glazing panel
   ------------------------------------------------------------------ */

function GlazingPanel({
  glazing,
  currencySymbol,
  onChange,
}: {
  glazing: Glazing[];
  currencySymbol: string;
  onChange: (next: Glazing[]) => void;
}) {
  const add = () => {
    const g = newGlazing() as any;
    g.name = "New glazing";
    onChange([...(glazing || []), g]);
  };

  const updateRow = (idx: number, patch: Partial<Glazing>) => {
    const next = [...glazing];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const remove = (idx: number) => {
    if (!window.confirm("Delete this glazing option?")) return;
    const next = glazing.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Glazing</h2>
        <button
          onClick={add}
          className="rounded-xl bg-slate-900 text-white px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          Add glazing
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Cost per square meter; you can include standard, UV, museum glass, etc.
      </p>

      {glazing.length === 0 && (
        <div className="text-sm text-slate-500">
          No glazing options yet. Click &ldquo;Add glazing&rdquo; to create one.
        </div>
      )}

      {glazing.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Type</th>
                <th className="py-1 pr-2">Cost / m²</th>
                <th className="py-1 pr-2">Markup %</th>
                <th className="py-1 pr-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {glazing.map((g, idx) => (
                <tr key={g.id ?? idx} className="border-b last:border-0">
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(g as any).name || ""}
                      onChange={(e) =>
                        updateRow(idx, { name: e.target.value } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(g as any).kind || (g as any).type || ""}
                      onChange={(e) =>
                        updateRow(idx, { kind: e.target.value } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">
                        {currencySymbol}
                      </span>
                      <input
                        type="number"
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                        value={(g as any).costPerSqm ?? ""}
                        onChange={(e) =>
                          updateRow(idx, {
                            costPerSqm: Number(e.target.value) || 0,
                          } as any)
                        }
                      />
                    </div>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(g as any).markupPercent ?? ""}
                      onChange={(e) =>
                        updateRow(idx, {
                          markupPercent: Number(e.target.value) || 0,
                        } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2 text-right">
                    <button
                      onClick={() => remove(idx)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Printing panel
   ------------------------------------------------------------------ */

function PrintingPanel({
  printingMaterials,
  currencySymbol,
  onChange,
}: {
  printingMaterials: PrintingMaterial[];
  currencySymbol: string;
  onChange: (next: PrintingMaterial[]) => void;
}) {
  const add = () => {
    const p = newPrintingMaterial() as any;
    p.name = "New medium";
    onChange([...(printingMaterials || []), p]);
  };

  const updateRow = (idx: number, patch: Partial<PrintingMaterial>) => {
    const next = [...printingMaterials];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const remove = (idx: number) => {
    if (!window.confirm("Delete this printing material?")) return;
    const next = printingMaterials.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Printing</h2>
        <button
          onClick={add}
          className="rounded-xl bg-slate-900 text-white px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          Add medium
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Cost per square meter for in-house printing media (paper, canvas, metal,
        etc).
      </p>

      {printingMaterials.length === 0 && (
        <div className="text-sm text-slate-500">
          No printing materials yet. Click &ldquo;Add medium&rdquo; to create
          one.
        </div>
      )}

      {printingMaterials.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Type</th>
                <th className="py-1 pr-2">Cost / m²</th>
                <th className="py-1 pr-2">Markup %</th>
                <th className="py-1 pr-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {printingMaterials.map((p, idx) => (
                <tr key={p.id ?? idx} className="border-b last:border-0">
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(p as any).name || ""}
                      onChange={(e) =>
                        updateRow(idx, { name: e.target.value } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(p as any).kind || (p as any).type || ""}
                      onChange={(e) =>
                        updateRow(idx, { kind: e.target.value } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">
                        {currencySymbol}
                      </span>
                      <input
                        type="number"
                        className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                        value={(p as any).costPerSqm ?? ""}
                        onChange={(e) =>
                          updateRow(idx, {
                            costPerSqm: Number(e.target.value) || 0,
                          } as any)
                        }
                      />
                    </div>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                      value={(p as any).markupPercent ?? ""}
                      onChange={(e) =>
                        updateRow(idx, {
                          markupPercent: Number(e.target.value) || 0,
                        } as any)
                      }
                    />
                  </td>
                  <td className="py-1 pr-2 text-right">
                    <button
                      onClick={() => remove(idx)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Jobs panel (checklist + ready message template)
   ------------------------------------------------------------------ */

function JobsPanel({
  settings,
  onChange,
}: {
  settings: any;
  onChange: (partial: any) => void;
}) {
  const [items, setItems] = useState<string[]>(() => {
    const fromSettings = settings.jobChecklistTemplate as
      | string[]
      | undefined;
    return fromSettings && fromSettings.length
      ? [...fromSettings]
      : [...DEFAULT_JOB_CHECKLIST];
  });

  const [message, setMessage] = useState<string>(() => {
    return settings.jobReadyMessageTemplate || DEFAULT_READY_MESSAGE;
  });

  const updateItem = (idx: number, text: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = text;
      return next;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, "New checklist item"]);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveItem = (idx: number, direction: -1 | 1) => {
    setItems((prev) => {
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const save = () => {
    onChange({
      jobChecklistTemplate: items,
      jobReadyMessageTemplate: message,
    });
    alert("Job defaults saved.");
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Jobs – Defaults</h2>
        <p className="text-sm text-slate-500">
          Configure the default workshop checklist and the message that is used
          when you send &ldquo;Job ready&rdquo; notifications from the Jobs
          page (Email and WhatsApp).
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start">
        {/* Checklist editor */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-900">
              Job checklist
            </h3>
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              + Add item
            </button>
          </div>
          <p className="text-xs text-slate-500">
            These steps appear on each job card (and Job Card PDF). New jobs
            inherit this list; you can still customise individual jobs later.
          </p>

          <div className="space-y-2">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <span className="text-xs text-slate-400 w-5">
                  {idx + 1}.
                </span>
                <input
                  type="text"
                  className="flex-1 border-none bg-transparent text-sm text-slate-900 focus:outline-none focus:ring-0"
                  value={item}
                  onChange={(e) => updateItem(idx, e.target.value)}
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveItem(idx, -1)}
                    className="rounded-full border border-slate-200 px-2 text-xs text-slate-500 hover:bg-white"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(idx, 1)}
                    className="rounded-full border border-slate-200 px-2 text-xs text-slate-500 hover:bg-white"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="rounded-full border border-rose-200 px-2 text-xs text-rose-600 hover:bg-rose-50"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            {items.length === 0 && (
              <p className="text-xs text-slate-400 italic">
                No checklist items defined. Click &ldquo;Add item&rdquo; to
                create your default workflow.
              </p>
            )}
          </div>
        </div>

        {/* Notification template editor */}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium text-slate-900">
              Ready notification message
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Used when a job is marked complete and you click &ldquo;Email
              customer&rdquo; or &ldquo;WhatsApp customer&rdquo; on the Jobs
              page. You can use these placeholders:
            </p>
          </div>

          <ul className="text-xs text-slate-500 list-disc list-inside space-y-0.5">
            <li>
              <code className="rounded bg-slate-100 px-1">
                {"{{customerName}}"}
              </code>{" "}
              – customer name
            </li>
            <li>
              <code className="rounded bg-slate-100 px-1">
                {"{{jobId}}"}
              </code>{" "}
              – job ID / reference
            </li>
            <li>
              <code className="rounded bg-slate-100 px-1">
                {"{{companyName}}"}
              </code>{" "}
              – your company name
            </li>
            <li>
              <code className="rounded bg-slate-100 px-1">
                {"{{companyAddressLine1}}"}
              </code>
              ,{" "}
              <code className="rounded bg-slate-100 px-1">
                {"{{companyAddressLine2}}"}
              </code>{" "}
              – address lines (optional)
            </li>
          </ul>

          <textarea
            rows={10}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          <p className="text-[11px] text-slate-500">
            The same template is used for both Email and WhatsApp. Email uses it
            as the message body; WhatsApp uses it as the chat text.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={save}
        className="inline-flex items-center px-4 py-2 rounded-xl bg-slate-900 text-white text-sm hover:bg-slate-800"
      >
        Save job defaults
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------
   Integrations panel
   ------------------------------------------------------------------ */

function IntegrationsPanel({
  settings,
  onChange,
}: {
  settings: any;
  onChange: (partial: any) => void;
}) {
  const integrations = settings.integrations || {};
  const qb = integrations.quickbooks || {};
  const xero = integrations.xero || {};

  const updateInt = (key: "quickbooks" | "xero", patch: any) => {
    onChange({
      integrations: {
        ...integrations,
        [key]: { ...(integrations[key] || {}), ...patch },
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-slate-500">
          UI-only for now. Actual API / OAuth wiring comes later.
        </p>
      </div>

      {/* QuickBooks */}
      <div className="rounded-2xl ring-1 ring-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">QuickBooks Online</h3>
            <p className="text-xs text-slate-500">
              Sync invoices to QuickBooks when ready.
            </p>
          </div>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
              qb.connectionStatus === "connected"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-slate-100 text-slate-700 border border-slate-200"
            }`}
          >
            {qb.connectionStatus === "connected"
              ? "Connected"
              : "Not connected"}
          </span>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={!!qb.enabled}
            onChange={(e) =>
              updateInt("quickbooks", { enabled: e.target.checked })
            }
          />
          Enable QuickBooks integration
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={!!qb.autoSyncInvoices}
            onChange={(e) =>
              updateInt("quickbooks", {
                autoSyncInvoices: e.target.checked,
              })
            }
          />
          Auto-sync invoices when they are marked Paid
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            onClick={() =>
              alert(
                "Connect to QuickBooks would start the OAuth flow here (stub)."
              )
            }
          >
            Connect to QuickBooks
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            onClick={() =>
              updateInt("quickbooks", { connectionStatus: "connected" })
            }
          >
            Mark connected
          </button>
          <button
            type="button"
            className="rounded-xl border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50"
            onClick={() =>
              updateInt("quickbooks", { connectionStatus: "disconnected" })
            }
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Xero */}
      <div className="rounded-2xl ring-1 ring-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Xero</h3>
            <p className="text-xs text-slate-500">
              Alternative accounting platform for invoices.
            </p>
          </div>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
              xero.connectionStatus === "connected"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-slate-100 text-slate-700 border border-slate-200"
            }`}
          >
            {xero.connectionStatus === "connected"
              ? "Connected"
              : "Not connected"}
          </span>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={!!xero.enabled}
            onChange={(e) =>
              updateInt("xero", { enabled: e.target.checked })
            }
          />
          Enable Xero integration
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={!!xero.autoSyncInvoices}
            onChange={(e) =>
              updateInt("xero", {
                autoSyncInvoices: e.target.checked,
              })
            }
          />
          Auto-sync invoices when they are marked Paid
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            onClick={() =>
              alert(
                "Connect to Xero would start the OAuth flow here (stub)."
              )
            }
          >
            Connect to Xero
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            onClick={() =>
              updateInt("xero", { connectionStatus: "connected" })
            }
          >
            Mark connected
          </button>
          <button
            type="button"
            className="rounded-xl border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50"
            onClick={() =>
              updateInt("xero", { connectionStatus: "disconnected" })
            }
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
