// src/components/CommandPalette.tsx - Keyboard shortcuts and command palette
import { useState, useEffect } from "react";

type Command = {
  id: string;
  name: string;
  description: string;
  shortcut: string;
  action: () => void;
};

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const commands: Command[] = [
    {
      id: "dashboard",
      name: "Go to Dashboard",
      description: "Navigate to main dashboard",
      shortcut: "Cmd+1",
      action: () => {
        window.location.hash = "#/";
        setIsOpen(false);
      },
    },
    {
      id: "customers",
      name: "Go to Customers",
      description: "View and manage customers",
      shortcut: "Cmd+2",
      action: () => {
        window.location.hash = "#/customers";
        setIsOpen(false);
      },
    },
    {
      id: "quotes",
      name: "Go to Quotes",
      description: "Create and manage quotes",
      shortcut: "Cmd+3",
      action: () => {
        window.location.hash = "#/quotes";
        setIsOpen(false);
      },
    },
    {
      id: "jobs",
      name: "Go to Jobs",
      description: "View and manage jobs",
      shortcut: "Cmd+4",
      action: () => {
        window.location.hash = "#/jobs";
        setIsOpen(false);
      },
    },
    {
      id: "invoices",
      name: "Go to Invoices",
      description: "View and manage invoices",
      shortcut: "Cmd+5",
      action: () => {
        window.location.hash = "#/invoices";
        setIsOpen(false);
      },
    },
    {
      id: "calendar",
      name: "Go to Calendar",
      description: "View calendar and events",
      shortcut: "Cmd+6",
      action: () => {
        window.location.hash = "#/calendar";
        setIsOpen(false);
      },
    },
    {
      id: "stock",
      name: "Go to Stock",
      description: "Manage stock and inventory",
      shortcut: "Cmd+7",
      action: () => {
        window.location.hash = "#/stock";
        setIsOpen(false);
      },
    },
  ];

  const filtered = search
    ? commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(search.toLowerCase()) ||
          cmd.description.toLowerCase().includes(search.toLowerCase())
      )
    : commands;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(!isOpen);
        setSearch("");
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 z-40 text-xs text-slate-500 bg-white border border-slate-300 rounded-lg px-2 py-1 hover:bg-slate-50 transition-colors"
        title="Press Cmd+K or Ctrl+K to open commands"
      >
        ⌘K
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-96 flex flex-col">
        {/* Search input */}
        <input
          autoFocus
          type="text"
          placeholder="Search commands..."
          className="w-full px-4 py-3 border-b border-slate-200 focus:outline-none text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Commands list */}
        <div className="overflow-y-auto flex-1">
          {filtered.length > 0 ? (
            filtered.map((cmd) => (
              <button
                key={cmd.id}
                onClick={() => {
                  cmd.action();
                  setIsOpen(false);
                  setSearch("");
                }}
                className="w-full text-left px-4 py-3 hover:bg-slate-100 border-b border-slate-100 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="font-medium text-sm">{cmd.name}</div>
                  <div className="text-xs text-slate-500">{cmd.description}</div>
                </div>
                <div className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">
                  {cmd.shortcut}
                </div>
              </button>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No commands found
            </div>
          )}
        </div>

        {/* Footer help text */}
        <div className="px-4 py-2 border-t border-slate-200 text-xs text-slate-500 bg-slate-50">
          Press ESC to close • Type to search
        </div>
      </div>
    </div>
  );
}
