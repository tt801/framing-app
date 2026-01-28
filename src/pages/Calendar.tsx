// src/pages/Calendar.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  Calendar as RBCalendar,
  Views,
  dateFnsLocalizer,
} from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import {
  format,
  parse,
  startOfWeek,
  getDay,
  addHours,
  isSameDay,
} from "date-fns";

import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

import {
  useCalendar,
  type CalendarEvent,
  type CalendarEventType,
} from "@/lib/calendar";
import { useCustomers } from "@/lib/customers";
import { useJobs } from "@/lib/jobs";
import { useLayout } from "@/lib/layout";
import { useUsers } from "@/lib/users";
import { useToast } from "@/lib/toast";
import { useHistory } from "@/lib/history";

import * as enGB from "date-fns/locale/en-GB";

// ---------- localisation ----------
const locales = {
  "en-GB": (enGB as any).default ?? enGB,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

const DnDCalendar = withDragAndDrop(RBCalendar as any);

// ---------- colours ----------
const typeColor: Record<CalendarEventType, string> = {
  appointment: "#16a34a", // green
  job: "#ea580c", // orange
  stock: "#0ea5e9", // sky
  other: "#6b7280", // slate
};

const statusColor: Record<string, string> = {
  tentative: "#f59e0b", // amber
  confirmed: "#10b981", // emerald
  completed: "#6b7280", // slate
  cancelled: "#ef4444", // red
};

// staff list – tweak these names/colours to match your team
const staffMembers = [
  { id: "alex", name: "Alex", color: "#22c55e" },
  { id: "workshop", name: "Workshop", color: "#0ea5e9" },
  { id: "deliveries", name: "Deliveries", color: "#a855f7" },
];

const staffColorById: Record<string, string> = {
  unassigned: "#6b7280",
  ...staffMembers.reduce<Record<string, string>>((acc, m) => {
    acc[m.id] = m.color;
    return acc;
  }, {}),
};

const staffNameById: Record<string, string> = staffMembers.reduce<
  Record<string, string>
>((acc, m) => {
  acc[m.id] = m.name;
  return acc;
}, {});

function toDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export default function CalendarPage() {
  const { events, addEvent, updateEvent, deleteEvent } = useCalendar();
  const { customers } = useCustomers() as any;
  const { jobs } = useJobs() as any;
  const { layoutMode } = useLayout();
  const { users } = useUsers();
  const { add: toast } = useToast();
  const { add: addToHistory, canUndo, undo } = useHistory();

  const containerClass =
    layoutMode === "fixed" ? "max-w-[1440px] mx-auto" : "max-w-none w-full";

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Debounce search input
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 200);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // Confirm modal for deletion
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  // 🔧 Controlled view + date so toolbar buttons (Today/Back/Next, Month/Week/Day) work
  const [view, setView] = useState<string>(Views.WEEK);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  // filter by type (appointment, job, stock, other)
  const [filterTypes, setFilterTypes] = useState<
    Record<CalendarEventType, boolean>
  >({
    appointment: true,
    job: true,
    stock: true,
    other: true,
  });

  // filter by staff (user assignment)
  const [staffFilter, setStaffFilter] = useState<Record<string, boolean>>(() => {
    const base: Record<string, boolean> = { unassigned: true };
    users.forEach((u) => {
      base[u.id] = true;
    });
    return base;
  });

  const now = new Date();

  const rbcEvents = useMemo(() => {
    // first filter by event type
    const byType = events.filter((ev) => filterTypes[ev.type]);

    // if all staff filters are still TRUE, don't bother filtering
    const anyStaffDisabled = Object.values(staffFilter).some((v) => v === false);

    const byStaff = anyStaffDisabled
      ? byType.filter((ev) => {
          const key = ev.assignedTo || "unassigned";
          return staffFilter[key] !== false; // default true if missing
        })
      : byType;

    // filter by search query
    const bySearch = searchQuery.trim()
      ? byStaff.filter((ev) =>
          ev.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (ev.notes && ev.notes.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (ev.location && ev.location.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      : byStaff;

    return bySearch.map((ev) => {
      const start = toDate(ev.start, now);
      const end = toDate(ev.end, addHours(start, 1));
      return {
        id: ev.id,
        title: ev.title,
        start,
        end,
        allDay: ev.allDay,
        resource: ev,
      };
    });
  }, [events, filterTypes, staffFilter, searchQuery, now]);

  const selectedEvent = events.find((e) => e.id === selectedEventId) || null;

  const selectedJobForEvent =
    selectedEvent && Array.isArray(jobs)
      ? (jobs as any[]).find((j) => j.id === selectedEvent.jobId)
      : null;

  function handleSelectSlot(slotInfo: any) {
    const start: Date = slotInfo.start;
    const end: Date = slotInfo.end || addHours(start, 1);

    const sameDay = isSameDay(start, end);
    const title = sameDay
      ? `New event (${format(start, "EEE d MMM, HH:mm")})`
      : `New multi-day event`;

    // 🔧 FIX: Always create timed events (no all-day row at the top)
    const ev = addEvent({
      type: "appointment",
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
    });

    // Auto-open sidebar with the new event
    setSelectedEventId(ev.id);
    toast("Event created", "success");
  }

  function handleEventDrop({ event, start, end }: any) {
    const id = event.id as string;
    updateEvent(id, {
      start: start.toISOString(),
      end: end.toISOString(),
    });
    toast("Event moved", "success");
  }

  function handleEventResize({ event, start, end }: any) {
    const id = event.id as string;
    updateEvent(id, {
      start: start.toISOString(),
      end: end.toISOString(),
    });
    toast("Event resized", "success");
  }

  function handleChangeField<K extends keyof CalendarEvent>(
    key: K,
    value: CalendarEvent[K]
  ) {
    if (!selectedEvent) return;
    updateEvent(selectedEvent.id, { [key]: value } as any);
  }

  function handleOpenJob() {
    if (!selectedEvent?.jobId) return;
    try {
      sessionStorage.setItem("frameit.selectedJobId", selectedEvent.jobId);
    } catch {
      // ignore sessionStorage errors
    }
    window.location.hash = "#/jobs";
  }

  function renderEvent({ event }: { event: any }) {
    const ev = event.resource as CalendarEvent;
    const typeDot = typeColor[ev.type] || "#6b7280";

    const staffKey = ev.assignedTo || "unassigned";
    const staffDot = staffColorById[staffKey] || "#9ca3af";
    const staffName =
      staffKey === "unassigned"
        ? ""
        : staffNameById[staffKey] || ev.assignedTo || "";

    const statusDot = statusColor[ev.status || "confirmed"] || "#6b7280";
    const statusLabel = ev.status || "confirmed";

    return (
      <div className="flex items-center gap-1 text-[11px]">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: typeDot }}
          title={ev.type}
        />
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: staffDot }}
          title={staffName ? `Assigned: ${staffName}` : "Unassigned"}
        />
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: statusDot }}
          title={`Status: ${statusLabel}`}
        />
        <span className="truncate">{event.title}</span>
      </div>
    );
  }

  function toggleType(t: CalendarEventType) {
    setFilterTypes((prev) => ({ ...prev, [t]: !prev[t] }));
  }

  function toggleStaff(id: string) {
    setStaffFilter((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-emerald-50/40 to-slate-50">
      {/* UNDO BAR */}
      {canUndo() && (
        <div className="flex items-center gap-2 p-3 mx-4 mt-4 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-xs font-medium text-blue-900">Last action:</span>
          <button
            onClick={undo}
            className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition"
          >
            ↶ Undo
          </button>
        </div>
      )}

      <main
        className={`${containerClass} p-4 grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)] flex-col lg:flex-row`}
      >
        {/* LEFT: Calendar */}
        <section className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-4 flex flex-col min-h-[520px]">
          <header className="mb-3 flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <h1 className="text-lg font-semibold text-slate-900">Calendar</h1>
              </div>

              {/* Search bar */}
              <input
                type="text"
                placeholder="Search events..."
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              {/* Type chips */}
              <div className="flex flex-wrap gap-1 text-xs items-center">
                <span className="text-[11px] text-slate-500 mr-1">Type:</span>
                {(
                  ["appointment", "job", "stock", "other"] as CalendarEventType[]
                ).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs ${
                      filterTypes[t]
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-300"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: typeColor[t] }}
                    />
                    <span className="capitalize">{t}</span>
                  </button>
                ))}
              </div>

              {/* Staff chips */}
              <div className="flex flex-wrap gap-1 text-xs items-center">
                <span className="text-[11px] text-slate-500 mr-1">Staff:</span>

                <button
                  type="button"
                  onClick={() => toggleStaff("unassigned")}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs ${
                    staffFilter["unassigned"]
                      ? "bg-white text-slate-700 border-slate-400"
                      : "bg-slate-100 text-slate-400 border-slate-200"
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: staffColorById["unassigned"] }}
                  />
                  <span>Unassigned</span>
                </button>

                {users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleStaff(u.id)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs ${
                      staffFilter[u.id]
                        ? "bg-white text-slate-700 border-slate-400"
                        : "bg-slate-100 text-slate-400 border-slate-200"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: u.color }}
                    />
                    <span>{u.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className="flex-1 min-h-[420px] rounded-xl border border-slate-200 overflow-hidden bg-white">
            <DnDCalendar
              localizer={localizer}
              events={rbcEvents}
              startAccessor="start"
              endAccessor="end"
              // Controlled navigation + view
              view={view}
              onView={(nextView) => setView(nextView as string)}
              date={currentDate}
              onNavigate={(nextDate) => setCurrentDate(nextDate)}
              defaultView={Views.WEEK}
              views={[Views.MONTH, Views.WEEK, Views.DAY]}
              step={30}
              popup
              selectable
              resizable
              onSelectSlot={handleSelectSlot}
              onEventDrop={handleEventDrop}
              onEventResize={handleEventResize}
              onSelectEvent={(e) => setSelectedEventId((e as any).resource.id)}
              components={{
                event: renderEvent,
              }}
              style={{ height: "100%", fontSize: "12px" }}
            />
          </div>
        </section>

        {/* RIGHT: Event details */}
        <aside className="space-y-3 lg:space-y-3">
          <div className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-4">
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              Event details
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              Click on an event or drag to create one, then edit it here.
            </p>

            {!selectedEvent && (
              <p className="text-sm text-slate-500">
                No event selected. Click an event in the calendar to edit.
              </p>
            )}

            {selectedEvent && (
              <div className="space-y-3 text-sm">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Title
                  </label>
                  <input
                    className="w-full rounded-lg border p-2 text-sm bg-white/95"
                    value={selectedEvent.title}
                    onChange={(e) => handleChangeField("title", e.target.value)}
                  />
                </div>

                {/* Type – full width */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Type
                  </label>
                  <select
                    className="w-full rounded-lg border p-2 text-sm bg-white/95"
                    value={selectedEvent.type}
                    onChange={(e) =>
                      handleChangeField(
                        "type",
                        e.target.value as CalendarEventType
                      )
                    }
                  >
                    <option value="appointment">Appointment</option>
                    <option value="job">Job</option>
                    <option value="stock">Stock</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Status – full width */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    className="w-full rounded-lg border p-2 text-sm bg-white/95"
                    value={selectedEvent.status || "confirmed"}
                    onChange={(e) =>
                      handleChangeField("status", e.target.value as any)
                    }
                  >
                    <option value="tentative">Tentative</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                {/* Assigned to */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Assigned to
                  </label>
                  <select
                    className="w-full rounded-lg border p-2 text-sm bg-white/95"
                    value={selectedEvent.assignedTo || ""}
                    onChange={(e) =>
                      handleChangeField(
                        "assignedTo",
                        (e.target.value || undefined) as any
                      )
                    }
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Start
                    </label>
                    <input
                      type="datetime-local"
                      className="w-full rounded-lg border p-2 text-xs bg-white/95"
                      value={format(
                        toDate(selectedEvent.start, now),
                        "yyyy-MM-dd'T'HH:mm"
                      )}
                      onChange={(e) =>
                        handleChangeField(
                          "start",
                          new Date(e.target.value).toISOString()
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      End
                    </label>
                    <input
                      type="datetime-local"
                      className="w-full rounded-lg border p-2 text-xs bg-white/95"
                      value={format(
                        toDate(
                          selectedEvent.end || selectedEvent.start,
                          addHours(now, 1)
                        ),
                        "yyyy-MM-dd'T'HH:mm"
                      )}
                      onChange={(e) =>
                        handleChangeField(
                          "end",
                          new Date(e.target.value).toISOString()
                        )
                      }
                    />
                  </div>
                </div>

                {/* Link to customer / job */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Customer
                    </label>
                    <select
                      className="w-full rounded-lg border p-2 text-xs bg-white/95"
                      value={selectedEvent.customerId || ""}
                      onChange={(e) =>
                        handleChangeField(
                          "customerId",
                          e.target.value || undefined
                        )
                      }
                    >
                      <option value="">None</option>
                      {(customers || []).map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() ||
                            c.company ||
                            c.email ||
                            c.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Job
                    </label>
                    <select
                      className="w-full rounded-lg border p-2 text-xs bg-white/95"
                      value={selectedEvent.jobId || ""}
                      onChange={(e) =>
                        handleChangeField("jobId", e.target.value || undefined)
                      }
                    >
                      <option value="">None</option>
                      {(jobs || []).map((j: any) => (
                        <option key={j.id} value={j.id}>
                          {j.refNo
                            ? `Job #${j.refNo} – ${j.description || ""}`
                            : j.description || j.id}
                        </option>
                      ))}
                    </select>

                    {selectedEvent.jobId && selectedJobForEvent && (
                      <button
                        type="button"
                        onClick={handleOpenJob}
                        className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 hover:underline"
                      >
                        Open job in Jobs page
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Location
                  </label>
                  <input
                    className="w-full rounded-lg border p-2 text-sm bg-white/95"
                    value={selectedEvent.location || ""}
                    onChange={(e) =>
                      handleChangeField("location", e.target.value)
                    }
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    className="w-full rounded-lg border p-2 text-sm bg-white/95"
                    rows={3}
                    value={selectedEvent.notes || ""}
                    onChange={(e) =>
                      handleChangeField("notes", e.target.value)
                    }
                  />
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    className="text-xs text-rose-600 hover:text-rose-700 hover:underline"
                    onClick={() => {
                      setConfirmModal({
                        isOpen: true,
                        title: "Delete Event",
                        message: "Are you sure you want to delete this event from the calendar? This cannot be undone.",
                        onCancel: () => {
                          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                        },
                        onConfirm: () => {
                          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                          // Store deleted event in history for undo
                          addToHistory({
                            type: "deleteEvent",
                            data: selectedEvent,
                            undo: () => {
                              addEvent(selectedEvent);
                            },
                          });
                          deleteEvent(selectedEvent.id);
                          setSelectedEventId(null);
                          toast("Event deleted", "success");
                        },
                      });
                    }}
                  >
                    Delete event
                  </button>
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:text-slate-700"
                    onClick={() => setSelectedEventId(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Placeholder card for future sync */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-sm ring-1 ring-blue-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              📅 External calendar sync
            </h3>
            <p className="text-xs text-slate-600 mb-3">
              Coming soon: Export an <code className="bg-white px-1 py-0.5 rounded text-xs">.ics</code> file or connect Google / Outlook calendars
            </p>
            <div className="flex gap-2">
              <button
                disabled
                className="text-xs px-2 py-1 rounded border border-blue-300 bg-white text-slate-500 cursor-not-allowed"
              >
                Export .ics
              </button>
              <button
                disabled
                className="text-xs px-2 py-1 rounded border border-blue-300 bg-white text-slate-500 cursor-not-allowed"
              >
                Sync Calendar
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* CONFIRM DELETE MODAL */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm mx-4 ring-1 ring-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {confirmModal.title}
            </h3>
            <p className="text-slate-600 mb-6 text-sm">
              {confirmModal.message}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={confirmModal.onCancel}
                className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-red-500 hover:bg-red-600 text-white transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
