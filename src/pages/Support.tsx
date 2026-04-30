import React, { useMemo, useState } from "react";
import { createSupportTicket } from "@/lib/supportTickets";
import { useToast } from "@/lib/toast";
import { getCurrentUser } from "@/lib/supabase";

function readSupportQuery() {
  const hash = window.location.hash.replace(/^#/, "");
  const [pathPart, queryPart = ""] = hash.split("?");
  const params = new URLSearchParams(queryPart);
  return {
    path: pathPart,
    auto: params.get("auto") === "1",
    source: params.get("source") || "app",
    subject: params.get("subject") || "Support request",
  };
}

export default function SupportPage() {
  const { add: toast } = useToast();
  const query = useMemo(() => readSupportQuery(), []);
  const [loading, setLoading] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState(query.subject);
  const [message, setMessage] = useState("Please describe your issue and the steps you took before this happened.");

  React.useEffect(() => {
    let active = true;
    const runAutoCreate = async () => {
      if (!query.auto) return;
      setLoading(true);
      try {
        const user = await getCurrentUser();
        const result = await createSupportTicket({
          subject: query.subject,
          message: `Auto-created from Contact Support (${query.source}).`,
          source: query.source,
          category: "general",
          priority: "normal",
          requesterEmail: user?.email || undefined,
          requesterName: typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : undefined,
        });
        if (!active) return;
        setTicketNumber(result.ticket.ticket_number);
        toast(`Ticket ${result.ticket.ticket_number} created.`, "success");
      } catch (err) {
        if (!active) return;
        toast(err instanceof Error ? err.message : "Failed to create support ticket", "error");
      } finally {
        if (active) setLoading(false);
      }
    };
    void runAutoCreate();
    return () => {
      active = false;
    };
  }, [query.auto, query.source, query.subject, toast]);

  const submitManual = async () => {
    if (!subject.trim() || !message.trim()) {
      toast("Subject and message are required.", "warning");
      return;
    }

    setLoading(true);
    try {
      const result = await createSupportTicket({
        subject: subject.trim(),
        message: message.trim(),
        source: query.source,
        requesterEmail: email.trim() || undefined,
        requesterName: name.trim() || undefined,
      });
      setTicketNumber(result.ticket.ticket_number);
      toast(`Ticket ${result.ticket.ticket_number} submitted.`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not submit ticket", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <a href="#/dashboard" className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700">
          Back
        </a>
        <h1 className="mt-3 text-2xl font-black text-slate-950">Contact support</h1>
        <p className="mt-2 text-sm text-slate-600">
          Submit a support ticket and our team will track it through triage, investigation, and resolution.
        </p>

        {ticketNumber && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Ticket created: <span className="font-bold">{ticketNumber}</span>
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Your name (optional)"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Your email (optional if signed in)"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="mt-3 space-y-3">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <textarea
            className="h-44 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={submitManual}
          disabled={loading}
          className="mt-4 inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Submitting..." : "Submit support ticket"}
        </button>
      </div>
    </div>
  );
}
