// src/pages/Quotes.tsx
import React, { useState, useMemo } from "react";
import { useCatalog } from "../lib/store";
import { useQuotes } from "../lib/quotes";
import { useCustomers } from "../lib/customers";
import { useInvoices } from "../lib/invoices";

export default function QuotesPage() {
  const { catalog } = useCatalog();
  const { quotes, update: updateQuote } = useQuotes(); // make sure your lib/quotes.ts exposes update
  const { customers } = useCustomers();
  const { addFromQuote } = useInvoices();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<any[]>([]);
  const [draftNotes, setDraftNotes] = useState<string>("");

  const money = (n: number) => {
    const code = catalog.settings.currencyCode || "ZAR";
    const sym = catalog.settings.currencySymbol || "R ";
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(n ?? 0); }
    catch { return `${sym}${(n ?? 0).toFixed(2)}`; }
  };

  const rows = useMemo(() => {
    return (quotes || []).map((q: any) => {
      const cust = customers.find(c => c.id === q.customerId);
      const items = q.items || [];
      const subtotal = items.reduce((s: number, it: any) => s + (it.unitPrice || 0) * (it.qty || 1), 0);
      const margin = Number(catalog.settings.marginMultiplier ?? 1);
      const total = subtotal * margin;
      return {
        id: q.id,
        createdAt: q.createdAt || q.meta?.createdAt || q.meta?.dateISO || null,
        customerName: cust ? `${cust.firstName} ${cust.lastName}` : 'Unknown customer',
        customerEmail: cust?.email || '',
        items,
        notes: q.notes || '',
        total,
        subtotal,
        margin,
        customerId: q.customerId,
        raw: q,
      };
    });
  }, [quotes, customers, catalog.settings.marginMultiplier]);

  const startEdit = (row: any) => {
    setEditingId(row.id);
    setDraftItems(row.items ? row.items.map((it: any) => ({ ...it })) : []);
    setDraftNotes(row.notes || "");
  };
  const cancelEdit = () => { setEditingId(null); setDraftItems([]); setDraftNotes(""); };

  const saveEdit = (row: any) => {
    updateQuote({ id: row.id, items: draftItems, notes: draftNotes });
    setEditingId(null);
  };

  return (
    <div className="p-0">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Quotes</h1>
        <div className="text-sm text-slate-500">{rows.length} quote{rows.length === 1 ? "" : "s"}</div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto] gap-3 p-3 text-xs font-medium text-slate-600 border-b">
          <div>Customer</div>
          <div>Created</div>
          <div>Subtotal</div>
          <div>Total</div>
          <div className="text-right">Actions</div>
        </div>

        {rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No quotes yet.</div>
        ) : (
          <div className="divide-y">
            {rows.map(row => {
              const isEditing = editingId === row.id;
              const subtotal = (isEditing ? draftItems : row.items).reduce((s: number, it: any) => s + (it.unitPrice || 0) * (it.qty || 1), 0);
              const total = subtotal * (row.margin ?? 1);

              return (
                <div key={row.id} className="p-3">
                  <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto] gap-3 items-center">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{row.customerName}</div>
                      {row.customerEmail && <div className="truncate text-xs text-slate-600">{row.customerEmail}</div>}
                    </div>
                    <div className="text-sm">{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}</div>
                    <div className="text-sm">{money(subtotal)}</div>
                    <div className="text-sm">{money(total)}</div>
                    <div className="flex items-center gap-2 justify-end">
                      {!isEditing ? (
                        <>
                          <button
                            onClick={() => startEdit(row)}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-black hover:text-white transition"
                          >
                            View / Edit
                          </button>
                          <button
                            onClick={() => {
                              const items = row.items ?? [];
                              const sub = items.reduce((s: number, it: any) => s + (it.unitPrice || 0) * (it.qty || 1), 0);
                              const margin = Number(catalog.settings.marginMultiplier ?? 1);
                              const tot = sub * margin;
                              const inv = addFromQuote({ customerId: row.customerId, items, subtotal: sub, total: tot, notes: row.notes || '' });
                              alert(`Invoice created: ${inv.number}`);
                              location.hash = '#/invoices';
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-black hover:text-white transition"
                          >
                            Invoice
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => saveEdit(row)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-black hover:text-white transition">Save</button>
                          <button onClick={cancelEdit} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-black hover:text-white transition">Cancel</button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Inline editor */}
                  {isEditing && (
                    <div className="mt-3 rounded border bg-slate-50 p-3">
                      <div className="overflow-x-auto">
                        <table className="min-w-[680px] w-full text-sm">
                          <thead>
                            <tr className="text-slate-600">
                              <th className="text-left px-2 py-1">Description</th>
                              <th className="text-right px-2 py-1">Qty</th>
                              <th className="text-right px-2 py-1">Unit Price</th>
                              <th className="text-right px-2 py-1">Line Total</th>
                              <th className="text-right px-2 py-1"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {draftItems.map((it, i) => (
                              <tr key={it.id || i} className="border-t">
                                <td className="px-2 py-1">
                                  <input
                                    className="w-full rounded border px-2 py-1 text-sm"
                                    value={it.description || ""}
                                    onChange={e => {
                                      const v = e.target.value
                                      setDraftItems(prev => prev.map((x, idx) => idx === i ? { ...x, description: v } : x))
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <input
                                    type="number"
                                    className="w-24 rounded border px-2 py-1 text-sm text-right"
                                    value={it.qty ?? 1}
                                    onChange={e => {
                                      const v = Math.max(0, Number(e.target.value) || 0)
                                      setDraftItems(prev => prev.map((x, idx) => idx === i ? { ...x, qty: v } : x))
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <input
                                    type="number"
                                    step="0.01"
                                    className="w-28 rounded border px-2 py-1 text-sm text-right"
                                    value={it.unitPrice ?? 0}
                                    onChange={e => {
                                      const v = Math.max(0, Number(e.target.value) || 0)
                                      setDraftItems(prev => prev.map((x, idx) => idx === i ? { ...x, unitPrice: v } : x))
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-1 text-right">{money((it.qty ?? 1) * (it.unitPrice ?? 0))}</td>
                                <td className="px-2 py-1 text-right">
                                  <button
                                    onClick={() => setDraftItems(prev => prev.filter((_, idx) => idx !== i))}
                                    className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => setDraftItems(prev => [{ id: Math.random().toString(36).slice(2,8), description: 'Item', qty: 1, unitPrice: 0 }, ...prev])}
                          className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white"
                        >
                          Add line
                        </button>
                        <div className="ml-auto text-sm">
                          <span className="mr-4">Subtotal: <b>{money(subtotal)}</b></span>
                          <span>Total (with margin): <b>{money(total)}</b></span>
                        </div>
                      </div>
                      <div className="mt-3">
                        <label className="block text-xs font-medium mb-1">Notes</label>
                        <textarea
                          className="w-full rounded border px-2 py-1 text-sm min-h-[72px]"
                          value={draftNotes}
                          onChange={e => setDraftNotes(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
