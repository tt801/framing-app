// src/App.tsx
import React, { useEffect, useState, Suspense } from "react";
import { LoadingSpinner } from "./components/LoadingSpinner";
import ToastContainer from "./components/ToastContainer";
import CommandPalette from "./components/CommandPalette";
import HelpAssistant from "./components/HelpAssistant";
import { useLayout } from "@/lib/layout";
import TrialBanner from "./components/TrialBanner";
import UpgradeModal from "./components/UpgradeModal";
import { useTrialStatus } from "@/lib/trial";
import { getCurrentUser, supabase } from "@/lib/supabase";
import { BillingAccessProvider } from "@/lib/billingAccess";
import { useUsers } from "@/lib/users";

const VisualizerApp = React.lazy(() => import("./VisualizerApp"));
const Admin = React.lazy(() => import("./pages/Admin"));
const Customers = React.lazy(() => import("./pages/Customers"));
const Quotes = React.lazy(() => import("./pages/Quotes"));
const InvoicesPage = React.lazy(() => import("./pages/Invoices"));
const MarketingPage = React.lazy(() => import("./pages/Marketing"));
const StockPage = React.lazy(() => import("./pages/Stock"));
const JobsPage = React.lazy(() => import("./pages/Jobs"));
const CalendarPage = React.lazy(() => import("./pages/Calendar"));
const DashboardPage = React.lazy(() => import("./pages/Dashboard"));
const APISettingsPage = React.lazy(() => import("./pages/APISettings"));
const WebsiteLanding = React.lazy(() => import("./pages/WebsiteLanding"));
const AuthPage = React.lazy(() => import("./pages/Auth"));
const AuthCallbackPage = React.lazy(() => import("./pages/AuthCallback"));
const BillingPage = React.lazy(() => import("./pages/Billing"));
const BillingSuccessPage = React.lazy(() => import("./pages/BillingSuccess"));
const appLogoSrc = "/framersapp-logo-lightblue.png";
const appTagline = "Frame. Quote. Grow.";

// ---------- Hash Router ----------
function useHashRoute() {
  const getRoute = () => {
    if (window.location.hash) {
      return window.location.hash.replace(/^#/, "");
    }

    if (window.location.pathname && window.location.pathname !== "/") {
      return window.location.pathname;
    }

    return "/";
  };

  const [route, setRoute] = useState(getRoute());
  useEffect(() => {
    const onLocationChange = () => setRoute(getRoute());
    window.addEventListener("hashchange", onLocationChange);
    window.addEventListener("popstate", onLocationChange);
    return () => {
      window.removeEventListener("hashchange", onLocationChange);
      window.removeEventListener("popstate", onLocationChange);
    };
  }, []);
  return route;
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
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-12">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <ErrorCatcher onError={setErr}>{children}</ErrorCatcher>
    </Suspense>
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
  } catch (e: unknown) {
    onError(e instanceof Error ? e : new Error(String(e)));
    return null;
  }
}

// ---------- Main App ----------
function App() {
  const route = useHashRoute();
  const { layoutMode, toggleLayoutMode } = useLayout();
  const { users } = useUsers();
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const isLanding = route === "/" || route === "";
  const isLogin = route.startsWith("/login");
  const isStartTrial = route.startsWith("/start-trial");
  const isAuthCallback = route.startsWith("/auth/callback");
  const isAuthRoute = isLogin || isStartTrial || isAuthCallback;

  const isAdmin = route.startsWith("/admin");
  const isCustomers = route.startsWith("/customers");
  const isQuotes = route.startsWith("/quotes");
  const isInvoices = route.startsWith("/invoices");
  const isJobs = route.startsWith("/jobs");
  const isMarketing = route.startsWith("/marketing");
  const isStock = route.startsWith("/stock");
  const isCalendar = route.startsWith("/calendar");
  const isAPISettings = route.startsWith("/api-settings");
  const isDashboard = route.startsWith("/dashboard");
  const isBilling = route.startsWith("/billing");
  const isBillingSuccess = route.startsWith("/billing/success");
  const isVisualizer =
    route.startsWith("/app") || route.startsWith("/visualizer");
  const isUnknownInternalRoute =
    !isLanding &&
    !isAdmin &&
    !isCustomers &&
    !isQuotes &&
    !isInvoices &&
    !isJobs &&
    !isMarketing &&
    !isStock &&
    !isCalendar &&
    !isAPISettings &&
    !isVisualizer &&
    !isDashboard &&
    !isBilling &&
    !isBillingSuccess;

  const isPublicRoute = isLanding || isAuthRoute;

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      const user = await getCurrentUser();
      if (!mounted) return;
      setIsAuthenticated(Boolean(user));
      setCurrentUserEmail(user?.email?.toLowerCase() || null);
      setAuthLoading(false);
    };

    initAuth();

    if (!supabase) return () => {
      mounted = false;
    };

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setIsAuthenticated(Boolean(session?.user));
      setCurrentUserEmail(session?.user?.email?.toLowerCase() || null);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isPublicRoute && !isAuthenticated) {
      window.location.hash = "#/login";
    }
  }, [authLoading, isAuthenticated, isPublicRoute]);

  const { trial, isExpired, loading: trialLoading } = useTrialStatus(!isLanding && isAuthenticated);
  const matchedWorkspaceUser = users.find((user) => {
    if (!currentUserEmail || !user.active || !user.email) return false;
    return user.email.toLowerCase() === currentUserEmail;
  });
  const hasAdminRole = matchedWorkspaceUser?.role === "owner" || matchedWorkspaceUser?.role === "manager";
  const hasAdminAccess = Boolean(trial || hasAdminRole);
  const billingAccess = trial
    ? {
        readOnly: trial.readOnly,
        hasFullAccess: trial.hasFullAccess,
        canUsePremiumFeatures: trial.canUsePremiumFeatures,
        isFounder: trial.isFounder,
        isPastDue: trial.isPastDue,
        statusMessage: trial.statusMessage,
      }
    : {
        readOnly: false,
        hasFullAccess: true,
        canUsePremiumFeatures: true,
        isFounder: false,
        isPastDue: false,
        statusMessage: "",
      };

  if (!isPublicRoute && authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isPublicRoute && !isAuthenticated) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Redirecting to sign in...</p>
          <p className="mt-2 text-sm text-slate-600">
            This page requires an active account session.
          </p>
          <a
            href="#/login"
            className="mt-4 inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white"
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  const navItems = [
    { label: "Dashboard", href: "#/dashboard", active: isDashboard || isUnknownInternalRoute },
    { label: "App", href: "#/app", active: isVisualizer },
    { label: "Customers", href: "#/customers", active: isCustomers },
    { label: "Quotes", href: "#/quotes", active: isQuotes },
    { label: "Invoices", href: "#/invoices", active: isInvoices },
    { label: "Jobs", href: "#/jobs", active: isJobs },
    { label: "Calendar", href: "#/calendar", active: isCalendar },
    { label: "Marketing", href: "#/marketing", active: isMarketing },
    { label: "Stock", href: "#/stock", active: isStock },
    ...(hasAdminAccess ? [{ label: "Admin", href: "#/admin", active: isAdmin }] : []),
  ];

  const createOptions = [
    { key: "invoice", label: "New invoice", href: "#/invoices" },
    { key: "quote", label: "New quote", href: "#/quotes" },
    { key: "customer", label: "New customer", href: "#/customers" },
    { key: "job", label: "New job", href: "#/jobs" },
  ];

  const preferredCreateKey = isQuotes
    ? "quote"
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

  const currentHelpArea = isAdmin
    ? "admin"
    : isCustomers
    ? "customers"
    : isQuotes
    ? "quotes"
    : isInvoices
    ? "invoices"
    : isJobs
    ? "jobs"
    : isMarketing
    ? "marketing"
    : isStock
    ? "stock"
    : isCalendar
    ? "calendar"
    : isVisualizer
    ? "app"
    : "dashboard";

  const showCreateButton = !billingAccess.readOnly && !(isMarketing || isStock || isAdmin || isDashboard || isVisualizer || isCalendar || isAPISettings);

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

  if (isLanding) {
    return (
      <BillingAccessProvider value={billingAccess}>
        <ErrorBoundary>
          <WebsiteLanding />
        </ErrorBoundary>
      </BillingAccessProvider>
    );
  }

  if (isAuthRoute) {
    return (
      <BillingAccessProvider value={billingAccess}>
        <ErrorBoundary>
          {isAuthCallback ? (
            <AuthCallbackPage />
          ) : (
            <AuthPage defaultMode={isStartTrial ? "signup" : "login"} />
          )}
        </ErrorBoundary>
      </BillingAccessProvider>
    );
  }

  if (isBillingSuccess) {
    return (
      <BillingAccessProvider value={billingAccess}>
        <ErrorBoundary>
          <BillingSuccessPage />
        </ErrorBoundary>
      </BillingAccessProvider>
    );
  }

  if (isAdmin && !authLoading && !trialLoading && !hasAdminAccess) {
    return (
      <BillingAccessProvider value={billingAccess}>
        <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Admin access required</p>
            <h1 className="mt-2 text-2xl font-black text-slate-950">You do not have access to Admin</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Admin is limited to workspace owners and managers. To gain access, sign in as the workspace owner or make sure your login email matches an active owner or manager record in Admin &gt; Users.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#/dashboard"
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Back to dashboard
              </a>
            </div>
          </div>
        </div>
      </BillingAccessProvider>
    );
  }

  if (isBilling) {
    return (
      <BillingAccessProvider value={billingAccess}>
        <ErrorBoundary>
          <BillingPage />
        </ErrorBoundary>
      </BillingAccessProvider>
    );
  }

  return (
    <BillingAccessProvider value={billingAccess}>
      <div className="min-h-dvh w-full bg-neutral-50 text-neutral-900">
        <TrialBanner trial={trial} loading={trialLoading} />
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
              <a href="#/dashboard" className="flex shrink-0 items-center">
                <img
                  src={appLogoSrc}
                  alt="Framers App"
                  className="h-9 w-auto object-contain"
                />
              </a>
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
      <HelpAssistant currentArea={currentHelpArea} />
      </div>
    </BillingAccessProvider>
  );
}

export default App;
