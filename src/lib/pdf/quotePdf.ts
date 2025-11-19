// src/lib/pdf/quotePdf.ts
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ---- Types kept loose so we don't fight the rest of the app ----
export interface QuotePdfItem {
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface QuotePdfQuote {
  id: string;
  number: string;
  dateISO: string;
  status?: string;
  items: QuotePdfItem[];
  subtotal: number;
  total: number;
  notes?: string;
  currency?: string;
}

export interface QuotePdfCustomer {
  id?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  postcode?: string;
  country?: string;
}

export interface QuotePdfSettings {
  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  logoDataUrl?: string;
  currencySymbol?: string;
  currencyCode?: string;
  themeColor?: string;
  bankDetails?: string;
  taxNumber?: string;
  quoteFooterNote?: string;
}

export interface ExportQuotePdfOptions {
  quote: QuotePdfQuote;
  customer: QuotePdfCustomer;
  settings: QuotePdfSettings;
}

/**
 * Export a single quote as PDF.
 * Uses static imports for jsPDF + autotable (same pattern as typical invoice PDFs).
 */
export async function exportQuotePDF(opts: ExportQuotePdfOptions): Promise<void> {
  const { quote, customer, settings } = opts;

  try {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const currencyCode = quote.currency || settings.currencyCode || "ZAR";
    const currencySymbol = settings.currencySymbol || symbolFor(currencyCode);

    const fmtMoney = (value: number) => {
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currencyCode,
        }).format(value ?? 0);
      } catch {
        return `${currencySymbol}${(value ?? 0).toFixed(2)}`;
      }
    };

    const themeColor = settings.themeColor || "#111827"; // slate-900 fallback

    // ---------- Header ----------
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(settings.companyName || "Quote", 14, 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const rightTop = [
      `Quote: ${quote.number}`,
      `Date: ${formatDate(quote.dateISO)}`,
      quote.status ? `Status: ${quote.status}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    alignRightMultiline(doc, rightTop, pageWidth - 14, 16);

    if (settings.companyAddress || settings.companyEmail || settings.companyPhone) {
      const companyBlock = [
        settings.companyAddress,
        settings.companyEmail,
        settings.companyPhone,
        settings.taxNumber ? `Tax: ${settings.taxNumber}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      doc.setFontSize(9);
      doc.text(companyBlock, 14, 26);
    }

    // Optional logo (top-right)
    if (settings.logoDataUrl) {
      try {
        doc.addImage(settings.logoDataUrl, "PNG", pageWidth - 40, 10, 26, 12);
      } catch (e) {
        console.warn("[quotePdf] Failed to render logo:", e);
      }
    }

    // ---------- Bill To ----------
    let y = 48;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Bill to", 14, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const name = `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
    const lines = [
      name || customer.company || "",
      customer.company && name ? customer.company : "",
      customer.address1 || "",
      customer.address2 || "",
      [customer.city, customer.postcode].filter(Boolean).join(" "),
      customer.country || "",
      customer.email || "",
      customer.phone || "",
    ]
      .filter(Boolean)
      .join("\n");

    if (lines) {
      y += 5;
      doc.text(lines, 14, y);
      y += lines.split("\n").length * 5 + 4;
    } else {
      y += 8;
    }

    // ---------- Items table ----------
    const body = quote.items.map((it, idx) => [
      String(it.name ?? `Item ${idx + 1}`),
      String(it.qty ?? 0),
      fmtMoney(it.unitPrice ?? 0),
      fmtMoney(it.total ?? 0),
    ]);

    autoTable(doc, {
      startY: y,
      head: [["Item", "Qty", "Unit Price", "Line Total"]],
      body,
      styles: { fontSize: 9 },
      headStyles: {
        fillColor: hexToRgb(themeColor),
        textColor: 255,
      },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
      },
    });

    const afterTableY = (doc as any).lastAutoTable?.finalY ?? y + 10;

    // ---------- Totals ----------
    const rightBlockX = pageWidth - 14;
    let totalsY = afterTableY + 6;
    doc.setFontSize(10);

    const subtotalLine = `Subtotal: ${fmtMoney(quote.subtotal ?? quote.total)}`;
    const totalLine = `Total: ${fmtMoney(quote.total)}`;

    doc.text(subtotalLine, rightBlockX, totalsY, { align: "right" });
    totalsY += 5;

    doc.setFont("helvetica", "bold");
    doc.text(totalLine, rightBlockX, totalsY, { align: "right" });
    doc.setFont("helvetica", "normal");
    totalsY += 10;

    // ---------- Notes ----------
    if (quote.notes) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("Notes", 14, totalsY);
      doc.setFont("helvetica", "normal");
      totalsY += 5;

      const wrapped = doc.splitTextToSize(quote.notes, pageWidth - 28);
      doc.text(wrapped, 14, totalsY);
      totalsY += wrapped.length * 5 + 4;
    }

    // ---------- Footer ----------
    const footerLines = [settings.bankDetails, settings.quoteFooterNote]
      .filter(Boolean)
      .join("\n");

    if (footerLines) {
      const footerY = pageHeight - 20;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(footerLines, 14, footerY);
    }

    const fileName = `Quote-${quote.number || quote.id || "quote"}.pdf`;
    doc.save(fileName);
  } catch (err) {
    console.error("[quotePdf] Failed to generate quote PDF", err);
    throw err; // let Quotes.tsx show the friendly alert
  }
}

// ---------- helpers ----------

function formatDate(iso: string | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function symbolFor(code: string | undefined): string {
  if (!code) return "R ";
  const c = code.toUpperCase();
  if (c === "ZAR") return "R ";
  if (c === "USD") return "$";
  if (c === "GBP") return "£";
  if (c === "EUR") return "€";
  return code + " ";
}

function hexToRgb(hex: string | undefined) {
  if (!hex) return undefined as any;
  const h = hex.replace("#", "");
  if (h.length !== 6) return undefined as any;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b] as [number, number, number];
}

/**
 * Draw a multi-line text block right-aligned.
 */
function alignRightMultiline(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  lineHeight = 4
) {
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    doc.text(line, x, y + idx * lineHeight, { align: "right" });
  });
}
