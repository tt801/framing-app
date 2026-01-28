// src/App.tsx
import React, { useEffect, useState } from "react";
import VisualizerApp from "./VisualizerApp";
import Admin from "./pages/Admin";
import Customers from "./pages/Customers";
import Quotes from "./pages/Quotes";
import InvoicesPage from "./pages/Invoices";
import MarketingPage from "./pages/Marketing";
import StockPage from "./pages/Stock";
import JobsPage from "./pages/Jobs";
import CalendarPage from "./pages/Calendar";
import DashboardPage from "./pages/Dashboard";
import APISettingsPage from "./pages/APISettings";
import ToastContainer from "./components/ToastContainer";
import CommandPalette from "./components/CommandPalette";
import { useLayout } from "@/lib/layout";

// ---------- Hash Router ----------
function useHashRoute() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // e.g. returns "/", "/customers", "/quotes", etc.
  return route.replace(/^#/, "");
}

// ---------- Error Boundary ----------
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [err, setErr] = useState<Error | null>(null);
  if (err) {
    return (
      <div style={{ padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
        <h2 style={{ fontWeight: 700, marginBottom: 8 }}>App error</h2>
        <pre style={{ whiteSpace: "pre-wrap" }}>
          {String(err.stack || err.message || err)}
        </pre>
      </div>
    );
  }
  return (
    <React.Suspense fallback={null}>
      <ErrorCatcher onError={setErr}>{children}</ErrorCatcher>
    </React.Suspense>
  );
}

function ErrorCatcher({
  onError,
  children,
}: {
  onError: (e: Error) => void;
  children: React.ReactNode;
}) {
  try {
    return <>{children}</>;
  } catch (e: any) {
    onError(e);
    return null;
  }
}

// ---------- Main App ----------
function App() {
  const route = useHashRoute();
  const { layoutMode, toggleLayoutMode } = useLayout();

  const isAdmin = route.startsWith("/admin");
  const isCustomers = route.startsWith("/customers");
  const isQuotes = route.startsWith("/quotes");
  const isInvoices = route.startsWith("/invoices");
  const isJobs = route.startsWith("/jobs");
  const isMarketing = route.startsWith("/marketing");
  const isStock = route.startsWith("/stock");
  const isCalendar = route.startsWith("/calendar");
  const isAPISettings = route.startsWith("/api-settings");
  const isVisualizer =
    route.startsWith("/app") || route.startsWith("/visualizer");

  // Dashboard = default home when no other route matches
  const isDashboard =
    !isAdmin &&
    !isCustomers &&
    !isQuotes &&
    !isInvoices &&
    !isJobs &&
    !isMarketing &&
    !isStock &&
    !isCalendar &&
    !isAPISettings &&
    !isVisualizer;

  const navItems = [
    { label: "Dashboard", href: "#/", active: isDashboard },
    { label: "App", href: "#/app", active: isVisualizer },
    { label: "Customers", href: "#/customers", active: isCustomers },
    { label: "Quotes", href: "#/quotes", active: isQuotes },
    { label: "Invoices", href: "#/invoices", active: isInvoices },
    { label: "Jobs", href: "#/jobs", active: isJobs },
    { label: "Calendar", href: "#/calendar", active: isCalendar },
    { label: "Marketing", href: "#/marketing", active: isMarketing },
    { label: "Stock", href: "#/stock", active: isStock },
    { label: "Admin", href: "#/admin", active: isAdmin },
    { label: "API Settings", href: "#/api-settings", active: isAPISettings },
  ];

  const createOptions = [
    { key: "invoice", label: "New invoice", href: "#/invoices" },
    { key: "customer", label: "New customer", href: "#/customers" },
    { key: "job", label: "New job", href: "#/jobs" },
  ];

  const preferredCreateKey = isQuotes
    ? "invoice"
    : isInvoices
    ? "invoice"
    : isCustomers
    ? "customer"
    : isJobs
    ? "job"
    : isVisualizer
    ? "job"
    : "invoice";

  const primaryCreate =
    createOptions.find((o) => o.key === preferredCreateKey) || createOptions[0];

  const showCreateButton = !(isMarketing || isStock || isAdmin || isDashboard || isVisualizer || isCalendar || isAPISettings);

  function triggerCreate(key: string) {
    const opt = createOptions.find((o) => o.key === key) || primaryCreate;
    window.location.hash = opt.href.replace(/^#/, "#");
    try {
      window.dispatchEvent(
        new CustomEvent("frameapp:new", { detail: { type: opt.key } })
      );
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-dvh w-full bg-neutral-50 text-neutral-900">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-40 w-full border-b border-neutral-200 bg-white/80 backdrop-blur">
        <div
          className={
            layoutMode === "fixed"
              ? "max-w-[1440px] mx-auto w-full px-3 sm:px-4"
              : "w-full px-3 sm:px-4"
          }
        >
          <div className="flex items-center justify-between gap-3 py-2">
            {/* LEFT: Logo + nav */}
            <div className="flex items-center gap-3 overflow-x-auto">
              <span className="text-sm font-semibold text-slate-900">Framing app</span>
              <nav className="flex items-center gap-1 text-sm">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    aria-current={item.active ? "page" : undefined}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 transition ${
                      item.active
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>

            {/* RIGHT: Primary create (optional) + layout toggle */}
            <div className="flex items-center gap-3">
              {showCreateButton && (
                <button
                  type="button"
                  onClick={() => triggerCreate(primaryCreate.key)}
                  className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 shadow-sm"
                >
                  <span className="text-base leading-none">+</span>
                  <span>{primaryCreate.label}</span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleLayoutMode}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
              >
                <span className="text-[11px] text-slate-500">Layout</span>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    layoutMode === "fixed" ? "bg-emerald-500" : "bg-slate-400"
                  }`}
                />
                <span>{layoutMode === "fixed" ? "Fixed" : "Full"}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ---------- Main Body ---------- */}
      <main className="w-full">
        <ErrorBoundary>
          {/* Wrapper:
              - Dashboard: no outer padding, it owns its dark full-bleed background.
              - Other pages: use layoutMode to choose fixed vs full width. */}
          <div
            className={
              isDashboard
                ? ""
                : layoutMode === "fixed"
                ? "max-w-[1440px] mx-auto p-3 sm:p-4"
                : "w-full px-3 sm:px-4"
            }
          >
            {isAdmin ? (
              <Admin />
            ) : isCustomers ? (
              <Customers />
            ) : isQuotes ? (
              <Quotes />
            ) : isInvoices ? (
              <InvoicesPage />
            ) : isJobs ? (
              <JobsPage />
            ) : isCalendar ? (
              <CalendarPage />
            ) : isMarketing ? (
              <MarketingPage />
            ) : isStock ? (
              <StockPage />
            ) : isAPISettings ? (
              <APISettingsPage />
            ) : isVisualizer ? (
              <VisualizerApp />
            ) : (
              <DashboardPage />
            )}
          </div>
        </ErrorBoundary>
      </main>

      {/* Global UI Components */}
      <ToastContainer />
      <CommandPalette />
    </div>
  );
}

export default App;
