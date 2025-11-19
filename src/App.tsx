// src/App.tsx
import React, { useEffect, useState } from "react";
import VisualizerApp from "./VisualizerApp";
import Admin from "./pages/Admin";
import Customers from "./pages/Customers";
import Quotes from "./pages/Quotes";
import InvoicesPage from "./pages/Invoices";
import MarketingPage from "./pages/Marketing";
import StockPage from "./pages/Stock";
import JobsPage from "./pages/Jobs"; // ✅ Proper import

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

  const isAdmin = route.startsWith("/admin");
  const isCustomers = route.startsWith("/customers");
  const isQuotes = route.startsWith("/quotes");
  const isInvoices = route.startsWith("/invoices");
  const isJobs = route.startsWith("/jobs"); // ✅ Added jobs route
  const isMarketing = route.startsWith("/marketing");
  const isStock = route.startsWith("/stock");
  const isHome =
    !isAdmin &&
    !isCustomers &&
    !isQuotes &&
    !isInvoices &&
    !isJobs &&
    !isMarketing &&
    !isStock;

  return (
    <div className="min-h-dvh w-full bg-neutral-50 text-neutral-900">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-40 w-full border-b border-neutral-200 bg-white/80 backdrop-blur">
        <div className="mx-auto w-full px-3 sm:px-4">
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
            </nav>
          </div>
        </div>
      </header>

      {/* ---------- Main Body ---------- */}
      <main className="w-full">
        <ErrorBoundary>
          {/* Fixed-width wrapper on every page EXCEPT Visualizer */}
          <div
            className={
              isHome ? "p-3 sm:p-4" : "max-w-5xl mx-auto p-3 sm:p-4"
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
              <JobsPage /> // ✅ Correct render
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

// ✅ Make sure this export exists (this was the missing piece!)
export default App;
