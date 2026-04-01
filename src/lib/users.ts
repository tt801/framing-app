// src/lib/users.ts
import { create } from "zustand";

export type AppUserRole = "owner" | "manager" | "sales" | "workshop" | "staff";
export type AppUserInviteStatus = "accepted" | "pending";

export type AppUser = {
  id: string;
  name: string;
  color: string;
  email?: string;
  phone?: string;
  role: AppUserRole;
  active: boolean;
  inviteStatus: AppUserInviteStatus;
  invitedAt: string;
  lastInviteSentAt?: string;
  lastActiveAt?: string;
};

const LS_KEY = "frameit_users_v1";
const nowIso = () => new Date().toISOString();

const defaultUsers: AppUser[] = [
  { id: "alex", name: "Alex", color: "#6366f1", email: "alex@framersapp.local", phone: "", role: "owner", active: true, inviteStatus: "accepted", invitedAt: nowIso(), lastInviteSentAt: nowIso(), lastActiveAt: nowIso() },
  { id: "sarah", name: "Sarah", color: "#ec4899", email: "sarah@framersapp.local", phone: "", role: "manager", active: true, inviteStatus: "accepted", invitedAt: nowIso(), lastInviteSentAt: nowIso(), lastActiveAt: nowIso() },
  { id: "workshop", name: "Workshop", color: "#22c55e", email: "workshop@framersapp.local", phone: "", role: "workshop", active: true, inviteStatus: "accepted", invitedAt: nowIso(), lastInviteSentAt: nowIso(), lastActiveAt: nowIso() }
];

function migrateUser(raw: any): AppUser {
  return {
    id: String(raw?.id || raw?.name || `user-${Math.random().toString(36).slice(2, 8)}`),
    name: String(raw?.name || "Unnamed user"),
    color: String(raw?.color || "#64748b"),
    email: raw?.email ? String(raw.email) : "",
    phone: raw?.phone ? String(raw.phone) : "",
    role: (raw?.role as AppUserRole) || "staff",
    active: raw?.active !== false,
    inviteStatus: raw?.inviteStatus === "pending" ? "pending" : "accepted",
    invitedAt: raw?.invitedAt || nowIso(),
    lastInviteSentAt: raw?.lastInviteSentAt || raw?.invitedAt || nowIso(),
    lastActiveAt: raw?.lastActiveAt || raw?.invitedAt || nowIso(),
  };
}

function loadFromStorage(): AppUser[] {
  if (typeof window === "undefined") return defaultUsers;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultUsers;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultUsers;
    return parsed.map(migrateUser);
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
  addUser: (input: { name: string; email?: string; phone?: string; color: string; role: AppUserRole; sendInvite?: boolean }) => AppUser | null;
  updateUser: (id: string, patch: Partial<AppUser>) => void;
  removeUser: (id: string) => boolean;
  resendInvite: (id: string) => boolean;
  markInviteAccepted: (id: string) => boolean;
};

export const useUsers = create<UserStore>((set, get) => ({
  users: loadFromStorage(),

  addUser(input) {
    const baseId = input.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `user-${Math.random().toString(36).slice(2, 7)}`;
    const existingIds = new Set(get().users.map((user) => user.id));
    let id = baseId;
    let suffix = 1;

    while (existingIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const newUser: AppUser = {
      id,
      name: input.name,
      email: input.email || "",
      phone: input.phone || "",
      color: input.color,
      role: input.role,
      active: true,
      inviteStatus: input.sendInvite ? "pending" : "accepted",
      invitedAt: nowIso(),
      lastInviteSentAt: nowIso(),
      lastActiveAt: input.sendInvite ? undefined : nowIso(),
    };
    const next = [...get().users, newUser];
    saveToStorage(next);
    set({ users: next });
    return newUser;
  },

  updateUser(id, patch) {
    const next = get().users.map((u) =>
      u.id === id ? { ...u, ...patch } : u
    );
    saveToStorage(next);
    set({ users: next });
  },

  resendInvite(id) {
    let updated = false;
    const next = get().users.map((user) => {
      if (user.id !== id) return user;
      updated = true;
      return {
        ...user,
        inviteStatus: "pending",
        lastInviteSentAt: nowIso(),
      };
    });

    if (!updated) return false;
    saveToStorage(next);
    set({ users: next });
    return true;
  },

  markInviteAccepted(id) {
    let updated = false;
    const next = get().users.map((user) => {
      if (user.id !== id) return user;
      updated = true;
      return {
        ...user,
        inviteStatus: "accepted",
        lastActiveAt: user.lastActiveAt || nowIso(),
      };
    });

    if (!updated) return false;
    saveToStorage(next);
    set({ users: next });
    return true;
  },

  removeUser(id) {
    const users = get().users;
    const target = users.find((user) => user.id === id);
    if (!target) return false;

    const activeOwners = users.filter((user) => user.role === "owner" && user.active);
    if (target.role === "owner" && target.active && activeOwners.length <= 1) {
      return false;
    }

    const next = users.filter((user) => user.id !== id);
    saveToStorage(next);
    set({ users: next });
    return true;
  },
}));
