// src/pages/Marketing.tsx
import { useCatalog } from "../lib/store";

export default function MarketingPage() {
  const { catalog, setCatalog } = useCatalog();

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Marketing</h1>

      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 space-y-3">
        <h2 className="text-base font-semibold">Integrations</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium mb-1">Mailchimp API Key</label>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={(catalog as any).settings?.mailchimpApiKey || ""}
              onChange={e => setCatalog(p => ({ ...p, settings: { ...p.settings, mailchimpApiKey: e.target.value } as any }))}
              placeholder="Paste your Mailchimp API key"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Audience/List ID</label>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={(catalog as any).settings?.mailchimpListId || ""}
              onChange={e => setCatalog(p => ({ ...p, settings: { ...p.settings, mailchimpListId: e.target.value } as any }))}
              placeholder="e.g. abcd1234"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="rounded border px-3 py-2 text-sm hover:bg-black hover:text-white">Sync audiences (placeholder)</button>
          <button className="rounded border px-3 py-2 text-sm hover:bg-black hover:text-white">Export customers to Mailchimp (placeholder)</button>
        </div>

        <p className="text-xs text-slate-600">We’ll wire these to API calls in a small server function later.</p>
      </section>
    </div>
  );
}
