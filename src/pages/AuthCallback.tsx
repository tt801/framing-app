import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const authLogoSrc = "/Framers%20App%20Logo%20v2.png";

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Confirming your account...");

  useEffect(() => {
    let active = true;
    let authSubscription: { unsubscribe: () => void } | null = null;

    const completeAuth = async () => {
      if (!supabase) {
        if (active) {
          setError("Supabase is not configured for authentication.");
        }
        return;
      }

      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        // type=recovery may or may not be present depending on Supabase version
        const typeParam = url.searchParams.get("type");

        // Listen for the auth event BEFORE exchanging the code so we don't miss it.
        // Supabase fires PASSWORD_RECOVERY (not SIGNED_IN) when the code is for a
        // password reset — this is more reliable than checking the type URL param.
        const recoveryDetected = { value: typeParam === "recovery" };

        const { data } = supabase.auth.onAuthStateChange((event) => {
          if (event === "PASSWORD_RECOVERY") {
            recoveryDetected.value = true;
          }
        });
        authSubscription = data.subscription;

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
        }

        // Small tick to let onAuthStateChange fire synchronously after exchange
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Password recovery flow — redirect to the reset form
        if (recoveryDetected.value) {
          if (active) {
            setStatus("Identity verified. Taking you to the password reset form...");
            authSubscription?.unsubscribe();
            window.setTimeout(() => {
              window.location.replace(`${window.location.origin}/#/login?reset=1`);
            }, 800);
          }
          return;
        }

        authSubscription?.unsubscribe();

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          if (active) {
            setStatus("Email confirmed. Please sign in to continue.");
            window.setTimeout(() => {
              window.location.replace(`${window.location.origin}/#/login`);
            }, 1200);
          }
          return;
        }

        if (active) {
          setStatus("Success. Taking you to your dashboard...");
          window.location.replace(`${window.location.origin}/#/dashboard`);
        }
      } catch (callbackError: unknown) {
        authSubscription?.unsubscribe();
        if (!active) return;
        setError(
          callbackError instanceof Error
            ? callbackError.message
            : "Authentication callback failed."
        );
      }
    };

    completeAuth();

    return () => {
      active = false;
      authSubscription?.unsubscribe();
    };
  }, []);

  return (
    <div className="landing-root min-h-dvh text-slate-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full rounded-[1.75rem] border border-white/15 bg-slate-950/65 p-8 text-center shadow-2xl backdrop-blur">
          <div className="flex flex-col items-center">
            <img
              src={authLogoSrc}
              alt="Framers App"
              className="h-10 w-auto object-contain"
            />
          </div>
          <h1 className="mt-3 text-3xl font-black text-white">Auth callback</h1>
          <p className="mt-3 text-sm leading-6 text-slate-200/90">{error || status}</p>
          <div className="mt-6">
            <a
              href="#/login"
              className="inline-flex rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-bold text-slate-100 hover:bg-white/10"
            >
              Back to login
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
