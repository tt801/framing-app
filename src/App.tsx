// src/App.tsx
import React, { useEffect, useState, Suspense } from "react";
import { LoadingSpinner } from "./components/LoadingSpinner";
import ToastContainer from "./components/ToastContainer";
import CommandPalette from "./components/CommandPalette";
import HelpAssistant from "./components/HelpAssistant";
import CookieConsentBanner from "./components/CookieConsentBanner";
import { useLayout } from "@/lib/layout";
import { useTheme } from "@/lib/theme";
import TrialBanner from "./components/TrialBanner";
import UpgradeModal from "./components/UpgradeModal";
import { useTrialStatus } from "@/lib/trial";
import { getCurrentUser, supabase } from "@/lib/supabase";
import { BillingAccessProvider } from "@/lib/billingAccess";

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
const LegalPolicyPage = React.lazy(() => import("./pages/LegalPolicy"));
const AuthPage = React.lazy(() => import("./pages/Auth"));
const AuthCallbackPage = React.lazy(() => import("./pages/AuthCallback"));
const BillingPage = React.lazy(() => import("./pages/Billing"));
const BillingSuccessPage = React.lazy(() => import("./pages/BillingSuccess"));
const SupportPage = React.lazy(() => import("./pages/Support"));
const appLogoSrc = "/Framers%20App%20Logo%20v2.png";
const appTagline = "Frame. Quote. Grow.";

// ---------- Hash Router ----------
function useHashRoute() {
  const getRoute = () => {
    const hashValue = window.location.hash.replace(/^#/, "");

    // Supabase recovery links can land with token params in the hash instead
    // of a route (e.g. #access_token=...&type=recovery). Normalize these
    // into the login reset route so the UI can complete password recovery.
    if (
      hashValue &&
      (/^(access_token|refresh_token|expires_in|token_type|type)=/.test(hashValue) ||
        hashValue.includes("type=recovery") ||
        hashValue.includes("recovery_token="))
    ) {
      return "/login?reset=1";
    }

    if (hashValue) {
      return hashValue;
    }

    const searchValue = window.location.search || "";
    if (
      searchValue.includes("type=recovery") ||
      searchValue.includes("recovery_token=") ||
      searchValue.includes("access_token=")
    ) {
      return "/login?reset=1";
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
  const { themeMode, toggleThemeMode } = useTheme();
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const isLanding = route === "/" || route === "";
  const isLegal = route.startsWith("/legal");
  const isLogin = route.startsWith("/login");
  const isStartTrial = route.startsWith("/start-trial");
  const isAuthCallback = route.startsWith("/auth/callback");
  const isSupport = route.startsWith("/support");
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

  const isPublicRoute = isLanding || isLegal || isAuthRoute;
  const isPublicOrSupport = isPublicRoute || isSupport;

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      const user = await getCurrentUser();
      if (!mounted) return;
      setIsAuthenticated(Boolean(user));
      setAuthLoading(false);
    };

    initAuth();

    if (!supabase) return () => {
      mounted = false;
    };

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setIsAuthenticated(Boolean(session?.user));
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isPublicOrSupport && !isAuthenticated) {
      window.location.hash = "#/login";
    }
  }, [authLoading, isAuthenticated, isPublicOrSupport]);

  const { trial, isExpired, loading: trialLoading } = useTrialStatus(!isLanding && isAuthenticated);
  const hasAdminAccess = trial?.workspaceRole === "owner" || trial?.workspaceRole === "manager";
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

  if (!isPublicOrSupport && authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isPublicOrSupport && !isAuthenticated) {
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
        <CookieConsentBanner />
      </BillingAccessProvider>
    );
  }

  if (isLegal) {
    return (
      <BillingAccessProvider value={billingAccess}>
        <ErrorBoundary>
          <LegalPolicyPage />
        </ErrorBoundary>
        <CookieConsentBanner />
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
        <CookieConsentBanner />
      </BillingAccessProvider>
    );
  }

  if (isSupport) {
    return (
      <BillingAccessProvider value={billingAccess}>
        <ErrorBoundary>
          <SupportPage />
        </ErrorBoundary>
        <CookieConsentBanner />
      </BillingAccessProvider>
    );
  }

  if (isBillingSuccess) {
    return (
      <BillingAccessProvider value={billingAccess}>
        <ErrorBoundary>
          <BillingSuccessPage />
        </ErrorBoundary>
        <CookieConsentBanner />
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
              Admin is limited to workspace owners and managers. To gain access, sign in with an invited workspace account or ask the owner to invite you from Admin &gt; Users.
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
      <div
        className={`app-shell min-h-dvh w-full ${
          themeMode === "dark"
            ? "app-theme-dark bg-slate-950 text-slate-100"
            : "bg-neutral-50 text-neutral-900"
        }`}
      >
        <TrialBanner trial={trial} loading={trialLoading} />
        {/* ---------- Header ---------- */}
        <header
          className={`sticky top-0 z-40 w-full border-b backdrop-blur ${
            themeMode === "dark"
              ? "border-slate-800 bg-slate-950/85"
              : "border-neutral-200 bg-white/80"
          }`}
        >
        <div
          className={
            layoutMode === "fixed"
              ? "max-w-[1440px] mx-auto w-full px-3 sm:px-4"
              : "w-full px-3 sm:px-4"
          }
        >
          <div className="flex items-center justify-between gap-3 py-2">
            {/* LEFT: Logo + nav */}
            <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
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
                        ? themeMode === "dark"
                          ? "bg-cyan-300 text-slate-950 shadow-sm"
                          : "bg-slate-900 text-white shadow-sm"
                        : themeMode === "dark"
                        ? "text-slate-300 hover:bg-slate-800"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>

            {/* RIGHT: Primary create (optional) + theme toggle + layout toggle */}
            <div className="flex shrink-0 items-center gap-2">
              {showCreateButton && (
                <button
                  type="button"
                  onClick={() => triggerCreate(primaryCreate.key)}
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium shadow-sm ${
                    themeMode === "dark"
                      ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  }`}
                >
                  <span className="text-base leading-none">+</span>
                  <span>{primaryCreate.label}</span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleThemeMode}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm ${
                  themeMode === "dark"
                    ? "border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
                    : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                <span className={`text-[11px] ${themeMode === "dark" ? "text-slate-400" : "text-slate-500"}`}>
                  Theme
                </span>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    themeMode === "dark" ? "bg-cyan-300" : "bg-amber-400"
                  }`}
                />
                <span>{themeMode === "dark" ? "Dark" : "Light"}</span>
              </button>

              <button
                type="button"
                onClick={toggleLayoutMode}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm ${
                  themeMode === "dark"
                    ? "border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
                    : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                <span className={`text-[11px] ${themeMode === "dark" ? "text-slate-400" : "text-slate-500"}`}>
                  Layout
                </span>
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
      <CookieConsentBanner />
      </div>
    </BillingAccessProvider>
  );
}

export default App;
