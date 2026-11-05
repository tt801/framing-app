// src/lib/toast.ts - Simple toast notification system
import { create } from "zustand";

export type Toast = {
  id: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
  duration?: number;
};

type ToastStore = {
  toasts: Toast[];
  // A duration of zero keeps a notification until explicitly dismissed.
  add: (message: string, type?: Toast["type"], duration?: number) => string;
  remove: (id: string) => void;
};

let nextId = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToast = create<ToastStore>((set, get) => ({
  toasts: [],

  add(message, type = "info", duration = 3000) {
    const id = `toast-${++nextId}`;
    const toast: Toast = { id, message, type, duration };
    
    set({ toasts: [...get().toasts, toast] });

    if (Number.isFinite(duration) && duration > 0) {
      timers.set(id, setTimeout(() => {
        get().remove(id);
      }, duration));
    }
    return id;
  },

  remove(id: string) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
