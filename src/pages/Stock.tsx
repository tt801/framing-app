// src/pages/Stock.tsx
import React, { useRef, useState } from "react";
import { useCatalog, type StockFrame, type StockSheet, type StockRoll } from "../lib/store";

export default function StockPage() {
  const { catalog, setCatalog } = useCatalog();

  const [scanCode, setScanCode] = useState("");
  const [highlight, setHighlight] = useState<{
    section: "frames" | "sheets" | "rolls" | null;
    index: number;
  }>({ section: null, index: -1 });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const n = (v: any, fb = 0) => {
    const x = typeof v === "string" ? parseFloat(v) : Number(v);
    return Number.isFinite(x) ? x : fb;
  };

  // Safely tap into catalog items (frames, printing materials) without breaking types
  const anyCatalog: any = catalog || {};
  const frameOptions: string[] = (anyCatalog.frames || [])
    .map((f: any) => f?.id ?? f?.profileId ?? f?.code ?? "")
    .filter(Boolean);
  const printMaterialOptions: string[] = (anyCatalog.printingMaterials || [])
    .map((m: any) => m?.id ?? m?.code ?? m?.name ?? "")
    .filter(Boolean);

  const frames: StockFrame[] = catalog.stock?.frames || [];
  const sheets: StockSheet[] = catalog.stock?.sheets || [];
  const rolls: StockRoll[] = catalog.stock?.rolls || [];

  const lowFrames = frames.filter((f) => n(f.metersAvailable) <= n(f.minThreshold)).length;
  const lowSheets = sheets.filter((s) => n(s.qty) <= n(s.minThreshold)).length;
  const lowRolls = rolls.filter((r) => n(r.metersRemaining) <= n(r.minThreshold)).length;
  const totalSkus = frames.length + sheets.length + rolls.length;

  // ------- CSV Export / Import -------

  const handleExportCSV = () => {
    const csv = buildStockCSV(frames, sheets, rolls);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "frameit-stock.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const { frames: f, sheets: s, rolls: r } = parseStockCSV(text);
        setCatalog((prev) => {
          const stock = prev.stock || {};
          return {
            ...prev,
            stock: {
              ...stock,
              frames: f,
              sheets: s,
              rolls: r,
            },
          };
        });
        window.alert(
          `Imported ${f.length} frames, ${s.length} sheets, ${r.length} rolls from CSV.`
        );
      } catch (err) {
        console.error(err);
        window.alert("Could not import stock CSV. Please check the format.");
      }
    };
    reader.readAsText(file);
    // reset input so same file can be re-selected
    e.target.value = "";
  };

  // ------- Barcode / scan search -------

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanCode.trim();
    if (!code) return;

    // 1) Try frames by profileId
    let section: "frames" | "sheets" | "rolls" | null = null;
    let index = -1;

    const frameIndex = frames.findIndex((f) => String(f.profileId ?? "") === code);
    if (frameIndex >= 0) {
      section = "frames";
      index = frameIndex;
    } else {
      // 2) Try sheets by SKU
      const sheetIndex = sheets.findIndex((s) => String(s.sku ?? "") === code);
      if (sheetIndex >= 0) {
        section = "sheets";
        index = sheetIndex;
      } else {
        // 3) Try rolls by materialId
        const rollIndex = rolls.findIndex((r) => String(r.materialId ?? "") === code);
        if (rollIndex >= 0) {
          section = "rolls";
          index = rollIndex;
        }
      }
    }

    if (section && index >= 0) {
      setHighlight({ section, index });
    } else {
      window.alert(`No stock item found for code: ${code}`);
      setHighlight({ section: null, index: -1 });
    }

    setScanCode("");
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="text-lg font-semibold">Stock</h1>
        </header>

        {/* Top tools split into 2 cards (1x2 format) */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* CSV tools */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">CSV import / export</h2>
              <p className="mt-1 text-xs text-slate-500">
                Download your current stock as a CSV, edit it in Excel/Sheets, and re-import to
                update FrameIT.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExportCSV}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={handleImportClick}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white"
              >
                Import CSV
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Barcode / code scanner */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Barcode / code scanner</h2>
              <p className="mt-1 text-xs text-slate-500">
                Scan or type a frame profile ID, sheet SKU, or print material ID to jump to that
                row. USB barcode scanners that act like a keyboard will work here.
              </p>
            </div>

            <form
              onSubmit={handleScanSubmit}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
            >
              <label className="text-xs font-medium text-slate-700 sm:w-32">
                Scan / search code
              </label>
              <input
                type="text"
                className="w-full max-w-sm rounded border px-2 py-1 text-sm"
                placeholder="Scan or type code..."
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
              />
              <button
                type="submit"
                className="mt-1 inline-flex items-center justify-center rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white sm:mt-0"
              >
                Go
              </button>
            </form>
          </div>
        </section>

        {/* Overview tiles */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewTile
            label="Frames (low / total)"
            value={`${lowFrames} / ${frames.length || 0}`}
            tone={lowFrames > 0 ? "warn" : "ok"}
          />
          <OverviewTile
            label="Sheets (low / total)"
            value={`${lowSheets} / ${sheets.length || 0}`}
            tone={lowSheets > 0 ? "warn" : "ok"}
          />
          <OverviewTile
            label="Print rolls (low / total)"
            value={`${lowRolls} / ${rolls.length || 0}`}
            tone={lowRolls > 0 ? "warn" : "ok"}
          />
          <OverviewTile label="Total SKUs" value={totalSkus} tone="neutral" />
        </section>

        {/* Frames by meters */}
        <Card title="Frames (meters available)">
          <StockTable
            columns={[
              {
                key: "profileId",
                label: "Frame Profile ID",
                type: "select",
                options: frameOptions.length ? frameOptions : undefined,
              },
              { key: "metersAvailable", label: "Meters Available", type: "number" },
              { key: "minThreshold", label: "Min Threshold", type: "number" },
            ]}
            rows={frames}
            onChange={(idx, key, val) => {
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const list = stock.frames ? [...stock.frames] : [];
                list[idx] = {
                  ...list[idx],
                  [key]: key === "metersAvailable" || key === "minThreshold" ? n(val) : val,
                } as StockFrame;
                return { ...prev, stock: { ...stock, frames: list } };
              });
            }}
            onAdd={() =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const next: StockFrame = {
                  profileId: "",
                  metersAvailable: 0,
                  minThreshold: 0,
                };
                return { ...prev, stock: { ...stock, frames: [...(stock.frames || []), next] } };
              })
            }
            onDelete={(idx) =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                return {
                  ...prev,
                  stock: { ...stock, frames: (stock.frames || []).filter((_, i) => i !== idx) },
                };
              })
            }
            rowClassName={(row) =>
              n(row.metersAvailable) <= n(row.minThreshold) && n(row.minThreshold) > 0
                ? "bg-red-50"
                : ""
            }
            cellClassName={(row, _idx, key) =>
              key === "metersAvailable" &&
              n(row.metersAvailable) <= n(row.minThreshold) &&
              n(row.minThreshold) > 0
                ? "font-semibold text-red-700"
                : ""
            }
            addLabel="Add frame run"
            highlightIndex={highlight.section === "frames" ? highlight.index : -1}
          />
        </Card>

        {/* Sheets */}
        <Card title="Sheets (mats, glazing, backer)">
          <StockTable
            columns={[
              {
                key: "type",
                label: "Type",
                type: "select",
                options: ["mat", "glazing", "backer"],
              },
              { key: "sku", label: "SKU", type: "text" },
              { key: "widthCm", label: "Width (cm)", type: "number" },
              { key: "heightCm", label: "Height (cm)", type: "number" },
              { key: "qty", label: "Quantity", type: "number" },
              { key: "minThreshold", label: "Min Threshold", type: "number" },
            ]}
            rows={sheets}
            onChange={(idx, key, val) => {
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const list = stock.sheets ? [...stock.sheets] : [];
                const numeric = ["widthCm", "heightCm", "qty", "minThreshold"].includes(key);
                list[idx] = {
                  ...list[idx],
                  [key]: numeric ? n(val) : val,
                } as StockSheet;
                return { ...prev, stock: { ...stock, sheets: list } };
              });
            }}
            onAdd={() =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const next: StockSheet = {
                  id: rid(),
                  type: "mat",
                  sku: "",
                  widthCm: 100,
                  heightCm: 70,
                  qty: 1,
                  minThreshold: 0,
                };
                return { ...prev, stock: { ...stock, sheets: [...(stock.sheets || []), next] } };
              })
            }
            onDelete={(idx) =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                return {
                  ...prev,
                  stock: { ...stock, sheets: (stock.sheets || []).filter((_, i) => i !== idx) },
                };
              })
            }
            rowClassName={(row) =>
              n(row.qty) <= n(row.minThreshold) && n(row.minThreshold) > 0 ? "bg-red-50" : ""
            }
            cellClassName={(row, _idx, key) =>
              key === "qty" && n(row.qty) <= n(row.minThreshold) && n(row.minThreshold) > 0
                ? "font-semibold text-red-700"
                : ""
            }
            addLabel="Add sheet"
            highlightIndex={highlight.section === "sheets" ? highlight.index : -1}
          />
        </Card>

        {/* Printing rolls */}
        <Card title="Printing rolls">
          <StockTable
            columns={[
              {
                key: "materialId",
                label: "Print Material ID",
                type: "select",
                options: printMaterialOptions.length ? printMaterialOptions : undefined,
              },
              { key: "widthCm", label: "Width (cm)", type: "number" },
              { key: "metersRemaining", label: "Meters Remaining", type: "number" },
              { key: "minThreshold", label: "Min Threshold", type: "number" },
            ]}
            rows={rolls}
            onChange={(idx, key, val) => {
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const list = stock.rolls ? [...stock.rolls] : [];
                const numeric = ["widthCm", "metersRemaining", "minThreshold"].includes(key);
                list[idx] = {
                  ...list[idx],
                  [key]: numeric ? n(val) : val,
                } as StockRoll;
                return { ...prev, stock: { ...stock, rolls: list } };
              });
            }}
            onAdd={() =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const next: StockRoll = {
                  materialId: "",
                  widthCm: 61,
                  metersRemaining: 30,
                  minThreshold: 0,
                };
                return { ...prev, stock: { ...stock, rolls: [...(stock.rolls || []), next] } };
              })
            }
            onDelete={(idx) =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                return {
                  ...prev,
                  stock: { ...stock, rolls: (stock.rolls || []).filter((_, i) => i !== idx) },
                };
              })
            }
            rowClassName={(row) =>
              n(row.metersRemaining) <= n(row.minThreshold) && n(row.minThreshold) > 0
                ? "bg-red-50"
                : ""
            }
            cellClassName={(row, _idx, key) =>
              key === "metersRemaining" &&
              n(row.metersRemaining) <= n(row.minThreshold) &&
              n(row.minThreshold) > 0
                ? "font-semibold text-red-700"
                : ""
            }
            addLabel="Add print roll"
            highlightIndex={highlight.section === "rolls" ? highlight.index : -1}
          />
        </Card>
      </div>
    </main>
  );
}

function OverviewTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn" | "neutral";
}) {
  const toneClasses =
    tone === "warn"
      ? "border-red-100 bg-red-50 text-red-800"
      : tone === "ok"
      ? "border-emerald-100 bg-emerald-50 text-emerald-800"
      : "border-slate-100 bg-slate-50 text-slate-800";

  return (
    <div className={`rounded-2xl border px-3 py-3 text-sm shadow-sm ${toneClasses}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
      <h2 className="text-base font-semibold mb-3">{title}</h2>
      {children}
    </section>
  );
}

type ColumnDef = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
};

function StockTable({
  columns,
  rows,
  onChange,
  onAdd,
  onDelete,
  rowClassName,
  cellClassName,
  addLabel = "Add",
  highlightIndex = -1,
}: {
  columns: ColumnDef[];
  rows: any[];
  onChange: (index: number, key: string, value: any) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
  rowClassName?: (row: any, index: number) => string;
  cellClassName?: (row: any, index: number, colKey: string) => string;
  addLabel?: string;
  highlightIndex?: number;
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b">
              {columns.map((col) => (
                <th key={col.key} className="px-3 py-2 text-left">
                  {col.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const baseRowClass = rowClassName ? rowClassName(row, idx) : "";
              const highlightClass =
                highlightIndex === idx ? " ring-2 ring-sky-400 ring-offset-0" : "";
              return (
                <tr key={idx} className={`border-b ${baseRowClass}${highlightClass}`}>
                  {columns.map((col) => {
                    const baseCell = "px-3 py-1.5";
                    const extra =
                      cellClassName?.(row, idx, col.key) ??
                      (col.type === "number" ? " text-right" : "");
                    const cellClasses = `${baseCell}${extra ? " " + extra : ""}`;

                    return (
                      <td key={col.key} className={cellClasses}>
                        {col.type === "number" ? (
                          <input
                            type="number"
                            className="w-full rounded border px-2 py-1 text-sm text-right"
                            value={row[col.key] ?? 0}
                            onChange={(e) => onChange(idx, col.key, e.target.value)}
                          />
                        ) : col.type === "select" ? (
                          <select
                            className="w-full rounded border px-2 py-1 text-sm bg-white"
                            value={row[col.key] ?? (col.options?.[0] ?? "")}
                            onChange={(e) => onChange(idx, col.key, e.target.value)}
                          >
                            <option value="">Select…</option>
                            {col.options?.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="w-full rounded border px-2 py-1 text-sm"
                            value={row[col.key] ?? ""}
                            onChange={(e) => onChange(idx, col.key, e.target.value)}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => onDelete(idx)}
                      className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={columns.length + 1}>
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        onClick={onAdd}
        className="rounded border px-3 py-2 text-sm hover:bg-black hover:text-white"
      >
        {addLabel}
      </button>
    </div>
  );
}

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

// ------- CSV helpers -------

function csvEscape(value: any): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildStockCSV(frames: StockFrame[], sheets: StockSheet[], rolls: StockRoll[]): string {
  const header = [
    "type",
    "profileId",
    "metersAvailable",
    "sheetType",
    "sku",
    "widthCm",
    "heightCm",
    "qty",
    "materialId",
    "metersRemaining",
    "minThreshold",
  ];

  const rows: string[][] = [header];

  frames.forEach((f) => {
    rows.push([
      "frame",
      csvEscape(f.profileId),
      csvEscape(f.metersAvailable),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      csvEscape(f.minThreshold),
    ]);
  });

  sheets.forEach((s) => {
    rows.push([
      "sheet",
      "",
      "",
      csvEscape(s.type),
      csvEscape((s as any).sku ?? ""),
      csvEscape(s.widthCm),
      csvEscape(s.heightCm),
      csvEscape(s.qty),
      "",
      "",
      csvEscape(s.minThreshold),
    ]);
  });

  rolls.forEach((r) => {
    rows.push([
      "roll",
      "",
      "",
      "",
      "",
      csvEscape(r.widthCm),
      "",
      "",
      csvEscape(r.materialId),
      csvEscape(r.metersRemaining),
      csvEscape(r.minThreshold),
    ]);
  });

  return rows.map((r) => r.join(",")).join("\r\n");
}

function parseStockCSV(text: string): {
  frames: StockFrame[];
  sheets: StockSheet[];
  rolls: StockRoll[];
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return { frames: [], sheets: [], rolls: [] };
  }

  const header = lines[0].split(",").map((h) => h.trim());
  const idxOf = (name: string) => header.indexOf(name);

  const frames: StockFrame[] = [];
  const sheets: StockSheet[] = [];
  const rolls: StockRoll[] = [];

  const num = (v: string | undefined, fb = 0): number => {
    const x = v ? parseFloat(v) : NaN;
    return Number.isFinite(x) ? x : fb;
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (!cols.length) continue;

    const get = (name: string): string => {
      const idx = idxOf(name);
      if (idx < 0 || idx >= cols.length) return "";
      const raw = cols[idx] ?? "";
      const trimmed = raw.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replace(/""/g, '"').trim();
      }
      return trimmed;
    };

    const type = get("type").toLowerCase();
    if (!type) continue;

    if (type === "frame") {
      frames.push({
        profileId: get("profileId"),
        metersAvailable: num(get("metersAvailable")),
        minThreshold: num(get("minThreshold")),
      });
    } else if (type === "sheet") {
      sheets.push({
        id: rid(),
        type: (get("sheetType") as StockSheet["type"]) || "mat",
        sku: get("sku"),
        widthCm: num(get("widthCm"), 100),
        heightCm: num(get("heightCm"), 70),
        qty: num(get("qty"), 1),
        minThreshold: num(get("minThreshold")),
      } as StockSheet);
    } else if (type === "roll") {
      rolls.push({
        materialId: get("materialId"),
        widthCm: num(get("widthCm"), 61),
        metersRemaining: num(get("metersRemaining"), 0),
        minThreshold: num(get("minThreshold")),
      } as StockRoll);
    }
  }

  return { frames, sheets, rolls };
}
