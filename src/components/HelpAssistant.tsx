import React, { useEffect, useMemo, useState } from "react";
import { findBestHelpReply, getHelpSection } from "@/lib/helpContent";

type HelpAssistantProps = {
  currentArea: string;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function HelpAssistant({ currentArea }: HelpAssistantProps) {
  const section = useMemo(() => getHelpSection(currentArea), [currentArea]);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: makeId(),
      role: "assistant",
      content: `Need help with ${section.title}? Ask a question or use one of the prompts below.`,
    },
  ]);

  const quickPrompts = section.quickPrompts;

  useEffect(() => {
    setMessages([
      {
        id: makeId(),
        role: "assistant",
        content: `${section.summary} Ask a question or use one of the prompts below.`,
      },
    ]);
  }, [section]);

  const askQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const reply = findBestHelpReply(trimmed, currentArea);
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
              <p className="text-[11px] text-slate-300">Built-in knowledge base only for now</p>
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