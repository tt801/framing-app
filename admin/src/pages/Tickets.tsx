import { useEffect, useMemo, useState } from "react";
import {
  listPlatformTickets,
  listPlatformTicketComments,
  updatePlatformTicket,
  createPlatformTicketComment,
  type PlatformTicket,
  type TicketComment,
  type TicketStatus,
  type TicketPriority,
} from "@/lib/api";
import { RefreshCw, MessageSquare } from "lucide-react";

const STATUS_BADGE: Record<string, string> = {
  open: "badge-red",
  in_progress: "badge-blue",
  waiting_customer: "badge-amber",
  resolved: "badge-green",
  closed: "badge-slate",
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "badge-red",
  high: "badge-amber",
  normal: "badge-blue",
  low: "badge-slate",
};

export default function Tickets() {
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [tickets, setTickets] = useState<PlatformTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [comments, setComments] = useState<TicketComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentVisibility, setCommentVisibility] = useState<"internal" | "customer">(
    "internal"
  );
  const [savingComment, setSavingComment] = useState(false);

  function loadTickets() {
    setLoading(true);
    setError(null);
    listPlatformTickets(statusFilter)
      .then((d) => {
        setTickets(d.tickets ?? []);
        if (!selectedTicketId && d.tickets?.length) {
          setSelectedTicketId(d.tickets[0].id);
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(loadTickets, [statusFilter]);

  useEffect(() => {
    if (!selectedTicketId) { setComments([]); return; }
    setLoadingComments(true);
    listPlatformTicketComments(selectedTicketId)
      .then((d) => setComments(d.comments ?? []))
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false));
  }, [selectedTicketId]);

  const selectedTicket = useMemo(
    () => tickets.find((t) => t.id === selectedTicketId) ?? null,
    [tickets, selectedTicketId]
  );

  const filtered = tickets.filter((t) => {
    const q = search.toLowerCase();
    return (
      !search ||
      t.subject.toLowerCase().includes(q) ||
      (t.company_name ?? "").toLowerCase().includes(q) ||
      (t.requester_email ?? "").toLowerCase().includes(q) ||
      t.ticket_number.toLowerCase().includes(q)
    );
  });

  async function patchTicket(input: {
    ticketId: string;
    status?: TicketStatus;
    priority?: TicketPriority;
  }) {
    try {
      const d = await updatePlatformTicket(input);
      setTickets((prev) => prev.map((t) => (t.id === input.ticketId ? d.ticket : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function addComment() {
    if (!selectedTicketId || !commentBody.trim()) return;
    try {
      setSavingComment(true);
      const d = await createPlatformTicketComment({
        ticketId: selectedTicketId,
        body: commentBody.trim(),
        visibility: commentVisibility,
      });
      setComments((prev) => [...prev, d.comment]);
      setCommentBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post comment");
    } finally {
      setSavingComment(false);
    }
  }

  return (
    <div className="page ticket-split">
      {/* Left: ticket list */}
      <div className="ticket-list-panel card">
        <div className="toolbar tight">
          <input
            className="search-input"
            placeholder="Search tickets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | TicketStatus)}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="waiting_customer">Waiting</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <button className="btn-icon" onClick={loadTickets} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="ticket-rows">
          {loading ? (
            <div className="page-state">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="page-state">No tickets found.</div>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                className={`ticket-row${selectedTicketId === t.id ? " selected" : ""}`}
                onClick={() => setSelectedTicketId(t.id)}
              >
                <div className="ticket-row-top">
                  <span className="ticket-number">{t.ticket_number}</span>
                  <span className={`badge ${STATUS_BADGE[t.status] ?? "badge-slate"}`}>
                    {t.status}
                  </span>
                </div>
                <div className="ticket-subject">{t.subject}</div>
                <div className="ticket-meta">
                  {t.company_name ?? "Unknown"} · {new Date(t.created_at).toLocaleDateString()}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: ticket detail */}
      <div className="ticket-detail-panel card">
        {!selectedTicket ? (
          <div className="page-state">Select a ticket to view.</div>
        ) : (
          <>
            <div className="ticket-detail-header">
              <h2 className="ticket-detail-subject">{selectedTicket.subject}</h2>
              <p className="text-muted ticket-detail-meta">
                {selectedTicket.ticket_number} · {selectedTicket.company_name ?? "Unknown"} ·{" "}
                {selectedTicket.requester_email ?? "No email"}
              </p>
            </div>

            <div className="ticket-fields">
              <div className="field-group">
                <label className="field-label">Status</label>
                <select
                  className="filter-select"
                  value={selectedTicket.status}
                  onChange={(e) =>
                    void patchTicket({
                      ticketId: selectedTicket.id,
                      status: e.target.value as TicketStatus,
                    })
                  }
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="waiting_customer">Waiting customer</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">Priority</label>
                <select
                  className="filter-select"
                  value={selectedTicket.priority}
                  onChange={(e) =>
                    void patchTicket({
                      ticketId: selectedTicket.id,
                      priority: e.target.value as TicketPriority,
                    })
                  }
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <span className={`badge ${PRIORITY_BADGE[selectedTicket.priority] ?? "badge-slate"}`}>
                  {selectedTicket.priority}
                </span>
              </div>
            </div>

            <div className="ticket-section-label">Message</div>
            <div className="ticket-message">{selectedTicket.message}</div>

            <div className="ticket-section-label">
              <MessageSquare size={13} /> Timeline
            </div>

            {loadingComments ? (
              <p className="text-muted">Loading…</p>
            ) : comments.length === 0 ? (
              <p className="text-muted">No comments yet.</p>
            ) : (
              <div className="comment-list">
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className={`comment-item ${c.visibility === "internal" ? "internal" : "customer"}`}
                  >
                    <div className="comment-meta">
                      <span>{c.author_name ?? c.author_email ?? "Team"}</span>
                      <span className={`badge badge-xs ${c.visibility === "internal" ? "badge-slate" : "badge-blue"}`}>
                        {c.visibility}
                      </span>
                      <span>{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <div className="comment-body">{c.body}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="ticket-reply">
              <div className="ticket-reply-top">
                <label className="field-label">Add note</label>
                <select
                  className="filter-select sm"
                  value={commentVisibility}
                  onChange={(e) =>
                    setCommentVisibility(e.target.value as "internal" | "customer")
                  }
                >
                  <option value="internal">Internal note</option>
                  <option value="customer">Visible to customer</option>
                </select>
              </div>
              <textarea
                className="reply-textarea"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Write a note or reply…"
                rows={3}
              />
              <button
                className="btn-primary sm"
                onClick={() => void addComment()}
                disabled={savingComment || !commentBody.trim()}
              >
                {savingComment ? "Posting…" : "Post"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
