import React, { useRef, useState } from 'react'
import type { InvoiceOpResult, Payment } from '@/lib/invoices'

type Props = {
  balance: number
  disabled: boolean
  onRecord: (payment: Payment) => Promise<InvoiceOpResult>
  onPendingChange: (pending: boolean) => void
}

export default function InvoicePaymentForm({ balance, disabled, onRecord, onPendingChange }: Props) {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pendingPayment = useRef<Payment | null>(null)
  const inFlight = useRef(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (disabled || inFlight.current) return
    const value = Number(amount)
    if (!pendingPayment.current && (!Number.isFinite(value) || value <= 0 || value > balance)) {
      setError('Enter a payment amount greater than zero and no more than the outstanding balance.')
      return
    }
    // Keep the exact payment ID and payload on failure: an ambiguous response may
    // already have committed. The existing append RPC deduplicates this ID.
    pendingPayment.current ??= { id: crypto.randomUUID(), amount: value, method: 'Manual', createdAt: new Date().toISOString() }
    inFlight.current = true
    setSaving(true)
    setError('')
    onPendingChange(true)
    try {
      const result = await onRecord(pendingPayment.current)
      if (result.ok === false) { setError(`${result.error}. Retry this payment before recording another.`); return }
      pendingPayment.current = null
      setAmount('')
      onPendingChange(false)
    } catch {
      setError('Payment result could not be confirmed. Retry this payment before recording another.')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={submit} className="rounded-2xl ring-1 ring-slate-200 p-4 space-y-2">
      <div className="text-sm font-medium">Record manual payment</div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-slate-600">
          Payment amount
          <input type="number" step="any" min="0" max={balance} value={amount}
            disabled={disabled || saving || Boolean(pendingPayment.current)}
            onChange={event => { setAmount(event.target.value); setError('') }}
            className="block rounded-lg border border-slate-300 px-3 py-1.5" />
        </label>
        <button type="submit" disabled={disabled || saving || (balance <= 0 && !pendingPayment.current)}
          className="rounded-xl border border-green-300 text-green-700 px-3 py-1.5 text-sm hover:bg-green-50 disabled:opacity-50">
          {saving ? 'Recording payment…' : pendingPayment.current ? 'Retry payment' : 'Record payment'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
