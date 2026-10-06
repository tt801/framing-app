import { useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured, isRecoveryCallback, markRecoveryCallback, clearRecoveryCallback } from "@/lib/supabase";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import Dashboard from "@/pages/Dashboard";
import Companies from "@/pages/Companies";
import Users from "@/pages/Users";
import Tickets from "@/pages/Tickets";
import Subscriptions from "@/pages/Subscriptions";
import CMS from "@/pages/CMS";

export type View = "dashboard" | "companies" | "users" | "tickets" | "subscriptions" | "cms";
type AuthView = "login" | "request-reset" | "set-password" | "reset-complete";

export default function App() {
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const allowSignedOutTransitionRef = useRef(false);
  const recoveryPendingRef = useRef(isRecoveryCallback);
  const recoveryReadyRef = useRef(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [authView, setAuthView] = useState<AuthView>(isRecoveryCallback ? "set-password" : "login");
  const [view, setView] = useState<View>("dashboard");

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoadingAuth(false);
      return;
    }

    let mounted = true;

    const syncSession = async () => {
      const { data } = await client.auth.getSession();
      if (!mounted) return;
      setIsSignedIn(!recoveryPendingRef.current && Boolean(data.session));
      setLoadingAuth(false);
    };

    void syncSession();

    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        markRecoveryCallback();
        recoveryPendingRef.current = true;
        recoveryReadyRef.current = true;
        setAuthView("set-password");
        setRecoveryReady(true);
        setAuthError(null);
        setIsSignedIn(false);
        setLoadingAuth(false);
        return;
      }
      if (session) {
        // A callback session is not a completed password reset or Admin authorization.
        setIsSignedIn(!recoveryPendingRef.current);
        allowSignedOutTransitionRef.current = false;
        setLoadingAuth(false);
        return;
      }

      // Only process signed-out transitions if this app initiated sign-out.
      if (event === "SIGNED_OUT" && allowSignedOutTransitionRef.current) {
        void syncSession();
        return;
      }

      // Ignore transient null-session events to avoid auth flicker.
      setLoadingAuth(false);
    });

    const verificationTimeout = recoveryPendingRef.current ? window.setTimeout(() => {
      if (mounted && !recoveryReadyRef.current) {
        setAuthError("Recovery link could not be verified. Request a new link.");
      }
    }, 5_000) : null;

    return () => {
      mounted = false;
      if (verificationTimeout !== null) window.clearTimeout(verificationTimeout);
      data.subscription.unsubscribe();
    };
  }, []);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    try {
      setAuthError(null);
      allowSignedOutTransitionRef.current = false;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  async function handleSignOut() {
    if (!supabase) return;
    allowSignedOutTransitionRef.current = true;
    await supabase.auth.signOut();
  }

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || authPending) return;
    setAuthError(null);
    setAuthMessage(null);
    setAuthPending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setAuthMessage("If an account exists for that email, a recovery email has been sent.");
    } catch {
      setAuthError("Unable to request a recovery email. Please try again later.");
    } finally {
      setAuthPending(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !recoveryReady || authPending) return;
    setAuthError(null);
    if (!passwordUpdated) {
      if (newPassword.length < 8) {
        setAuthError("Use a password of at least 8 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setAuthError("Passwords do not match.");
        return;
      }
    }
    setAuthPending(true);
    let didUpdatePassword = passwordUpdated;
    try {
      if (!didUpdatePassword) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) {
          setAuthError(error.message);
          return;
        }
        didUpdatePassword = true;
        setPasswordUpdated(true);
        setNewPassword("");
        setConfirmPassword("");
      }
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setAuthError("Password updated, but sign-out failed. Please try finishing sign-out again.");
        return;
      }
      setIsSignedIn(false);
      clearRecoveryCallback();
      setAuthView("reset-complete");
      window.history.replaceState(window.history.state, "", window.location.pathname);
    } catch {
      setAuthError(didUpdatePassword
        ? "Sign-out failed. Please try finishing sign-out again."
        : "Unable to update your password. Please try again.");
    } finally {
      setAuthPending(false);
    }
  }

  async function handleRequestAnotherLink() {
    if (!supabase || authPending) return;
    setAuthPending(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      clearRecoveryCallback();
      recoveryPendingRef.current = false;
      recoveryReadyRef.current = false;
      setIsSignedIn(false);
      setAuthError(null);
      setAuthView("request-reset");
      window.history.replaceState(window.history.state, "", window.location.pathname);
    } catch {
      setAuthError("Unable to sign out safely. Please try again.");
    } finally {
      setAuthPending(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h2>Supabase not configured</h2>
          <p>
            Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in <code>admin/.env</code>.
          </p>
        </div>
      </div>
    );
  }

  if (loadingAuth) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="text-muted">Checking session...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn || authView !== "login") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">F</div>
          <h2 className="auth-title">{authView === "request-reset" ? "Reset password" : authView === "set-password" ? "Set new password" : "Platform Admin"}</h2>
          <p className="auth-sub">{authView === "request-reset" ? "Enter your email to request a recovery link." : authView === "set-password" ? "Choose a new password for your account." : "Internal team access only."}</p>
          {authView === "request-reset" ? (
            <form className="auth-form" onSubmit={(e) => void handleRequestReset(e)}>
              <input className="form-input" type="email" placeholder="Email" value={email}
                onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              <button className="btn-primary" type="submit" disabled={authPending}>
                {authPending ? "Sending..." : "Send reset link"}
              </button>
              <button className="auth-link" type="button" onClick={() => { setAuthView("login"); setAuthError(null); setAuthMessage(null); }}>Back to sign in</button>
              {authMessage && <p role="status" className="auth-sub">{authMessage}</p>}
              {authError && <p role="alert" className="error-text">{authError}</p>}
            </form>
          ) : authView === "set-password" ? (
            <form className="auth-form" onSubmit={(e) => void handleSetPassword(e)}>
              {!recoveryReady ? <p role="status" className="auth-sub">Verifying recovery link...</p> : !passwordUpdated ? (
                <>
                  <input className="form-input" type="password" placeholder="New password" value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)} required autoComplete="new-password" />
                  <input className="form-input" type="password" placeholder="Confirm new password" value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
                </>
              ) : null}
              <button className="btn-primary" type="submit" disabled={!recoveryReady || authPending}>
                {authPending ? "Please wait..." : passwordUpdated ? "Finish sign-out" : "Set new password"}
              </button>
              {authError && <p role="alert" className="error-text">{authError}</p>}
              {!recoveryReady && authError && <button className="auth-link" type="button" disabled={authPending}
                onClick={() => void handleRequestAnotherLink()}>Request another link</button>}
            </form>
          ) : authView === "reset-complete" ? (
            <div className="auth-form">
              <p role="status" className="auth-sub">Password updated. You have been signed out. Sign in with your new password.</p>
              <button className="btn-primary" type="button" onClick={() => {
                recoveryPendingRef.current = false;
                setRecoveryReady(false);
                setPasswordUpdated(false);
                setAuthError(null);
                setAuthView("login");
              }}>Back to sign in</button>
            </div>
          ) : (
          <form onSubmit={(e) => void handleSignIn(e)} className="auth-form">
            <input
              className="form-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
            <input
              className="form-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <button type="submit" className="btn-primary">
              Sign In
            </button>
            <button className="auth-link" type="button" onClick={() => setAuthView("request-reset")}>Forgot password?</button>
            {authError && <p className="error-text">{authError}</p>}
          </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar view={view} setView={setView} onSignOut={() => void handleSignOut()} />
      <div className="shell-body">
        <TopBar view={view} />
        <main className="shell-main">
          {view === "dashboard" && <Dashboard />}
          {view === "companies" && <Companies />}
          {view === "users" && <Users />}
          {view === "tickets" && <Tickets />}
          {view === "subscriptions" && <Subscriptions />}
          {view === "cms" && <CMS />}
        </main>
      </div>
    </div>
  );
}
