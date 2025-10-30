type Tab = { key: string; label: string }


export function Tabs({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (k: string) => void }) {
return (
<div className="flex gap-2 border-b">
{tabs.map(t => (
<button key={t.key}
onClick={() => onChange(t.key)}
className={`px-3 py-2 text-sm -mb-px border-b-2 ${active===t.key ? 'border-black font-medium' : 'border-transparent text-gray-500 hover:text-black'}`}
>{t.label}</button>
))}
</div>
)
}