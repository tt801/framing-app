// src/pages/Stock.tsx
import React from "react";
import { useCatalog, type StockFrame, type StockSheet, type StockRoll } from "../lib/store";

export default function StockPage() {
  const { catalog, setCatalog } = useCatalog();

  const n = (v: any, fb = 0) => {
    const x = typeof v === 'string' ? parseFloat(v) : Number(v);
    return Number.isFinite(x) ? x : fb;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Stock</h1>

      {/* Frames by meters */}
      <Card title="Frames (meters available)">
        <StockTable
          columns={[
            { key: "profileId", label: "Frame Profile ID", type: "text" },
            { key: "metersAvailable", label: "Meters Available", type: "number" },
            { key: "minThreshold", label: "Min Threshold", type: "number" },
          ]}
          rows={catalog.stock?.frames || []}
          onChange={(idx, key, val) => {
            setCatalog(prev => {
              const list = prev.stock?.frames ? [...prev.stock.frames] : [];
              list[idx] = { ...list[idx], [key]: key === "metersAvailable" || key === "minThreshold" ? n(val) : val } as StockFrame;
              return { ...prev, stock: { ...prev.stock, frames: list } };
            });
          }}
          onAdd={() => setCatalog(prev => ({ ...prev, stock: { ...prev.stock, frames: [...(prev.stock?.frames || []), { profileId: "", metersAvailable: 0, minThreshold: 0 }] } }))}
          onDelete={idx => setCatalog(prev => ({ ...prev, stock: { ...prev.stock, frames: (prev.stock?.frames || []).filter((_, i) => i !== idx) } }))}
        />
      </Card>

      {/* Sheets */}
      <Card title="Sheets (mats, glazing, backer)">
        <StockTable
          columns={[
            { key: "type", label: "Type", type: "select", options: ["mat", "glazing", "backer"] },
            { key: "sku", label: "SKU", type: "text" },
            { key: "widthCm", label: "Width (cm)", type: "number" },
            { key: "heightCm", label: "Height (cm)", type: "number" },
            { key: "qty", label: "Quantity", type: "number" },
            { key: "minThreshold", label: "Min Threshold", type: "number" },
          ]}
          rows={catalog.stock?.sheets || []}
          onChange={(idx, key, val) => {
            setCatalog(prev => {
              const list = prev.stock?.sheets ? [...prev.stock.sheets] : [];
              const numeric = ["widthCm", "heightCm", "qty", "minThreshold"].includes(key);
              list[idx] = { ...list[idx], [key]: numeric ? n(val) : val } as StockSheet;
              return { ...prev, stock: { ...prev.stock, sheets: list } };
            });
          }}
          onAdd={() => setCatalog(prev => ({ ...prev, stock: { ...prev.stock, sheets: [...(prev.stock?.sheets || []), { id: rid(), type: "mat", sku: "", widthCm: 100, heightCm: 70, qty: 1, minThreshold: 0 }] } }))}
          onDelete={idx => setCatalog(prev => ({ ...prev, stock: { ...prev.stock, sheets: (prev.stock?.sheets || []).filter((_, i) => i !== idx) } }))}
        />
      </Card>

      {/* Printing rolls */}
      <Card title="Printing rolls">
        <StockTable
          columns={[
            { key: "materialId", label: "Print Material ID", type: "text" },
            { key: "widthCm", label: "Width (cm)", type: "number" },
            { key: "metersRemaining", label: "Meters Remaining", type: "number" },
            { key: "minThreshold", label: "Min Threshold", type: "number" },
          ]}
          rows={catalog.stock?.rolls || []}
          onChange={(idx, key, val) => {
            setCatalog(prev => {
              const list = prev.stock?.rolls ? [...prev.stock.rolls] : [];
              const numeric = ["widthCm", "metersRemaining", "minThreshold"].includes(key);
              list[idx] = { ...list[idx], [key]: numeric ? n(val) : val } as StockRoll;
              return { ...prev, stock: { ...prev.stock, rolls: list } };
            });
          }}
          onAdd={() => setCatalog(prev => ({ ...prev, stock: { ...prev.stock, rolls: [...(prev.stock?.rolls || []), { materialId: "", widthCm: 61, metersRemaining: 30, minThreshold: 0 }] } }))}
          onDelete={idx => setCatalog(prev => ({ ...prev, stock: { ...prev.stock, rolls: (prev.stock?.rolls || []).filter((_, i) => i !== idx) } }))}
        />
      </Card>
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

function StockTable({
  columns,
  rows,
  onChange,
  onAdd,
  onDelete,
}: {
  columns: { key: string; label: string; type: "text" | "number" | "select"; options?: string[] }[];
  rows: any[];
  onChange: (index: number, key: string, value: any) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b">
              {columns.map(col => (<th key={col.key} className="px-3 py-2 text-left">{col.label}</th>))}
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b">
                {columns.map(col => (
                  <td key={col.key} className="px-3 py-1.5">
                    {col.type === "number" ? (
                      <input type="number" className="w-full rounded border px-2 py-1 text-sm" value={row[col.key] ?? 0} onChange={e => onChange(idx, col.key, e.target.value)} />
                    ) : col.type === "select" ? (
                      <select className="w-full rounded border px-2 py-1 text-sm bg-white" value={row[col.key] ?? col.options?.[0]} onChange={e => onChange(idx, col.key, e.target.value)}>
                        {col.options?.map(opt => (<option key={opt} value={opt}>{opt}</option>))}
                      </select>
                    ) : (
                      <input className="w-full rounded border px-2 py-1 text-sm" value={row[col.key] ?? ""} onChange={e => onChange(idx, col.key, e.target.value)} />
                    )}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right">
                  <button onClick={() => onDelete(idx)} className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white">Delete</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td className="px-3 py-6 text-slate-500" colSpan={columns.length + 1}>No rows.</td></tr>}
          </tbody>
        </table>
      </div>
      <button onClick={onAdd} className="rounded border px-3 py-2 text-sm hover:bg-black hover:text-white">Add</button>
    </div>
  );
}

function rid() { return Math.random().toString(36).slice(2, 8) }
