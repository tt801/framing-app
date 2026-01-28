// src/components/StatusBadge.tsx - Reusable status badge component
import React from "react";

export type StatusType = 
  | "draft" 
  | "sent" 
  | "accepted" 
  | "invoiced" 
  | "in-progress" 
  | "completed" 
  | "cancelled"
  | "tentative"
  | "confirmed"
  | "active"
  | "inactive";

const statusStyles: Record<StatusType, { bg: string; text: string; dot: string }> = {
  draft: { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-400" },
  sent: { bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-400" },
  accepted: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-400" },
  invoiced: { bg: "bg-indigo-100", text: "text-indigo-700", dot: "bg-indigo-400" },
  "in-progress": { bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-400" },
  completed: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-400" },
  cancelled: { bg: "bg-red-100", text: "text-red-700", dot: "bg-red-400" },
  tentative: { bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-400" },
  confirmed: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-400" },
  active: { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-400" },
  inactive: { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-400" },
};

interface StatusBadgeProps {
  status: StatusType;
  showDot?: boolean;
}

export default function StatusBadge({ status, showDot = false }: StatusBadgeProps) {
  const style = statusStyles[status];
  if (!style) return null;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      {showDot && <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />}
      <span className="capitalize">{status.replace("-", " ")}</span>
    </div>
  );
}
