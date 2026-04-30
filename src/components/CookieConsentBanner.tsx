import React, { useEffect, useMemo, useState } from "react";

type ConsentChoice = "accepted" | "essential-only" | "custom";

type CookiePrefs = {
  choice: ConsentChoice;
  essential: true;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
};

const STORAGE_KEY = "framers_cookie_consent_v1";

function readStoredPrefs(): CookiePrefs | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookiePrefs;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePrefs(prefs: CookiePrefs) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent("framers:cookie-consent", { detail: prefs }));
}

export default function CookieConsentBanner() {
  const [loaded, setLoaded] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(true);

  const existing = useMemo(() => {
    if (!loaded) return null;
    return readStoredPrefs();
  }, [loaded]);

  useEffect(() => {
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!existing) return;
    setAnalytics(existing.analytics);
    setMarketing(existing.marketing);
  }, [existing]);

  if (!loaded || existing) return null;

  const acceptAll = () => {
    writePrefs({
      choice: "accepted",
      essential: true,
      analytics: true,
      marketing: true,
      updatedAt: new Date().toISOString(),
    });
  };

  const rejectNonEssential = () => {
    writePrefs({
      choice: "essential-only",
      essential: true,
      analytics: false,
      marketing: false,
      updatedAt: new Date().toISOString(),
    });
  };

  const saveCustom = () => {
    writePrefs({
      choice: "custom",
      essential: true,
      analytics,
      marketing,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-[80] sm:inset-x-6 sm:bottom-5 lg:inset-x-auto lg:right-6 lg:w-[420px]">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.18)]">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Cookie notice</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          We use essential cookies for sign-in and app security. With your permission, we also use analytics and marketing cookies to improve performance and communications.
        </p>

        {showManage && (
          <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
              <span>Analytics cookies</span>
              <input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
              <span>Marketing cookies</span>
              <input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} />
            </label>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={acceptAll}
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-slate-800"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={rejectNonEssential}
            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={() => (showManage ? saveCustom() : setShowManage(true))}
            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-100"
          >
            {showManage ? "Save choices" : "Manage"}
          </button>
        </div>
      </div>
    </div>
  );
}
