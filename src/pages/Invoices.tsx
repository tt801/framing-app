// src/pages/Invoices.tsx
import React, { useState, useMemo } from "react";
import { useInvoices } from '../lib/invoices'
import { useCustomers } from '../lib/customers'
import { useCatalog } from '../lib/store'
import { exportInvoicePDF } from '../lib/pdf/invoicePdf'

export default function InvoicesPage() {
  const { invoices } = useInvoices()
  const { customers } = useCustomers()
  const { catalog } = useCatalog()
  const [q, setQ] = useState('')

  const money = (n: number) => {
    const code = catalog?.settings?.currencyCode || 'ZAR'
    const sym = catalog?.settings?.currencySymbol || 'R '
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n ?? 0)
    } catch {
      return `${sym}${(n ?? 0).toFixed(2)}`
    }
  }

  const rows = useMemo(() => {
    const qlc = q.trim().toLowerCase()
    return invoices
      .map((inv: any) => {
        const cust = customers.find(c => c.id === inv.customerId)
        const subtotal =
          inv.subtotal ??
          (inv.items || []).reduce((s: number, it: any) => s + Number(it.unitPrice || 0) * Number(it.qty || 1), 0)
        const total = inv.total ?? subtotal ?? 0
        const created = inv.dateISO || inv.createdAt
        return {
          id: inv.id,
          number: inv.number || inv.id,
          date: created ? new Date(created) : null,
          dateStr: created ? new Date(created).toLocaleDateString() : '—',
          total,
          notes: inv.notes || '',
          customerId: inv.customerId,
          customerName: cust ? `${cust.firstName} ${cust.lastName}` : 'Unknown customer',
          customerEmail: cust?.email || '',
          payments: inv.payments || [],
          raw: inv,
        }
      })
      .filter(r =>
        !qlc ||
        r.number.toLowerCase().includes(qlc) ||
        r.customerName.toLowerCase().includes(qlc) ||
        r.customerEmail.toLowerCase().includes(qlc)
      )
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
  }, [invoices, customers, q])

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Invoices</h1>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by number, name, or email…"
          className="rounded border px-3 py-2 text-sm"
        />
      </div>

      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_auto] gap-3 p-3 text-xs font-medium text-slate-600 border-b">
          <div>Customer</div>
          <div>Invoice</div>
          <div>Total</div>
          <div className="text-right">Actions</div>
        </div>

        {rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No invoices yet.</div>
        ) : (
          <div className="divide-y">
            {rows.map(r => (
              <div key={r.id} className="grid grid-cols-[1.2fr_0.8fr_0.8fr_auto] gap-3 p-3 items-center">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.customerName}</div>
                  <div className="truncate text-xs text-slate-600">{r.customerEmail}</div>
                </div>

                <div className="text-sm">
                  <div className="font-medium">#{r.number}</div>
                  <div className="text-xs text-slate-600">{r.dateStr}</div>
                </div>

                <div className="text-sm">{money(r.total)}</div>

                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={async () => {
                      const cust = customers.find(c => c.id === r.customerId)
                      if (!cust) { alert('Customer not found for this invoice'); return }
                      await exportInvoicePDF({
                        invoice: {
                          id: r.id,
                          number: r.number,
                          dateISO: r.raw.dateISO || r.raw.createdAt,
                          dueDateISO: r.raw.dueDateISO,
                          items: r.raw.items || [],
                          subtotal:
                            r.raw.subtotal ??
                            (r.raw.items || []).reduce(
                              (s: number, it: any) => s + Number(it.unitPrice || 0) * Number(it.qty || 1),
                              0
                            ),
                          total: r.raw.total ?? r.total,
                          notes: r.raw.notes || '',
                          payments: (r.raw.payments || []).map((p: any) => ({
                            id: p.id, dateISO: p.dateISO || p.date, amount: p.amount, method: p.method, notes: p.notes || p.note
                          })),
                        },
                        customer: {
                          id: cust.id,
                          firstName: cust.firstName,
                          lastName: cust.lastName,
                          email: cust.email,
                          phone: cust.phone || '',
                          company: cust.company || '',
                        },
                        settings: {
                          companyName: (catalog.settings as any)?.companyName,
                          companyEmail: (catalog.settings as any)?.companyEmail,
                          companyPhone: (catalog.settings as any)?.companyPhone,
                          companyAddress: (catalog.settings as any)?.companyAddress,
                          logoDataUrl: (catalog.settings as any)?.companyLogoDataUrl,
                          currencySymbol: (catalog.settings as any)?.currencySymbol,
                          currencyCode: (catalog.settings as any)?.currencyCode,
                          themeColor: (catalog.settings as any)?.themeColor,
                        },
                        fileName: `Invoice_${r.number}.pdf`,
                      })
                    }}
                    className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white"
                  >
                    PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
