// src/VisualizerApp.tsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import { matGeometry, restoreMatBorders, defaultMatBorders, MAT_GEOMETRY_VERSION, matSides, type MatBorders } from '@/lib/matGeometry';

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({
    title,
    children,
  }) => (
    <div className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 mb-2">
        {title}
      </h3>
      {children}
    </div>
  );

function BorderInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="block text-sm text-slate-700">{label}<input type="number" min="0" step="0.1"
    className="w-full rounded-lg border p-2 text-sm bg-white/90" value={draft}
    onChange={e => { const raw = e.target.value; setDraft(raw); const n = Number(raw); if (raw.trim() && Number.isFinite(n) && n >= 0) onChange(n); }}
    onBlur={() => setDraft(String(value))} /></label>;
}

type HandleKey = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const Handle = ({
    o,
    handle,
    style,
    phase,
    onResize,
  }: {
    o: MatOpening;
    handle: HandleKey;
    style: React.CSSProperties;
    phase: 'visible' | 'fading' | 'hidden';
    onResize: (e: React.MouseEvent, o: MatOpening, handle: HandleKey) => void;
  }) => (
    <div
      onMouseDown={(e) => onResize(e, o, handle)}
      data-html2canvas-ignore="true"
      className="absolute bg-white border border-slate-400 rounded shadow-sm cursor-pointer"
      style={{ width: 12, height: 12, opacity: phase === 'fading' ? 0 : 1,
        transition: 'opacity 200ms ease', pointerEvents: phase === 'fading' ? 'none' : 'auto', ...style }}
      title={`Drag to resize (${handle.toUpperCase()})`}
    />
  );

// STORES / LIBS
import { useCatalog, type PrintingMaterial } from "@/lib/store";
import { materialRateIssue, pricingSettingsIssue } from '@/lib/materialPricing';
import { useEffectiveCompanyCatalogue } from "@/lib/effectiveSupplierAccess";
import { priceVisualiser, effectiveTaxRatePct, toVisualiserQuote, toVisualiserJobCosts, toVisualiserInvoice } from "@/lib/pricing";
import { useQuotes } from "@/lib/quotes";
import { useCustomers, validateCustomer, type Customer } from "@/lib/customers";
import { useInvoices } from "@/lib/invoices";
import { useJobs } from "@/lib/jobs";
import { useToast } from "@/lib/toast";
import { useLayout } from "@/lib/layout";
import * as htmlToImage from "html-to-image";

declare global {
  interface Window {
    __FRAMEIT: { useCatalog: typeof useCatalog };
  }
}

window.__FRAMEIT = { useCatalog };

// COMPONENTS
import RoomMockup from "@/components/RoomMockup";
import { Tabs } from "@/components/Tabs";

// EXPORT HELPERS & PRESETS
import {
  exportNodeAsJpeg,
  exportNodeAsPdf,
  exportNodeAsPng,
} from "@/lib/exporters";
import type { VisualizerPreset } from "@/lib/presets";
import PresetControls from "@/components/PresetControls";
import { useBillingAccess } from "@/lib/billingAccess";

type OpeningShape = "rect" | "oval" | "circle";
type MatOpening = {
  id: string;
  shape: OpeningShape;
  xCm: number;
  yCm: number;
  widthCm: number;
  heightCm: number;
  imageUrl?: string;
};

type IndividualFeedback = {
  isCurrent: () => boolean;
  selectCustomer: (id: string) => void;
  notify: (message: string, type: "success" | "error" | "warning") => void;
  fail: (message: string) => void;
};

const CM_PER_IN = 2.54;
const cmToIn = (cm: number) => cm / CM_PER_IN;
const inToCm = (inch: number) => inch * CM_PER_IN;
const fmt2 = (n: number) => Number(n ?? 0).toFixed(2);
const rid = () => Math.random().toString(36).slice(2, 9);

// 🔹 Pro-mode snapping helpers
const SNAP_STEP_CM = 0.5;
const SNAP_MAGNET_CM = 1.5;

const snapToGrid = (valueCm: number, step = SNAP_STEP_CM) =>
  step > 0 ? Math.round(valueCm / step) * step : valueCm;

const snapWithMagnet = (
  valueCm: number,
  targetsCm: number[],
  thresholdCm = SNAP_MAGNET_CM
) => {
  for (const t of targetsCm) {
    if (Math.abs(valueCm - t) <= thresholdCm) return t;
  }
  return valueCm;
};

/* --------- LocalStorage helpers for quotes (tolerant) --------- */
const LS_KEYS = [
  "framing_app_quotes_v1",
  "frameit_quotes_v1",
  "frameit_quotes",
  "quotes_store",
  "quotes",
];

const readQuotesFromAnyLS = (): any[] => {
  for (const k of LS_KEYS) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch {}
  }
  return [];
};

const writeQuotesToAllLS = (quotes: any[]) => {
  for (const k of LS_KEYS) {
    try {
      localStorage.setItem(k, JSON.stringify(quotes));
    } catch {}
  }
  try {
    window.dispatchEvent(new CustomEvent("quotes:changed"));
  } catch {}
};

const mergeQuote = (arr: any[], q: any) => {
  const keyQ = (x: any) =>
    x?.id ?? x?.number ?? x?.quoteNumber ?? x?.quoteNo ?? undefined;
  const idx = arr.findIndex((x) => keyQ(x) === keyQ(q));
  if (idx >= 0) {
    const copy = arr.slice();
    copy[idx] = { ...copy[idx], ...q };
    return copy;
  }
  return [...arr, q];
};

const writeQuoteToAnyStore = (qStore: any, payload: any) => {
  let wrote = false;
  const hit = (label: string, fn: (p: any) => void) => {
    fn(payload);
    wrote = true;
    try {
      console.debug("quotes: wrote via", label, payload);
    } catch {}
  };

  try {
    if (typeof qStore?.addQuote === "function") {
      hit("addQuote", qStore.addQuote.bind(qStore));
    } else if (typeof qStore?.createQuote === "function") {
      hit("createQuote", qStore.createQuote.bind(qStore));
    } else if (typeof qStore?.add === "function") {
      hit("add", qStore.add.bind(qStore));
    } else if (typeof qStore?.saveQuote === "function") {
      hit("saveQuote", (p) => qStore.saveQuote(p.id, p));
    } else if (typeof qStore?.updateQuote === "function") {
      hit("updateQuote", (p) => qStore.updateQuote(p.id, p));
    } else if (typeof qStore?.setQuotes === "function") {
      qStore.setQuotes((rows: any[] = []) => mergeQuote(rows, payload));
      wrote = true;
      try {
        console.debug("quotes: wrote via setQuotes", payload);
      } catch {}
    } else if (typeof qStore?.setItems === "function") {
      qStore.setItems((rows: any[] = []) => mergeQuote(rows, payload));
      wrote = true;
      try {
        console.debug("quotes: wrote via setItems", payload);
      } catch {}
    } else if (typeof qStore?.set === "function" && typeof qStore?.getState === "function") {
      const curr = (qStore.getState()?.quotes ?? []) as any[];
      qStore.set({ quotes: mergeQuote(curr, payload) });
      wrote = true;
      try {
        console.debug("quotes: wrote via zustand.set", payload);
      } catch {}
    }
  } catch (e) {
    console.warn("quotes store write failed:", e);
  }
  if (!wrote) {
    try {
      console.warn(
        "quotes: no known store API; keys:",
        Object.keys(qStore || {})
      );
    } catch {}
  }
  return wrote;
};

/* --------- Currency helpers --------- */
const symbolFor = (code?: string) => {
  const m: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    ZAR: "R ",
    AUD: "A$",
    CAD: "C$",
    NZD: "NZ$",
    JPY: "¥",
    CHF: "CHF ",
    SEK: "kr",
    NOK: "kr",
    DKK: "kr",
    INR: "₹",
    CNY: "¥",
    HKD: "HK$",
  };
  return code ? m[code.toUpperCase()] : undefined;
};
const getSettingsCurrency = (settings: any) =>
  settings?.currencyCode ||
  (typeof settings?.currency === "string" ? settings?.currency : undefined) ||
  "ZAR";

/* --------- Jobs checklist template --------- */
function makeJobChecklist() {
  return [
    { id: rid(), text: "Measure & verify artwork size", done: false },
    { id: rid(), text: "Cut frame lengths", done: false },
    { id: rid(), text: "Join frame (underpinner)", done: false },
    { id: rid(), text: "Cut mat(s) / openings", done: false },
    { id: rid(), text: "Cut glazing", done: false },
    { id: rid(), text: "Cut foam/backer", done: false },
    { id: rid(), text: "Assemble & tape", done: false },
    { id: rid(), text: "Clean glass & QC", done: false },
    { id: rid(), text: "Fit hardware & final QC", done: false },
  ];
}

export default function VisualizerApp() {
  const { catalog, loading: catalogLoading, settingsLoading, error: catalogError, settingsError } = useCatalog();
  const billing = useBillingAccess();
  const effectiveCatalogue = useEffectiveCompanyCatalogue(billing.companyAccountId, catalog);
  const qStore = useQuotes() as any;
  const { add: toast } = useToast();
  const jobsStore = useJobs() as any;
  const invoicesStore = useInvoices() as any;

  const { customers, add: addCustomer, update: updateCustomer } =
    useCustomers();
  const { layoutMode } = useLayout();

  // 🔍 DEBUG: expose state on window for console inspection
  if (typeof window !== "undefined") {
    (window as any).__FRAMEIT = {
      ...(window as any).__FRAMEIT,
      catalog,
      quotesState: qStore,
      jobsState: jobsStore,
      invoicesState: invoicesStore,
      customersState: customers,
    };
  }

  const containerClass =
    layoutMode === "fixed" ? "max-w-[1440px] mx-auto" : "max-w-none w-full";

  const addJob = async (job: any) => {
    if (typeof jobsStore?.add !== "function") return { ok: false, error: "No job creation function available" };
    return jobsStore.add(job);
  };
  const addInvoice = async (invoice: any) => {
    if (typeof invoicesStore?.addInvoice !== "function") {
      return { ok: false, error: "No invoice creation function available" };
    }
    return invoicesStore.addInvoice(invoice);
  };

  const settings = catalog?.settings || {} as Partial<import('@/lib/store').Settings>;
  const currencyCode = getSettingsCurrency(settings);
  const currencySymbol =
    settings?.currencySymbol || symbolFor(currencyCode) || "R ";

  const defaultFrameId = catalog?.frames?.[0]?.id || "";

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

  // ---------- UI state ----------
  const [activeTab, setActiveTab] = useState<"build" | "room">("build");
  const [showDimensions, setShowDimensions] = useState(true);
  const [mode, setMode] = useState<"basic" | "pro">("basic");
  const [unit, setUnit] = useState<"metric" | "imperial">("metric");

  const [sizeMode, setSizeMode] = useState<"image" | "frame">("image");

  const [artWcm, setArtWcm] = useState(40);
  const [artHcm, setArtHcm] = useState(30);
  const [artworkUrl, setArtworkUrl] = useState<string>("");
  // Composite framed preview for RoomMockup
  const [roomArtworkUrl, setRoomArtworkUrl] = useState<string>("");

  // Frame + mats
  const [selectedFrame, setSelectedFrame] = useState<string>(defaultFrameId);
  const [faceAuto, setFaceAuto] = useState<boolean>(true);
  const [faceWidthCm, setFaceWidthCm] = useState(2.0);

  const [selectedMat1, setSelectedMat1] = useState<string>("mat0");
  const [selectedMat2, setSelectedMat2] = useState<string>("mat0");
  const [selectedMat3, setSelectedMat3] = useState<string>("mat0");

  // Independent incremental measurements survive disabling/re-enabling each material slot.
  const [borders, setBorders] = useState<MatBorders[]>(defaultMatBorders);
  const [matRestoreIssue, setMatRestoreIssue] = useState<string | null>(null);

  const [showMat2, setShowMat2] = useState(false);
  const [showMat3, setShowMat3] = useState(false);

  const hasMat1 = selectedMat1 !== "mat0";
  const hasMat2 = selectedMat2 !== "mat0";
  const hasMat3 = selectedMat3 !== "mat0";

  const [openings, setOpenings] = useState<MatOpening[]>([]);
  const activeMats = [hasMat1, hasMat2, hasMat3];
  const [proOrigin, setProOrigin] = useState<{ x: number; y: number } | null>(null);
  const baseGeometry = matGeometry(artWcm, artHcm, faceWidthCm, borders, activeMats);
  const origin = proOrigin ?? { x: baseGeometry.total.left, y: baseGeometry.total.top };
  const layoutWidth = mode === 'pro' ? Math.max(artWcm, ...openings.map(o => o.xCm + o.widthCm - origin.x)) : artWcm;
  const layoutHeight = mode === 'pro' ? Math.max(artHcm, ...openings.map(o => o.yCm + o.heightCm - origin.y)) : artHcm;
  const geometry = matGeometry(layoutWidth, layoutHeight, faceWidthCm, borders, activeMats);
  const legacyLayoutIssue = mode === 'pro' && openings.some(o => o.xCm < origin.x || o.yCm < origin.y);
  const totalBorder = geometry.total.left; // legacy initial-opening origin only
  const proOffset = proOrigin ? { x: geometry.total.left - proOrigin.x, y: geometry.total.top - proOrigin.y } : { x: 0, y: 0 };

  // Pro mode openings are stored unchanged in their saved coordinate space.
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(
    null
  );
  const [hoveredOpeningId, setHoveredOpeningId] = useState<string | null>(null);
  const [handleOpeningId, setHandleOpeningId] = useState<string | null>(null);
  const [handlePhase, setHandlePhase] = useState<'visible' | 'fading' | 'hidden'>('hidden');
  const [handleInteraction, setHandleInteraction] = useState(0);
  function revealHandles(id: string) {
    setHandleOpeningId(id); setHandlePhase('visible'); setHandleInteraction(n => n + 1);
  }

  const [selectedGlazingId, setSelectedGlazingId] = useState<string>("");
  const [useFrameTexture, setUseFrameTexture] = useState<boolean>(true);
  const [textureScalePct, setTextureScalePct] = useState<number>(100);

  // Printing and backer
  const PRINT_MATS = (catalog?.printingMaterials || []) as any[];
  const [includePrint, setIncludePrint] = useState(false);
  const [printMaterialId, setPrintMaterialId] = useState<string>("");
  const [includeBacker, setIncludeBacker] = useState(false);
  const [backerMaterialId, setBackerMaterialId] = useState('__legacy_foam__');
  const backerList = catalog?.backers || [];

  const foamBackerPerSqM = catalog?.settings?.foamBackerPerSqM ?? (catalog as any)?.backer?.pricePerSqM;

  // Catalog lookups
  const frameProfile = catalog?.frames?.find?.(
    (f: any) => f.id === selectedFrame
  );
  const glazingList = (catalog?.glazing || []) as any[];
  const glazing = selectedGlazingId ? glazingList.find((g: any) => g.id === selectedGlazingId) : glazingList[0];

  const mat1 = catalog?.mats?.find?.((m: any) => m.id === selectedMat1);
  const mat2 = catalog?.mats?.find?.((m: any) => m.id === selectedMat2);
  const mat3 = catalog?.mats?.find?.((m: any) => m.id === selectedMat3);
  const selectedPM = PRINT_MATS.find((p: any) => p.id === printMaterialId);
  const selectedBacker = backerMaterialId === '__legacy_foam__'
    ? { id: '__legacy_foam__', name: 'Foam board backer (legacy)', pricePerSqM: foamBackerPerSqM,
        allowZeroPrice: catalog?.settings?.foamBackerAllowZeroPrice }
    : backerList.find(board => board.id === backerMaterialId);
  const supplierSelectionIssue = effectiveCatalogue.selectionIssue([
    selectedFrame, selectedMat1, selectedMat2, selectedMat3, selectedGlazingId,
    ...(includePrint ? [printMaterialId] : []),
    ...(includeBacker ? [backerMaterialId] : []),
  ]);
  const guardSupplierSelection = (feedback?: IndividualFeedback) => {
    if (!supplierSelectionIssue && !pricingIssue) return true;
    const message = customerPricingIssue;
    if (feedback) feedback.notify(message, "warning");
    else alert(message); // The combined workflow retains its existing feedback.
    return false;
  };

  useEffect(() => {
    if (!selectedGlazingId && glazingList.length > 0) {
      setSelectedGlazingId(glazingList[0].id);
    }
  }, [glazingList, selectedGlazingId]);

  const getProfileFaceWidth = (fp: any | undefined) => {
    const v =
      fp &&
      (fp.faceWidthCm ??
        fp.faceWidth ??
        fp.lipWidthCm ??
        fp.lipWidth ??
        undefined);
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  useEffect(() => {
    const frames = (catalog?.frames || []) as any[];
    if (!frames.length) return;
    if (!selectedFrame) {
      setSelectedFrame(frames[0].id);
    }
  }, [catalog?.frames, selectedFrame]);

  useEffect(() => {
    if (faceAuto) {
      const w = getProfileFaceWidth(frameProfile);
      if (typeof w === "number") setFaceWidthCm(w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedFrame,
    faceAuto,
    frameProfile?.faceWidthCm,
  ]);

  const framePreviewColor =
    (frameProfile as any)?.colour ||
    (frameProfile as any)?.color ||
    "#333";

  const frameTextureUrl = "";

  // Derived dimensions
  const outerWcm = geometry.external.width;
  const outerHcm = geometry.external.height;
  const visibleWcm = geometry.internal.width;
  const visibleHcm = geometry.internal.height;

  // ---------- Dimension input handlers (now used onBlur / Enter) ----------
  function handleDimensionChange(axis: "width" | "height", raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    const parsed = parseFloat(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    const cmValue = unit === "imperial" ? inToCm(parsed) : parsed;

    if (sizeMode === "image") {
      if (axis === "width") setArtWcm(cmValue);
      else setArtHcm(cmValue);
    } else {
      const margin = axis === 'width' ? geometry.total.left + geometry.total.right : geometry.total.top + geometry.total.bottom;
      const newArtCm = cmValue - margin - 2 * faceWidthCm;
      const clamped = Math.max(1, newArtCm);
      if (axis === "width") setArtWcm(clamped);
      else setArtHcm(clamped);
    }
  }

  function handleMatBorderChange(which: number, side: keyof MatBorders, value: number) {
    setBorders(current => current.map((b, i) => i === which ? { ...b, [side]: value } : b));
  }

  // ---------- Pricing: one immutable commercial result for all creation paths ----------
  const fallbackPrintSqM = catalog?.settings?.printingPerSqM;
  const labourBase = catalog?.settings?.labourBase;
  const marginMultiplier = catalog?.settings?.marginMultiplier;
  const printProduct = printMaterialId ? selectedPM : { id: '__fallback_print__', name: 'Printing (fallback)',
    pricePerSqM: fallbackPrintSqM, allowZeroPrice: catalog?.settings?.printingAllowZeroPrice };
  const materialIssues = [
    materialRateIssue(frameProfile, frameProfile?.pricePerMeter, 'Frame'),
    materialRateIssue(glazing, glazing?.pricePerSqM, 'Glazing'),
    ...(hasMat1 ? [materialRateIssue(mat1, mat1?.pricePerSqM, 'Mat 1')] : []),
    ...(hasMat2 ? [materialRateIssue(mat2, mat2?.pricePerSqM, 'Mat 2')] : []),
    ...(hasMat3 ? [materialRateIssue(mat3, mat3?.pricePerSqM, 'Mat 3')] : []),
    ...(includePrint ? [materialRateIssue(printProduct, printProduct?.pricePerSqM, 'Printing')] : []),
    ...(includeBacker ? [materialRateIssue(selectedBacker, selectedBacker?.pricePerSqM, 'Backing')] : []),
  ];
  let pricingIssue = catalogLoading || settingsLoading ? 'Catalogue and pricing settings are loading.'
    : catalogError || settingsError ? 'Could not load catalogue or pricing settings. Retry before creating a priced document.'
    : matRestoreIssue || geometry.issue || pricingSettingsIssue({ labourBase, marginMultiplier }) || materialIssues.find(Boolean) || supplierSelectionIssue;
  // Invalid selections have no commercial result. Never display or persist fabricated zero totals.
  const pricingSnapshot = (() => {
    if (pricingIssue) return null;
    try {
      return priceVisualiser({ artWcm, artHcm, borderCm: 0, geometry: { internalWidthCm: visibleWcm, internalHeightCm: visibleHcm }, frame: frameProfile,
        mats: [hasMat1 ? mat1 : null, hasMat2 ? mat2 : null, hasMat3 ? mat3 : null].filter(Boolean) as NonNullable<typeof mat1>[],
        glazing, print: includePrint ? printProduct : null, backer: includeBacker ? selectedBacker : null,
        labourBase, marginMultiplier, taxRatePct: effectiveTaxRatePct(catalog?.settings ?? {}),
        taxLabel: catalog?.settings?.taxLabel, currencyCode, currencySymbol });
    } catch {
      pricingIssue = 'Check dimensions, material rates, currency and tax settings before creating a priced document.';
      return null;
    }
  })();
  // Internal validation stays intact; never render its configuration diagnostics to customers.
  const customerPricingIssue = catalogLoading || settingsLoading ? 'Pricing is loading. Please wait.'
    : 'Pricing is unavailable for this selection. Please choose another material or ask a staff member.';
  const rawCost = (key: string) => pricingSnapshot?.items.find(item => item.key === key)?.rawAmount ?? 0;
  const frameCost = rawCost('frame');
  const glazingCost = rawCost('glazing');
  const mat1Cost = rawCost('mat1');
  const mat2Cost = rawCost('mat2');
  const mat3Cost = rawCost('mat3');
  const printingCost = rawCost('print');
  const backerCost = rawCost('backer');
  // Presentation consumes the engine's rounded selling lines; internal costs stay unchanged.
  const sellingAmount = (key: string) => pricingSnapshot?.items.find(item => item.key === key)?.lineTotal ?? 0;
  // The engine numbers only included mats; UI slots may contain gaps in a saved design.
  const sellingMatAmount = (slot: number) => sellingAmount(`mat${[hasMat1, hasMat2, hasMat3].slice(0, slot).filter(Boolean).length}`);
  const subtotal = pricingSnapshot?.subtotal;
  const total = pricingSnapshot?.total;

  // ---------- Responsive preview ----------
  const [maxPx, setMaxPx] = useState(760);
  const MAX_PREVIEW_PX = 1200;
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Keep a dataURL of the framed preview for the room mockup
  useEffect(() => {
    // If there's no artwork at all, clear the room preview too
    if (!artworkUrl && !openings.some(o => o.imageUrl)) {
      setRoomArtworkUrl("");
      return;
    }
    if (!previewRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const dataUrl = await htmlToImage.toPng(previewRef.current!, {
          cacheBust: true,
          filter: node => !(node instanceof Element && node.hasAttribute('data-html2canvas-ignore')),
        });
        if (!cancelled) {
          setRoomArtworkUrl(dataUrl);
        }
      } catch (err) {
        console.error(
          "[Visualizer] Failed to capture preview for room mockup",
          err
        );
        if (!cancelled) {
          setRoomArtworkUrl("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Include the things that visually change the frame/mats/openings
  }, [
    artworkUrl,
    selectedFrame,
    framePreviewColor,
    faceWidthCm,
    frameTextureUrl,
    useFrameTexture,
    textureScalePct,
    hasMat1,
    hasMat2,
    hasMat3,
    selectedMat1,
    selectedMat2,
    selectedMat3,
    borders,
    mode,
    openings,
    outerWcm,
    outerHcm,
  ]);

  // Pro-mode: per-opening image picker
  const [openingImageTargetId, setOpeningImageTargetId] =
    useState<string | null>(null);
  const openingImageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = previewHostRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth || el.getBoundingClientRect().width || 760;
      setMaxPx(
        Math.min(MAX_PREVIEW_PX, Math.max(1, Math.floor(w - 24)), Math.max(1, Math.floor(window.innerHeight * 0.7)))
      );
    };
    update();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => update());
      try {
        ro.observe(el);
      } catch {}
    } else {
      window.addEventListener("resize", update);
    }
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      if (ro)
        try {
          ro.disconnect();
        } catch {}
    };
  }, [previewHostRef]);

  const scale = useMemo(() => {
    const maxCm = Math.max(outerWcm, outerHcm);
    return maxCm <= 0 ? 1 : maxPx / maxCm;
  }, [outerWcm, outerHcm, maxPx]);

  const px = (cm: number) => Math.max(1, Math.round(cm * scale));

  const bevelThicknessPx = Math.max(1, Math.round(px(0.5)));

  const textureSizePx = `${Math.max(
    16,
    Math.round((px(faceWidthCm) * textureScalePct) / 100)
  )}px`;

  // ---------- Drag / Resize for pro openings ----------

  const [drag, setDrag] = useState<null | {
    kind: "move" | "resize";
    id: string;
    handle?: HandleKey;
    startX: number;
    startY: number;
    scale: number;
    layoutWidth: number;
    layoutHeight: number;
    originX: number;
    originY: number;
    ox?: number;
    oy?: number;
    ow?: number;
    oh?: number;
    shape?: OpeningShape;
  }>(null);

  useEffect(() => {
    if (!handleOpeningId) return;
    if (!openings.some(o => o.id === handleOpeningId)) {
      setHandleOpeningId(null); setHandlePhase('hidden'); return;
    }
    if (hoveredOpeningId || drag) return;
    const fade = window.setTimeout(() => setHandlePhase('fading'), 2500);
    const hide = window.setTimeout(() => setHandlePhase('hidden'), 2700);
    return () => { window.clearTimeout(fade); window.clearTimeout(hide); };
  }, [handleOpeningId, handleInteraction, hoveredOpeningId, drag, openings]);

  useEffect(() => {
    if (!drag) return;

    function onMove(e: MouseEvent) {
      const d = drag!;
      const dxPx = e.clientX - d.startX;
      const dyPx = e.clientY - d.startY;
      const dx = dxPx / d.scale;
      const dy = dyPx / d.scale;
      const maxX = d.originX + d.layoutWidth;
      const maxY = d.originY + d.layoutHeight;

      if (d.kind === "move") {
        const id = d.id;
        const baseW = d.ow ?? 0;
        const baseH = d.oh ?? 0;

        let x = (d.ox ?? 0) + dx;
        let y = (d.oy ?? 0) + dy;

        x = Math.max(d.originX, Math.min(x, maxX - baseW));
        y = Math.max(d.originY, Math.min(y, maxY - baseH));

        x = snapToGrid(x);
        y = snapToGrid(y);

        const centerX = x + baseW / 2;
        const centerY = y + baseH / 2;

        const snappedCenterX = snapWithMagnet(centerX, [d.originX + d.layoutWidth / 2]);
        const snappedCenterY = snapWithMagnet(centerY, [d.originY + d.layoutHeight / 2]);

        if (snappedCenterX !== centerX) {
          x = snappedCenterX - baseW / 2;
        }
        if (snappedCenterY !== centerY) {
          y = snappedCenterY - baseH / 2;
        }

        const leftTarget = d.originX;
        const rightTarget = maxX - baseW;
        const topTarget = d.originY;
        const bottomTarget = maxY - baseH;

        const snapLeft = snapWithMagnet(x, [leftTarget]);
        const snapRight = snapWithMagnet(x, [rightTarget]);
        if (
          snapLeft !== x &&
          Math.abs(snapLeft - x) <= Math.abs(snapRight - x)
        ) {
          x = snapLeft;
        } else if (snapRight !== x) {
          x = snapRight;
        }

        const snapTop = snapWithMagnet(y, [topTarget]);
        const snapBottom = snapWithMagnet(y, [bottomTarget]);
        if (
          snapTop !== y &&
          Math.abs(snapTop - y) <= Math.abs(snapBottom - y)
        ) {
          y = snapTop;
        } else if (snapBottom !== y) {
          y = snapBottom;
        }

        x = Math.max(d.originX, Math.min(x, maxX - baseW));
        y = Math.max(d.originY, Math.min(y, maxY - baseH));

        setOpenings((arr) =>
          arr.map((o) =>
            o.id === id ? { ...o, xCm: x, yCm: y } : o
          )
        );
      } else if (d.kind === "resize") {
        const id = d.id;
        const handle = d.handle!;
        const shape = d.shape!;
        setOpenings((arr) =>
          arr.map((o) => {
            if (o.id !== id) return o;

            let x = o.xCm;
            let y = o.yCm;
            let w = o.widthCm;
            let h = o.heightCm;

            const MIN_W_CM = 2;
            const MIN_H_CM = 2;

            if (handle.includes("e")) {
              w = Math.max(
                MIN_W_CM,
                Math.min((d.ow ?? 0) + dx, maxX - x)
              );
            }
            if (handle.includes("w")) {
              const newX = Math.max(
                d.originX,
                Math.min(maxX, (d.ox ?? 0) + dx)
              );
              const owCalc =
                (d.ow ?? 0) + (d.ox ?? 0) - newX;
              w = Math.max(
                MIN_W_CM,
                Math.min(owCalc, maxX - newX)
              );
              x = newX;
            }
            if (handle.includes("s")) {
              h = Math.max(
                MIN_H_CM,
                Math.min((d.oh ?? 0) + dy, maxY - y)
              );
            }
            if (handle.includes("n")) {
              const newY = Math.max(
                d.originY,
                Math.min(maxY, (d.oy ?? 0) + dy)
              );
              const ohCalc =
                (d.oh ?? 0) + (d.oy ?? 0) - newY;
              h = Math.max(
                MIN_H_CM,
                Math.min(ohCalc, maxY - newY)
              );
              y = newY;
            }

            if (shape === "circle") {
              const s = Math.max(MIN_W_CM, Math.max(w, h));
              w = s;
              h = s;
            } else if (shape === "oval") {
              const ratio = (d.ow ?? 1) / (d.oh ?? 1);
              if (ratio > 1.5) h = Math.max(h, w / 1.5);
              else if (ratio < 0.66) w = Math.max(w, h * 0.66);
            }

            x = snapToGrid(x);
            y = snapToGrid(y);
            w = snapToGrid(w);
            h = snapToGrid(h);

            x = Math.max(d.originX, Math.min(x, maxX - MIN_W_CM));
            y = Math.max(d.originY, Math.min(y, maxY - MIN_H_CM));
            w = Math.max(MIN_W_CM, Math.min(w, maxX - x));
            h = Math.max(MIN_H_CM, Math.min(h, maxY - y));

            if (shape === 'circle') {
              const diameter = Math.min(w, h, maxX - x, maxY - y);
              w = diameter; h = diameter;
            }
            return {
              ...o,
              xCm: x,
              yCm: y,
              widthCm: w,
              heightCm: h,
            };
          })
        );
      }
    }

    function onUp() {
      setDrag(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, scale, visibleWcm, visibleHcm]);

  const startMove = (e: React.MouseEvent, o: MatOpening) => {
    e.preventDefault();
    setSelectedOpeningId(o.id);
    revealHandles(o.id);
    setDrag({
      kind: "move",
      id: o.id,
      startX: e.clientX,
      startY: e.clientY,
      scale, layoutWidth, layoutHeight, originX: origin.x, originY: origin.y,
      ox: o.xCm,
      oy: o.yCm,
      ow: o.widthCm,
      oh: o.heightCm,
    });
  };

  const startResize = (
    e: React.MouseEvent,
    o: MatOpening,
    handle: HandleKey
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedOpeningId(o.id);
    revealHandles(o.id);
    setDrag({
      kind: "resize",
      id: o.id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      scale, layoutWidth, layoutHeight, originX: origin.x, originY: origin.y,
      shape: o.shape,
      ox: o.xCm,
      oy: o.yCm,
      ow: o.widthCm,
      oh: o.heightCm,
    });
  };


  // ---------- Customer panel ----------
  const [selectedCustomerId, setSelectedCustomerId] =
    useState<string>("__new__");
  // Only individual actions opt into these guards; the combined workflow is unchanged.
  const feedbackScope = useRef({ companyId: billing.companyAccountId, userId: billing.userId, customerId: selectedCustomerId });
  if (feedbackScope.current.companyId !== billing.companyAccountId ||
      feedbackScope.current.userId !== billing.userId || feedbackScope.current.customerId !== selectedCustomerId) {
    feedbackScope.current = { companyId: billing.companyAccountId, userId: billing.userId, customerId: selectedCustomerId };
  }
  const feedbackMounted = useRef(false);
  useEffect(() => {
    feedbackMounted.current = true;
    return () => { feedbackMounted.current = false; };
  }, []);
  type IndividualAction = "crm" | "quote" | "job" | "invoice";
  const pendingActionsRef = useRef(new Set<IndividualAction>());
  const [pendingActions, setPendingActions] = useState<Partial<Record<IndividualAction, boolean>>>({});
  const runIndividual = async (action: IndividualAction, work: (feedback: IndividualFeedback) => Promise<void>) => {
    if (pendingActionsRef.current.has(action)) return;
    pendingActionsRef.current.add(action);
    setPendingActions(previous => ({ ...previous, [action]: true }));
    let scope = feedbackScope.current;
    const route = window.location.hash;
    const isCurrent = () => feedbackMounted.current && feedbackScope.current === scope && window.location.hash === route;
    const feedback: IndividualFeedback = {
      isCurrent,
      selectCustomer(id) {
        if (!isCurrent()) return;
        // Adopt our own confirmed customer selection, but invalidate other pending contexts.
        if (scope.customerId !== id) {
          scope = { ...scope, customerId: id };
          feedbackScope.current = scope;
        }
        setSelectedCustomerId(id);
      },
      notify(message, type) { if (isCurrent()) toast(message, type); },
      fail(message) {
        const records = action === "crm" ? "Customers" : `Customers and ${action === "quote" ? "Quotes" : action === "job" ? "Jobs" : "Invoices"}`;
        if (isCurrent()) toast(`${message} A record may already have been saved. Check ${records} before retrying.`, "error", 0);
      },
    };
    try {
      await work(feedback);
    } catch (error) {
      feedback.fail(error instanceof Error ? error.message : "Could not confirm the save outcome.");
    } finally {
      pendingActionsRef.current.delete(action);
      if (feedbackMounted.current) setPendingActions(previous => ({ ...previous, [action]: false }));
    }
  };
  const [cust, setCust] = useState({
    firstName: "",
    lastName: "",
    company: "",
    email: "",
    phone: "",
    address1: "",
    address2: "",
    city: "",
    postcode: "",
    country: "",
    notes: "",
  });

  // ---------- Backdrop ----------
  type Backdrop = "studio" | "living" | "gallery" | "office";

  const [backdrop, setBackdrop] = useState<Backdrop>("studio");

  const sortedCustomers = useMemo(() => {
    const arr = [...(customers || [])] as any[];
    return arr.sort((a, b) =>
      `${a.firstName ?? ""} ${a.lastName ?? ""}`.localeCompare(
        `${b.firstName ?? ""} ${b.lastName ?? ""}`
      )
    );
  }, [customers]);

  useEffect(() => {
    if (!selectedCustomerId || selectedCustomerId === "__new__") {
      setCust({
        firstName: "",
        lastName: "",
        company: "",
        email: "",
        phone: "",
        address1: "",
        address2: "",
        city: "",
        postcode: "",
        country: "",
        notes: "",
      });
      return;
    }
    const c: any = sortedCustomers.find(
      (x) => x.id === selectedCustomerId
    );
    if (c) {
      setCust({
        firstName: c.firstName || "",
        lastName: c.lastName || "",
        company: c.company || "",
        email: c.email || "",
        phone: c.phone || "",
        address1: c.address1 || "",
        address2: c.address2 || "",
        city: c.city || "",
        postcode: c.postcode || c.postalCode || "",
        country: c.country || "",
        notes: c.notes || "",
      });
    }
  }, [selectedCustomerId, sortedCustomers]);

  async function ensureCustomerId(feedback?: IndividualFeedback): Promise<string> {
    if (selectedCustomerId && selectedCustomerId !== "__new__")
      return selectedCustomerId;
    const hasCore = !!(
      cust.firstName?.trim() ||
      cust.lastName?.trim() ||
      cust.email?.trim()
    );
    if (!hasCore) return "";
    const result = await addCustomer?.({ ...cust, id: "" } as any);
    if (!result || result.ok === false) return "";
    if (feedback) feedback.selectCustomer(result.customer.id);
    else setSelectedCustomerId(result.customer.id);
    return result.customer.id;
  }

  // FileReader may finish after a mode/layout change; initialize from the current design.
  const proLayoutRef = useRef({ mode, openings, artWcm, artHcm, totalBorder, topBorder: geometry.total.top });
  proLayoutRef.current = { mode, openings, artWcm, artHcm, totalBorder, topBorder: geometry.total.top };

  // Seed only an empty Pro layout from the explicitly uploaded Basic artwork.
  // Never resolve an existing opening's image from the main artwork as a fallback.
  function initializeProOpening(imageUrl: string) {
    const layout = proLayoutRef.current;
    if (!imageUrl || layout.openings.length) return;
    setProOrigin({ x: layout.totalBorder, y: layout.topBorder });
    const opening: MatOpening = { id: rid(), shape: 'rect', xCm: layout.totalBorder, yCm: layout.topBorder,
      widthCm: layout.artWcm, heightCm: layout.artHcm, imageUrl };
    setOpenings(current => current.length ? current : [opening]);
  }

  function changeMatMode(next: 'basic' | 'pro') {
    if (next === 'pro') {
      if (!proOrigin) setProOrigin({ x: geometry.total.left, y: geometry.total.top });
      initializeProOpening(artworkUrl);
    }
    setMode(next);
  }

  // ---------- Image upload ----------
  function onPickImage(file?: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = String(reader.result || "");
      setArtworkUrl(imageUrl);
      if (proLayoutRef.current.mode === 'pro') initializeProOpening(imageUrl);
    };
    reader.readAsDataURL(file);
  }

  // Pro-mode opening image helpers
  function requestOpeningImage(id: string) {
    setOpeningImageTargetId(id);
    openingImageInputRef.current?.click();
  }

  function handleOpeningImageSelected(file?: File | null) {
    if (!file || !openingImageTargetId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      setOpenings((arr) =>
        arr.map((o) =>
          o.id === openingImageTargetId ? { ...o, imageUrl: url } : o
        )
      );
      setOpeningImageTargetId(null);
    };
    reader.readAsDataURL(file);
  }

  // ---------- Actions: CRM / Quotes / Jobs / Invoice ----------
  async function saveToCRM(feedback: IndividualFeedback) {
    if (!selectedCustomerId || selectedCustomerId === "__new__") {
      const result = await addCustomer?.({ ...cust, id: "" } as any);
      if (result?.ok !== true || !result.customer?.id) {
        feedback.fail(result?.ok === false ? result.error : "Could not confirm customer creation.");
        return;
      }
      feedback.selectCustomer(result.customer.id);
      feedback.notify("Saved to CRM (created).", "success");
    } else {
      const result = await updateCustomer?.({
        id: selectedCustomerId,
        ...cust,
      } as any);
      if (result?.ok !== true || !result.customer?.id) {
        feedback.fail(result?.ok === false ? result.error : "Could not confirm customer update.");
        return;
      }
      feedback.notify("Saved to CRM (updated).", "success");
    }
  }

  async function addQuoteNow(feedback?: IndividualFeedback) {
    if (!guardSupplierSelection(feedback)) return;
    let customerObj: Customer;
    try {
      customerObj = await resolveQuoteCustomer(feedback);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not resolve the customer. No quote was created.";
      if (feedback) feedback.fail(message);
      else toast(message, "error");
      return;
    }
    if (feedback && !feedback.isCurrent()) return;
    const customerId = customerObj.id;

    const commercial = toVisualiserQuote(pricingSnapshot);
    const jobSpecification = jobForDesign(customerId, customerObj);

    const existingInStore = (qStore?.quotes ?? qStore?.items ?? []) as any[];
    const existingInLS = readQuotesFromAnyLS();
    const allExisting = [...existingInStore, ...existingInLS];

    const prefix: string = "Q-";
    const pad: number = 3;
    const start: number = 1;

    let maxN = 0;
    for (const q of allExisting) {
      const raw =
        q?.number ??
        q?.quoteNo ??
        q?.quoteNumber ??
        q?.id ??
        "";
      const m = String(raw).match(/(\d+)\s*$/);
      if (m && m[1]) {
        const v = Number(m[1]);
        if (Number.isFinite(v)) maxN = Math.max(maxN, v);
      }
    }
    const nextN = Math.max(start, maxN + 1);
    const displayNumber = `${prefix}${String(nextN).padStart(
      Math.max(0, pad),
      "0"
    )}`;

    const payload = {
      id: `q_${Date.now()}`,
      number: displayNumber,
      status: "Draft",
      createdAt: new Date().toISOString(),
      customerId: customerId || null,
      customerName:
        (customerObj &&
          (`${customerObj.firstName ?? ""} ${
            customerObj.lastName ?? ""
          }`.trim() ||
            customerObj.company ||
            customerObj.email)) ||
        undefined,

      ...commercial,
      jobSpecification,
      customerSnapshot: jobSpecification.customerSnapshot,
    };

    const wroteStore = await qStore?.add?.(payload);

    if (feedback) {
      if (wroteStore?.ok !== true || !wroteStore.quote?.id) {
        feedback.fail(wroteStore?.error || "Could not confirm quote creation.");
      } else {
        feedback.notify(`Quote ${payload.number} created.`, "success");
      }
      return;
    }
    if (!wroteStore || wroteStore.ok === false) {
      alert(wroteStore?.error || "Could not save quote. See console for details.");
      return;
    }

    try {
      console.debug("Quote saved:", payload.number, { id: wroteStore.quote.id });
    } catch {}
    alert(`Quote ${payload.number} created.`);
  }

  async function resolveQuoteCustomer(feedback?: IndividualFeedback): Promise<Customer> {
    let customer: Customer;
    if (selectedCustomerId && selectedCustomerId !== "__new__") {
      const selected = customers.find((row) => row.id === selectedCustomerId);
      if (!selected) throw new Error("The selected customer is unavailable. Select an existing customer again before creating a quote.");
      customer = selected;
    } else {
      const errors = validateCustomer({ ...cust, id: "" });
      if (errors.length) throw new Error(`Select an existing customer or complete valid new customer details: ${errors.join(". ")}`);
      const result = await addCustomer({ ...cust, id: "" });
      if (result.ok === false) throw new Error(result.error || "Could not save the customer. No quote was created.");
      customer = result.customer;
    }
    if (!customer?.id?.trim() || customer.id === "__new__" || validateCustomer(customer).length) {
      throw new Error("Could not resolve valid saved customer details. No quote was created.");
    }
    if (feedback) feedback.selectCustomer(customer.id);
    else setSelectedCustomerId(customer.id);
    return customer;
  }

  function jobForDesign(customerId: string | null, resolvedCustomer?: Customer) {
    const frameName = frameProfile?.name || selectedFrame || "Frame";
    const mat1Name = hasMat1 ? mat1?.name || selectedMat1 : "";
    const mat2Name = hasMat2 ? mat2?.name || selectedMat2 : "";
    const mat3Name = hasMat3 ? mat3?.name || selectedMat3 : "";
    const glazingName =
      glazing?.name || selectedGlazingId || "Glazing";

    const customerObj = resolvedCustomer || (customerId
      ? (customers || []).find((c: any) => c.id === customerId)
      : undefined);
    const customerSnapshot = customerObj
      ? {
          id: customerObj.id,
          firstName: customerObj.firstName || "",
          lastName: customerObj.lastName || "",
          company: customerObj.company || "",
          email: customerObj.email || "",
          phone: customerObj.phone || "",
        }
      : cust.firstName || cust.lastName || cust.email
      ? {
          id: "",
          firstName: cust.firstName || "",
          lastName: cust.lastName || "",
          company: cust.company || "",
          email: cust.email || "",
          phone: cust.phone || "",
        }
      : undefined;

    const dimsNested = {
      unit,
      art: { widthCm: Number(artWcm), heightCm: Number(artHcm) },
      visible: {
        widthCm: Number(visibleWcm),
        heightCm: Number(visibleHcm),
      },
      external: { widthCm: outerWcm, heightCm: outerHcm },
      frameFaceWidthCm: Number(faceWidthCm),
    };

    const commercial = toVisualiserJobCosts(pricingSnapshot);

    const detailsSnapshot = {
      artworkUrl,
      dims: dimsNested,
      mats: {
        geometryVersion: MAT_GEOMETRY_VERSION,
        borders: borders.map(b => ({ ...b })),
        proOrigin,
        hasMat1,
        hasMat2,
        hasMat3,
        mat1: hasMat1
          ? {
              id: selectedMat1,
              name: mat1Name,
              borders: { ...borders[0] },
            }
          : null,
        mat2: hasMat2
          ? {
              id: selectedMat2,
              name: mat2Name,
              borders: { ...borders[1] },
            }
          : null,
        mat3: hasMat3
          ? {
              id: selectedMat3,
              name: mat3Name,
              borders: { ...borders[2] },
            }
          : null,
        openings: mode === "pro" ? openings : [],
        mode,
      },
      frame: {
        id: selectedFrame,
        name: frameName,
        faceWidthCm: Number(faceWidthCm),
        previewColor: framePreviewColor || undefined,
        textureUrl: frameTextureUrl || undefined,
      },
      glazing: { id: selectedGlazingId || "", name: glazingName },
      printing: includePrint
        ? {
            include: true,
            materialId: selectedPM?.id || "",
            materialName: selectedPM?.name || "",
          }
        : { include: false },
      backer: includeBacker ? { include: true, materialId: selectedBacker.id, materialName: selectedBacker.name } : { include: false },
      costs: {
        ...commercial,
        currency: { code: currencyCode, symbol: currencySymbol },
      },
      internalCosts: { frameCost, glazingCost, mat1Cost, mat2Cost, mat3Cost, printingCost, backerCost, labourBase },
      pricingSnapshot,
    };

    const flatForJobs = {
      customer: customerSnapshot || {},
      artwork: {
        imageUrl: artworkUrl,
        widthCm: Number(artWcm),
        heightCm: Number(artHcm),
        visibleWidthCm: Number(visibleWcm),
        visibleHeightCm: Number(visibleHcm),
      },
      frame: {
        id: selectedFrame,
        name: frameName,
        faceWidthCm: Number(faceWidthCm),
        previewColor: framePreviewColor || undefined,
        textureUrl: frameTextureUrl || undefined,
      },
      glazing: { id: selectedGlazingId || "", name: glazingName },
      mats: {
        geometryVersion: MAT_GEOMETRY_VERSION,
        borders: borders.map(b => ({ ...b })),
        proOrigin,
        hasMat1,
        hasMat2,
        hasMat3,
        mat1: hasMat1
          ? {
              id: selectedMat1,
              name: mat1Name,
              borders: { ...borders[0] },
            }
          : null,
        mat2: hasMat2
          ? {
              id: selectedMat2,
              name: mat2Name,
              borders: { ...borders[1] },
            }
          : null,
        mat3: hasMat3
          ? {
              id: selectedMat3,
              name: mat3Name,
              borders: { ...borders[2] },
            }
          : null,
        mode,
        openings: mode === "pro" ? openings : [],
      },
      dims: {
        unit,
        artWcm: Number(artWcm),
        artHcm: Number(artHcm),
        visWcm: Number(visibleWcm),
        visHcm: Number(visibleHcm),
        faceWcm: Number(faceWidthCm),
      },
      costs: {
        ...commercial,
        currency: { code: currencyCode, symbol: currencySymbol },
      },
    };

    const job = {
      description: `Framing job — ${frameName}`,
      status: "new",
      priority: "normal",
      subtotal: pricingSnapshot.subtotal,
      total: pricingSnapshot.total,
      taxRate: pricingSnapshot.taxRate,
      pricingSnapshot,
      currency: { code: currencyCode, symbol: currencySymbol },
      customerId: customerId || undefined,
      customerSnapshot,
      details: detailsSnapshot,
      detailsJson: JSON.stringify(detailsSnapshot),
      ...flatForJobs,
      checklist: makeJobChecklist(),
    };

    return job;
  }

  async function addJobNow(feedback?: IndividualFeedback) {
    if (!guardSupplierSelection(feedback)) return;
    const customerId = await ensureCustomerId(feedback);
    if (feedback && !feedback.isCurrent()) return;
    const job = jobForDesign(customerId);
    try {
      const result = await addJob(job as any);
      if (feedback) {
        if (result?.ok !== true || !result.job?.id) feedback.fail(result?.error || "Could not confirm job creation.");
        else feedback.notify(`Job ${result.job.refNo ?? result.job.id} created and added to Jobs.`, "success");
        return;
      }
      if (!result?.ok) {
        alert(result?.error || "Job could not be saved.");
        return;
      }
      alert(`Job ${result.job.refNo ?? result.job.id} created and added to Jobs.`);
    } catch (err) {
      if (feedback) throw err;
      console.error(err);
      alert("Failed to save job. See console for details.");
    }
  }

  async function invoiceNow(feedback?: IndividualFeedback) {
    if (!guardSupplierSelection(feedback)) return;
    const customerId = await ensureCustomerId(feedback);
    if (feedback && !feedback.isCurrent()) return;

    const todayISO = new Date().toISOString();

    const commercial = toVisualiserInvoice(pricingSnapshot);
    const invoiceObj = {
      customerId: customerId || undefined,
      dateISO: todayISO,
      dueDateISO: undefined,
      ...commercial,
      currency: { code: currencyCode, symbol: currencySymbol },

      notes: "",
      payments: [],
      createdAt: todayISO,

      details: {
        costs: {
          subtotal: commercial.subtotal,
          taxRate: commercial.taxRate,
          tax: commercial.tax,
          total: commercial.total,
          currency: { code: currencyCode, symbol: currencySymbol },
        },
      },
    };

    try {
      const result = await addInvoice(invoiceObj as any);
      if (feedback) {
        if (result?.ok !== true || !result.invoice?.id) feedback.fail(result?.error || "Could not confirm invoice creation.");
        else if (feedback.isCurrent()) window.location.hash = `#/invoices?id=${encodeURIComponent(result.invoice.id)}`;
        return;
      }
      if (!result?.ok) {
        alert(result?.error || "Invoice could not be saved.");
        return;
      }

      window.location.hash = `#/invoices?id=${encodeURIComponent(result.invoice.id)}`;
    } catch (err) {
      if (feedback) throw err;
      console.error(err);
      alert(
        "Invoice creation failed. See console for details."
      );
    }
  }

  async function handleCreateQuoteInvoiceJob() {
    if (!guardSupplierSelection()) return;
    try {
      await addQuoteNow();
      await addJobNow();
      await invoiceNow();
    } catch (e) {
      console.error("Failed to create Quote + Invoice + Job", e);
      alert(
        "Could not create Quote + Invoice + Job. Please check the console for details."
      );
    }
  }



  // ---------- Presets ----------
  const customerKey =
    selectedCustomerId && selectedCustomerId !== "__new__"
      ? selectedCustomerId
      : "anonymous";

  const currentState = {
      unit,
      sizeMode,
      art: { widthCm: artWcm, heightCm: artHcm, imageUrl: artworkUrl },
      frame: {
        id: selectedFrame,
        faceAuto,
        faceWidthCm,
        previewColor: framePreviewColor,
        textureUrl: frameTextureUrl,
        useFrameTexture,
        textureScalePct,
      },
      mats: {
        selectedMat1,
        selectedMat2,
        selectedMat3,
        geometryVersion: MAT_GEOMETRY_VERSION,
        borders: borders.map(b => ({ ...b })),
        proOrigin,
        openings,
        mode,
      },
      glazing: { id: selectedGlazingId },
      printing: { includePrint, printMaterialId },
      backer: { includeBacker, materialId: backerMaterialId },
      backdrop,
    };

  function applyPreset(p: VisualizerPreset) {
    try {
      const s = (p.state as any) || {};
      setUnit(s.unit === "imperial" ? "imperial" : "metric");
      setSizeMode(s.sizeMode === "frame" ? "frame" : "image");
      setArtWcm(Number(s?.art?.widthCm) || 40);
      setArtHcm(Number(s?.art?.heightCm) || 30);
      setArtworkUrl(String(s?.art?.imageUrl || ""));
      setSelectedFrame(String(s?.frame?.id || defaultFrameId));
      setFaceAuto(Boolean(s?.frame?.faceAuto));
      if (
        !Boolean(s?.frame?.faceAuto) &&
        Number.isFinite(s?.frame?.faceWidthCm)
      ) {
        setFaceWidthCm(Number(s?.frame?.faceWidthCm));
      }
      setUseFrameTexture(Boolean(s?.frame?.useFrameTexture));
      if (Number.isFinite(s?.frame?.textureScalePct)) {
        setTextureScalePct(Number(s.frame.textureScalePct));
      }

      setSelectedMat1(String(s?.mats?.selectedMat1 || "mat0"));
      setSelectedMat2(String(s?.mats?.selectedMat2 || "mat0"));
      setSelectedMat3(String(s?.mats?.selectedMat3 || "mat0"));
      const active = [s?.mats?.selectedMat1, s?.mats?.selectedMat2, s?.mats?.selectedMat3].map(id => !!id && id !== 'mat0');
      const restored = restoreMatBorders(s?.mats, active);
      setBorders(restored.borders);
      setMatRestoreIssue(restored.issue);
      const restoredGeometry = matGeometry(Number(s?.art?.widthCm) || 40, Number(s?.art?.heightCm) || 30, 0, restored.borders, active);
      setProOrigin(s?.mats?.proOrigin && Number.isFinite(s.mats.proOrigin.x) && Number.isFinite(s.mats.proOrigin.y)
        ? s.mats.proOrigin : { x: restoredGeometry.total.left, y: restoredGeometry.total.top });
      setDrag(null); setSelectedOpeningId(null); setHoveredOpeningId(null); setHandleOpeningId(null); setHandlePhase('hidden');
      setOpenings(
        Array.isArray(s?.mats?.openings) ? s.mats.openings : []
      );
      setMode(s?.mats?.mode === "pro" ? "pro" : "basic");

      setShowMat2(
        Boolean(
          s?.mats?.selectedMat2 && s.mats.selectedMat2 !== "mat0"
        )
      );
      setShowMat3(
        Boolean(
          s?.mats?.selectedMat3 && s.mats.selectedMat3 !== "mat0"
        )
      );

      if (s?.glazing?.id)
        setSelectedGlazingId(String(s.glazing.id));
      setIncludePrint(Boolean(s?.printing?.includePrint));
      setPrintMaterialId(
        String(s?.printing?.printMaterialId || "")
      ); // note: we store id here
      setIncludeBacker(Boolean(s?.backer?.includeBacker));
      setBackerMaterialId(typeof s?.backer?.materialId === 'string' ? s.backer.materialId : '__legacy_foam__');
      setBackdrop(
        (
          ["studio", "living", "gallery", "office"] as const
        ).includes(s?.backdrop)
          ? s.backdrop
          : "studio"
      );
    } catch (e) {
      console.error("Failed to apply preset", e);
      toast("Could not apply this preset. It may be from an older version.", "error");
    }
  }

  // ---------- Export menu ----------
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const exportPendingRef = useRef(false);
  const [exportPending, setExportPending] = useState(false);

  const runExport = async (format: "PNG" | "JPG" | "PDF") => {
    setExportMenuOpen(false);
    if (exportPendingRef.current) return;
    const node = previewRef.current;
    if (!node) {
      toast("The preview is not ready. Wait for the preview and its images to load, then try again.", "error");
      return;
    }
    exportPendingRef.current = true;
    setExportPending(true);
    const scope = feedbackScope.current;
    const route = window.location.hash;
    const isCurrent = () => feedbackMounted.current && feedbackScope.current === scope && window.location.hash === route;
    try {
      const exporter = format === "PNG" ? exportNodeAsPng : format === "JPG" ? exportNodeAsJpeg : exportNodeAsPdf;
      await exporter(node);
      if (isCurrent()) toast(`${format} download requested. Check your browser's downloads.`, "success");
    } catch {
      if (isCurrent()) toast(`Could not confirm the ${format} download request. Check that the preview and its images have loaded. Check your browser's downloads before retrying.`, "error", 0);
    } finally {
      exportPendingRef.current = false;
      if (feedbackMounted.current) setExportPending(false);
    }
  };

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handle = (e: MouseEvent) => {
      const el = exportMenuRef.current;
      if (el && !el.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handle);
    return () => window.removeEventListener("mousedown", handle);
  }, [exportMenuOpen]);

  // ---------- Colours for mats ----------
      const matColor = (m: any): string => {
      if (!m) return "#EEE";

      const raw =
        (m as any).colour ??
        (m as any).color ??
        "";

      if (raw === "transparent") return "#EEE";
      return raw || "#EEE";
    };

  const mat1Color = matColor(mat1);
  const mat2Color = matColor(mat2);
  const mat3Color = matColor(mat3);

  // Basic and Pro share physical board dimensions and nested aperture distances.
  const matMaskId = React.useId().replace(/:/g, '');
  const displayedOpenings = mode === 'pro' ? openings.map(o => ({ ...o, xCm: o.xCm + proOffset.x, yCm: o.yCm + proOffset.y }))
    : [{ id: 'basic', shape: 'rect' as OpeningShape, xCm: geometry.total.left, yCm: geometry.total.top, widthCm: artWcm, heightCm: artHcm }];
  const matLayers = <svg data-testid="mat-layers" aria-hidden="true" viewBox={`0 0 ${visibleWcm} ${visibleHcm}`}
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
    {[...geometry.layers].reverse().map(layer => {
      const id = `${matMaskId}-${layer.slot}`;
      return <g key={layer.slot} data-mat-layer={layer.slot + 1}>
        <defs><mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={visibleWcm} height={visibleHcm}>
          <rect width={visibleWcm} height={visibleHcm} fill="white" />
          {displayedOpenings.map(o => {
            const x = o.xCm - (geometry.total.left - layer.borders.left);
            const y = o.yCm - (geometry.total.top - layer.borders.top);
            const width = o.widthCm + geometry.total.left + geometry.total.right - layer.borders.left - layer.borders.right;
            const height = o.heightCm + geometry.total.top + geometry.total.bottom - layer.borders.top - layer.borders.bottom;
            return o.shape === 'rect' ? <rect key={o.id} x={x} y={y} width={width} height={height} fill="black" />
              : <ellipse key={o.id} cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill="black" />;
          })}
        </mask></defs>
        <rect width={visibleWcm} height={visibleHcm} fill={[mat1Color, mat2Color, mat3Color][layer.slot]} mask={`url(#${id})`} />
      </g>;
    })}
  </svg>;
  const basicMatMarkup = <div data-opening-x={geometry.total.left} style={{ position: 'absolute', left: geometry.total.left * scale,
    top: geometry.total.top * scale, width: artWcm * scale, height: artHcm * scale, background: '#fff', overflow: 'hidden' }}>
    {artworkUrl ? <img src={artworkUrl} alt="artwork" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      : <div className="flex items-center justify-center h-full"><span className="text-neutral-700 text-sm">Upload an image to preview</span></div>}
  </div>;

  // ---------- RENDER ----------
  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-emerald-50/40 to-slate-50">
      <main
        className={`${containerClass} p-4 grid gap-4 
            lg:grid-cols-[320px_1fr_320px] 
            xl:grid-cols-[360px_1fr_360px]`}
      >
        {/* LEFT */}
        <section className="space-y-3">
          {/* Artwork / Image */}
          <Panel title="Artwork / Image">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex flex-col">
                <span className="text-xs text-slate-600 mb-1">
                  Measurement mode
                </span>
                <div className="flex gap-3 text-xs">
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      className="h-3 w-3"
                      checked={sizeMode === "image"}
                      onChange={() => setSizeMode("image")}
                    />
                    Image size
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      className="h-3 w-3"
                      checked={sizeMode === "frame"}
                      onChange={() => setSizeMode("frame")}
                    />
                    Frame size
                  </label>
                </div>
              </div>
              <div>
                <span className="block text-xs text-slate-600 mb-1">
                  Units
                </span>
                <select
                  className="rounded border p-1 text-xs bg-white"
                  value={unit}
                  onChange={(e) =>
                    setUnit(e.target.value as "metric" | "imperial")
                  }
                >
                  <option value="metric">cm</option>
                  <option value="imperial">inches</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(["width", "height"] as const).map((axis) => {
                const isWidth = axis === "width";
                const labelText = isWidth ? "Width" : "Height";

                const helperText =
                  sizeMode === "image"
                    ? "Measured edge-to-edge of the image."
                    : "Overall outside of frame including mats & face.";

                const dimCm =
                  sizeMode === "image"
                    ? isWidth
                      ? artWcm
                      : artHcm
                    : isWidth
                    ? outerWcm
                    : outerHcm;

                const dimDisplay =
                  unit === "imperial"
                    ? cmToIn(dimCm).toFixed(2)
                    : dimCm.toFixed(1);

                const keySeed = dimCm;

                return (
                  <div key={axis}>
                    <label className="block text-sm font-medium text-slate-700">
                      {labelText} ({unit === "imperial" ? "in" : "cm"})
                    </label>
                    <input
                      key={`dim-${axis}-${unit}-${sizeMode}-${Math.round(
                        keySeed * 10
                      )}`}
                      type="number"
                      step="0.1"
                      defaultValue={dimDisplay}
                      onBlur={(e) =>
                        handleDimensionChange(axis, e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const val = (
                            e.target as HTMLInputElement
                          ).value;
                          handleDimensionChange(axis, val);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="w-full rounded-lg border p-2 text-sm bg-white/90"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {helperText}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <label
                htmlFor="artUpload"
                className="cursor-pointer rounded-lg border border-emerald-300 px-3 py-2 text-sm hover:bg-emerald-600 hover:text-white transition"
              >
                Upload image
              </label>
              <input
                id="artUpload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) =>
                  onPickImage(e.target.files?.[0] || null)
                }
              />
              {artworkUrl && (
                <>
                  <button
                    type="button"
                    onClick={() => setArtworkUrl("")}
                    className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-900 hover:text-white"
                  >
                    Clear
                  </button>
                  <img
                    src={artworkUrl}
                    alt="art-thumb"
                    className="h-9 w-9 rounded border object-cover"
                  />
                </>
              )}
            </div>
          </Panel>

          {supplierSelectionIssue && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
              {customerPricingIssue}
            </div>
          )}
          {/* Frame Profile */}
          <Panel title="Frame Profile">
            <div className="grid gap-2">
              <label className="block text-sm font-medium text-slate-700">
                Frame
              </label>
              <select
                className="w-full rounded-lg border p-2 bg-white text-sm"
                value={selectedFrame}
                onChange={(e) => setSelectedFrame(e.target.value)}
              >
                {selectedFrame.startsWith('supplier:') &&
                  <option value={selectedFrame} disabled>Unavailable frame — select a material</option>}
                {selectedFrame && !frameProfile && !selectedFrame.startsWith('supplier:') &&
                  <option value={selectedFrame} disabled>Unavailable frame — select a material</option>}
                {(catalog?.frames || []).filter(f => !f.id.startsWith('supplier:')).map((f: any) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>

              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={faceAuto}
                    onChange={(e) =>
                      setFaceAuto(e.target.checked)
                    }
                  />
                  Auto face width from profile
                </label>
              </div>

              <label className="block text-sm font-medium text-slate-700 mt-2">
                Face width (cm)
              </label>
              <input
                type="number"
                step="0.1"
                value={faceWidthCm}
                onChange={(e) =>
                  setFaceWidthCm(parseFloat(e.target.value))
                }
                className="w-full rounded-lg border p-2 text-sm bg-white/90 disabled:opacity-60"
                disabled={faceAuto}
              />

              {frameTextureUrl ? (
                <div className="mt-2 grid gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={useFrameTexture}
                      onChange={(e) =>
                        setUseFrameTexture(e.target.checked)
                      }
                    />
                    Use wood texture
                  </label>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">
                      Texture scale
                    </label>
                    <input
                      type="range"
                      min={50}
                      max={300}
                      step={10}
                      value={textureScalePct}
                      onChange={(e) =>
                        setTextureScalePct(
                          parseInt(
                            e.target.value || "100",
                            10
                          )
                        )
                      }
                      className="w-full"
                    />
                    <div className="text-xs text-slate-500 mt-0.5">
                      {textureScalePct}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 mt-1">
                  No texture for this profile.
                </div>
              )}
            </div>
          </Panel>

          {/* Mat & Backer */}
          <Panel title="Mat & Backer">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-slate-600">
                Mode
              </span>
              <select
                className="rounded border p-1 text-xs bg-white"
                value={mode}
                onChange={(e) =>
                  changeMatMode(e.target.value as "basic" | "pro")
                }
              >
                <option value="basic">Basic</option>
                <option value="pro">Pro (multi-opening)</option>
              </select>
            </div>

            {(matRestoreIssue || geometry.issue) && <p role="status" className="text-sm text-amber-800">{matRestoreIssue || geometry.issue}</p>}
            {legacyLayoutIssue && <p role="status" className="text-sm text-amber-800">This saved layout has openings in its border area. Positions are preserved; review the layout before changing its measurements.</p>}
            <p className="text-xs text-slate-500">Each side is incremental: Mat 1 is relative to the artwork/layout opening; Mat 2 is relative to Mat 1’s inner edge; Mat 3 is relative to Mat 2’s inner edge. Enabled contributions are added on each side.</p>
            {/* Mat 1 */}
            <div className="grid gap-2">
              <label className="block text-sm font-medium text-slate-700">
                Mat 1 (top)
              </label>
              <select
                className="w-full rounded-lg border p-2 bg-white text-sm"
                value={selectedMat1}
                onChange={(e) => setSelectedMat1(e.target.value)}
              >
                {hasMat1 && (!mat1 || selectedMat1.startsWith('supplier:')) && <option value={selectedMat1} disabled>Unavailable mat — select a material</option>}
                <option value="mat0">None</option>
                {(catalog?.mats || []).filter(m => !m.id.startsWith('supplier:')).map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              {hasMat1 && (
                <div className="grid grid-cols-2 gap-2">
                  {matSides.map(side => <BorderInput key={side} label={`Mat 1 ${side[0].toUpperCase() + side.slice(1)} (cm)`}
                    value={borders[0][side]} onChange={value => handleMatBorderChange(0, side, value)} />)}
                  </div>
              )}
            </div>

            {/* Mat 2 trigger */}
            {!showMat2 && (
              <button
                type="button"
                className="mt-3 rounded-lg border border-dashed border-emerald-300 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-600 hover:text-white transition"
                onClick={() => setShowMat2(true)}
              >
                + Add second mat
              </button>
            )}

            {/* Mat 2 */}
            {showMat2 && (
              <div className="mt-3 border-t border-slate-200 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-slate-700">
                    Mat 2 (under)
                  </label>
                  {!hasMat2 && (
                    <span className="text-[11px] text-slate-500">
                      Choose a mat colour
                    </span>
                  )}
                </div>

                <select
                  className="w-full rounded-lg border p-2 bg-white text-sm"
                  value={selectedMat2}
                  onChange={(e) =>
                    setSelectedMat2(e.target.value)
                  }
                >
                  {hasMat2 && (!mat2 || selectedMat2.startsWith('supplier:')) && <option value={selectedMat2} disabled>Unavailable mat — select a material</option>}
                  <option value="mat0">None</option>
                  {(catalog?.mats || []).filter(m => !m.id.startsWith('supplier:')).map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {hasMat2 && (
                  <div className="grid grid-cols-2 gap-2">
                  {matSides.map(side => <BorderInput key={side} label={`Mat 2 ${side[0].toUpperCase() + side.slice(1)} (cm)`}
                    value={borders[1][side]} onChange={value => handleMatBorderChange(1, side, value)} />)}
                  </div>
                )}

                {/* Mat 3 trigger */}
                {!showMat3 && (
                  <button
                    type="button"
                    className="mt-3 rounded-lg border border-dashed border-emerald-300 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-600 hover:text-white transition"
                    onClick={() => setShowMat3(true)}
                  >
                    + Add third mat
                  </button>
                )}

                {/* Mat 3 */}
                {showMat3 && (
                  <div className="mt-3 border-t border-slate-200 pt-3 space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Mat 3 (lowest)
                    </label>

                    <select
                      className="w-full rounded-lg border p-2 bg-white text-sm"
                      value={selectedMat3}
                      onChange={(e) =>
                        setSelectedMat3(e.target.value)
                      }
                    >
                      {hasMat3 && (!mat3 || selectedMat3.startsWith('supplier:')) && <option value={selectedMat3} disabled>Unavailable mat — select a material</option>}
                      <option value="mat0">None</option>
                      {(catalog?.mats || []).filter(m => !m.id.startsWith('supplier:')).map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>

                    {hasMat3 && (
                      <div className="grid grid-cols-2 gap-2">
                  {matSides.map(side => <BorderInput key={side} label={`Mat 3 ${side[0].toUpperCase() + side.slice(1)} (cm)`}
                    value={borders[2][side]} onChange={value => handleMatBorderChange(2, side, value)} />)}
                  </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Pro-mode openings */}
            {mode === "pro" && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="flex flex-wrap gap-2 mb-2">
                  <button
                    type="button"
                    className="rounded-lg border px-2 py-1 text-xs bg-white hover:bg-slate-900 hover:text-white"
                    onClick={() =>
                      setOpenings((arr) => [
                        ...arr,
                        {
                          id: rid(),
                          shape: "rect",
                          xCm: (proOrigin?.x ?? geometry.total.left) + 2,
                          yCm: (proOrigin?.y ?? geometry.total.top) + 2,
                          widthCm: 10,
                          heightCm: 15,
                          imageUrl: "",
                        },
                      ])
                    }
                  >
                    + Rectangle
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border px-2 py-1 text-xs bg-white hover:bg-slate-900 hover:text-white"
                    onClick={() =>
                      setOpenings((arr) => [
                        ...arr,
                        {
                          id: rid(),
                          shape: "oval",
                          xCm: (proOrigin?.x ?? geometry.total.left) + 2,
                          yCm: (proOrigin?.y ?? geometry.total.top) + 2,
                          widthCm: 12,
                          heightCm: 16,
                          imageUrl: "",
                        },
                      ])
                    }
                  >
                    + Oval
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border px-2 py-1 text-xs bg-white hover:bg-slate-900 hover:text-white"
                    onClick={() =>
                      setOpenings((arr) => [
                        ...arr,
                        {
                          id: rid(),
                          shape: "circle",
                          xCm: (proOrigin?.x ?? geometry.total.left) + 2,
                          yCm: (proOrigin?.y ?? geometry.total.top) + 2,
                          widthCm: 12,
                          heightCm: 12,
                          imageUrl: "",
                        },
                      ])
                    }
                  >
                    + Circle
                  </button>
                </div>

                <div className="space-y-1 max-h-40 overflow-auto pr-1">
                  {openings.map((o, index) => (
                    <div
                      key={o.id}
                      className={`flex items-center justify-between rounded border px-2 py-1 text-xs bg-white ${
                        selectedOpeningId === o.id
                          ? "border-emerald-500"
                          : "border-slate-300"
                      }`}
                    >
                      <button type="button" aria-label={`Opening ${index + 1}: ${o.shape}`} className="truncate text-left"
                        onClick={() => { setSelectedOpeningId(o.id); revealHandles(o.id); }}>
                        <span className="font-medium">
                          {o.shape}
                        </span>{" "}
                        <span className="text-slate-600">
                          {Math.round(o.widthCm)}×
                          {Math.round(o.heightCm)}cm @{" "}
                          {Math.round(o.xCm)},
                          {Math.round(o.yCm)}
                        </span>
                      </button>
                      <div className="flex items-center gap-1">
                        {o.imageUrl && (
                          <button
                            type="button"
                            title="Change image"
                            className="rounded border px-1 py-0.5 bg-white hover:bg-slate-100"
                            onClick={() =>
                              requestOpeningImage(o.id)
                            }
                          >
                            Img
                          </button>
                        )}
                        <button
                          type="button"
                          title="Delete"
                          className="rounded border px-1 py-0.5 bg-white hover:bg-rose-50"
                          onClick={() =>
                            setOpenings((arr) =>
                              arr.filter(
                                (x) => x.id !== o.id
                              )
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                  {!openings.length && (
                    <div className="text-xs text-slate-500">
                      No openings yet. Add one above.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Backer inside Mat panel */}
            <div className="mt-3 border-t border-slate-200 pt-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={includeBacker}
                  onChange={(e) =>
                    setIncludeBacker(e.target.checked)
                  }
                />
                Include backing board
              </label>
              {includeBacker && <label className="block text-sm mt-2">Backing material
                <select aria-label="Backing material" className="w-full rounded-lg border p-2 bg-white text-sm" value={backerMaterialId}
                  onChange={event => setBackerMaterialId(event.target.value)}>
                  <option value="__legacy_foam__">Foam board backer</option>
                  {(!selectedBacker || backerMaterialId.startsWith('supplier:')) && <option value={backerMaterialId} disabled>Unavailable backing — select a material</option>}
                  {backerList.filter(board => !board.id.startsWith('supplier:')).map(board => <option key={board.id} value={board.id}>
                    {board.name}
                  </option>)}
                </select>
              </label>}
            </div>
          </Panel>

          {/* Glazing */}
          <Panel title="Glazing">
            <label className="block text-sm font-medium text-slate-700">
              Glazing
            </label>
            <select
              className="w-full rounded-lg border p-2 bg-white text-sm mt-1"
              value={selectedGlazingId}
              onChange={(e) =>
                setSelectedGlazingId(e.target.value)
              }
            >
              {selectedGlazingId && (!glazing || selectedGlazingId.startsWith('supplier:')) && <option value={selectedGlazingId} disabled>Unavailable glazing — select a material</option>}
              {glazingList.filter(g => !g.id.startsWith('supplier:')).map((g: any) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Panel>

          {/* Printing */}
          <Panel title="Printing">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={includePrint}
                onChange={(e) =>
                  setIncludePrint(e.target.checked)
                }
              />
              Include printing
            </label>

            {includePrint && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-slate-700">
                  Paper / material
                </label>
                <select
                  className="w-full rounded-lg border p-2 bg-white text-sm mt-1"
                  aria-label="Printing material"
                  value={printMaterialId}
                  onChange={(e) =>
                    setPrintMaterialId(e.target.value)
                  }
                >
                  <option value="">
                    Standard printing
                  </option>
                  {printMaterialId && (!selectedPM || printMaterialId.startsWith('supplier:')) && <option value={printMaterialId} disabled>Unavailable printing — select a material</option>}
                  {PRINT_MATS.filter((pm: PrintingMaterial) => !pm.id.startsWith('supplier:')).map((pm: any) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Panel>
        </section>

        {/* MIDDLE */}
        <section className="min-w-0">
          <div className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-6">
            {/* Header with tabs + export */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Tabs
                  tabs={[
                    { key: "build", label: "Build" },
                    { key: "room", label: "Room preview" },
                  ]}
                  active={activeTab}
                  onChange={(k) =>
                    setActiveTab(k as "build" | "room")
                  }
                />
              </div>

              <div className="flex items-center gap-3 flex-1 justify-end">
                <div className="relative" ref={exportMenuRef}>
                  <button
                    type="button"
                    disabled={exportPending}
                    aria-busy={exportPending}
                    className="rounded-lg px-3 py-1.5 text-xs bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:opacity-50"
                    onClick={() =>
                      setExportMenuOpen((o) => !o)
                    }
                  >
                    {exportPending ? "Preparing export…" : "Export image ▾"}
                  </button>
                  {exportMenuOpen && (
                    <div className="absolute right-0 mt-1 w-32 rounded-lg border bg-white shadow-lg z-20 text-xs">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
                        disabled={exportPending}
                        onClick={() => void runExport("PNG")}
                      >
                        PNG
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
                        disabled={exportPending}
                        onClick={() => void runExport("JPG")}
                      >
                        JPG
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
                        disabled={exportPending}
                        onClick={() => void runExport("PDF")}
                      >
                        PDF
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Preview area + Room content */}
            <div className="mb-6 space-y-3 relative">
              {/* Always-mounted framed preview for both tabs */}
              <div
                ref={previewHostRef}
                className={`w-full flex justify-center ${
                  activeTab === "room"
                    ? "absolute -left-[9999px] -top-[9999px] opacity-0 pointer-events-none"
                    : ""
                }`}
              >
                <div
                  ref={previewRef}
                  className="relative bg-white overflow-hidden shadow-inner ring-1 ring-slate-200"
                  style={{
                    width: px(outerWcm),
                    height: px(outerHcm),

                  }}
                >
                  {/* Frame band */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        frameTextureUrl && useFrameTexture
                          ? "transparent"
                          : framePreviewColor,
                      borderRadius: 0,
                    }}
                  />

                  {/* Texture strips */}
                  {frameTextureUrl && useFrameTexture && (
                    <>
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          right: 0,
                          height: px(faceWidthCm),
                          backgroundImage: `url(${frameTextureUrl})`,
                          backgroundRepeat: "repeat",
                          backgroundSize: textureSizePx,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          bottom: 0,
                          right: 0,
                          height: px(faceWidthCm),
                          backgroundImage: `url(${frameTextureUrl})`,
                          backgroundRepeat: "repeat",
                          backgroundSize: textureSizePx,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: px(faceWidthCm),
                          bottom: px(faceWidthCm),
                          left: 0,
                          width: px(faceWidthCm),
                          backgroundImage: `url(${frameTextureUrl})`,
                          backgroundRepeat: "repeat",
                          backgroundSize: textureSizePx,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: px(faceWidthCm),
                          bottom: px(faceWidthCm),
                          right: 0,
                          width: px(faceWidthCm),
                          backgroundImage: `url(${frameTextureUrl})`,
                          backgroundRepeat: "repeat",
                          backgroundSize: textureSizePx,
                        }}
                      />
                    </>
                  )}

                  {/* Mat area */}
                  <div
                    style={{
                      position: "absolute",
                      left: px(faceWidthCm),
                      top: px(faceWidthCm),
                      right: px(faceWidthCm),
                      bottom: px(faceWidthCm),
                      background: "#fff",
                      borderRadius: 0,
                      overflow: "hidden",
                    }}
                  >
                    {matLayers}
                    {/* BASIC MODE stacked mats */}
                    {mode === "basic" && basicMatMarkup}

                    {/* PRO MODE openings */}
                    {mode === "pro" &&
                      openings.map((o) => {
                        const left = (o.xCm + proOffset.x) * scale;
                        const top = (o.yCm + proOffset.y) * scale;
                        const w = px(o.widthCm);
                        const h = px(o.heightCm);
                        const isCircle = o.shape === "circle";
                        const isOval = o.shape === "oval";
                        const borderRadius = isCircle
                          ? "9999px"
                          : isOval
                          ? "50% / 50%"
                          : "0px";

                        const bevelPx = bevelThicknessPx;
                        const bevelColor = "#f5f0e6";

                        return (
                          <div
                            key={o.id}
                            onMouseDown={(e) =>
                              startMove(e, o)
                            }
                            onMouseEnter={() => { setHoveredOpeningId(o.id); revealHandles(o.id); }}
                            onMouseLeave={() =>
                              setHoveredOpeningId(null)
                            }
                            className="absolute cursor-move group"
                            style={{
                              left,
                              top,
                              width: Math.max(8, w),
                              height: Math.max(
                                8,
                                isCircle ? Math.max(w, h) : h
                              ),
                              borderRadius,
                              userSelect: "none",
                            }}
                            title="Drag to move. Use handles to resize."
                          >
                            {/* Bevel ring */}
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                background: bevelColor,
                                borderRadius: "inherit",
                                boxShadow:
                                  "inset 0 0 3px rgba(0,0,0,0.35)",
                                pointerEvents: "none",
                              }}
                            />

                            {/* Artwork inset */}
                            <div data-opening-x={o.xCm + proOffset.x}
                              style={{
                                position: "absolute",
                                inset: bevelPx,
                                borderRadius: "inherit",
                                overflow: "hidden",
                                background: "#ffffff",
                              }}
                            >
                              {o.imageUrl ? (
                                <img
                                  src={o.imageUrl}
                                  alt="artwork"
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block",
                                  }}
                                  draggable={false}
                                  onDoubleClick={() =>
                                    requestOpeningImage(o.id)
                                  }
                                  title="Double-click to change image"
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="flex items-center justify-center h-full w-full text-neutral-700 text-xs hover:bg-slate-100"
                                  onClick={() =>
                                    requestOpeningImage(o.id)
                                  }
                                >
                                  Select image for this opening
                                </button>
                              )}
                            </div>

                            {/* Resize handles */}
                            {((drag?.id === o.id || hoveredOpeningId === o.id || handleOpeningId === o.id) && handlePhase !== 'hidden') && (
                              <>
                                <Handle phase={handlePhase} onResize={startResize}
                                  o={o}
                                  handle="nw"
                                  style={{
                                    left: -6,
                                    top: -6,
                                    cursor:
                                      "nwse-resize",
                                  }}
                                />
                                <Handle phase={handlePhase} onResize={startResize}
                                  o={o}
                                  handle="ne"
                                  style={{
                                    right: -6,
                                    top: -6,
                                    cursor:
                                      "nesw-resize",
                                  }}
                                />
                                <Handle phase={handlePhase} onResize={startResize}
                                  o={o}
                                  handle="sw"
                                  style={{
                                    left: -6,
                                    bottom: -6,
                                    cursor:
                                      "nesw-resize",
                                  }}
                                />
                                <Handle phase={handlePhase} onResize={startResize}
                                  o={o}
                                  handle="se"
                                  style={{
                                    right: -6,
                                    bottom: -6,
                                    cursor:
                                      "nwse-resize",
                                  }}
                                />
                                <Handle phase={handlePhase} onResize={startResize}
                                  o={o}
                                  handle="n"
                                  style={{
                                    left: "50%",
                                    top: -6,
                                    transform:
                                      "translateX(-50%)",
                                    cursor:
                                      "ns-resize",
                                  }}
                                />
                                <Handle phase={handlePhase} onResize={startResize}
                                  o={o}
                                  handle="s"
                                  style={{
                                    left: "50%",
                                    bottom: -6,
                                    transform:
                                      "translateX(-50%)",
                                    cursor:
                                      "ns-resize",
                                  }}
                                />
                                <Handle phase={handlePhase} onResize={startResize}
                                  o={o}
                                  handle="w"
                                  style={{
                                    top: "50%",
                                    left: -6,
                                    transform:
                                      "translateY(-50%)",
                                    cursor:
                                      "ew-resize",
                                  }}
                                />
                                <Handle phase={handlePhase} onResize={startResize}
                                  o={o}
                                  handle="e"
                                  style={{
                                    top: "50%",
                                    right: -6,
                                    transform:
                                      "translateY(-50%)",
                                    cursor:
                                      "ew-resize",
                                  }}
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>

              {/* Room preview tab content */}
              {activeTab === "room" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-end gap-2 mb-1">
                    <span className="text-xs text-slate-600">
                      Backdrop
                    </span>
                    <select
                      className="rounded border p-1 text-xs bg-white"
                      value={backdrop}
                      onChange={(e) =>
                        setBackdrop(e.target.value as any)
                      }
                    >
                      <option value="studio">Studio</option>
                      <option value="living">Living</option>
                      <option value="gallery">
                        Gallery
                      </option>
                      <option value="office">Office</option>
                    </select>
                  </div>

                  <RoomMockup
                    artworkUrl={roomArtworkUrl || artworkUrl}
                    openings={mode === 'pro' ? openings.map(o => ({ ...o,
                      xCm: o.xCm + proOffset.x + faceWidthCm, yCm: o.yCm + proOffset.y + faceWidthCm })) : undefined}
                    artSizeCm={{ widthCm: outerWcm, heightCm: outerHcm }}
                    onOpeningsChange={next => setOpenings(next.map(o => ({ ...o,
                      xCm: o.xCm - proOffset.x - faceWidthCm, yCm: o.yCm - proOffset.y - faceWidthCm })))}
                    backdrop={backdrop}
                  />
                </div>
              )}
            </div>

            {/* Dimensions & Cost */}
            <div className="grid gap-4 grid-cols-1">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70">
                {/* Header */}
                <button
                  onClick={() =>
                    setShowDimensions((s) => !s)
                  }
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-emerald-900"
                >
                  <span>Dimensions</span>
                  <span className="text-xs text-emerald-800">
                    {showDimensions ? "Hide ▲" : "Show ▼"}
                  </span>
                </button>

                {/* Collapsible Body */}
                {showDimensions && (
                  <div className="px-4 pb-4 text-sm divide-y divide-emerald-100">
                    <div className="py-1.5 flex justify-between">
                      <span className="text-slate-700">
                        Image
                      </span>
                      <span className="text-slate-900">
                        {unit === "imperial"
                          ? `${cmToIn(
                              artWcm
                            ).toFixed(2)} × ${cmToIn(
                              artHcm
                            ).toFixed(2)} in`
                          : `${artWcm.toFixed(
                              1
                            )} × ${artHcm.toFixed(
                              1
                            )} cm`}
                      </span>
                    </div>

                    <div className="py-1.5 flex justify-between">
                      <span className="text-slate-700">
                        Visible (mats)
                      </span>
                      <span className="text-slate-900">
                        {unit === "imperial"
                          ? `${cmToIn(
                              visibleWcm
                            ).toFixed(2)} × ${cmToIn(
                              visibleHcm
                            ).toFixed(2)} in`
                          : `${visibleWcm.toFixed(
                              1
                            )} × ${visibleHcm.toFixed(
                              1
                            )} cm`}
                      </span>
                    </div>

                    <div className="py-1.5 flex justify-between">
                      <span className="text-slate-700">
                        Frame outside
                      </span>
                      <span className="text-slate-900">
                        {unit === "imperial"
                          ? `${cmToIn(
                              outerWcm
                            ).toFixed(2)} × ${cmToIn(
                              outerHcm
                            ).toFixed(2)} in`
                          : `${outerWcm.toFixed(
                              1
                            )} × ${outerHcm.toFixed(
                              1
                            )} cm`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="bg-slate-900 text-slate-50 rounded-xl border border-slate-800 p-4 text-sm mt-2">
                <div className="font-semibold text-base mb-2 flex items-center justify-between">
                  <span>Pricing</span>
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">
                    Currency: {currencyCode}
                  </span>
                </div>
                {pricingIssue ? !supplierSelectionIssue && <p role="alert">{customerPricingIssue}</p> : <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Frame</span>
                    <span>{moneyIntl(sellingAmount('frame'))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Glazing</span>
                    <span>{moneyIntl(sellingAmount('glazing'))}</span>
                  </div>
                  {hasMat1 && (
                    <div className="flex justify-between">
                      <span>Mat 1</span>
                      <span>{moneyIntl(sellingMatAmount(1))}</span>
                    </div>
                  )}
                  {hasMat2 && (
                    <div className="flex justify-between">
                      <span>Mat 2</span>
                      <span>{moneyIntl(sellingMatAmount(2))}</span>
                    </div>
                  )}
                  {hasMat3 && (
                    <div className="flex justify-between">
                      <span>Mat 3</span>
                      <span>{moneyIntl(sellingMatAmount(3))}</span>
                    </div>
                  )}
                  {includePrint && (
                    <div className="flex justify-between">
                      <span>Printing</span>
                      <span>{moneyIntl(sellingAmount('print'))}</span>
                    </div>
                  )}
                  {includeBacker && (
                    <div className="flex justify-between">
                      <span>Backer</span>
                      <span>{moneyIntl(sellingAmount('backer'))}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Labour</span>
                    <span>{moneyIntl(sellingAmount('labour'))}</span>
                  </div>
                  <div className="border-t border-slate-700 pt-1 flex justify-between">
                    <span>Subtotal</span>
                    <span>{moneyIntl(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-200">
                    <span>Tax</span>
                    <span>{moneyIntl(pricingSnapshot.tax)}</span>
                  </div>
                  <div className="font-semibold border-t border-slate-700 pt-1 flex justify-between text-lg">
                    <span>Total</span>
                    <span className="text-emerald-300">
                      {moneyIntl(total)}
                    </span>
                  </div>
                </div>}
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT */}
        <aside className="space-y-3">
          <PresetControls
            saveIssue={matRestoreIssue || geometry.issue}
            companyName={billing.companyName}
            customerKey={customerKey}
            hasSavedCustomer={Boolean(selectedCustomerId && selectedCustomerId !== "__new__")}
            ensureCustomerId={ensureCustomerId}
            currentState={currentState}
            onApply={applyPreset}
          />

          {/* Customer */}
          <div
            className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-4"
            onChangeCapture={() => {
              // Editing a draft is also a context change; hook-driven refreshes are not.
              feedbackScope.current = { ...feedbackScope.current };
            }}
          >
            <div className="mb-3">
              <h2 className="text-base font-semibold text-slate-900">
                Customer
              </h2>
              <div className="text-xs text-slate-500">
                Save directly to CRM and build jobs/quotes.
              </div>
            </div>

            <label className="block text-sm font-medium mb-1 text-slate-700">
              Existing customer
            </label>
            <select
              className="w-full rounded-lg border p-2 mb-3 bg-white text-sm"
              value={selectedCustomerId}
              onChange={(e) =>
                setSelectedCustomerId(e.target.value)
              }
            >
              <option value="__new__">— Select —</option>
              {sortedCustomers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {`${c.firstName ?? ""} ${
                    c.lastName ?? ""
                  }`.trim() ||
                    c.email ||
                    c.company ||
                    c.id}
                </option>
              ))}
            </select>

            <div className="grid gap-2">
              <p className="text-sm font-semibold text-slate-700 mb-1">
                New customer
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="rounded-lg border p-2 text-sm bg-white/95"
                  placeholder="First name"
                  value={cust.firstName}
                  onChange={(e) =>
                    setCust((s) => ({
                      ...s,
                      firstName: e.target.value,
                    }))
                  }
                />
                <input
                  className="rounded-lg border p-2 text-sm bg-white/95"
                  placeholder="Last name"
                  value={cust.lastName}
                  onChange={(e) =>
                    setCust((s) => ({
                      ...s,
                      lastName: e.target.value,
                    }))
                  }
                />
              </div>
              <input
                className="rounded-lg border p-2 text-sm bg-white/95"
                placeholder="Company"
                value={cust.company}
                onChange={(e) =>
                  setCust((s) => ({
                    ...s,
                    company: e.target.value,
                  }))
                }
              />
              <input
                className="rounded-lg border p-2 text-sm bg-white/95"
                placeholder="Email"
                value={cust.email}
                onChange={(e) =>
                  setCust((s) => ({
                    ...s,
                    email: e.target.value,
                  }))
                }
              />
              <input
                className="rounded-lg border p-2 text-sm bg-white/95"
                placeholder="Phone"
                value={cust.phone}
                onChange={(e) =>
                  setCust((s) => ({
                    ...s,
                    phone: e.target.value,
                  }))
                }
              />
              <input
                className="rounded-lg border p-2 text-sm bg-white/95"
                placeholder="Address line 1"
                value={cust.address1}
                onChange={(e) =>
                  setCust((s) => ({
                    ...s,
                    address1: e.target.value,
                  }))
                }
              />
              <input
                className="rounded-lg border p-2 text-sm bg-white/95"
                placeholder="Address line 2"
                value={cust.address2}
                onChange={(e) =>
                  setCust((s) => ({
                    ...s,
                    address2: e.target.value,
                  }))
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="rounded-lg border p-2 text-sm bg-white/95"
                  placeholder="City"
                  value={cust.city}
                  onChange={(e) =>
                    setCust((s) => ({
                      ...s,
                      city: e.target.value,
                    }))
                  }
                />
                <input
                  className="rounded-lg border p-2 text-sm bg-white/95"
                  placeholder="Postcode"
                  value={cust.postcode}
                  onChange={(e) =>
                    setCust((s) => ({
                      ...s,
                      postcode: e.target.value,
                    }))
                  }
                />
              </div>
              <input
                className="rounded-lg border p-2 text-sm bg-white/95"
                placeholder="Country"
                value={cust.country}
                onChange={(e) =>
                  setCust((s) => ({
                    ...s,
                    country: e.target.value,
                  }))
                }
              />
              <textarea
                className="rounded-lg border p-2 text-sm bg-white/95"
                rows={3}
                placeholder="Notes"
                value={cust.notes}
                onChange={(e) =>
                  setCust((s) => ({
                    ...s,
                    notes: e.target.value,
                  }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {/* Save to CRM */}
              <button
                onClick={() => void runIndividual("crm", saveToCRM)}
                disabled={pendingActions.crm}
                className="rounded-lg border border-emerald-300 px-3 py-2 text-sm bg-white 
                        hover:bg-emerald-600 hover:text-white transition"
              >
                Save to CRM
              </button>

              {/* Add to Quotes */}
              <button
                onClick={() => void runIndividual("quote", addQuoteNow)}
                disabled={pendingActions.quote}
                className="rounded-lg border border-indigo-300 px-3 py-2 text-sm bg-white 
                        hover:bg-indigo-600 hover:text-white transition"
              >
                Add to Quotes
              </button>

              {/* Add to Jobs */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void runIndividual("job", addJobNow);
                }}
                disabled={pendingActions.job}
                className="rounded-lg border border-blue-300 px-3 py-2 text-sm bg-white 
                        hover:bg-blue-600 hover:text-white transition"
              >
                Add to Jobs
              </button>

              {/* Add to Invoices */}
              <button
                onClick={() => void runIndividual("invoice", invoiceNow)}
                disabled={pendingActions.invoice}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white 
                        hover:bg-slate-700 hover:text-white transition"
              >
                Add to Invoices
              </button>

              {/* Create all three */}
              <button
                onClick={handleCreateQuoteInvoiceJob}
                className="col-span-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium 
                        text-white shadow-sm hover:bg-emerald-700 transition"
              >
                Create Quote + Invoice + Job
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* Hidden file input for pro-mode opening images */}
      <input
        ref={openingImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) =>
          handleOpeningImageSelected(e.target.files?.[0] || null)
        }
      />
    </div>
  );
}
