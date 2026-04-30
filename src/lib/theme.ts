import { create } from "zustand";

export type ThemeMode = "light" | "dark";

type ThemeState = {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleThemeMode: () => void;
};

const LS_KEY = "frameit_theme_mode_v1";

const getInitialMode = (): ThemeMode => {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(LS_KEY);
  return saved === "dark" || saved === "light" ? (saved as ThemeMode) : "light";
};

export const useTheme = create<ThemeState>((set) => ({
  themeMode: getInitialMode(),
  setThemeMode: (mode) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LS_KEY, mode);
    }
    set({ themeMode: mode });
  },
  toggleThemeMode: () =>
    set((prev) => {
      const next: ThemeMode = prev.themeMode === "light" ? "dark" : "light";
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LS_KEY, next);
      }
      return { themeMode: next };
    }),
}));