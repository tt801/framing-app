// src/lib/calendar.ts
import { create } from "zustand";

export type CalendarEventType = "appointment" | "job" | "stock" | "other";

export type CalendarEventStatus =
  | "tentative"
  | "confirmed"
  | "completed"
  | "cancelled";

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  customerId?: string;
  jobId?: string;
  location?: string;
  notes?: string;
  status?: "tentative" | "confirmed" | "completed" | "cancelled";
  assignedTo?: string; // NEW
}
const LS_KEY = "frameit_calendar_events_v1";

const rid = () => Math.random().toString(36).slice(2, 9);

function loadFromLS(): CalendarEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveToLS(events: CalendarEvent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(events));
  } catch {
    // ignore
  }
}

type CalendarState = {
  events: CalendarEvent[];
  addEvent: (partial: Omit<CalendarEvent, "id">) => CalendarEvent;
  updateEvent: (id: string, patch: Partial<CalendarEvent>) => void;
  deleteEvent: (id: string) => void;
  clearAll: () => void;
};

export const useCalendar = create<CalendarState>((set, get) => ({
  events: loadFromLS(),

  addEvent(partial) {
    const event: CalendarEvent = {
      id: rid(),
      status: "confirmed",
      ...partial,
    };
    const next = [...get().events, event];
    saveToLS(next);
    set({ events: next });
    return event;
  },

  updateEvent(id, patch) {
    const next = get().events.map((ev) =>
      ev.id === id ? { ...ev, ...patch } : ev
    );
    saveToLS(next);
    set({ events: next });
  },

  deleteEvent(id) {
    const next = get().events.filter((ev) => ev.id !== id);
    saveToLS(next);
    set({ events: next });
  },

  clearAll() {
    saveToLS([]);
    set({ events: [] });
  },
}));
