// src/pages/Onboarding.tsx
import React, { useState, useEffect } from "react";
import { useCompany } from "@/lib/company";
import { inviteCompanyMember } from "@/lib/companyMembers";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";

const CURRENCIES = [
  { code: "AUD", symbol: "A$", label: "Australian Dollar (AUD)" },
  { code: "CAD", symbol: "CA$", label: "Canadian Dollar (CAD)" },
  { code: "EUR", symbol: "€", label: "Euro (EUR)" },
  { code: "GBP", symbol: "£", label: "British Pound (GBP)" },
  { code: "NZD", symbol: "NZ$", label: "New Zealand Dollar (NZD)" },
  { code: "USD", symbol: "$", label: "US Dollar (USD)" },
  { code: "ZAR", symbol: "R ", label: "South African Rand (ZAR)" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar (SGD)" },
  { code: "CHF", symbol: "CHF ", label: "Swiss Franc (CHF)" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen (JPY)" },
  { code: "HKD", symbol: "HK$", label: "Hong Kong Dollar (HKD)" },
  { code: "DKK", symbol: "kr ", label: "Danish Krone (DKK)" },
  { code: "NOK", symbol: "kr ", label: "Norwegian Krone (NOK)" },
  { code: "SEK", symbol: "kr ", label: "Swedish Krona (SEK)" },
  { code: "MXN", symbol: "MX$", label: "Mexican Peso (MXN)" },
  { code: "BRL", symbol: "R$", label: "Brazilian Real (BRL)" },
  { code: "INR", symbol: "₹", label: "Indian Rupee (INR)" },
  { code: "AED", symbol: "AED ", label: "UAE Dirham (AED)" },
];

type InviteRow = { email: string; fullName: string; role: "manager" | "sales" | "workshop" | "staff" };

const EMPTY_INVITE: InviteRow = { email: "", fullName: "", role: "staff" };

export const ONBOARDING_FLAG_KEY = "frameit.setup.done.";

function markOnboardingDone(userId: string) {
  localStorage.setItem(ONBOARDING_FLAG_KEY + userId, "1");
}

export function isOnboardingDone(userId: string): boolean {
  return localStorage.getItem(ONBOARDING_FLAG_KEY + userId) === "1";
}

export function checkAndAutoMarkExistingUser(userId: string): boolean {
  if (isOnboardingDone(userId)) return true;
  try {
    const raw = localStorage.getItem("frameit.company");
    if (raw) {
      const company = JSON.parse(raw) as { companyName?: string };
      if (company.companyName) {
        markOnboardingDone(userId);
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

export default function Onboarding() {
  const { profile, save } = useCompany();
  const { themeMode } = useTheme();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [inviteRows, setInviteRows] = useState<InviteRow[]>([{ ...EMPTY_INVITE }]);
  const [inviteResults, setInviteResults] = useState<string[]>([]);
  const [inviteError, setInviteError] = useState("");

  // Company info fields (local state to avoid re-saving on every keystroke)
  const [form, setForm] = useState({
    companyName: "",
    email: "",
    phone: "",
    website: "",
    addressLine1: "",
    city: "",
    region: "",
    postalCode: "",
    country: "",
    currencyCode: "AUD",
    currencySymbol: "A$",
  });

  // Pre-fill from auth metadata and existing profile on mount
  useEffect(() => {
    const prefill = async () => {
      const { data } = await supabase.auth.getUser();
      const meta = data.user?.user_metadata || {};
      setForm((prev) => ({
        ...prev,
        companyName: profile.companyName || (meta.company_name as string) || "",
        email: profile.email || (data.user?.email as string) || "",
        phone: profile.phone || "",
        website: profile.website || "",
        addressLine1: profile.addressLine1 || "",
        city: profile.city || "",
        region: profile.region || "",
        postalCode: profile.postalCode || "",
        country: profile.country || "",
        currencyCode: profile.currencyCode || "AUD",
        currencySymbol: profile.currencySymbol || "A$",
      }));
    };
    void prefill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleCurrencyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const code = e.target.value;
    const match = CURRENCIES.find((c) => c.code === code);
    setForm((prev) => ({
      ...prev,
      currencyCode: code,
      currencySymbol: match?.symbol ?? code + " ",
    }));
  };

  const handleStep1Next = () => {
    if (!form.companyName.trim()) return;
    setStep(2);
  };

  const handleStep2Next = () => {
    setStep(3);
  };

  const handleFinish = async () => {
    setSaving(true);
    setInviteError("");
    const results: string[] = [];

    // Save company profile to localStorage
    save({
      companyName: form.companyName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      website: form.website.trim(),
      addressLine1: form.addressLine1.trim(),
      city: form.city.trim(),
      region: form.region.trim(),
      postalCode: form.postalCode.trim(),
      country: form.country.trim(),
      currencyCode: form.currencyCode,
      currencySymbol: form.currencySymbol,
    });

    // Send invites for non-empty rows
    const toInvite = inviteRows.filter((r) => r.email.trim());
    for (const row of toInvite) {
      try {
        await inviteCompanyMember({ email: row.email.trim(), fullName: row.fullName.trim() || undefined, role: row.role });
        results.push(`✓ Invited ${row.email}`);
      } catch (err) {
        results.push(`✗ ${row.email}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    setInviteResults(results);

    // Mark onboarding done
    const { data } = await supabase.auth.getUser();
    if (data.user?.id) markOnboardingDone(data.user.id);

    setSaving(false);
    window.location.hash = "#/dashboard";
  };

  const updateInviteRow = (idx: number, field: keyof InviteRow, value: string) => {
    setInviteRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const logoSrc = themeMode === "dark" ? "/FramersApp%20Logo%20white.png" : "/FramersApp%20logo%20Black.png";

  const steps = ["Company info", "Currency", "Invite users"];

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-start px-4 py-10">
      {/* Logo */}
      <img src={logoSrc} alt="FramersApp" className="h-8 mb-8" />

      {/* Progress */}
      <div className="w-full max-w-lg mb-6">
        <div className="flex items-center gap-2">
          {steps.map((label, i) => {
            const num = i + 1;
            const done = step > num;
            const active = step === num;
            return (
              <React.Fragment key={label}>
                <div className="flex items-center gap-2 shrink-0">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      done
                        ? "bg-emerald-500 text-white"
                        : active
                        ? "bg-slate-900 text-white"
                        : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {done ? "✓" : num}
                  </div>
                  <span className={`text-sm font-medium hidden sm:block ${active ? "text-slate-900" : "text-slate-400"}`}>
                    {label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-px transition-colors ${done ? "bg-emerald-400" : "bg-slate-200"}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6 sm:p-8">
        {/* ── Step 1: Company Info ── */}
        {step === 1 && (
          <div>
            <h1 className="text-xl font-semibold text-slate-900 mb-1">Welcome! Let's set up your company.</h1>
            <p className="text-sm text-slate-500 mb-6">This information appears on quotes and invoices.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Company name <span className="text-red-500">*</span>
                </label>
                <input
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={form.companyName}
                  onChange={set("companyName")}
                  placeholder="e.g. Smith Framing Studio"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Business email</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    placeholder="orders@yourshop.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={form.phone}
                    onChange={set("phone")}
                    placeholder="+61 4XX XXX XXX"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Website</label>
                <input
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={form.website}
                  onChange={set("website")}
                  placeholder="https://yourshop.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                <input
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-2"
                  value={form.addressLine1}
                  onChange={set("addressLine1")}
                  placeholder="Street address"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={form.city}
                    onChange={set("city")}
                    placeholder="City"
                  />
                  <input
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={form.postalCode}
                    onChange={set("postalCode")}
                    placeholder="Postal code"
                  />
                </div>
                <input
                  className="w-full mt-2 rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={form.country}
                  onChange={set("country")}
                  placeholder="Country"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleStep1Next}
                disabled={!form.companyName.trim()}
                className="rounded-xl bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold disabled:opacity-40 hover:bg-slate-800 transition"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Currency ── */}
        {step === 2 && (
          <div>
            <h1 className="text-xl font-semibold text-slate-900 mb-1">What currency do you operate in?</h1>
            <p className="text-sm text-slate-500 mb-6">Used on all quotes, invoices, and reports.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
                <select
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  value={form.currencyCode}
                  onChange={handleCurrencyChange}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600">
                <span className="font-medium text-slate-900">Preview: </span>
                <span className="font-semibold text-emerald-700">{form.currencySymbol}1,250.00</span>
                <span className="ml-2 text-slate-400">({form.currencyCode})</span>
              </div>

              <p className="text-xs text-slate-400">
                You can change this anytime in Admin → Company Settings.
              </p>
            </div>

            <div className="mt-6 flex justify-between">
              <button onClick={() => setStep(1)} className="text-sm text-slate-500 hover:text-slate-700 transition">
                ← Back
              </button>
              <button
                onClick={handleStep2Next}
                className="rounded-xl bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-800 transition"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Invite Users ── */}
        {step === 3 && (
          <div>
            <h1 className="text-xl font-semibold text-slate-900 mb-1">Invite your team</h1>
            <p className="text-sm text-slate-500 mb-6">
              Optional — you can invite staff now or later in Admin → Users.
            </p>

            <div className="space-y-3">
              {inviteRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
                  <div>
                    {idx === 0 && <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>}
                    <input
                      className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      type="email"
                      value={row.email}
                      onChange={(e) => updateInviteRow(idx, "email", e.target.value)}
                      placeholder="team@yourshop.com"
                    />
                  </div>
                  <div>
                    {idx === 0 && <label className="block text-xs font-medium text-slate-600 mb-1">Name (optional)</label>}
                    <input
                      className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      value={row.fullName}
                      onChange={(e) => updateInviteRow(idx, "fullName", e.target.value)}
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    {idx === 0 && <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>}
                    <select
                      className="rounded-lg border border-slate-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                      value={row.role}
                      onChange={(e) => updateInviteRow(idx, "role", e.target.value as InviteRow["role"])}
                    >
                      <option value="manager">Manager</option>
                      <option value="sales">Sales</option>
                      <option value="workshop">Workshop</option>
                      <option value="staff">Staff</option>
                    </select>
                  </div>
                  <div>
                    {idx === 0 && <div className="h-5 mb-1" />}
                    {inviteRows.length > 1 && (
                      <button
                        onClick={() => setInviteRows((rows) => rows.filter((_, i) => i !== idx))}
                        className="p-2 text-slate-400 hover:text-red-500 transition"
                        title="Remove"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <button
                onClick={() => setInviteRows((rows) => [...rows, { ...EMPTY_INVITE }])}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium transition"
              >
                + Add another
              </button>
            </div>

            {inviteError && (
              <p className="mt-3 text-sm text-red-600">{inviteError}</p>
            )}
            {inviteResults.length > 0 && (
              <div className="mt-3 text-xs space-y-1">
                {inviteResults.map((r, i) => (
                  <p key={i} className={r.startsWith("✓") ? "text-emerald-600" : "text-red-500"}>{r}</p>
                ))}
              </div>
            )}

            <div className="mt-6 flex items-center justify-between">
              <button onClick={() => setStep(2)} className="text-sm text-slate-500 hover:text-slate-700 transition">
                ← Back
              </button>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    // Skip invites, just save company + finish
                    setSaving(true);
                    save({
                      companyName: form.companyName.trim(),
                      email: form.email.trim(),
                      phone: form.phone.trim(),
                      website: form.website.trim(),
                      addressLine1: form.addressLine1.trim(),
                      city: form.city.trim(),
                      region: form.region.trim(),
                      postalCode: form.postalCode.trim(),
                      country: form.country.trim(),
                      currencyCode: form.currencyCode,
                      currencySymbol: form.currencySymbol,
                    });
                    const { data } = await supabase.auth.getUser();
                    if (data.user?.id) markOnboardingDone(data.user.id);
                    setSaving(false);
                    window.location.hash = "#/dashboard";
                  }}
                  disabled={saving}
                  className="text-sm text-slate-500 hover:text-slate-700 transition disabled:opacity-40"
                >
                  Skip for now
                </button>
                <button
                  onClick={handleFinish}
                  disabled={saving}
                  className="rounded-xl bg-emerald-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Finish setup"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400">You can update all of these in Admin → Company Settings at any time.</p>
    </div>
  );
}
