import React, { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

const authLogoSrc = "/framersapp-logo-lightblue.png";
const authTagline = "Business OS for modern framing studios";

type AuthMode = "signup" | "login";

type AuthPageProps = {
  defaultMode?: AuthMode;
};

export default function AuthPage({ defaultMode = "login" }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>(defaultMode);
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const title = useMemo(
    () => (mode === "signup" ? "Start your free trial" : "Welcome back"),
    [mode]
  );

  const subtitle = useMemo(
    () =>
      mode === "signup"
        ? "Create your Framers App account and we will set up your 14-day free trial automatically."
        : "Sign in to continue managing your framing business.",
    [mode]
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!supabase) {
      setError("Supabase is not configured for authentication.");
      return;
    }

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    if (mode === "signup" && !companyName.trim()) {
      setError("Company name is required to start a trial.");
      return;
    }

    try {
      setLoading(true);

      if (mode === "signup") {
        const redirectTo = `${window.location.origin}/auth/callback`;
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: {
              full_name: fullName,
              company_name: companyName,
            },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        setMessage(
          "Account created. Check your email to confirm your address, then sign in to start your trial."
        );
        setMode("login");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      window.location.hash = "#/dashboard";
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Authentication failed."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-root min-h-dvh text-slate-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <section>
            <a
              href="#/"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-100 hover:bg-white/10"
            >
              Back to site
            </a>
            <div className="mt-6 flex flex-col items-start">
              <img
                src={authLogoSrc}
                alt="Framers App"
                className="h-10 w-auto object-contain"
              />
              <p className="mt-2 text-xs text-slate-300/80">{authTagline}</p>
            </div>
            <h1 className="mt-3 font-display text-4xl leading-[1.05] text-white sm:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-200/90 sm:text-lg">
              {subtitle}
            </p>
            <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
              <p className="text-sm font-semibold text-white">What happens after signup</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-200/90">
                <li>Your company workspace is created automatically.</li>
                <li>Your 14-day free trial starts on first access.</li>
                <li>You can add your own integrations and team details later.</li>
              </ul>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-white/15 bg-slate-950/65 p-6 shadow-2xl backdrop-blur sm:p-8">
            <div className="mb-6 flex gap-2 rounded-full border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={mode === "signup"
                  ? "flex-1 rounded-full bg-cyan-300 px-4 py-2 text-sm font-extrabold text-slate-950"
                  : "flex-1 rounded-full px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/5"}
              >
                Start trial
              </button>
              <button
                type="button"
                onClick={() => setMode("login")}
                className={mode === "login"
                  ? "flex-1 rounded-full bg-cyan-300 px-4 py-2 text-sm font-extrabold text-slate-950"
                  : "flex-1 rounded-full px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/5"}
              >
                Sign in
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              {mode === "signup" && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-200">
                      Full name
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Alex Thompson"
                      className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-200">
                      Company name
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Alex Fine Framing"
                      className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-200">
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-200">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {error}
                </div>
              ) : null}

              {message ? (
                <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  {message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black uppercase tracking-wide text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-cyan-200/60"
              >
                {loading
                  ? "Please wait..."
                  : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
