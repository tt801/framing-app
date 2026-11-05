// src/components/ToastContainer.tsx - Toast UI component
import React from "react";
import { useToast } from "@/lib/toast";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

const variants = {
  success: { label: 'Success', icon: CheckCircle2, style: 'border-emerald-200 bg-emerald-50 text-emerald-950' },
  error: { label: 'Error', icon: AlertCircle, style: 'border-rose-200 bg-rose-50 text-rose-950' },
  warning: { label: 'Warning', icon: AlertTriangle, style: 'border-amber-200 bg-amber-50 text-amber-950' },
  info: { label: 'Information', icon: Info, style: 'border-slate-200 bg-white text-slate-900' },
};

export default function ToastContainer() {
  const { toasts, remove } = useToast();

  return (
    <div className="fixed bottom-4 left-3 right-3 z-50 max-h-[80dvh] overflow-y-auto space-y-2 pointer-events-none sm:left-auto sm:right-4 sm:w-96 sm:max-w-[calc(100vw-2rem)]">
      {toasts.map((toast) => {
        const variant = variants[toast.type];
        const Icon = variant.icon;
        return (
        <div
          key={toast.id}
          role={toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'}
          aria-atomic="true"
          className={`pointer-events-auto rounded-xl border shadow-lg p-3 text-sm ${variant.style}`}
        >
          <div className="flex items-start gap-3">
            <Icon aria-hidden="true" className="mt-1 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1 py-1">
              <p className="font-semibold">{variant.label}</p>
              <span className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{toast.message}</span>
            </div>
            <button
              type="button"
              aria-label={`Dismiss ${toast.type} notification`}
              onClick={() => remove(toast.id)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
      ); })}
    </div>
  );
}
