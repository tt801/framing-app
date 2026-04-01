import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const authLogoSrc = "/framersapp-logo-lightblue.png";

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Confirming your account...");

  useEffect(() => {
    let active = true;

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

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
        }

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
