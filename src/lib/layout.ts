// src/lib/layout.ts
import { create } from "zustand";

export type LayoutMode = "fixed" | "full";

type LayoutState = {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  toggleLayoutMode: () => void;
};

const LS_KEY = "frameit_layout_mode_v1";

const getInitialMode = (): LayoutMode => {
  if (typeof window === "undefined") return "fixed";
  const saved = window.localStorage.getItem(LS_KEY);
  return saved === "fixed" || saved === "full" ? (saved as LayoutMode) : "fixed";
};

export const useLayout = create<LayoutState>((set) => ({
  layoutMode: getInitialMode(),
  setLayoutMode: (mode) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LS_KEY, mode);
    }
    set({ layoutMode: mode });
  },
  toggleLayoutMode: () =>
    set((prev) => {
      const next: LayoutMode = prev.layoutMode === "fixed" ? "full" : "fixed";
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LS_KEY, next);
      }
      return { layoutMode: next };
    }),
}));
