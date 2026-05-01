import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  createPlatformTicketComment,
  listPlatformTicketComments,
  listPlatformTickets,
  updatePlatformTicket,
  type PlatformTicket,
  type TicketComment,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/api";

type View = "tickets" | "cms";

export default function App() {
  const [view, setView] = useState<View>("tickets");
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [tickets, setTickets] = useState<PlatformTicket[]>([]);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const [comments, setComments] = useState<TicketComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<"internal" | "customer">("internal");
  const [savingComment, setSavingComment] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoadingAuth(false);
      return;
    }

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

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    if (view !== "tickets") return;
    void loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, view, statusFilter]);

  async function handleSignIn() {
    if (!supabase) return;
    try {
      setAuthError(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  async function loadTickets() {
    try {
      setTicketError(null);
      setLoadingTickets(true);
      const data = await listPlatformTickets(statusFilter);
      setTickets(data.tickets || []);
      if (!selectedTicketId && data.tickets?.length) {
        setSelectedTicketId(data.tickets[0].id);
      }
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoadingTickets(false);
    }
  }

  async function loadComments(ticketId: string) {
    try {
      setLoadingComments(true);
      const data = await listPlatformTicketComments(ticketId);
      setComments(data.comments || []);
    } finally {
      setLoadingComments(false);
    }
  }

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  );

  useEffect(() => {
    if (!selectedTicketId) {
      setComments([]);
      return;
    }
    void loadComments(selectedTicketId);
  }, [selectedTicketId]);

  async function patchTicket(input: { ticketId: string; status?: TicketStatus; priority?: TicketPriority }) {
    try {
      const data = await updatePlatformTicket(input);
      setTickets((prev) => prev.map((t) => (t.id === input.ticketId ? data.ticket : t)));
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : "Ticket update failed");
    }
  }

  async function addComment() {
    if (!selectedTicketId || !commentBody.trim()) return;
    try {
      setSavingComment(true);
      const data = await createPlatformTicketComment({
        ticketId: selectedTicketId,
        body: commentBody.trim(),
        visibility: commentVisibility,
      });
      setComments((prev) => [...prev, data.comment]);
      setCommentBody("");
    } catch (err) {
      setTicketError(err instanceof Error ? err.message : "Could not add comment");
    } finally {
      setSavingComment(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="auth-card card">
        <h2>Supabase not configured</h2>
        <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in admin/.env.local.</p>
      </div>
    );
  }

  if (loadingAuth) {
    return (
      <div className="auth-card card">
        <p>Checking session...</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="auth-card card">
        <h2 style={{ marginTop: 0 }}>Platform Admin Sign In</h2>
        <p style={{ color: "#64748b", marginBottom: 16 }}>
          Use your internal team account. Access is enforced by PLATFORM_ADMIN_EMAILS on the backend.
        </p>
        <div className="grid">
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn" onClick={() => void handleSignIn()}>Sign In</button>
          {authError && <p style={{ color: "#b91c1c", margin: 0 }}>{authError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar">
        <div className="platform-brand">Framers Platform</div>
        <div className="platform-title">Admin Control</div>

        <nav className="platform-nav">
          <button className={view === "tickets" ? "active" : ""} onClick={() => setView("tickets")}>
            Support Tickets
          </button>
          <button className={view === "cms" ? "active" : ""} onClick={() => setView("cms")}>
            CMS (Starter)
          </button>
          <button onClick={() => void handleSignOut()}>Sign out</button>
        </nav>
      </aside>

      <main className="platform-main">
        {view === "tickets" ? (
          <section className="split">
            <div className="card" style={{ padding: 14 }}>
              <div className="toolbar" style={{ marginBottom: 10 }}>
                <h2 style={{ margin: 0, marginRight: "auto" }}>All Client Tickets</h2>
                <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | TicketStatus)} style={{ width: 180 }}>
                  <option value="all">All statuses</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="waiting_customer">Waiting customer</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <button className="btn secondary" onClick={() => void loadTickets()}>Refresh</button>
              </div>

              {ticketError && <div className="notice" style={{ marginBottom: 10 }}>{ticketError}</div>}

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Company</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingTickets ? (
                      <tr>
                        <td colSpan={5}>Loading...</td>
                      </tr>
                    ) : tickets.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No tickets found.</td>
                      </tr>
                    ) : (
                      tickets.map((t) => (
                        <tr
                          key={t.id}
                          onClick={() => setSelectedTicketId(t.id)}
                          style={{ cursor: "pointer", background: selectedTicketId === t.id ? "#f8fafc" : "transparent" }}
                        >
                          <td>
                            <div>{t.ticket_number}</div>
                            <div style={{ color: "#64748b", fontSize: 12 }}>{t.subject}</div>
                          </td>
                          <td>{t.company_name || "Unknown"}</td>
                          <td>
                            <span className={`badge ${t.status}`}>{t.status}</span>
                          </td>
                          <td>{t.priority}</td>
                          <td>{new Date(t.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card" style={{ padding: 14 }}>
              {!selectedTicket ? (
                <p style={{ margin: 0 }}>Select a ticket to inspect.</p>
              ) : (
                <>
                  <h3 style={{ marginTop: 0, marginBottom: 6 }}>{selectedTicket.subject}</h3>
                  <p style={{ marginTop: 0, color: "#64748b", fontSize: 13 }}>
                    {selectedTicket.ticket_number} | {selectedTicket.company_name || "Unknown"} | {selectedTicket.requester_email || "No email"}
                  </p>

                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div>
                      <label>Status</label>
                      <select
                        className="select"
                        value={selectedTicket.status}
                        onChange={(e) => {
                          void patchTicket({ ticketId: selectedTicket.id, status: e.target.value as TicketStatus });
                        }}
                      >
                        <option value="open">open</option>
                        <option value="in_progress">in_progress</option>
                        <option value="waiting_customer">waiting_customer</option>
                        <option value="resolved">resolved</option>
                        <option value="closed">closed</option>
                      </select>
                    </div>
                    <div>
                      <label>Priority</label>
                      <select
                        className="select"
                        value={selectedTicket.priority}
                        onChange={(e) => {
                          void patchTicket({ ticketId: selectedTicket.id, priority: e.target.value as TicketPriority });
                        }}
                      >
                        <option value="low">low</option>
                        <option value="normal">normal</option>
                        <option value="high">high</option>
                        <option value="urgent">urgent</option>
                      </select>
                    </div>
                  </div>

                  <p style={{ marginTop: 12, marginBottom: 4, fontWeight: 700 }}>Message</p>
                  <div className="comment">{selectedTicket.message}</div>

                  <p style={{ marginTop: 14, marginBottom: 4, fontWeight: 700 }}>Timeline</p>
                  {loadingComments ? <p>Loading comments...</p> : null}
                  {comments.map((c) => (
                    <div key={c.id} className="comment">
                      <small>
                        {c.author_name || c.author_email || "Team"} | {c.visibility} | {new Date(c.created_at).toLocaleString()}
                      </small>
                      <div>{c.body}</div>
                    </div>
                  ))}

                  <p style={{ marginTop: 14, marginBottom: 4, fontWeight: 700 }}>Add note</p>
                  <select className="select" value={commentVisibility} onChange={(e) => setCommentVisibility(e.target.value as "internal" | "customer")}> 
                    <option value="internal">internal</option>
                    <option value="customer">customer</option>
                  </select>
                  <textarea className="textarea" value={commentBody} onChange={(e) => setCommentBody(e.target.value)} placeholder="Write a note..." />
                  <button className="btn" onClick={() => void addComment()} disabled={savingComment || !commentBody.trim()}>
                    {savingComment ? "Posting..." : "Post comment"}
                  </button>
                </>
              )}
            </div>
          </section>
        ) : (
          <section className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0 }}>CMS Starter</h2>
            <p>
              This is the placeholder for your team CMS modules (landing content, legal copy, announcements, feature flags).
            </p>
            <div className="notice">
              Next step: connect this to your existing content tables and add publish/version workflows.
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
