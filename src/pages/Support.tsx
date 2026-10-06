import React, { useEffect, useRef, useState } from "react";
import {
  createSupportTicket, listCustomerSupportTickets, getCustomerSupportTicket,
  listCustomerTicketComments, createCustomerTicketComment,
  type CustomerSupportTicket, type CustomerSupportComment,
} from "@/lib/supportTickets";
import { getCurrentUser } from "@/lib/supabase";

const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const buttonClass = "rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70";

function isTicketListRoute() {
  return new URLSearchParams(window.location.hash.split("?")[1] || "").get("view") === "tickets";
}

export default function SupportPage() {
  const [mode, setMode] = useState<"new" | "tickets">(isTicketListRoute() ? "tickets" : "new");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [tickets, setTickets] = useState<CustomerSupportTicket[]>([]);
  const [selected, setSelected] = useState<CustomerSupportTicket | null>(null);
  const [comments, setComments] = useState<CustomerSupportComment[]>([]);
  const [reply, setReply] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  useEffect(() => {
    const onHashChange = () => setMode(isTicketListRoute() ? "tickets" : "new");
    window.addEventListener("hashchange", onHashChange);
    void getCurrentUser().then((user) => setUserId(user?.id || null)).catch(() => setUserId(null));
    const requests = detailRequest;
    return () => { window.removeEventListener("hashchange", onHashChange); requests.current++; };
  }, []);

  useEffect(() => {
    if (mode !== "tickets") return;
    let active = true;
    setLoadingList(true);
    setError(null);
    void listCustomerSupportTickets()
      .then(({ tickets: items }) => { if (active) setTickets(items || []); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Could not load tickets"); })
      .finally(() => { if (active) setLoadingList(false); });
    return () => { active = false; };
  }, [mode]);

  async function openTicket(id: string) {
    const request = ++detailRequest.current;
    setSelected(null);
    setComments([]);
    setReply("");
    setLoadingDetail(true);
    setError(null);
    try {
      const [{ ticket }, { comments: visible }] = await Promise.all([
        getCustomerSupportTicket(id), listCustomerTicketComments(id),
      ]);
      if (request !== detailRequest.current) return;
      setSelected(ticket);
      setComments(visible || []);
    } catch (err) {
      if (request === detailRequest.current) setError(err instanceof Error ? err.message : "Could not load ticket");
    } finally {
      if (request === detailRequest.current) setLoadingDetail(false);
    }
  }

  async function submitTicket(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { ticket } = await createSupportTicket({ subject: subject.trim(), category, message: message.trim() });
      setTicketNumber(ticket.ticket_number);
      setSubject("");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit ticket");
    } finally {
      setLoading(false);
    }
  }

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !reply.trim() || loading) return;
    setLoading(true);
    setError(null);
    const ticketId = selected.id;
    const request = detailRequest.current;
    try {
      const { comment } = await createCustomerTicketComment({ ticketId, body: reply.trim() });
      if (request === detailRequest.current) {
        setComments((current) => [...current, comment]);
        setReply("");
      }
    } catch (err) {
      if (request === detailRequest.current) setError(err instanceof Error ? err.message : "Could not send reply");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <a href="#/dashboard" className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700">Back to dashboard</a>
        <h1 className="mt-3 text-2xl font-black text-slate-950">Contact support</h1>
        <p className="mt-2 text-sm text-slate-600">Need help beyond the Help Assistant? Contact our support team.</p>
        <div className="mt-5 flex gap-3 border-b border-slate-200 pb-4 text-sm font-semibold">
          <a href="#/support" onClick={() => setMode("new")} className={mode === "new" ? "text-slate-950" : "text-slate-500 hover:text-slate-900"}>Open a support ticket</a>
          <a href="#/support?view=tickets" onClick={() => setMode("tickets")} className={mode === "tickets" ? "text-slate-950" : "text-slate-500 hover:text-slate-900"}>My support tickets</a>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
        {mode === "new" ? (
          <>
            {ticketNumber && <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Ticket created: <strong>{ticketNumber}</strong></p>}
            <form onSubmit={(event) => void submitTicket(event)} className="mt-5 space-y-4">
              <label className="block text-sm font-semibold">Subject
                <input className={`${inputClass} mt-1`} placeholder="Subject" value={subject} maxLength={150} required onChange={(event) => setSubject(event.target.value)} />
              </label>
              <label className="block text-sm font-semibold">Category
                <select className={`${inputClass} mt-1`} value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="general">General</option><option value="billing">Billing</option>
                  <option value="technical">Technical</option><option value="account">Account</option>
                </select>
              </label>
              <label className="block text-sm font-semibold">Description
                <textarea className={`${inputClass} mt-1 h-40`} placeholder="Describe your issue" value={message} maxLength={5000} required onChange={(event) => setMessage(event.target.value)} />
              </label>
              <button type="submit" disabled={loading} className={buttonClass}>{loading ? "Submitting..." : "Submit support ticket"}</button>
            </form>
          </>
        ) : (
          <div className="mt-5 space-y-4">
            {loadingList ? <p>Loading tickets...</p> : tickets.length === 0 ? <p className="text-sm text-slate-600">No support tickets yet.</p> : (
              <div className="space-y-2">{tickets.map((ticket) => (
                <button key={ticket.id} type="button" onClick={() => void openTicket(ticket.id)} className="block w-full rounded-xl border border-slate-200 p-3 text-left text-sm hover:bg-slate-50">
                  <strong>{ticket.ticket_number}</strong> · {ticket.subject} · {ticket.status.replaceAll("_", " ")}
                  <span className="mt-1 block text-xs text-slate-500">Created {new Date(ticket.created_at).toLocaleString()} · Updated {new Date(ticket.updated_at).toLocaleString()}</span>
                </button>
              ))}</div>
            )}
            {loadingDetail && <p>Loading ticket...</p>}
            {selected && (
              <section className="rounded-xl border border-slate-200 p-4" aria-label="Ticket detail">
                <h2 className="font-bold">{selected.ticket_number} · {selected.subject}</h2>
                <p className="mt-1 text-xs text-slate-500">{selected.status.replaceAll("_", " ")} · Updated {new Date(selected.updated_at).toLocaleString()}</p>
                <p className="mt-4 whitespace-pre-wrap text-sm">{selected.message}</p>
                <h3 className="mt-5 font-semibold">Conversation</h3>
                <div className="mt-2 space-y-3">{comments.map((comment) => (
                  <div key={comment.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-semibold">{comment.author_user_id === userId ? "You" : comment.author_name || comment.author_email || "Support"}</p>
                    <p className="whitespace-pre-wrap">{comment.body}</p>
                    <p className="text-xs text-slate-500">{new Date(comment.created_at).toLocaleString()}</p>
                  </div>
                ))}</div>
                <form onSubmit={(event) => void submitReply(event)} className="mt-5 space-y-2">
                  <label className="block text-sm font-semibold">Reply
                    <textarea className={`${inputClass} mt-1`} placeholder="Write a reply" value={reply} maxLength={5000} required onChange={(event) => setReply(event.target.value)} />
                  </label>
                  <button type="submit" disabled={loading || !reply.trim()} className={buttonClass}>{loading ? "Sending..." : "Send reply"}</button>
                </form>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
