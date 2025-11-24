// src/pages/Calendar.tsx
import React, { useMemo, useState } from "react";
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

  const containerClass =
    layoutMode === "fixed" ? "max-w-[1440px] mx-auto" : "max-w-none w-full";

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

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
    staffMembers.forEach((m) => {
      base[m.id] = true;
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

    return byStaff.map((ev) => {
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
  }, [events, filterTypes, staffFilter, now]);

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

    setSelectedEventId(ev.id);
  }

  function handleEventDrop({ event, start, end }: any) {
    const id = event.id as string;
    updateEvent(id, {
      start: start.toISOString(),
      end: end.toISOString(),
    });
  }

  function handleEventResize({ event, start, end }: any) {
    const id = event.id as string;
    updateEvent(id, {
      start: start.toISOString(),
      end: end.toISOString(),
    });
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
      <main
        className={`${containerClass} p-4 grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)]`}
      >
        {/* LEFT: Calendar */}
        <section className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-4 flex flex-col min-h-[520px]">
          <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Calendar</h1>
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
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${
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
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${
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

                {staffMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleStaff(m.id)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${
                      staffFilter[m.id]
                        ? "bg-white text-slate-700 border-slate-400"
                        : "bg-slate-100 text-slate-400 border-slate-200"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: m.color }}
                    />
                    <span>{m.name}</span>
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
        <aside className="space-y-3">
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
                    {staffMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
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
                      if (
                        window.confirm("Delete this event from the calendar?")
                      ) {
                        deleteEvent(selectedEvent.id);
                        setSelectedEventId(null);
                      }
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
          <div className="bg-white/90 rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              External calendar sync (later)
            </h3>
            <p className="text-xs text-slate-500">
              Here we can add buttons to export an <code>.ics</code> file or
              connect Google / Outlook calendars once the backend is ready.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
