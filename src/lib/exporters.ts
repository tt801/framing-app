// src/lib/exporters.ts
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export async function exportNodeAsPng(node: HTMLElement, filename = "frameit.png") {
  const canvas = await html2canvas(node, { backgroundColor: null, scale: 2 });
  const dataUrl = canvas.toDataURL("image/png");
  download(dataUrl, filename);
}

export async function exportNodeAsJpeg(node: HTMLElement, filename = "frameit.jpg", quality = 0.92) {
  const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  download(dataUrl, filename);
}

export async function exportNodeAsPdf(node: HTMLElement, filename = "frameit.pdf") {
  const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
  const imgData = canvas.toDataURL("image/jpeg", 0.95);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgRatio = canvas.width / canvas.height;

  let w = pageW - 20;
  let h = w / imgRatio;
  if (h > pageH - 20) {
    h = pageH - 20;
    w = h * imgRatio;
  }

  pdf.addImage(imgData, "JPEG", (pageW - w) / 2, (pageH - h) / 2, w, h);
  pdf.save(filename);
}

function download(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
