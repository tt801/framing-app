import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import Dashboard from "@/pages/Dashboard";
import Companies from "@/pages/Companies";
import Users from "@/pages/Users";
import Tickets from "@/pages/Tickets";
import Subscriptions from "@/pages/Subscriptions";
import CMS from "@/pages/CMS";

export type View = "dashboard" | "companies" | "users" | "tickets" | "subscriptions" | "cms";

export default function App() {
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [view, setView] = useState<View>("dashboard");

  useEffect(() => {
    if (!supabase) { setLoadingAuth(false); return; }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setIsSignedIn(Boolean(data.session));
      setLoadingAuth(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setIsSignedIn(Boolean(session));
      setLoadingAuth(false);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    try {
      setAuthError(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h2>Supabase not configured</h2>
          <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in <code>admin/.env</code>.</p>
        </div>
      </div>
    );
  }

  if (loadingAuth) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="text-muted">Checking session…</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">F</div>
          <h2 className="auth-title">Platform Admin</h2>
          <p className="auth-sub">Internal team access only.</p>
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
            <button type="submit" className="btn-primary">Sign In</button>
            {authError && <p className="error-text">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar view={view} setView={setView} onSignOut={() => void supabase?.auth.signOut()} />
      <div className="shell-body">
        <TopBar view={view} />
        <main className="shell-main">
          {view === "dashboard"     && <Dashboard />}
          {view === "companies"     && <Companies />}
          {view === "users"         && <Users />}
          {view === "tickets"       && <Tickets />}
          {view === "subscriptions" && <Subscriptions />}
          {view === "cms"           && <CMS />}
        </main>
      </div>
    </div>
  );
}
