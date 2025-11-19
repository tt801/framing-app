// src/lib/presets.ts
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
