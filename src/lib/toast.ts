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
  add: (message: string, type: "success" | "error" | "info" | "warning", duration?: number) => void;
  remove: (id: string) => void;
};

export const useToast = create<ToastStore>((set, get) => ({
  toasts: [],

  add(message, type = "info", duration = 3000) {
    const id = Math.random().toString(36).slice(2, 9);
    const toast: Toast = { id, message, type, duration };
    
    set({ toasts: [...get().toasts, toast] });

    if (duration) {
      setTimeout(() => {
        get().remove(id);
      }, duration);
    }
  },

  remove(id: string) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
