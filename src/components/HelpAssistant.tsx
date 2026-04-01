import React, { useMemo, useState } from "react";

type HelpAssistantProps = {
  currentArea: string;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

const quickPromptsByArea: Record<string, string[]> = {
  dashboard: ["What can I do from the dashboard?", "Where are my integrations?"],
  customers: ["How do I add a new customer?", "How do I edit customer details?"],
  quotes: ["How do I create a new quote?", "How do I turn a quote into an invoice?"],
  invoices: ["How do I create a new invoice?", "How do I record a payment?"],
  jobs: ["How do I create a new job?", "How do I send a ready message?"],
  marketing: ["How do I send a campaign?", "Where do I connect Mailchimp?"],
  calendar: ["How do I link calendar events to jobs?", "How do I find a scheduled job?"],
  stock: ["How do I manage stock?", "Where do I edit catalog pricing?"],
  admin: ["Where are connected apps?", "How do I manage billing?"],
  app: ["How do I start a visual mockup?", "How do I add a design to jobs?"],
};

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function areaLabel(area: string) {
  return area.charAt(0).toUpperCase() + area.slice(1);
}

function getPlaceholderReply(question: string, currentArea: string) {
  const text = question.toLowerCase();

  if (text.includes("integration") || text.includes("mailchimp") || text.includes("outlook") || text.includes("whatsapp")) {
    return "Open Admin, then go to Integrations. Your connected apps now live there, including WhatsApp, Mailchimp, and Outlook credentials.";
  }

  if (text.includes("billing") || text.includes("subscription") || text.includes("founder") || text.includes("stripe")) {
    return "Use the Billing page for plan changes and subscription status. Admin > Integrations also shows a billing overview and a Stripe management shortcut.";
  }

  if (text.includes("customer")) {
    return "Go to Customers and use New customer. A blank customer is created and selected immediately so you can fill in the details panel on the right.";
  }

  if (text.includes("quote")) {
    return "Go to Quotes and use New quote. The app now creates a new quote in place instead of redirecting you to invoices.";
  }

  if (text.includes("invoice")) {
    return "Go to Invoices and use New invoice. From Quotes, you can still create an invoice from an existing quote when needed.";
  }

  if (text.includes("job")) {
    return "Go to Jobs and use New job. A blank job is created and selected so you can complete the details panel straight away.";
  }

  if (text.includes("calendar")) {
    return "Use Calendar to review scheduled work and jump back into linked jobs. If you arrive from Calendar, the linked job can be auto-selected in Jobs.";
  }

  if (text.includes("stock") || text.includes("catalog") || text.includes("frame") || text.includes("mat")) {
    return "Use Stock for day-to-day stock management. Use Admin for catalog setup such as frames, mats, glazing, printing materials, and backer boards.";
  }

  if (text.includes("dashboard")) {
    return "Dashboard gives you the main overview. From there you can jump into customers, quotes, invoices, jobs, and other workflow areas.";
  }

  if (text.includes("help") || text.includes("what can you do") || text.includes("how do i")) {
    return `I can help with navigation and common workflow questions in ${areaLabel(currentArea)}. Try asking about customers, quotes, jobs, billing, or connected apps.`;
  }

  return `This is the first helper version, so I currently answer common product questions with built-in guidance. Try asking about ${quickPromptsByArea[currentArea]?.[0]?.toLowerCase() || "creating records, billing, or connected apps"}.`;
}

export default function HelpAssistant({ currentArea }: HelpAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: makeId(),
      role: "assistant",
      content: `Need help with ${areaLabel(currentArea)}? Ask a question or use one of the prompts below.`,
    },
  ]);

  const quickPrompts = useMemo(
    () => quickPromptsByArea[currentArea] || ["Where are connected apps?", "How do I create a new record?"],
    [currentArea]
  );

  const askQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const reply = getPlaceholderReply(trimmed, currentArea);
    setMessages((prev) => [
      ...prev,
      { id: makeId(), role: "user", content: trimmed },
      { id: makeId(), role: "assistant", content: reply },
    ]);
    setDraft("");
    setIsOpen(true);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-end justify-end">
      {isOpen ? (
        <div className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
            <div>
              <p className="text-sm font-bold">Help assistant</p>
              <p className="text-[11px] text-slate-300">Built-in answers only for now</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full border border-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/10"
            >
              Close
            </button>
          </div>

          <div className="max-h-[24rem] space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-6 ${
                  message.role === "assistant"
                    ? "bg-white text-slate-700 ring-1 ring-slate-200"
                    : "ml-auto bg-slate-900 text-white"
                }`}
              >
                {message.content}
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-3">
            <div className="mb-3 flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => askQuestion(prompt)}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                askQuestion(draft);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask about the app..."
                className="flex-1 rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <button
                type="submit"
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-xl hover:bg-slate-800"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-base">?</span>
          Help
        </button>
      ) : null}
    </div>
  );
}