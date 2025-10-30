// src/pages/Marketing.tsx
import React, { useMemo, useState } from 'react'
import { useCatalog } from '../lib/store'

type Provider = 'mailchimp' | 'sendgrid' | 'custom'

export default function MarketingPage() {
  const { catalog } = useCatalog()
  const [provider, setProvider] = useState<Provider>('mailchimp')
  const [testEmail, setTestEmail] = useState('')
  const [audienceId, setAudienceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const company = useMemo(() => ({
    name: (catalog.settings as any)?.companyName || 'FrameIT',
    email: (catalog.settings as any)?.companyEmail || '',
  }), [catalog.settings])

  const onSubscribe = async () => {
    setMsg(null)
    if (!testEmail || !audienceId) {
      setMsg('Enter an email and audience/list ID first.')
      return
    }
    try {
      setBusy(true)
      // Calls your serverless function (Vercel) – see /api/mailchimp/subscribe.ts below.
      const res = await fetch('/api/mailchimp/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, audienceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to subscribe')
      setMsg(`Subscribed ${testEmail} ✅`)
      setTestEmail('')
    } catch (e: any) {
      setMsg(e.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Marketing Integrations</h1>
        <div className="text-sm text-slate-600">
          {company.name} {company.email ? `• ${company.email}` : ''}
        </div>
      </header>

      {/* Provider selector */}
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
        <div className="text-sm font-medium mb-2">Provider</div>
        <div className="flex gap-2 text-sm">
          <button
            className={`rounded border px-3 py-1 ${provider==='mailchimp' ? 'bg-black text-white' : 'bg-white hover:bg-black/5'}`}
            onClick={() => setProvider('mailchimp')}
          >
            Mailchimp
          </button>
          <button
            className={`rounded border px-3 py-1 ${provider==='sendgrid' ? 'bg-black text-white' : 'bg-white hover:bg-black/5'}`}
            onClick={() => setProvider('sendgrid')}
          >
            SendGrid (coming soon)
          </button>
          <button
            className={`rounded border px-3 py-1 ${provider==='custom' ? 'bg-black text-white' : 'bg-white hover:bg-black/5'}`}
            onClick={() => setProvider('custom')}
          >
            Custom Webhook (coming soon)
          </button>
        </div>
      </div>

      {/* Mailchimp block */}
      {provider === 'mailchimp' && (
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 space-y-3">
          <div className="text-sm">
            <div className="font-medium mb-1">Mailchimp</div>
            <p className="text-slate-600">
              For security, store API keys as environment variables on Vercel (do <b>not</b> hardcode in the browser).
              Use the serverless endpoint below to subscribe contacts.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium mb-1">Audience (List) ID</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="e.g. a1b2c3d4e5"
                value={audienceId}
                onChange={e => setAudienceId(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Test email</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                placeholder="name@example.com"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onSubscribe}
              disabled={busy}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-black hover:text-white disabled:opacity-60"
            >
              {busy ? 'Subscribing…' : 'Subscribe test email'}
            </button>
            {msg && <div className="text-sm">{msg}</div>}
          </div>

          <details className="text-xs mt-2">
            <summary className="cursor-pointer select-none">Setup notes</summary>
            <ul className="list-disc pl-4 mt-2 space-y-1 text-slate-600">
              <li>On Vercel, add env vars: <code>MAILCHIMP_API_KEY</code> and <code>MAILCHIMP_DC</code> (e.g. <code>us21</code>), and optionally <code>MAILCHIMP_AUDIENCE_ID</code>.</li>
              <li>Create the serverless function <code>/api/mailchimp/subscribe.ts</code> (below) to proxy requests to Mailchimp.</li>
              <li>Do not expose API keys in client code.</li>
            </ul>
          </details>
        </div>
      )}
    </div>
  )
}
