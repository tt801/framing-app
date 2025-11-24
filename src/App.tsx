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
import CalendarPage from "./pages/Calendar"; // 👈 use same style as others
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
  const isCalendar = route.startsWith("/calendar"); // 👈 NEW
  const isHome =
    !isAdmin &&
    !isCustomers &&
    !isQuotes &&
    !isInvoices &&
    !isJobs &&
    !isMarketing &&
    !isStock &&
    !isCalendar; // 👈 exclude calendar from "home"

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
          <div className="flex h-14 items-center gap-2">
            <a
              href="#/"
              className="rounded px-2 py-1 text-sm font-semibold hover:bg-neutral-100"
            >
              Home
            </a>
            <nav className="ml-1 flex items-center gap-1 text-sm">
              <a href="#/" className="rounded px-2 py-1 hover:bg-neutral-100">
                App
              </a>
              <a
                href="#/customers"
                className="rounded px-2 py-1 hover:bg-neutral-100"
              >
                Customers
              </a>
              <a
                href="#/quotes"
                className="rounded px-2 py-1 hover:bg-neutral-100"
              >
                Quotes
              </a>
              <a
                href="#/invoices"
                className="rounded px-2 py-1 hover:bg-neutral-100"
              >
                Invoices
              </a>
              <a
                href="#/jobs"
                className="rounded px-2 py-1 hover:bg-neutral-100"
              >
                Jobs
              </a>
              <a
                href="#/calendar"
                className="rounded px-2 py-1 hover:bg-neutral-100"
              >
                Calendar
              </a>
              <a
                href="#/marketing"
                className="rounded px-2 py-1 hover:bg-neutral-100"
              >
                Marketing
              </a>
              <a
                href="#/stock"
                className="rounded px-2 py-1 hover:bg-neutral-100"
              >
                Stock
              </a>
              <a
                href="#/admin"
                className="rounded px-2 py-1 hover:bg-neutral-100"
              >
                Admin
              </a>

              {/* Page layout toggle */}
              <button
                type="button"
                onClick={toggleLayoutMode}
                className="ml-3 inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-xs bg-white hover:bg-slate-100"
              >
                <span className="text-[11px] text-slate-500">
                  Page layout
                </span>
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      layoutMode === "fixed" ? "#0f766e" : "#6b7280",
                  }}
                />
                <span className="font-medium">
                  {layoutMode === "fixed" ? "1440px" : "Full width"}
                </span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* ---------- Main Body ---------- */}
      <main className="w-full">
        <ErrorBoundary>
          {/* Wrapper:
              - Visualizer (home): lets VisualizerApp control its own layout.
              - Other pages: use layoutMode to choose fixed vs full width. */}
          <div
            className={
              isHome
                ? "p-3 sm:p-4"
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
            ) : (
              <VisualizerApp />
            )}
          </div>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default App;
