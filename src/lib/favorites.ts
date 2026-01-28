// src/lib/favorites.ts - Favorites/star system
import { create } from "zustand";

const LS_KEY = "frameit_favorites_v1";

type FavoritesStore = {
  favorites: Set<string>;
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  isFavorited: (id: string) => boolean;
};

function loadFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveToStorage(favorites: Set<string>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Array.from(favorites)));
  } catch {}
}

export const useFavorites = create<FavoritesStore>((set, get) => ({
  favorites: loadFromStorage(),

  add(id: string) {
    const next = new Set(get().favorites);
    next.add(id);
    saveToStorage(next);
    set({ favorites: next });
  },

  remove(id: string) {
    const next = new Set(get().favorites);
    next.delete(id);
    saveToStorage(next);
    set({ favorites: next });
  },

  toggle(id: string) {
    const { favorites } = get();
    if (favorites.has(id)) {
      get().remove(id);
    } else {
      get().add(id);
    }
  },

  isFavorited(id: string) {
    return get().favorites.has(id);
  },
}));
