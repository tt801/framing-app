// src/lib/tax.ts
export type InvoiceLine = { qty: number; unitPrice: number };
export type InvoiceShape = { items: InvoiceLine[]; taxExempt?: boolean };

// Settings shape we read from your Settings tab (see Step 2)
export type SettingsForTax = {
  taxRatePct?: number;   // e.g. 15 for ZA
  taxLabel?: string;     // "VAT" (or "GST")
  currency?: string;     // "ZAR", "GBP", etc.
  vatNumber?: string;    // for display on the PDF
};

export function computeInvoiceTotals(inv: InvoiceShape, s: SettingsForTax) {
  const subTotal = (inv?.items || []).reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0),
    0
  );
  const rate = inv?.taxExempt ? 0 : Number(s?.taxRatePct || 0);
  const tax = subTotal * (rate / 100);
  const label = (s?.taxLabel || "VAT").toUpperCase();

  return {
    subTotal,
    taxLabel: label,
    taxRatePct: rate,
    taxAmount: round2(tax),
    grandTotal: round2(subTotal + tax),
    currency: s?.currency || "",
    vatNumber: s?.vatNumber || "",
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
