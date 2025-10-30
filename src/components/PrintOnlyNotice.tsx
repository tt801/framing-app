// src/components/PrintOnlyNotice.tsx

export function PrintOnlyNotice({ enabled }: { enabled: boolean }) {
if (!enabled) return null
return (
<div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 shadow-sm">
<div className="text-sm font-medium">Print‑only mode</div>
<div className="text-xs opacity-90">
You selected <b>No Frame</b> and <b>No Glazing</b>. Only <b>Printing</b> and <b>Labour</b> will be costed.
</div>
</div>
)
}