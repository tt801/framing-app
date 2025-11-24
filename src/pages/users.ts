// src/lib/users.ts
import { create } from "zustand";

export type AppUser = {
  id: string;
  name: string;
  color: string;
};

const LS_KEY = "frameit_users_v1";

const defaultUsers: AppUser[] = [
  { id: "alex", name: "Alex", color: "#6366f1" },     // indigo
  { id: "sarah", name: "Sarah", color: "#ec4899" },   // pink
  { id: "workshop", name: "Workshop", color: "#22c55e" } // green
];

function loadFromStorage(): AppUser[] {
  if (typeof window === "undefined") return defaultUsers;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultUsers;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultUsers;
    return parsed;
  } catch {
    return defaultUsers;
  }
}

function saveToStorage(users: AppUser[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(users));
  } catch {}
}

type UserStore = {
  users: AppUser[];
  addUser: (name: string, color: string) => void;
  updateUser: (id: string, patch: Partial<AppUser>) => void;
};

export const useUsers = create<UserStore>((set, get) => ({
  users: loadFromStorage(),

  addUser(name, color) {
    const id = name.toLowerCase().replace(/\s+/g, "-");
    const newUser = { id, name, color };
    const next = [...get().users, newUser];
    saveToStorage(next);
    set({ users: next });
  },

  updateUser(id, patch) {
    const next = get().users.map((u) =>
      u.id === id ? { ...u, ...patch } : u
    );
    saveToStorage(next);
    set({ users: next });
  }
}));
