import React, { useId, useLayoutEffect, useRef, useState } from 'react'

type Props = {
  title: string
  description: string
  recordIdentity: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void | string | Promise<void | string>
}

/** Mount only while open. The native modal supplies focus containment and background inertness. */
export default function ConfirmationDialog({ title, description, recordIdentity, confirmLabel, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)
  const submitting = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  useLayoutEffect(() => {
    mounted.current = true
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    cancel.current?.focus()
    return () => {
      mounted.current = false
      element.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useLayoutEffect(() => {
    if (pending) dialog.current?.focus()
    else cancel.current?.focus()
  }, [pending])
  const confirm = async () => {
    if (submitting.current) return
    submitting.current = true
    setPending(true); setError('')
    try {
      const message = await onConfirm()
      if (mounted.current && message) setError(message)
    } catch {
      if (mounted.current) setError('Could not complete this action. Please try again.')
    } finally {
      submitting.current = false
      if (mounted.current) setPending(false)
    }
  }
  return <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description ${id}-record`}
    tabIndex={-1} aria-busy={pending}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (!submitting.current) onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      if (!buttons?.length) { event.preventDefault(); return }
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }}
    onCancel={event => { event.preventDefault(); if (!submitting.current) onCancel() }}
    className="m-auto w-[calc(100%-1.5rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-950/50">
    <h2 id={`${id}-title`} className="text-lg font-semibold">{title}</h2>
    <p id={`${id}-description`} className="mt-2 text-sm text-slate-600">{description}</p>
    <p id={`${id}-record`} className="mt-3 break-words text-sm font-semibold">{recordIdentity}</p>
    {error && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
    {pending && <p role="status" className="mt-3 text-sm text-slate-600">Working… Please wait.</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-3">
      <button ref={cancel} type="button" disabled={pending} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700" onClick={() => { if (!submitting.current) onCancel() }}>Cancel</button>
      <button type="button" disabled={pending} className="min-h-11 rounded-xl bg-rose-700 px-4 py-2 text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700" onClick={confirm}>{confirmLabel}</button>
    </div>
  </dialog>
}
