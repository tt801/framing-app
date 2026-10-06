import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// Capture callback evidence before createClient consumes/clears the URL.
// Store only a boolean marker (never a token); keep the recovery screen across refreshes.
const recoveryKey = "framers-admin-recovery-pending";
export const isRecoveryCallback = typeof window !== "undefined" && (() => {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  // Password sign-in is the only other auth flow in this standalone Admin app.
  const fromUrl = hash.get("type") === "recovery" || url.searchParams.has("code") ||
    url.searchParams.has("error") || hash.has("error") ||
    url.searchParams.has("error_code") || hash.has("error_code");
  try {
    if (fromUrl) window.sessionStorage.setItem(recoveryKey, "1");
    return fromUrl || window.sessionStorage.getItem(recoveryKey) === "1";
  } catch {
    return fromUrl;
  }
})();

export function markRecoveryCallback() {
  try { window.sessionStorage.setItem(recoveryKey, "1"); } catch { /* Storage may be blocked. */ }
}

export function clearRecoveryCallback() {
  try { window.sessionStorage.removeItem(recoveryKey); } catch { /* Storage may be blocked. */ }
}

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}
