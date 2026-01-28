// src/lib/history.ts - Simple undo/redo system
import { create } from "zustand";

export type HistoryAction = {
  id: string;
  name: string;
  undo: () => void;
  redo: () => void;
  timestamp: number;
};

type HistoryStore = {
  past: HistoryAction[];
  future: HistoryAction[];
  add: (action: HistoryAction) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
};

export const useHistory = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],

  add(action: HistoryAction) {
    set({
      past: [...get().past, action],
      future: [], // clear redo history when new action is added
    });
  },

  undo() {
    const { past, future } = get();
    if (past.length === 0) return;

    const action = past[past.length - 1];
    action.undo();

    set({
      past: past.slice(0, -1),
      future: [...future, action],
    });
  },

  redo() {
    const { past, future } = get();
    if (future.length === 0) return;

    const action = future[future.length - 1];
    action.redo();

    set({
      past: [...past, action],
      future: future.slice(0, -1),
    });
  },

  canUndo() {
    return get().past.length > 0;
  },

  canRedo() {
    return get().future.length > 0;
  },

  clear() {
    set({ past: [], future: [] });
  },
}));
