import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

const authLogoSrc = "/Framers%20App%20Logo%20v2.png";

type AuthMode = "signup" | "login";

type AuthPageProps = {
  defaultMode?: AuthMode;
};

export default function AuthPage({ defaultMode = "login" }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>(defaultMode);
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(false);
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoverySessionReady, setRecoverySessionReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetCooldown, setResetCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const href = window.location.href;
    const isReset = href.includes("type=recovery") || href.includes("recovery_token") || href.includes("reset=1");
    if (!isReset) return;

    setIsRecoveryFlow(true);
    setMode("login");

    // Supabase stores the recovery session in localStorage after code exchange.
    // onAuthStateChange fires synchronously with the stored session on init,
    // so listen for it to confirm the session is live before allowing updateUser.
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        setRecoverySessionReady(true);
        setMessage("Enter your new password below.");
        subscription.unsubscribe();
      }
    });

    // Also check if a session already exists right now (handles page reload case)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setRecoverySessionReady(true);
        setMessage("Enter your new password below.");
        subscription.unsubscribe();
      }
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  const title = useMemo(
    () => (mode === "signup" ? "Start your free trial" : "Welcome back"),
    [mode]
  );

  const subtitle = useMemo(
    () =>
      isRecoveryFlow
        ? "Set a new password to restore access to your account."
        : mode === "signup"
        ? "Create your Framers App account and we will set up your 14-day free trial automatically."
        : "Sign in to continue managing your framing business.",
    [isRecoveryFlow, mode]
  );

  const handleForgotPassword = async () => {
    setError(null);
    setMessage(null);

    if (!supabase) {
      setError("Supabase is not configured for authentication.");
      return;
    }

    if (!email.trim()) {
      setError("Enter your email address first, then click forgot password.");
      return;
    }

    try {
      setLoading(true);
      // Add an explicit flow marker so callback can always route to reset UI,
      // even if Supabase omits type=recovery in some PKCE responses.
      const redirectTo = `${window.location.origin}/auth/callback?flow=recovery`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (resetError) throw resetError;
      setMessage("Password reset email sent. Open the email link, then enter your new password here.");
      // Start 60-second cooldown to prevent hammering the rate limit
      setResetCooldown(60);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      cooldownRef.current = setInterval(() => {
        setResetCooldown((prev) => {
          if (prev <= 1) {
            if (cooldownRef.current) clearInterval(cooldownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (forgotError: unknown) {
      const msg = forgotError instanceof Error ? forgotError.message : "Could not send reset email.";
      if (msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("email rate")) {
        const retryAfter = new Date(Date.now() + 60 * 60 * 1000);
        const retryTime = retryAfter.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        setError(`Supabase has rate-limited password reset emails for this address (limit: 1 per hour). Please try again after ${retryTime}.`);
        const waitSecs = 3600;
        setResetCooldown(waitSecs);
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        cooldownRef.current = setInterval(() => {
          setResetCooldown((prev) => {
            if (prev <= 1) {
              if (cooldownRef.current) clearInterval(cooldownRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!supabase) {
      setError("Supabase is not configured for authentication.");
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      setMessage("Password updated successfully. You can now sign in.");
      setIsRecoveryFlow(false);
      setNewPassword("");
      setConfirmPassword("");
      window.location.hash = "#/login";
    } catch (recoveryError: unknown) {
      setError(recoveryError instanceof Error ? recoveryError.message : "Could not update password.");
    } finally {
      setLoading(false);
    }
  };

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
        const redirectTo = `${window.location.origin}/#/auth/callback`;
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
            {!isRecoveryFlow && (
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
            )}

            <form className="space-y-4" onSubmit={isRecoveryFlow ? handleRecoverySubmit : handleSubmit}>
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

              {isRecoveryFlow && !recoverySessionReady && (
                <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-200">
                  Verifying your reset link… please wait.
                </div>
              )}

              {isRecoveryFlow && recoverySessionReady && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-200">
                      New password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-200">
                      Confirm new password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                    />
                  </div>
                </>
              )}

              {!isRecoveryFlow && (
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
              )}

              {!isRecoveryFlow && (
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
              )}

              {!isRecoveryFlow && mode === "login" && (
                <button
                  type="button"
                  onClick={() => void handleForgotPassword()}
                  disabled={loading || resetCooldown > 0}
                  className="text-sm font-semibold text-cyan-200 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resetCooldown > 0
                    ? resetCooldown >= 3600
                      ? "Rate limited (1 hr)"
                      : resetCooldown >= 60
                      ? `Resend in ${Math.ceil(resetCooldown / 60)}m`
                      : `Resend in ${resetCooldown}s`
                    : "Forgot password?"}
                </button>
              )}

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
                disabled={loading || (isRecoveryFlow && !recoverySessionReady)}
                className="w-full rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black uppercase tracking-wide text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-cyan-200/60"
              >
                {loading
                  ? "Please wait..."
                  : isRecoveryFlow
                  ? "Update password"
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
