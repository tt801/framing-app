// src/VisualizerApp.tsx
import React, { useMemo, useRef, useState } from "react";
import { useCatalog } from "./lib/store";
import { useQuotes } from "./lib/quotes";
import { useCustomers } from "./lib/customers";
import { useInvoices } from "./lib/invoices";
import RoomMockup from "./components/RoomMockup";
import { Tabs } from "./components/Tabs";

// ---------- helpers ----------
const CM_PER_IN = 2.54;
const cmToIn = (cm: number) => cm / CM_PER_IN;
const inToCm = (inch: number) => inch * CM_PER_IN;
const cmToM = (n: number) => n / 100;
const perimeterMeters = (w: number, h: number) => cmToM(2 * (w + h));
const areaSqM = (w: number, h: number) => cmToM(w) * cmToM(h);
const fmt2 = (n: number) =>
  new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
function rid() {
  return Math.random().toString(36).slice(2, 8);
}

export default function VisualizerApp() {
  const { catalog } = useCatalog();
  const { add: addQuote } = useQuotes();
  const { customers, add: addCustomer, update: updateCustomer, findByEmail } = useCustomers();
  const { addFromQuote } = useInvoices();

  const FRAMES = catalog.frames || [];
  const MATS = catalog.mats || [];
  const GLAZING = catalog.glazing || [];
  const PRINT_MATS = (catalog as any).printingMaterials || [];
  const SETTINGS = (catalog as any).settings || {};

  // live settings
  const unit: "metric" | "imperial" = SETTINGS?.unit ?? "metric";
  const currencySymbol: string = SETTINGS?.currencySymbol ?? "R ";
  const currencyCode: string = SETTINGS?.currencyCode ?? "ZAR";
  const fallbackPrintingPerSqM = Number(SETTINGS?.printingPerSqM ?? 0);
  const foamBackerPerSqM = Number(SETTINGS?.foamBackerPerSqM ?? 0);
  const labourBase = Number(SETTINGS?.labourBase ?? 0);
  const margin = Number(SETTINGS?.marginMultiplier ?? 1);

  const moneyIntl = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
      }).format(n);
    } catch {
      return `${currencySymbol}${fmt2(n)}`;
    }
  };

  // ---------- state ----------
  const [activeTab, setActiveTab] = useState<"build" | "room">("build");

  const [artWcm, setArtWcm] = useState(40);
  const [artHcm, setArtHcm] = useState(30);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const [selectedFrame, setSelectedFrame] = useState(FRAMES[0]?.id ?? "");
  const [frameFaceOverride, setFrameFaceOverride] = useState<number | "auto">("auto");

  // Mat 1 (inner)
  const [selectedMat1, setSelectedMat1] = useState(MATS[1]?.id ?? MATS[0]?.id ?? "mat0"); // 'mat0' = no mat
  const [mat1BorderCm, setMat1BorderCm] = useState(5);

  // Mat 2 (outer, optional)
  const [selectedMat2, setSelectedMat2] = useState<string>("mat0");
  const [mat2BorderCm, setMat2BorderCm] = useState(2);

  // Glazing
  const [selectedGlazing, setSelectedGlazing] = useState(GLAZING[0]?.id ?? "");

  // Printing
  const [includePrint, setIncludePrint] = useState(false);
  const [printMaterialId, setPrintMaterialId] = useState<string>("");

  // Backer (foam)
  const [includeBacker, setIncludeBacker] = useState(false);

  // Backdrop (simple presets used in Build preview)
  const [backdrop, setBackdrop] = useState<"none" | "white" | "living" | "gallery" | "office">("none");

  // CRM mini-form
  const [customer, setCustomer] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    company: "",
    notes: "",
    ref: "",
  });

  // ---------- lookups ----------
  const frameProfile = useMemo(
    () => FRAMES.find((f) => f.id === selectedFrame) ?? FRAMES[0],
    [FRAMES, selectedFrame]
  );
  const mat1 = useMemo(() => MATS.find((m) => m.id === selectedMat1) ?? MATS[0], [MATS, selectedMat1]);
  const mat2 = useMemo(() => MATS.find((m) => m.id === selectedMat2) ?? MATS[0], [MATS, selectedMat2]);
  const glazing = useMemo(
    () => GLAZING.find((g) => g.id === selectedGlazing) ?? GLAZING[0],
    [GLAZING, selectedGlazing]
  );
  const selectedPM = useMemo(
    () => PRINT_MATS.find((pm: any) => pm.id === printMaterialId),
    [PRINT_MATS, printMaterialId]
  );

  // ---------- geometry ----------
  const faceWidthCm = frameFaceOverride === "auto" ? frameProfile?.faceWidthCm ?? 2 : Number(frameFaceOverride);

  const hasMat1 = selectedMat1 !== "mat0";
  const hasMat2 = selectedMat2 !== "mat0";

  const totalBorder = (hasMat1 ? mat1BorderCm : 0) + (hasMat2 ? mat2BorderCm : 0);

  const visibleWcm = artWcm + 2 * totalBorder;
  const visibleHcm = artHcm + 2 * totalBorder;
  const outerWcm = visibleWcm + 2 * faceWidthCm;
  const outerHcm = visibleHcm + 2 * faceWidthCm;

  // ---------- pricing ----------
  const framePerimeterM = perimeterMeters(visibleWcm, visibleHcm);
  const areaArt = areaSqM(artWcm, artHcm);
  const glazedAreaSqM = areaSqM(visibleWcm, visibleHcm);

  const areaAfterMat1 = areaSqM(
    artWcm + 2 * (hasMat1 ? mat1BorderCm : 0),
    artHcm + 2 * (hasMat1 ? mat1BorderCm : 0)
  );
  const areaAfterMat2 = areaSqM(artWcm + 2 * totalBorder, artHcm + 2 * totalBorder);

  const mat1SheetSqM = hasMat1 ? areaAfterMat1 - areaArt : 0;
  const mat2SheetSqM = hasMat2 ? areaAfterMat2 - areaArt : 0;

  const pricePerMeter = Number(frameProfile?.pricePerMeter ?? 0);
  const glazingPerSqM = Number(glazing?.pricePerSqM ?? 0);
  const mat1PerSqM = Number(mat1?.pricePerSqM ?? 0);
  const mat2PerSqM = Number(mat2?.pricePerSqM ?? 0);
  const printingPerSqM = Number((selectedPM?.pricePerSqM ?? fallbackPrintingPerSqM) ?? 0);

  const frameCost = framePerimeterM * pricePerMeter;
  const glazingCost = glazedAreaSqM * glazingPerSqM;
  const mat1Cost = mat1SheetSqM * mat1PerSqM;
  const mat2Cost = mat2SheetSqM * mat2PerSqM;
  const printingCost = includePrint ? areaArt * printingPerSqM : 0;
  const backerCost = includeBacker ? glazedAreaSqM * foamBackerPerSqM : 0;

  const subtotal =
    frameCost + glazingCost + mat1Cost + mat2Cost + printingCost + backerCost + labourBase;
  const total = subtotal * margin;

  // ---------- scaling (cm → pixels) ----------
  const maxPx = 760;
  const scale = useMemo(() => {
    const maxCm = Math.max(outerWcm, outerHcm);
    return maxCm <= 0 ? 1 : maxPx / maxCm;
  }, [outerWcm, outerHcm]);
  const px = (cm: number) => Math.max(1, Math.round(cm * scale));

  // ---------- upload ----------
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageUrl(URL.createObjectURL(f));
  };

  // ---------- CRM actions ----------
  const loadCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    setCustomer({
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone || "",
      company: c.company || "",
      notes: c.notes || "",
      ref: "",
    });
  };

  const saveToCRM = () => {
    if (!customer.firstName.trim() || !customer.lastName.trim() || !customer.email.trim()) {
      alert("First name, last name and email are required");
      return;
    }
    const existing = findByEmail(customer.email);
    if (existing) {
      updateCustomer({ id: existing.id, ...customer } as any);
      alert("Customer updated");
    } else {
      addCustomer({ ...customer } as any);
      alert("Customer saved");
    }
  };

  const buildItems = () => {
    const items = [
      { id: rid(), description: `Frame (${frameProfile?.name ?? "frame"})`, qty: 1, unitPrice: frameCost },
      { id: rid(), description: `Glazing (${glazing?.name ?? "glazing"})`, qty: 1, unitPrice: glazingCost },
      ...(hasMat1
        ? [{ id: rid(), description: `Mat 1 (${mat1?.name ?? "mat"})`, qty: 1, unitPrice: mat1Cost }]
        : []),
      ...(hasMat2
        ? [{ id: rid(), description: `Mat 2 (${mat2?.name ?? "mat"})`, qty: 1, unitPrice: mat2Cost }]
        : []),
      ...(includePrint
        ? [
            {
              id: rid(),
              description: selectedPM ? `Printing — ${selectedPM.name}` : "Printing",
              qty: 1,
              unitPrice: printingCost,
            },
          ]
        : []),
      ...(includeBacker ? [{ id: rid(), description: `Foam backer`, qty: 1, unitPrice: backerCost }] : []),
      { id: rid(), description: `Labour & overhead`, qty: 1, unitPrice: labourBase },
    ];
    return items;
  };

  const buildMeta = () => ({
    unit,
    currencySymbol,
    currencyCode,
    artWcm,
    artHcm,
    selectedFrame,
    faceWidthCm,
    selectedMat1,
    mat1BorderCm,
    selectedMat2,
    mat2BorderCm,
    selectedGlazing,
    includePrint,
    printMaterialId,
    includeBacker,
    visibleWcm,
    visibleHcm,
    outerWcm,
    outerHcm,
    margin,
    backdrop,
  });

  const ensureCustomer = (): string | null => {
    if (!customer.email.trim() || !customer.firstName.trim() || !customer.lastName.trim()) {
      alert("Please enter first name, last name, and email first.");
      return null;
    }
    const existing = findByEmail(customer.email);
    let customerId = existing?.id;
    if (existing) {
      updateCustomer({ id: existing.id, ...customer } as any);
    } else {
      addCustomer({ ...customer } as any);
      customerId = findByEmail(customer.email)?.id;
    }
    if (!customerId) {
      alert("Could not create or find customer.");
      return null;
    }
    return customerId;
  };

  const onQuote = () => {
    const customerId = ensureCustomer();
    if (!customerId) return;
    const items = buildItems();
    const meta = buildMeta();
    addQuote({ customerId, items, notes: "", meta } as any);
    location.hash = "#/quotes";
  };

  const onInvoice = () => {
    const customerId = ensureCustomer();
    if (!customerId) return;

    const items = buildItems();
    const subtotalX = items.reduce((s, it) => s + (it.unitPrice || 0) * (it.qty || 1), 0);
    const totalX = subtotalX * margin;

    const inv = addFromQuote({
      customerId,
      items,
      subtotal: subtotalX,
      total: totalX,
      notes: "",
    });
    alert(`Invoice created: ${inv.number}`);
    location.hash = "#/invoices";
  };

  // ---------- preview helpers ----------
  const frameColor = frameProfile?.color ?? "#000";
  const hasImage = !!imageUrl;

  const formatLenUI = (cmValue: number, unitMode: "metric" | "imperial") =>
    unitMode === "imperial" ? Number(cmToIn(cmValue).toFixed(2)) : Number(cmValue.toFixed(1));

  // Room tab artwork source (for now we use raw uploaded image)
  const artworkUrl = useMemo(() => imageUrl ?? "", [imageUrl]);

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="w-full p-4 grid gap-4 sm:grid-cols-1 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        {/* LEFT: Options */}
        <section className="w-full md:w-[300px] flex-none">
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
            <h2 className="text-base font-semibold mb-2">Artwork & Options</h2>

            {/* Image upload */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium">Artwork image</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFile}
                className="block w-full text-sm"
              />
            </div>

            {/* Backdrop presets (Build tab only) */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium">Backdrop</label>
              <select
                value={backdrop}
                onChange={(e) => setBackdrop(e.target.value as any)}
                className="w-full rounded-lg border p-2 bg-white"
              >
                <option value="none">None</option>
                <option value="white">White wall</option>
                <option value="living">Living room</option>
                <option value="gallery">Gallery wall</option>
                <option value="office">Office desk</option>
              </select>
              <p className="text-xs text-slate-600">Presets only. Use Room Preview tab for AI/room scenes.</p>
            </div>

            {/* Art size */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium">Width ({unit === "imperial" ? "in" : "cm"})</label>
                <input
                  type="number"
                  step="0.1"
                  value={formatLenUI(artWcm, unit)}
                  onChange={(e) =>
                    setArtWcm(unit === "imperial" ? inToCm(parseFloat(e.target.value)) : parseFloat(e.target.value))
                  }
                  className="w-full rounded-lg border p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Height ({unit === "imperial" ? "in" : "cm"})</label>
                <input
                  type="number"
                  step="0.1"
                  value={formatLenUI(artHcm, unit)}
                  onChange={(e) =>
                    setArtHcm(unit === "imperial" ? inToCm(parseFloat(e.target.value)) : parseFloat(e.target.value))
                  }
                  className="w-full rounded-lg border p-2"
                />
              </div>
            </div>

            {/* Frame */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium">Frame profile</label>
              <select
                value={selectedFrame}
                onChange={(e) => setSelectedFrame(e.target.value)}
                className="w-full rounded-lg border p-2 bg-white"
              >
                {FRAMES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {moneyIntl(Number(f.pricePerMeter))}/m
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={frameFaceOverride === "auto" ? frameProfile?.faceWidthCm ?? 2 : (frameFaceOverride as number)}
                  onChange={(e) => setFrameFaceOverride(parseFloat(e.target.value))}
                  className="w-full rounded-lg border p-2"
                />
                <button
                  onClick={() => setFrameFaceOverride("auto")}
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white"
                >
                  Default
                </button>
              </div>
            </div>

            {/* Mat 1 */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium">Mat 1 (inner)</label>
              <select
                value={selectedMat1}
                onChange={(e) => setSelectedMat1(e.target.value)}
                className="w-full rounded-lg border p-2 bg-white"
              >
                {MATS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.pricePerSqM > 0 ? ` — ${moneyIntl(Number(m.pricePerSqM))}/m²` : ""}
                  </option>
                ))}
              </select>
              {selectedMat1 !== "mat0" && (
                <div>
                  <label className="block text-sm">Mat 1 border ({unit === "imperial" ? "in" : "cm"})</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formatLenUI(mat1BorderCm, unit)}
                    onChange={(e) =>
                      setMat1BorderCm(
                        unit === "imperial" ? inToCm(parseFloat(e.target.value)) : parseFloat(e.target.value)
                      )
                    }
                    className="w-full rounded-lg border p-2"
                  />
                </div>
              )}
            </div>

            {/* Mat 2 */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium">Mat 2 (outer, optional)</label>
              <select
                value={selectedMat2}
                onChange={(e) => setSelectedMat2(e.target.value)}
                className="w-full rounded-lg border p-2 bg-white"
              >
                <option value="mat0">No second mat</option>
                {MATS.filter((m) => m.id !== "mat0").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.pricePerSqM > 0 ? ` — ${moneyIntl(Number(m.pricePerSqM))}/m²` : ""}
                  </option>
                ))}
              </select>
              {selectedMat2 !== "mat0" && (
                <div>
                  <label className="block text-sm">Mat 2 border ({unit === "imperial" ? "in" : "cm"})</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formatLenUI(mat2BorderCm, unit)}
                    onChange={(e) =>
                      setMat2BorderCm(
                        unit === "imperial" ? inToCm(parseFloat(e.target.value)) : parseFloat(e.target.value)
                      )
                    }
                    className="w-full rounded-lg border p-2"
                  />
                </div>
              )}
            </div>

            {/* Glazing */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium">Glazing</label>
              <select
                value={selectedGlazing}
                onChange={(e) => setSelectedGlazing(e.target.value)}
                className="w-full rounded-lg border p-2 bg-white"
              >
                {GLAZING.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} — {moneyIntl(Number(g.pricePerSqM))}/m²
                  </option>
                ))}
              </select>
            </div>

            {/* Printing */}
            <div className="flex items-center gap-2 mt-2 mb-2">
              <input
                id="print"
                type="checkbox"
                checked={includePrint}
                onChange={(e) => setIncludePrint(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="print" className="text-sm">
                Include printing
              </label>
            </div>
            {includePrint && (
              <div className="space-y-1 mb-2">
                <label className="block text-xs">Printing material</label>
                <select
                  className="w-full rounded-lg border p-2 bg-white text-sm"
                  value={printMaterialId}
                  onChange={(e) => setPrintMaterialId(e.target.value)}
                >
                  <option value="">Use fallback — {moneyIntl(fallbackPrintingPerSqM)}/m²</option>
                  {PRINT_MATS.map((pm: any) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name} — {moneyIntl(Number(pm.pricePerSqM))}/m²
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Foam backer */}
            <div className="flex items-center gap-2 mt-3">
              <input
                id="backer"
                type="checkbox"
                checked={includeBacker}
                onChange={(e) => setIncludeBacker(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="backer" className="text-sm">
                Foam board backer {foamBackerPerSqM > 0 ? `(${moneyIntl(foamBackerPerSqM)}/m²)` : ""}
              </label>
            </div>
          </div>
        </section>

        {/* MIDDLE: Visualizer + Cost */}
        <section className="min-w-0">
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6">

            {/* Tabs */}
            <div className="mb-4">
              <Tabs
                tabs={[
                  { key: "build", label: "Build" },
                  { key: "room", label: "Room Preview" },
                ]}
                active={activeTab}
                onChange={(k) => setActiveTab(k as "build" | "room")}
              />
            </div>

            {/* Preview area */}
            {activeTab === "build" ? (
              <div className="flex items-center justify-center overflow-auto mb-6">
                {/* Existing framed preview */}
                <div
                  className="relative select-none shrink-0"
                  style={{
                    width: Math.max(1, Math.round(px(outerWcm))),
                    height: Math.max(1, Math.round(px(outerHcm))),
                    background:
                      backdrop === "white"
                        ? "#f6f7fb"
                        : backdrop === "living"
                        ? "linear-gradient(180deg, #e6e6e6 0%, #d6d3d1 100%)"
                        : backdrop === "gallery"
                        ? "linear-gradient(180deg, #fafafa 0%, #f1f5f9 100%)"
                        : backdrop === "office"
                        ? "linear-gradient(180deg, #ede9fe 0%, #f5f3ff 100%)"
                        : frameColor,
                    boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
                    borderRadius: 8,
                  }}
                >
                  {/* Visible area inside frame face */}
                  <div
                    style={{
                      position: "absolute",
                      left: px(faceWidthCm),
                      top: px(faceWidthCm),
                      right: px(faceWidthCm),
                      bottom: px(faceWidthCm),
                      background: selectedMat1 !== "mat0" ? (mat1?.color === "transparent" ? "#EEE" : mat1?.color ?? "#EEE") : "#EEE",
                      borderRadius: 4,
                    }}
                  >
                    {/* Mat 2 ring (if present), inset inside Mat1 */}
                    {selectedMat2 !== "mat0" && (
                      <div
                        style={{
                          position: "absolute",
                          left: px(mat1BorderCm),
                          top: px(mat1BorderCm),
                          right: px(mat1BorderCm),
                          bottom: px(mat1BorderCm),
                          background: mat2?.color === "transparent" ? "#EEE" : mat2?.color ?? "#EEE",
                          borderRadius: 3,
                        }}
                      />
                    )}

                    {/* Artwork window */}
                    <div
                      style={{
                        position: "absolute",
                        left: px(totalBorder),
                        top: px(totalBorder),
                        right: px(totalBorder),
                        bottom: px(totalBorder),
                        background: "#fff",
                        overflow: "hidden",
                        borderRadius: 2,
                      }}
                    >
                      {hasImage ? (
                        <img src={imageUrl!} alt="art" className="w-full h-full object-cover" draggable={false} />
                      ) : (
                        <div className="w-full h-full grid place-items-center">
                          <span className="text-neutral-700 text-sm font-normal">Upload an image to preview</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <RoomMockup artworkUrl={artworkUrl} />
              </div>
            )}

            {/* Dimensions & Cost */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="bg-white rounded-xl border p-4 text-sm">
                <div className="font-semibold text-base mb-2">Dimensions</div>
                <div className="divide-y">
                  <div className="py-1.5 flex justify-between">
                    <span>Artwork</span>
                    <span>
                      {formatLenUI(artWcm, unit)} × {formatLenUI(artHcm, unit)} {unit === "imperial" ? "in" : "cm"}
                    </span>
                  </div>
                  <div className="py-1.5 flex justify-between">
                    <span>Visible</span>
                    <span>
                      {formatLenUI(visibleWcm, unit)} × {formatLenUI(visibleHcm, unit)} {unit === "imperial" ? "in" : "cm"}
                    </span>
                  </div>
                  <div className="py-1.5 flex justify-between">
                    <span>Outer</span>
                    <span>
                      {formatLenUI(outerWcm, unit)} × {formatLenUI(outerHcm, unit)} {unit === "imperial" ? "in" : "cm"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border p-4 text-sm">
                <div className="font-semibold text-base mb-2">Cost</div>
                <div className="divide-y">
                  <div className="py-1.5 flex justify-between">
                    <span>Frame</span>
                    <span title="perimeter(m) × price/m">{moneyIntl(frameCost)}</span>
                  </div>
                  <div className="py-1.5 flex justify-between">
                    <span>Glazing</span>
                    <span title="visible area(m²) × price/m²">{moneyIntl(glazingCost)}</span>
                  </div>
                  {selectedMat1 !== "mat0" && (
                    <div className="py-1.5 flex justify-between">
                      <span>Mat 1</span>
                      <span title="sheet area(m²) × price/m²">{moneyIntl(mat1Cost)}</span>
                    </div>
                  )}
                  {selectedMat2 !== "mat0" && (
                    <div className="py-1.5 flex justify-between">
                      <span>Mat 2</span>
                      <span title="sheet area(m²) × price/m²">{moneyIntl(mat2Cost)}</span>
                    </div>
                  )}
                  {includePrint && (
                    <div className="py-1.5 flex justify-between">
                      <span>Printing</span>
                      <span title="art area(m²) × price/m²">{moneyIntl(printingCost)}</span>
                    </div>
                  )}
                  {includeBacker && (
                    <div className="py-1.5 flex justify-between">
                      <span>Foam backer</span>
                      <span title="visible area(m²) × price/m²">{moneyIntl(backerCost)}</span>
                    </div>
                  )}
                  <div className="py-1.5 flex justify-between">
                    <span>Labour</span>
                    <span>{moneyIntl(labourBase)}</span>
                  </div>
                  <div className="pt-2 flex justify-between font-semibold">
                    <span>Total</span>
                    <span>{moneyIntl(total)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT: Customer Panel */}
        <aside className="w-full md:w-[260px] flex-none space-y-4">
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
            <h3 className="font-medium mb-3">Customer</h3>

            {/* Load existing */}
            <div className="mb-3">
              <label className="block text-sm mb-1">Load existing</label>
              <select
                className="w-full rounded-lg border p-2 text-sm"
                onChange={(e) => e.target.value && loadCustomer(e.target.value)}
                defaultValue=""
              >
                <option value="" disabled>
                  Select a customer…
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName} — {c.email}
                  </option>
                ))}
              </select>
            </div>

            {/* Editable fields */}
            <div className="space-y-2">
              <input
                placeholder="First name"
                className="w-full rounded-lg border p-2 text-sm"
                value={customer.firstName}
                onChange={(e) => setCustomer({ ...customer, firstName: e.target.value })}
              />
              <input
                placeholder="Last name"
                className="w-full rounded-lg border p-2 text-sm"
                value={customer.lastName}
                onChange={(e) => setCustomer({ ...customer, lastName: e.target.value })}
              />
              <input
                placeholder="Company"
                className="w-full rounded-lg border p-2 text-sm"
                value={customer.company}
                onChange={(e) => setCustomer({ ...customer, company: e.target.value })}
              />
              <input
                placeholder="Email"
                type="email"
                className="w-full rounded-lg border p-2 text-sm"
                value={customer.email}
                onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
              />
              <input
                placeholder="Phone"
                className="w-full rounded-lg border p-2 text-sm"
                value={customer.phone}
                onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
              />
              <textarea
                placeholder="Notes"
                className="w-full rounded-lg border p-2 text-sm h-20 resize-y"
                value={customer.notes}
                onChange={(e) => setCustomer({ ...customer, notes: e.target.value })}
              />
            </div>

            <div className="flex gap-2 mt-3">
              <button
                onClick={saveToCRM}
                className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white"
              >
                Save to customer
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => alert("Saved draft (stub).")} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">
                Save
              </button>
              <button onClick={onQuote} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">
                Quote
              </button>
              <button onClick={() => alert("Job created (stub).")} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">
                Create Job
              </button>
              <button onClick={onInvoice} className="rounded-lg border px-3 py-2 text-sm hover:bg-black hover:text-white">
                Invoice
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
