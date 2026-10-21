// src/lib/pdf/jobCardPdf.ts
import jsPDF from "jspdf";
import { jobSpecificationFields } from "@/lib/jobSpecification";
import { jobDetailsDraft, savedJobDetails } from "@/lib/jobEditing";

type AnyRecord = Record<string, any>;

type ExportJobCardPdfArgs = {
  job: AnyRecord;
  customer?: AnyRecord | null;
  settings?: AnyRecord | null;
};

const CM_PER_IN = 2.54;

function parseDetails(job: AnyRecord): AnyRecord | null {
  return savedJobDetails(job);
}

function normalizeJobForPdf(job: AnyRecord, catalogSettings?: AnyRecord) {
  const d = parseDetails(job);
  const spec = jobDetailsDraft(job).spec;
  const fields = Object.fromEntries(jobSpecificationFields(job).map(field => [field.label, field.value]));

  const currencyCode =
    job?.currency?.code ??
    d?.settings?.currencyCode ??
    catalogSettings?.currencyCode ??
    "ZAR";
  const currencySymbol =
    job?.currency?.symbol ??
    d?.settings?.currencySymbol ??
    catalogSettings?.currencySymbol ??
    "R ";

  const frameName = fields.Frame;
  const glazingName = fields.Glazing;

  const unit = d?.dims?.unit || job?.unit || "metric";

  const dims = {
    unit,
    artWcm: Number(spec.artWidth || 0),
    artHcm: Number(spec.artHeight || 0),
    visWcm: Number(spec.visibleWidth || 0),
    visHcm: Number(spec.visibleHeight || 0),
    faceWcm: Number(spec.faceWidth || 0),
  };

  const costs = {
    subtotal: d?.costs?.subtotal ?? job?.subtotal ?? 0,
    total: d?.costs?.total ?? job?.total ?? 0,
    taxRate: d?.costs?.taxRate ?? job?.taxRate ?? 0,
  };

  const checklist: AnyRecord[] = Array.isArray(job?.checklist)
    ? job.checklist
    : Array.isArray(d?.checklist)
    ? d.checklist
    : [];

  return {
    id: job?.id,
    refNo: job?.refNo,
    description: job?.description || "Not recorded",
    status: job?.status ?? "new",
    createdAt: job?.createdAt || job?.created_at || null,
    frameName,
    glazingName,
    dims,
    costs,
    currencyCode,
    currencySymbol,
    checklist,
  };
}

function fmtMoney(
  n: number | undefined,
  currencyCode?: string,
  currencySymbol?: string
) {
  const v = Number(n ?? 0);
  if (currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
      }).format(v);
    } catch {
      // fall back
    }
  }
  return `${currencySymbol ?? ""}${v.toFixed(2)}`;
}

export async function exportJobCardPDF({
  job,
  customer,
  settings,
  download = true,
}: ExportJobCardPdfArgs & { download?: boolean }): Promise<jsPDF> {
  const view = normalizeJobForPdf(job, settings ?? undefined);

  const doc = new jsPDF({
    unit: "pt",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;
  const writeLine = (text: string) => {
    const lines: string[] = doc.splitTextToSize(text, pageWidth - margin * 2);
    for (const line of lines) {
      if (y > 740) { doc.addPage(); y = margin; }
      doc.text(line, margin, y); y += 12;
    }
  };

  const companyName = settings?.companyName || "Framing Studio";
  const companyAddress = settings?.companyAddress || "";
  const companyEmail = settings?.companyEmail || "";
  const companyPhone = settings?.companyPhone || "";
  const taxNumber = settings?.taxNumber || "";
  const bankDetails = settings?.bankDetails || "";
  const footerNote =
    settings?.jobCardFooterNote ||
    "Thank you for choosing us for your framing project.";

  // ---------- Header ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(companyName, margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y += 14;
  if (companyAddress) {
    companyAddress.split("\n").forEach((line: string) => {
      doc.text(line, margin, y);
      y += 11;
    });
  }
  if (companyEmail) {
    doc.text(`Email: ${companyEmail}`, margin, y);
    y += 11;
  }
  if (companyPhone) {
    doc.text(`Tel: ${companyPhone}`, margin, y);
    y += 11;
  }
  if (taxNumber) {
    doc.text(`Tax/VAT: ${taxNumber}`, margin, y);
    y += 11;
  }

  // Job meta on right
  const rightX = pageWidth - margin;
  let rightY = margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Job card", rightX, rightY, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  rightY += 16;
  doc.text(`Job ID: ${String(view.refNo ?? view.id ?? "").slice(0, 12)}`, rightX, rightY, {
    align: "right",
  });
  rightY += 12;
  if (view.status) {
    doc.text(`Status: ${view.status}`, rightX, rightY, { align: "right" });
    rightY += 12;
  }
  if (view.createdAt) {
    const d = new Date(view.createdAt);
    doc.text(
      `Created: ${d.toLocaleString()}`,
      rightX,
      rightY,
      { align: "right" }
    );
    rightY += 12;
  }

  y += 20;

  // ---------- Customer box ----------
  const custName =
    (customer &&
      [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(" ")
        .trim()) ||
    customer?.company ||
    (job.jobType === "internal" ? "Internal work — no customer" : "Customer");

  doc.setDrawColor(200);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 70, 4, 4);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Customer", margin + 8, y + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  let cy = y + 32;
  doc.text(custName, margin + 8, cy);
  cy += 12;

  if (customer?.email) {
    doc.text(String(customer.email), margin + 8, cy);
    cy += 12;
  }
  if (customer?.phone) {
    doc.text(String(customer.phone), margin + 8, cy);
    cy += 12;
  }
  if (customer?.address1 || customer?.city) {
    const addrLines: string[] = [];
    const parts = [
      customer.address1,
      customer.address2,
      customer.city,
      customer.postcode,
      customer.country,
    ].filter(Boolean);
    if (parts.length) {
      addrLines.push(parts.join(", "));
    }
    addrLines.forEach((line) => {
      doc.text(line, margin + 8, cy);
      cy += 12;
    });
  }

  y += 90;

  // ---------- Job / dimensions & pricing ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Job details", margin, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (job.jobType) writeLine(`Job type: ${job.jobType === 'internal' ? 'Internal' : job.jobType}`);
  writeLine(`Description: ${view.description}`);
  if (job.workInstructions) writeLine(`Work instructions: ${job.workInstructions}`);
  if (job.notes) writeLine(`Notes: ${job.notes}`);
  writeLine(`Frame: ${view.frameName}`);
  writeLine(`Glazing: ${view.glazingName}`);
  y += 4;

  const dimsLines: string[] = [];
  const spec = jobDetailsDraft(job).spec;
  const fields = Object.fromEntries(jobSpecificationFields(job).map(field => [field.label, field.value]));
  if (spec.artWidth !== '' && spec.artHeight !== '') {
    const wIn = (view.dims.artWcm / CM_PER_IN).toFixed(2);
    const hIn = (view.dims.artHcm / CM_PER_IN).toFixed(2);
    dimsLines.push(
      `Artwork: ${view.dims.artWcm.toFixed(1)} × ${view.dims.artHcm.toFixed(
        1
      )} cm (${wIn} × ${hIn} in)`
    );
  } else dimsLines.push(`Artwork: ${fields['Artwork dimensions']}`);
  if (spec.visibleWidth !== '' && spec.visibleHeight !== '') {
    dimsLines.push(
      `Visible: ${view.dims.visWcm.toFixed(1)} × ${view.dims.visHcm.toFixed(
        1
      )} cm`
    );
  } else dimsLines.push(`Visible: ${fields['Visible dimensions']}`);
  if (spec.faceWidth !== '') {
    dimsLines.push(`Frame face width: ${view.dims.faceWcm.toFixed(1)} cm`);
  } else dimsLines.push('Frame face width: Not recorded');

  dimsLines.forEach((line) => {
    writeLine(line);
  });

  jobSpecificationFields(job)
    .filter(field => ["Mat 1", "Additional mats", "Printing", "Foam/backer"].includes(field.label))
    .forEach(field => {
      const lines: string[] = doc.splitTextToSize(`${field.label}: ${field.value}`, pageWidth - margin * 2);
      lines.forEach(line => {
        if (y > 700) { doc.addPage(); y = margin; }
        doc.text(line, margin, y);
        y += 12;
      });
    });

  y += 6;

  const recordedCommercial = job.pricingSnapshot || job.total != null || parseDetails(job)?.costs?.total != null;
  if (!recordedCommercial) {
    writeLine('Commercial value not recorded');
    y += 12;
  } else {
  if (y > 660) { doc.addPage(); y = margin; }
  const taxAmount =
    (view.costs.subtotal ?? 0) * (view.costs.taxRate ?? 0);

  doc.setFont("helvetica", "bold");
  doc.text("Pricing", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.text(
    `Subtotal: ${fmtMoney(
      view.costs.subtotal,
      view.currencyCode,
      view.currencySymbol
    )}`,
    margin,
    y
  );
  y += 12;
  doc.text(
    `Tax: ${fmtMoney(
      taxAmount,
      view.currencyCode,
      view.currencySymbol
    )} (${((view.costs.taxRate ?? 0) * 100).toFixed(1)}%)`,
    margin,
    y
  );
  y += 12;
  doc.setFont("helvetica", "bold");
  doc.text(
    `Total: ${fmtMoney(
      view.costs.total,
      view.currencyCode,
      view.currencySymbol
    )}`,
    margin,
    y
  );
  y += 20;

  }

  // ---------- Checklist ----------
  if (y > 700) { doc.addPage(); y = margin; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Workshop checklist", margin, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const checklist =
    Array.isArray(view.checklist) && view.checklist.length > 0
      ? view.checklist
      : [];

  if (checklist.length === 0) {
    doc.text("No checklist items for this job.", margin, y);
    y += 14;
  } else {
    checklist.forEach((item: AnyRecord, index: number) => {
      if (y > 770) {
        doc.addPage();
        y = margin;
      }
      const mark = item.done ? "[x]" : "[ ]";
      writeLine(`${mark} ${item.text ?? item.label ?? ""}`);
      if (index === checklist.length - 1) y += 4;
    });
  }

  // ---------- Bank details ----------
  if (bankDetails) {
    if (y > 700) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Bank details", margin, y);
    y += 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    bankDetails
      .toString()
      .split("\n")
      .forEach((line: string) => {
        doc.text(line, margin, y);
        y += 11;
      });

    y += 10;
  }

  // ---------- Footer ----------
  const footerY = doc.internal.pageSize.getHeight() - 30;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.text(footerNote, margin, footerY);

  if (download) doc.save(`job-card-${view.id || "job"}.pdf`);
  return doc;
}
