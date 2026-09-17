// src/lib/presets.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBillingAccess, useBillingWriteGuard } from "@/lib/billingAccess";
export type VisualizerPreset = {
  id: string;
  name: string;
  createdAt: number;
  state: any; // snapshot of visualizer state
};

const KEY = (customerId: string) => `frameit_presets_v1_${customerId}`;

export function listPresets(customerId: string): VisualizerPreset[] {
  try {
    const raw = localStorage.getItem(KEY(customerId));
    return raw ? (JSON.parse(raw) as VisualizerPreset[]) : [];
  } catch {
    return [];
  }
}

export function savePreset(
  customerId: string,
  preset: { name: string; state: any }
) {
  const all = listPresets(customerId);
  const full: VisualizerPreset = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...preset,
  };
  localStorage.setItem(KEY(customerId), JSON.stringify([full, ...all]));
  return full;
}

export function deletePreset(customerId: string, id: string) {
  const all = listPresets(customerId).filter((p) => p.id !== id);
  localStorage.setItem(KEY(customerId), JSON.stringify(all));
}

type PresetRow = { id: string; name: string; state: any; created_at: string; revision: number };
const fromRow = (row: PresetRow): VisualizerPreset => ({ id: row.id, name: row.name, state: row.state, createdAt: new Date(row.created_at).getTime(), revision: row.revision });

export function useCompanyPresets(customerId: string) {
  const billing = useBillingAccess(); const allowWrite = useBillingWriteGuard(); const [presets, setPresets] = useState<VisualizerPreset[]>([]); const presetsRef = useRef<VisualizerPreset[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const requestRef = useRef(0);
  useEffect(() => { presetsRef.current = presets; }, [presets]);
  const refresh = useCallback(async () => { const request = ++requestRef.current; if (!supabase || !billing.companyAccountId) { setPresets([]); setLoading(false); return; } setPresets([]); setLoading(true); const { data, error } = await supabase.from("company_presets").select("id,name,state,created_at,revision").eq("company_account_id", billing.companyAccountId).eq("customer_id", customerId).order("created_at", { ascending: false }); if (request !== requestRef.current) return; if (error) { setError(error.message); setLoading(false); return; } setPresets((data || []).map(fromRow)); setError(null); setLoading(false); }, [billing.companyAccountId, customerId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const save = useCallback(async (preset: Omit<VisualizerPreset, "createdAt" | "revision">) => { if (!allowWrite("save presets")) return { ok: false as const, error: "Read-only account" }; if (!supabase || !billing.companyAccountId) return { ok: false as const, error: "No active company account" }; const { data, error } = await supabase.rpc("create_company_preset", { p_id: preset.id || crypto.randomUUID(), p_company: billing.companyAccountId, p_customer: customerId, p_name: preset.name, p_state: preset.state }); if (error || !data) return { ok: false as const, error: error?.message || "Could not save preset" }; const saved = fromRow(data as PresetRow); presetsRef.current = [saved, ...presetsRef.current.filter(item => item.id !== saved.id)]; setPresets(previous => [saved, ...previous.filter(item => item.id !== saved.id)]); return { ok: true as const, preset: saved }; }, [allowWrite, billing.companyAccountId, customerId]);
  const update = useCallback(async (preset: VisualizerPreset) => { if (!allowWrite("edit presets")) return { ok: false as const, error: "Read-only account" }; if (!supabase || !billing.companyAccountId) return { ok: false as const, error: "No active company account" }; const { data, error } = await supabase.rpc("update_company_preset", { p_id: preset.id, p_company: billing.companyAccountId, p_name: preset.name, p_state: preset.state, p_revision: preset.revision }); if (error || !data) return { ok: false as const, error: error?.message || "Preset changed or no longer exists" }; const saved = fromRow(data as PresetRow); setPresets(previous => previous.map(item => item.id === saved.id ? saved : item)); return { ok: true as const, preset: saved }; }, [allowWrite, billing.companyAccountId]);
  const remove = useCallback(async (preset: VisualizerPreset) => { if (!allowWrite("delete presets")) return { ok: false as const, error: "Read-only account" }; if (!supabase || !billing.companyAccountId) return { ok: false as const, error: "No active company account" }; const { error } = await supabase.rpc("delete_company_preset", { p_id: preset.id, p_company: billing.companyAccountId, p_revision: preset.revision }); if (error) return { ok: false as const, error: error.message }; setPresets(previous => previous.filter(item => item.id !== preset.id)); return { ok: true as const }; }, [allowWrite, billing.companyAccountId]);
  const importLegacy = useCallback(async () => { let imported = 0, skipped = 0; const failures: Array<{ id: string; reason: string }> = []; const known = new Set(presetsRef.current.map(preset => preset.id)); for (const preset of listPresets(customerId)) { if (known.has(preset.id)) { skipped++; continue; } const result = await save(preset); if (result.ok) { imported++; known.add(preset.id); } else if (/duplicate|unique/i.test(result.error)) { skipped++; known.add(preset.id); } else failures.push({ id: preset.id, reason: result.error }); } return { ok: true as const, imported, skipped, failures }; }, [customerId, save]);
  return { presets, loading, error, refresh, save, update, remove, importLegacy, legacyCount: listPresets(customerId).length };
}
