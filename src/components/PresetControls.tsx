import { useEffect, useRef, useState } from "react";
import { useCompanyPresets, type VisualizerPreset } from "@/lib/presets";

type Props = {
  companyName: string;
  customerKey: string;
  hasSavedCustomer: boolean;
  ensureCustomerId: () => Promise<string>;
  currentState: any;
  onApply: (preset: VisualizerPreset) => void;
};

export default function PresetControls({ companyName, customerKey, hasSavedCustomer, ensureCustomerId, currentState, onApply }: Props) {
  const { presets, loading, error, save, remove, importLegacy, legacyCount } = useCompanyPresets(customerKey);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const scopeRef = useRef("");
  const scope = `${companyName}:${customerKey}`;
  useEffect(() => { scopeRef.current = scope; setFeedback(null); }, [scope]);
  const current = (value: string) => scopeRef.current === value;

  async function savePreset() {
    const scopeAtStart = scope;
    const customerId = await ensureCustomerId();
    if (!current(scopeAtStart)) return;
    if (!customerId) { setFeedback("Save the customer before saving a preset."); return; }
    if (!hasSavedCustomer) { setFeedback("Customer saved. Save the preset again now that it is assigned to this customer."); return; }
    const name = window.prompt("Preset name?");
    if (!name?.trim()) return;
    const result = await save({ id: "", name: name.trim(), state: currentState });
    if (!current(scopeAtStart)) return;
    setFeedback(result.ok ? "Preset saved." : result.error);
  }

  async function deletePreset(preset: VisualizerPreset) {
    const scopeAtStart = scope;
    const result = await remove(preset);
    if (current(scopeAtStart)) setFeedback(result.ok ? "Preset deleted." : result.error);
  }

  async function importPresets() {
    const scopeAtStart = scope;
    const customer = customerKey === "anonymous" ? "unsaved customer" : `customer ${customerKey}`;
    if (!legacyCount || !window.confirm(`Import ${legacyCount} legacy presets into ${companyName || "this company"} for ${customer}? Original browser data will be preserved.`)) return;
    const result = await importLegacy();
    if (!current(scopeAtStart)) return;
    setFeedback(`${result.imported} imported, ${result.skipped} already imported.${result.failures.length ? ` ${result.failures.length} failed.` : ""}`);
  }

  return <div className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-4">
    <div className="flex items-center justify-between mb-3"><div><h3 className="font-semibold text-slate-900">Presets</h3><p className="text-xs text-slate-500">Save this exact setup for reuse.</p></div><div className="relative"><button type="button" className="relative inline-flex items-center justify-between gap-1 rounded-lg px-3 py-1.5 text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm whitespace-nowrap" onClick={() => setMenuOpen(open => !open)}>Save preset</button>{menuOpen && <div className="absolute right-0 mt-1 w-40 rounded-lg border bg-white shadow-lg z-20 text-xs"><button type="button" className="w-full text-left px-3 py-1.5 hover:bg-slate-100" onClick={() => { setMenuOpen(false); void savePreset(); }}>Save preset</button></div>}</div></div>
    {feedback && <p role="status" className="mb-2 text-sm text-slate-600">{feedback}</p>}
    {legacyCount > 0 && <button type="button" onClick={() => void importPresets()} className="mb-2 text-xs text-emerald-700 hover:underline">Import legacy presets</button>}
    {loading ? <p className="text-sm text-slate-500">Loading presets...</p> : error ? <p className="text-sm text-rose-600">Could not load presets: {error}</p> : presets.length === 0 ? <p className="text-sm text-slate-500">No presets yet for this customer.</p> : <ul className="space-y-2">{presets.map(preset => <li key={preset.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"><div className="min-w-0"><div className="text-sm font-medium truncate text-slate-900">{preset.name}</div><div className="text-xs text-slate-500">{new Date(preset.createdAt).toLocaleString()}</div></div><div className="flex gap-2 shrink-0"><button onClick={() => onApply(preset)} className="rounded-lg px-2 py-1 text-xs bg-white ring-1 ring-slate-300 hover:bg-slate-100">Load</button><button onClick={() => void deletePreset(preset)} className="rounded-lg px-2 py-1 text-xs bg-white ring-1 ring-rose-200 text-rose-600 hover:bg-rose-50">Delete</button></div></li>)}</ul>}
  </div>;
}