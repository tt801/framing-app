import { useId, useLayoutEffect, useRef, useState } from "react";

export default function PresetNameDialog({ onCancel, onSave, returnFocus }: {
  onCancel: () => void;
  onSave: (name: string) => Promise<string | void>;
  returnFocus: HTMLButtonElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  useLayoutEffect(() => {
    mounted.current = true;
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    return () => {
      mounted.current = false;
      element.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [returnFocus]);
  useLayoutEffect(() => {
    if (pending) dialog.current?.focus();
    else input.current?.focus();
  }, [pending]);

  async function submit() {
    if (submitting.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a preset name.");
      input.current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true); setError("");
    try {
      const message = await onSave(trimmed);
      if (mounted.current && message) setError(message);
    } catch {
      if (mounted.current) setError("Could not confirm whether the preset was saved. Check the preset list before retrying.");
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <dialog ref={dialog} aria-labelledby={`${id}-title`} tabIndex={-1} aria-busy={pending}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (!submitting.current) onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)");
      if (!controls?.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault(); first.focus();
      }
    }}
    onCancel={event => { event.preventDefault(); if (!submitting.current) onCancel(); }}
    className="m-auto w-[calc(100%-1.5rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-950/50">
    <form noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 id={`${id}-title`} className="text-lg font-semibold">Save design preset</h2>
      <label htmlFor={`${id}-name`} className="mt-4 block text-sm font-medium">Preset name</label>
      <input ref={input} id={`${id}-name`} value={name} disabled={pending} required aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={event => { setName(event.target.value); setError(""); }}
        className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" />
      {error && <p id={`${id}-error`} role="alert" className="mt-3 break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
      {pending && <p role="status" className="mt-3 text-sm text-slate-600">Saving… Please wait.</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" disabled={pending} onClick={() => { if (!submitting.current) onCancel(); }}
          className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700">Cancel</button>
        <button type="submit" disabled={pending}
          className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Save preset</button>
      </div>
    </form>
  </dialog>;
}
