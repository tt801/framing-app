// src/VisualizerApp.tsx
import React, { useMemo, useRef, useState, useEffect } from "react";

// STORES / LIBS
import { useCatalog } from "@/lib/store";
import { useQuotes } from "@/lib/quotes";
import { useCustomers } from "@/lib/customers";
import { useInvoices } from "@/lib/invoices";
import { useJobs } from "@/lib/jobs";
import { useLayout } from "@/lib/layout";
import * as htmlToImage from "html-to-image";
window.__FRAMEIT = { useCatalog };

// PDF
import { exportInvoicePDF } from "@/lib/pdf/invoicePdf";

// COMPONENTS
import RoomMockup from "@/components/RoomMockup";
import { Tabs } from "@/components/Tabs";

// EXPORT HELPERS & PRESETS
import {
  exportNodeAsJpeg,
  exportNodeAsPdf,
  exportNodeAsPng,
} from "@/lib/exporters";
import { listPresets, savePreset, deletePreset } from "@/lib/presets";
import type { VisualizerPreset } from "@/lib/presets";

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

const CM_PER_IN = 2.54;
const cmToIn = (cm: number) => cm / CM_PER_IN;
const inToCm = (inch: number) => inch * CM_PER_IN;
const cmToM = (n: number) => n / 100;
const perimeterMeters = (w: number, h: number) => cmToM(2 * (w + h));
const areaSqM = (w: number, h: number) => cmToM(w) * cmToM(h);
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
  const { catalog } = useCatalog();
  const qStore = useQuotes() as any;
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

  const addJob = (job: any) =>
    jobsStore?.add?.(job) ??
    jobsStore?.create?.(job) ??
    jobsStore?.push?.(job);
  const addInvoice = (inv: any) =>
    invoicesStore?.add?.(inv) ??
    invoicesStore?.addFromQuote?.(inv) ??
    invoicesStore?.create?.(inv) ??
    invoicesStore?.push?.(inv);

  const settings = catalog?.settings || {};
  const currencyCode = getSettingsCurrency(settings);
  const currencySymbol =
    settings?.currencySymbol || symbolFor(currencyCode) || "R ";

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
  const [selectedFrame, setSelectedFrame] = useState<string>("frame1");
  const [faceAuto, setFaceAuto] = useState<boolean>(true);
  const [faceWidthCm, setFaceWidthCm] = useState(2.0);

  const [selectedMat1, setSelectedMat1] = useState<string>("mat0");
  const [selectedMat2, setSelectedMat2] = useState<string>("mat0");
  const [selectedMat3, setSelectedMat3] = useState<string>("mat0");

  // Core mat borders in cm (single source of truth)
  const [mat1BorderCm, setMat1BorderCm] = useState(5);
  const [mat2BorderCm, setMat2BorderCm] = useState(2);
  const [mat3BorderCm, setMat3BorderCm] = useState(1);

  const [showMat2, setShowMat2] = useState(false);
  const [showMat3, setShowMat3] = useState(false);

  const hasMat1 = selectedMat1 !== "mat0";
  const hasMat2 = selectedMat2 !== "mat0";
  const hasMat3 = selectedMat3 !== "mat0";

  const totalBorder =
    (hasMat1 ? mat1BorderCm : 0) +
    (hasMat2 ? mat2BorderCm : 0) +
    (hasMat3 ? mat3BorderCm : 0);

  const topVisibleBorderCm = hasMat1
    ? mat1BorderCm
    : hasMat2
    ? mat2BorderCm
    : hasMat3
    ? mat3BorderCm
    : 0;

  // Pro mode openings
  const [openings, setOpenings] = useState<MatOpening[]>([]);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(
    null
  );
  const [hoveredOpeningId, setHoveredOpeningId] = useState<string | null>(null);

  const [selectedGlazingId, setSelectedGlazingId] = useState<string>("");
  const [useFrameTexture, setUseFrameTexture] = useState<boolean>(true);
  const [textureScalePct, setTextureScalePct] = useState<number>(100);

  // Printing and backer
  const PRINT_MATS = (catalog?.printMaterials ||
    (catalog as any)?.printingMaterials ||
    []) as any[];
  const [includePrint, setIncludePrint] = useState(false);
  const [printMaterialId, setPrintMaterialId] = useState<string>("");
  const [includeBacker, setIncludeBacker] = useState(false);

  const foamBackerPerSqM = Number(
    (catalog?.settings as any)?.foamBackerPerSqM ??
      (catalog as any)?.backer?.pricePerSqM ??
      0
  );

  // Catalog lookups
  const frameProfile = catalog?.frames?.find?.(
    (f: any) => f.id === selectedFrame
  );
  const glazingList = (catalog?.glazing || []) as any[];
  const glazing =
    glazingList.find((g: any) => g.id === selectedGlazingId) ||
    glazingList[0] || { pricePerSqM: 0, name: "Glazing" };

  const mat1 = catalog?.mats?.find?.((m: any) => m.id === selectedMat1);
  const mat2 = catalog?.mats?.find?.((m: any) => m.id === selectedMat2);
  const mat3 = catalog?.mats?.find?.((m: any) => m.id === selectedMat3);
  const selectedPM = PRINT_MATS.find((p: any) => p.id === printMaterialId);

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
    if (faceAuto) {
      const w = getProfileFaceWidth(frameProfile);
      if (typeof w === "number") setFaceWidthCm(w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedFrame,
    faceAuto,
    frameProfile?.faceWidthCm,
    frameProfile?.faceWidth,
    frameProfile?.lipWidthCm,
    frameProfile?.lipWidth,
  ]);

  const framePreviewColor =
    (frameProfile?.previewColor as string) ||
    (frameProfile?.previewColour as string) || // if you ever store it like this
    (frameProfile as any)?.colour ||
    (frameProfile as any)?.color ||
    "#333";

  const frameTextureUrl =
    (frameProfile?.previewImageUrl as string) ||
    (frameProfile?.textureUrl as string) ||
    "";

  // Derived dimensions
  const outerWcm = artWcm + 2 * (totalBorder + faceWidthCm);
  const outerHcm = artHcm + 2 * (totalBorder + faceWidthCm);
  const visibleWcm = artWcm + 2 * totalBorder;
  const visibleHcm = artHcm + 2 * totalBorder;

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
      const margin = totalBorder + faceWidthCm;
      const newArtCm = cmValue - 2 * margin;
      const clamped = Math.max(1, newArtCm);
      if (axis === "width") setArtWcm(clamped);
      else setArtHcm(clamped);
    }
  }

  // ---------- Mat border handlers (now onBlur / Enter) ----------
  function handleMatBorderChange(which: 1 | 2 | 3, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (which === 1) setMat1BorderCm(0);
      else if (which === 2) setMat2BorderCm(0);
      else setMat3BorderCm(0);
      return;
    }
    const parsed = parseFloat(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const safe = Math.min(50, Math.max(0, parsed));

    if (which === 1) setMat1BorderCm(safe);
    else if (which === 2) setMat2BorderCm(safe);
    else setMat3BorderCm(safe);
  }

  // ---------- Pricing ----------
  const pricePerMeter = Number(frameProfile?.pricePerMeter ?? 0);
  const glazingPerSqM = Number(glazing?.pricePerSqM ?? 0);
  const mat1PerSqM = Number(mat1?.pricePerSqM ?? 0);
  const mat2PerSqM = Number(mat2?.pricePerSqM ?? 0);
  const mat3PerSqM = Number(mat3?.pricePerSqM ?? 0);
  const fallbackPrintSqM = Number(catalog?.settings?.printingPerSqM ?? 0);
  const printingPerSqM = Number(
    (selectedPM?.pricePerSqM ?? fallbackPrintSqM) ?? 0
  );

  const framePerimeterM = perimeterMeters(visibleWcm, visibleHcm);
  const areaArt = areaSqM(artWcm, artHcm);
  const glazedAreaSqM = areaSqM(visibleWcm, visibleHcm);

  const matBoardArea = areaSqM(visibleWcm, visibleHcm);

  const mat1Area = hasMat1 ? matBoardArea : 0;
  const mat2Area = hasMat2 ? matBoardArea : 0;
  const mat3Area = hasMat3 ? matBoardArea : 0;

  const frameCost = pricePerMeter * framePerimeterM;
  const glazingCost = glazingPerSqM * glazedAreaSqM;
  const mat1Cost = mat1PerSqM * mat1Area;
  const mat2Cost = mat2PerSqM * mat2Area;
  const mat3Cost = mat3PerSqM * mat3Area;
  const printingCost = includePrint ? printingPerSqM * areaArt : 0;
  const backerCost = includeBacker ? foamBackerPerSqM * glazedAreaSqM : 0;

  const labourBase = Number(catalog?.settings?.labourBase ?? 0);
  const marginMultiplier = Number(
    catalog?.settings?.marginMultiplier ?? 1
  );
  const taxRate = Number(catalog?.settings?.taxRate ?? 0);

  const subtotalRaw =
    frameCost +
    glazingCost +
    mat1Cost +
    mat2Cost +
    mat3Cost +
    printingCost +
    backerCost +
    labourBase;
  const subtotal = subtotalRaw * marginMultiplier;
  const total = subtotal * (1 + taxRate);

  // ---------- Responsive preview ----------
  const [maxPx, setMaxPx] = useState(760);
  const MAX_PREVIEW_PX = 1200;
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Keep a dataURL of the framed preview for the room mockup
  useEffect(() => {
    // If there's no artwork at all, clear the room preview too
    if (!artworkUrl) {
      setRoomArtworkUrl("");
      return;
    }
    if (!previewRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const dataUrl = await htmlToImage.toPng(previewRef.current!, {
          cacheBust: true,
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
    mat1BorderCm,
    mat2BorderCm,
    mat3BorderCm,
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
        Math.min(MAX_PREVIEW_PX, Math.max(320, Math.floor(w - 24)))
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
  type HandleKey = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  const [drag, setDrag] = useState<null | {
    kind: "move" | "resize";
    id: string;
    handle?: HandleKey;
    startX: number;
    startY: number;
    ox?: number;
    oy?: number;
    ow?: number;
    oh?: number;
    shape?: OpeningShape;
  }>(null);

  useEffect(() => {
    if (!drag) return;

    function onMove(e: MouseEvent) {
      const dxPx = e.clientX - drag.startX;
      const dyPx = e.clientY - drag.startY;
      const dx = dxPx / scale;
      const dy = dyPx / scale;

      if (drag.kind === "move") {
        const id = drag.id;
        const baseW = drag.ow ?? 0;
        const baseH = drag.oh ?? 0;

        let x = (drag.ox ?? 0) + dx;
        let y = (drag.oy ?? 0) + dy;

        x = Math.max(0, Math.min(x, visibleWcm - baseW));
        y = Math.max(0, Math.min(y, visibleHcm - baseH));

        x = snapToGrid(x);
        y = snapToGrid(y);

        const centerX = x + baseW / 2;
        const centerY = y + baseH / 2;

        const snappedCenterX = snapWithMagnet(centerX, [visibleWcm / 2]);
        const snappedCenterY = snapWithMagnet(centerY, [visibleHcm / 2]);

        if (snappedCenterX !== centerX) {
          x = snappedCenterX - baseW / 2;
        }
        if (snappedCenterY !== centerY) {
          y = snappedCenterY - baseH / 2;
        }

        const leftTarget = 0;
        const rightTarget = visibleWcm - baseW;
        const topTarget = 0;
        const bottomTarget = visibleHcm - baseH;

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

        x = Math.max(0, Math.min(x, visibleWcm - baseW));
        y = Math.max(0, Math.min(y, visibleHcm - baseH));

        setOpenings((arr) =>
          arr.map((o) =>
            o.id === id ? { ...o, xCm: x, yCm: y } : o
          )
        );
      } else if (drag.kind === "resize") {
        const id = drag.id;
        const handle = drag.handle!;
        const shape = drag.shape!;
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
                Math.min((drag.ow ?? 0) + dx, visibleWcm - x)
              );
            }
            if (handle.includes("w")) {
              const newX = Math.max(
                0,
                Math.min(visibleWcm, (drag.ox ?? 0) + dx)
              );
              const owCalc =
                (drag.ow ?? 0) + (drag.ox ?? 0) - newX;
              w = Math.max(
                MIN_W_CM,
                Math.min(owCalc, visibleWcm - newX)
              );
              x = newX;
            }
            if (handle.includes("s")) {
              h = Math.max(
                MIN_H_CM,
                Math.min((drag.oh ?? 0) + dy, visibleHcm - y)
              );
            }
            if (handle.includes("n")) {
              const newY = Math.max(
                0,
                Math.min(visibleHcm, (drag.oy ?? 0) + dy)
              );
              const ohCalc =
                (drag.oh ?? 0) + (drag.oy ?? 0) - newY;
              h = Math.max(
                MIN_H_CM,
                Math.min(ohCalc, visibleHcm - newY)
              );
              y = newY;
            }

            if (shape === "circle") {
              const s = Math.max(MIN_W_CM, Math.max(w, h));
              w = s;
              h = s;
            } else if (shape === "oval") {
              const ratio = (drag.ow ?? 1) / (drag.oh ?? 1);
              if (ratio > 1.5) h = Math.max(h, w / 1.5);
              else if (ratio < 0.66) w = Math.max(w, h * 0.66);
            }

            x = snapToGrid(x);
            y = snapToGrid(y);
            w = snapToGrid(w);
            h = snapToGrid(h);

            x = Math.max(0, Math.min(x, visibleWcm - MIN_W_CM));
            y = Math.max(0, Math.min(y, visibleHcm - MIN_H_CM));
            w = Math.max(MIN_W_CM, Math.min(w, visibleWcm - x));
            h = Math.max(MIN_H_CM, Math.min(h, visibleHcm - y));

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
    setDrag({
      kind: "move",
      id: o.id,
      startX: e.clientX,
      startY: e.clientY,
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
    setDrag({
      kind: "resize",
      id: o.id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      shape: o.shape,
      ox: o.xCm,
      oy: o.yCm,
      ow: o.widthCm,
      oh: o.heightCm,
    });
  };

  const Handle = ({
    o,
    handle,
    style,
  }: {
    o: MatOpening;
    handle: HandleKey;
    style: React.CSSProperties;
  }) => (
    <div
      onMouseDown={(e) => startResize(e, o, handle)}
      className="absolute bg-white border border-slate-400 rounded shadow-sm cursor-pointer"
      style={{ width: 12, height: 12, ...style }}
      title={`Drag to resize (${handle.toUpperCase()})`}
    />
  );

  // ---------- Customer panel ----------
  const [selectedCustomerId, setSelectedCustomerId] =
    useState<string>("__new__");
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

  const backdropStyle: React.CSSProperties = useMemo(() => {
    switch (backdrop) {
      case "living":
        return {
          background:
            "linear-gradient(180deg, #fefcf5 0%, #f8efe2 100%)",
        };
      case "gallery":
        return {
          background:
            "linear-gradient(180deg, #fdfdfd 0%, #f3f4f6 100%)",
        };
      case "office":
        return {
          background:
            "linear-gradient(180deg, #f0f9ff 0%, #e0f2fe 100%)",
        };
      default: // studio
        return { background: "transparent" };
    }
  }, [backdrop]);

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

  function ensureCustomerId(): string | "" {
    if (selectedCustomerId && selectedCustomerId !== "__new__")
      return selectedCustomerId;
    const hasCore = !!(
      cust.firstName?.trim() ||
      cust.lastName?.trim() ||
      cust.email?.trim()
    );
    if (!hasCore) return "";
    const id = rid();
    addCustomer?.({
      id,
      ...cust,
      createdAt: new Date().toISOString(),
    } as any);
    setSelectedCustomerId(id);
    return id;
  }

  // ---------- Image upload ----------
  function onPickImage(file?: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setArtworkUrl(String(reader.result || ""));
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

  function clearOpeningImage(id: string) {
    setOpenings((arr) =>
      arr.map((o) =>
        o.id === id ? { ...o, imageUrl: "" } : o
      )
    );
  }

  // ---------- Actions: CRM / Quotes / Jobs / Invoice ----------
  function saveToCRM() {
    if (!selectedCustomerId || selectedCustomerId === "__new__") {
      const id = rid();
      addCustomer?.({
        id,
        ...cust,
        createdAt: new Date().toISOString(),
      } as any);
      setSelectedCustomerId(id);
      alert("Saved to CRM (created).");
    } else {
      updateCustomer?.({
        id: selectedCustomerId,
        ...cust,
      } as any);
      alert("Saved to CRM (updated).");
    }
  }

  function addQuoteNow() {
    const customerId = ensureCustomerId();
    const customerObj = customerId
      ? (customers || []).find((c: any) => c.id === customerId)
      : undefined;

    const items = [
      {
        name: `Frame (${frameProfile?.name ?? "frame"})`,
        qty: 1,
        unitPrice: Number(frameCost),
        total: Number(frameCost),
      },
      {
        name: `Glazing (${glazing?.name ?? "glazing"})`,
        qty: 1,
        unitPrice: Number(glazingCost),
        total: Number(glazingCost),
      },
      ...(hasMat1
        ? [
            {
              name: `Mat 1 (${mat1?.name ?? "mat"})`,
              qty: 1,
              unitPrice: Number(mat1Cost),
              total: Number(mat1Cost),
            },
          ]
        : []),
      ...(hasMat2
        ? [
            {
              name: `Mat 2 (${mat2?.name ?? "mat"})`,
              qty: 1,
              unitPrice: Number(mat2Cost),
              total: Number(mat2Cost),
            },
          ]
        : []),
      ...(hasMat3
        ? [
            {
              name: `Mat 3 (${mat3?.name ?? "mat"})`,
              qty: 1,
              unitPrice: Number(mat3Cost),
              total: Number(mat3Cost),
            },
          ]
        : []),
      ...(includePrint
        ? [
            {
              name: selectedPM
                ? `Printing (${selectedPM.name})`
                : "Printing",
              qty: 1,
              unitPrice: Number(printingCost),
              total: Number(printingCost),
            },
          ]
        : []),
      ...(includeBacker
        ? [
            {
              name: "Foam board backer",
              qty: 1,
              unitPrice: Number(backerCost),
              total: Number(backerCost),
            },
          ]
        : []),
      {
        name: "Labour & overhead",
        qty: 1,
        unitPrice: Number(labourBase),
        total: Number(labourBase),
      },
    ];

    const subtotalItems = items.reduce(
      (s, i) => s + Number(i.total || 0),
      0
    );
    const tax = subtotalItems * taxRate;
    const totalAll = subtotalItems + tax;

    const existingInStore = (qStore?.quotes ?? qStore?.items ?? []) as any[];
    const existingInLS = readQuotesFromAnyLS();
    const allExisting = [...existingInStore, ...existingInLS];

    const prefix: string =
      catalog?.settings?.quoteNumberPrefix ??
      catalog?.settings?.quotePrefix ??
      "Q-";
    const pad: number = Number(
      catalog?.settings?.quoteNumberPad ??
        catalog?.settings?.quotePad ??
        3
    );
    const start: number = Number(
      catalog?.settings?.quoteNumberStart ?? 1
    );

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

      items,
      subtotal: subtotalItems,
      taxRate,
      tax,
      total: totalAll,

      currency: catalog?.settings?.currencyCode ?? "ZAR",
      currencyCode: catalog?.settings?.currencyCode ?? "ZAR",
      currencySymbol: catalog?.settings?.currencySymbol ?? "R ",
    };

    const wroteStore = writeQuoteToAnyStore(qStore, payload);

    const ls = readQuotesFromAnyLS();
    const merged = mergeQuote(ls, payload);
    writeQuotesToAllLS(merged);

    try {
      console.debug("Quote upserted:", payload.number, {
        wroteStore,
        quotesCountLS: merged.length,
      });
    } catch {}
    alert(`Quote ${payload.number} created.`);
  }

  function addJobNow() {
    const customerId = ensureCustomerId();

    const frameName = frameProfile?.name || selectedFrame || "Frame";
    const mat1Name = hasMat1 ? mat1?.name || selectedMat1 : "";
    const mat2Name = hasMat2 ? mat2?.name || selectedMat2 : "";
    const mat3Name = hasMat3 ? mat3?.name || selectedMat3 : "";
    const glazingName =
      glazing?.name || selectedGlazingId || "Glazing";
    const printName = includePrint
      ? selectedPM?.name
        ? `Printing (${selectedPM.name})`
        : "Printing"
      : "";

    const customerObj = customerId
      ? (customers || []).find((c: any) => c.id === customerId)
      : undefined;
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
      frameFaceWidthCm: Number(faceWidthCm),
    };

    const lineItems = [
      {
        k: "frame",
        label: `Frame — ${frameName}`,
        amount: Number(frameCost),
      },
      {
        k: "glazing",
        label: `Glazing — ${glazingName}`,
        amount: Number(glazingCost),
      },
      ...(hasMat1
        ? [
            {
              k: "mat1",
              label: `Mat 1 — ${mat1Name}`,
              amount: Number(mat1Cost),
            },
          ]
        : []),
      ...(hasMat2
        ? [
            {
              k: "mat2",
              label: `Mat 2 — ${mat2Name}`,
              amount: Number(mat2Cost),
            },
          ]
        : []),
      ...(hasMat3
        ? [
            {
              k: "mat3",
              label: `Mat 3 — ${mat3Name}`,
              amount: Number(mat3Cost),
            },
          ]
        : []),
      ...(includePrint
        ? [
            {
              k: "print",
              label: printName,
              amount: Number(printingCost),
            },
          ]
        : []),
      ...(includeBacker
        ? [
            {
              k: "backer",
              label: "Foam board backer",
              amount: Number(backerCost),
            },
          ]
        : []),
      {
        k: "labour",
        label: "Labour & overhead",
        amount: Number(labourBase),
      },
    ];

    const detailsSnapshot = {
      artworkUrl,
      dims: dimsNested,
      mats: {
        hasMat1,
        hasMat2,
        hasMat3,
        mat1: hasMat1
          ? {
              id: selectedMat1,
              name: mat1Name,
              borderCm: Number(mat1BorderCm),
            }
          : null,
        mat2: hasMat2
          ? {
              id: selectedMat2,
              name: mat2Name,
              borderCm: Number(mat2BorderCm),
            }
          : null,
        mat3: hasMat3
          ? {
              id: selectedMat3,
              name: mat3Name,
              borderCm: Number(mat3BorderCm),
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
      backer: { include: Boolean(includeBacker) },
      costs: {
        frameCost: Number(frameCost),
        glazingCost: Number(glazingCost),
        mat1Cost: Number(mat1Cost),
        mat2Cost: Number(mat2Cost),
        mat3Cost: Number(mat3Cost),
        printingCost: Number(printingCost),
        backerCost: Number(backerCost),
        labourBase: Number(labourBase),
        marginMultiplier: Number(marginMultiplier),
        subtotal: Number(subtotal),
        taxRate: Number(taxRate),
        total: Number(total),
        lineItems,
      },
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
        hasMat1,
        hasMat2,
        hasMat3,
        mat1: hasMat1
          ? {
              id: selectedMat1,
              name: mat1Name,
              borderCm: Number(mat1BorderCm),
            }
          : null,
        mat2: hasMat2
          ? {
              id: selectedMat2,
              name: mat2Name,
              borderCm: Number(mat2BorderCm),
            }
          : null,
        mat3: hasMat3
          ? {
              id: selectedMat3,
              name: mat3Name,
              borderCm: Number(mat3BorderCm),
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
        subtotal: Number(subtotal),
        total: Number(total),
        taxRate: Number(taxRate),
        currency: {
          code: currencyCode,
          symbol: currencySymbol,
        },
        lineItems,
      },
    };

    const refNo = Number(String(Date.now()).slice(-4));

    const job = {
      id: rid(),
      refNo,
      createdAt: new Date().toISOString(),
      description: `Framing job — ${frameName}`,
      status: "new",
      priority: "normal",
      subtotal: Number(subtotal),
      total: Number(total),
      taxRate: Number(taxRate),
      currency: { code: currencyCode, symbol: currencySymbol },
      customerId: customerId || undefined,
      customerSnapshot,
      details: detailsSnapshot,
      detailsJson: JSON.stringify(detailsSnapshot),
      ...flatForJobs,
      checklist: makeJobChecklist(),
    };

    try {
      addJob?.(job as any);
      alert("Job created and added to Jobs.");
    } catch (err) {
      console.error(err);
      alert("Failed to save job. See console for details.");
    }
  }

  function invoiceNow() {
    const customerId = ensureCustomerId();
    const customerObj = customerId
      ? (customers || []).find((c: any) => c.id === customerId)
      : undefined;

    const invId = rid();
    const todayISO = new Date().toISOString();

    const items = [
      {
        id: rid(),
        name: `Frame (${frameProfile?.name ?? "frame"})`,
        description: `Frame (${frameProfile?.name ?? "frame"})`,
        qty: 1,
        unitPrice: frameCost,
      },
      {
        id: rid(),
        name: `Glazing (${glazing?.name ?? "glazing"})`,
        description: `Glazing (${glazing?.name ?? "glazing"})`,
        qty: 1,
        unitPrice: glazingCost,
      },
      ...(hasMat1
        ? [
            {
              id: rid(),
              name: `Mat 1 (${mat1?.name ?? "mat"})`,
              description: `Mat 1 (${mat1?.name ?? "mat"})`,
              qty: 1,
              unitPrice: mat1Cost,
            },
          ]
        : []),
      ...(hasMat2
        ? [
            {
              id: rid(),
              name: `Mat 2 (${mat2?.name ?? "mat"})`,
              description: `Mat 2 (${mat2?.name ?? "mat"})`,
              qty: 1,
              unitPrice: mat2Cost,
            },
          ]
        : []),
      ...(hasMat3
        ? [
            {
              id: rid(),
              name: `Mat 3 (${mat3?.name ?? "mat"})`,
              description: `Mat 3 (${mat3?.name ?? "mat"})`,
              qty: 1,
              unitPrice: mat3Cost,
            },
          ]
        : []),
      ...(includePrint
        ? [
            {
              id: rid(),
              name: selectedPM
                ? `Printing (${selectedPM.name})`
                : "Printing",
              description: selectedPM
                ? `Printing (${selectedPM.name})`
                : "Printing",
              qty: 1,
              unitPrice: printingCost,
            },
          ]
        : []),
      ...(includeBacker
        ? [
            {
              id: rid(),
              name: "Foam board backer",
              description: "Foam board backer",
              qty: 1,
              unitPrice: backerCost,
            },
          ]
        : []),
      {
        id: rid(),
        name: "Labour & overhead",
        description: "Labour & overhead",
        qty: 1,
        unitPrice: labourBase,
      },
    ];

    const invoiceObj = {
      id: invId,
      number: `INV-${new Date().getFullYear()}-${invId
        .slice(0, 4)
        .toUpperCase()}`,
      customerId: customerId || undefined,
      dateISO: todayISO,
      dueDateISO: undefined,
      items,
      subtotal: Number(subtotal),
      taxRate: Number(taxRate),
      tax: Number(subtotal) * Number(taxRate),
      total: Number(total),

      currency: { code: currencyCode, symbol: currencySymbol },
      currencyCode,
      currencySymbol,

      notes: "",
      payments: [],
      createdAt: todayISO,

      details: {
        costs: {
          subtotal: Number(subtotal),
          taxRate: Number(taxRate),
          tax: Number(subtotal) * Number(taxRate),
          total: Number(total),
          currency: { code: currencyCode, symbol: currencySymbol },
        },
      },
    };

    try {
      addInvoice?.(invoiceObj as any);

      // Still generate the PDF, but stay on the Visualizer
      exportInvoicePDF?.({
        invoice: invoiceObj,
        customer: customerObj
          ? {
              id: customerObj.id,
              firstName: customerObj.firstName,
              lastName: customerObj.lastName,
              email: customerObj.email,
              phone: customerObj.phone,
              company: customerObj.company,
              address1: customerObj.address1,
              address2: customerObj.address2,
              city: customerObj.city,
              postcode:
                customerObj.postcode || customerObj.postalCode,
              country: customerObj.country,
            }
          : undefined,
        settings: {
          companyName: settings?.companyName,
          companyEmail: settings?.companyEmail,
          companyPhone: settings?.companyPhone,
          companyAddress: settings?.companyAddress,
          logoDataUrl: (settings as any)?.companyLogoDataUrl,
          currencySymbol,
          currencyCode,
          themeColor: settings?.themeColor,
          bankDetails: (settings as any)?.bankDetails,
          taxNumber: (settings as any)?.taxNumber,
          invoiceFooterNote: (settings as any)?.invoiceFooterNote,
        },
      } as any);

      alert("Invoice created and added to Invoices.");
      // ⬆️ No navigation: we stay on the Visualizer
    } catch (err) {
      console.error(err);
      alert(
        "Invoice creation or PDF export failed. See console for details."
      );
    }
  }

  function handleCreateQuoteInvoiceJob() {
    try {
      addQuoteNow();
      addJobNow();
      invoiceNow();
    } catch (e) {
      console.error("Failed to create Quote + Invoice + Job", e);
      alert(
        "Could not create Quote + Invoice + Job. Please check the console for details."
      );
    }
  }

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

  // ---------- Presets ----------
  const customerKey =
    selectedCustomerId && selectedCustomerId !== "__new__"
      ? selectedCustomerId
      : "anonymous";

  const [presets, setPresets] = useState<VisualizerPreset[]>([]);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDivElement | null>(null);
  const currentState = useMemo(
    () => ({
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
        mat1BorderCm,
        mat2BorderCm,
        mat3BorderCm,
        openings,
        mode,
      },
      glazing: { id: selectedGlazingId },
      printing: { includePrint, printMaterialId },
      backer: { includeBacker },
      backdrop,
    }),
    [
      unit,
      sizeMode,
      artWcm,
      artHcm,
      artworkUrl,
      selectedFrame,
      faceAuto,
      faceWidthCm,
      framePreviewColor,
      frameTextureUrl,
      useFrameTexture,
      textureScalePct,
      selectedMat1,
      selectedMat2,
      selectedMat3,
      mat1BorderCm,
      mat2BorderCm,
      mat3BorderCm,
      openings,
      mode,
      selectedGlazingId,
      includePrint,
      printMaterialId,
      includeBacker,
      backdrop,
    ]
  );

  useEffect(() => {
    setPresets(listPresets(customerKey));
  }, [customerKey]);

  // Close preset menu on outside click
  type PresetScope = "me" | "shared";

  function handleSavePreset(scope: PresetScope = "shared") {
    const label =
      scope === "me"
        ? "Preset name (for your use)?"
        : "Preset name (for everyone to use)?";

    const baseName = window.prompt(label);
    if (!baseName || !baseName.trim()) return;

    const prefix = scope === "me" ? "👤 " : "🌐 ";
    const name = prefix + baseName.trim();

    try {
      const created = savePreset(customerKey, { name, state: currentState });
      setPresets((prev) => [created, ...prev]);
    } catch (e: any) {
      console.error("Failed to save preset", e);

      const message =
        e && (e.name === "QuotaExceededError" || e.code === 22)
          ? "Preset storage is full in this browser. Please delete some older presets or clear FrameIT data and try again."
          : "Could not save this preset. Please try again.";

      alert(message);
    }
  }

  function closePresetMenu() {
    setPresetMenuOpen(false);
  }

  function applyPreset(p: VisualizerPreset) {
    try {
      const s = (p.state as any) || {};
      setUnit(s.unit === "imperial" ? "imperial" : "metric");
      setSizeMode(s.sizeMode === "frame" ? "frame" : "image");
      setArtWcm(Number(s?.art?.widthCm) || 40);
      setArtHcm(Number(s?.art?.heightCm) || 30);
      setArtworkUrl(String(s?.art?.imageUrl || ""));
      setSelectedFrame(String(s?.frame?.id || "frame1"));
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
      if (Number.isFinite(s?.mats?.mat1BorderCm))
        setMat1BorderCm(Number(s.mats.mat1BorderCm));
      if (Number.isFinite(s?.mats?.mat2BorderCm))
        setMat2BorderCm(Number(s.mats.mat2BorderCm));
      if (Number.isFinite(s?.mats?.mat3BorderCm))
        setMat3BorderCm(Number(s.mats.mat3BorderCm));

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
      setBackdrop(
        (
          ["studio", "living", "gallery", "office"] as const
        ).includes(s?.backdrop)
          ? s.backdrop
          : "studio"
      );
    } catch (e) {
      console.error("Failed to apply preset", e);
      alert(
        "Could not apply this preset. It may be from an older version."
      );
    }
  }

  function removePreset(id: string) {
    deletePreset(customerKey, id);
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }

  // ---------- Export menu ----------
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

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

  // ---------- BASIC MODE MAT STACK ----------
  const basicMatMarkup = React.useMemo<React.ReactNode>(() => {
    if (mode !== "basic") return null;

    const matsStack: { color: string; borderCm: number }[] = [];
    if (hasMat1)
      matsStack.push({ color: mat1Color, borderCm: mat1BorderCm });
    if (hasMat2)
      matsStack.push({ color: mat2Color, borderCm: mat2BorderCm });
    if (hasMat3)
      matsStack.push({ color: mat3Color, borderCm: mat3BorderCm });

    const renderArtwork = () => (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#FFF",
          overflow: "hidden",
        }}
      >
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt="artwork"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
            draggable={false}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-neutral-700 text-sm">
              Upload an image to preview
            </span>
          </div>
        )}
      </div>
    );

    if (!matsStack.length) {
      return renderArtwork();
    }

    const buildLayers = (index: number): React.ReactElement => {
      if (index >= matsStack.length) {
        return renderArtwork();
      }

      const mat = matsStack[index];
      const insetPx = px(mat.borderCm);

      const nextColor =
        index + 1 < matsStack.length
          ? matsStack[index + 1].color
          : "#FFF";

      return (
        <div
          style={{
            position: "absolute",
            inset: insetPx,
            background: nextColor,
          }}
        >
          {buildLayers(index + 1)}
        </div>
      );
    };

    const outerColor = matsStack[0].color;

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: outerColor,
        }}
      >
        {buildLayers(0)}
      </div>
    );
  }, [
    mode,
    hasMat1,
    hasMat2,
    hasMat3,
    mat1Color,
    mat2Color,
    mat3Color,
    mat1BorderCm,
    mat2BorderCm,
    mat3BorderCm,
    artworkUrl,
    px,
  ]);

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
                {(catalog?.frames || []).map((f: any) => (
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
                  setMode(e.target.value as "basic" | "pro")
                }
              >
                <option value="basic">Basic</option>
                <option value="pro">Pro (multi-opening)</option>
              </select>
            </div>

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
                <option value="mat0">None</option>
                {(catalog?.mats || []).map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              {hasMat1 && (
                <>
                  <label className="block text-sm font-medium text-slate-700 mt-2">
                    Mat 1 border (cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    defaultValue={mat1BorderCm.toFixed(1)}
                    onBlur={(e) =>
                      handleMatBorderChange(1, e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = (
                          e.target as HTMLInputElement
                        ).value;
                        handleMatBorderChange(1, val);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-full rounded-lg border p-2 text-sm bg-white/90"
                  />
                </>
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
                  <option value="mat0">None</option>
                  {(catalog?.mats || []).map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {hasMat2 && (
                  <>
                    <label className="block text-sm font-medium text-slate-700 mt-2">
                      Mat 2 border (cm)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      defaultValue={mat2BorderCm.toFixed(1)}
                      onBlur={(e) =>
                        handleMatBorderChange(2, e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const val = (
                            e.target as HTMLInputElement
                          ).value;
                          handleMatBorderChange(2, val);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="w-full rounded-lg border p-2 text-sm bg-white/90"
                    />
                  </>
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
                      <option value="mat0">None</option>
                      {(catalog?.mats || []).map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>

                    {hasMat3 && (
                      <>
                        <label className="block text-sm font-medium text-slate-700 mt-2">
                          Mat 3 border (cm)
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          defaultValue={mat3BorderCm.toFixed(1)}
                          onBlur={(e) =>
                            handleMatBorderChange(
                              3,
                              e.target.value
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const val = (
                                e.target as HTMLInputElement
                              ).value;
                              handleMatBorderChange(3, val);
                              (
                                e.target as HTMLInputElement
                              ).blur();
                            }
                          }}
                          className="w-full rounded-lg border p-2 text-sm bg-white/90"
                        />
                      </>
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
                          xCm: 2,
                          yCm: 2,
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
                          xCm: 2,
                          yCm: 2,
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
                          xCm: 2,
                          yCm: 2,
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
                  {openings.map((o) => (
                    <div
                      key={o.id}
                      className={`flex items-center justify-between rounded border px-2 py-1 text-xs bg-white ${
                        selectedOpeningId === o.id
                          ? "border-emerald-500"
                          : "border-slate-300"
                      }`}
                    >
                      <div className="truncate">
                        <span className="font-medium">
                          {o.shape}
                        </span>{" "}
                        <span className="text-slate-600">
                          {Math.round(o.widthCm)}×
                          {Math.round(o.heightCm)}cm @{" "}
                          {Math.round(o.xCm)},
                          {Math.round(o.yCm)}
                        </span>
                      </div>
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
                Foam board backer{" "}
                {foamBackerPerSqM ? (
                  <span className="text-xs text-slate-500">
                    ({moneyIntl(foamBackerPerSqM)}/m²)
                  </span>
                ) : null}
              </label>
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
              {glazingList.map((g: any) => (
                <option key={g.id} value={g.id}>
                  {g.name} — {moneyIntl(Number(g.pricePerSqM))}
                  /m²
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
                  value={printMaterialId}
                  onChange={(e) =>
                    setPrintMaterialId(e.target.value)
                  }
                >
                  <option value="">
                    Use fallback — {moneyIntl(fallbackPrintSqM)}
                    /m²
                  </option>
                  {PRINT_MATS.map((pm: any) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name} —{" "}
                      {moneyIntl(Number(pm.pricePerSqM))}
                      /m²
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
                    className="rounded-lg px-3 py-1.5 text-xs bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                    onClick={() =>
                      setExportMenuOpen((o) => !o)
                    }
                  >
                    Export image ▾
                  </button>
                  {exportMenuOpen && (
                    <div className="absolute right-0 mt-1 w-32 rounded-lg border bg-white shadow-lg z-20 text-xs">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
                        onClick={() => {
                          setExportMenuOpen(false);
                          if (previewRef.current)
                            exportNodeAsPng(previewRef.current);
                        }}
                      >
                        PNG
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
                        onClick={() => {
                          setExportMenuOpen(false);
                          if (previewRef.current)
                            exportNodeAsJpeg(previewRef.current);
                        }}
                      >
                        JPG
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
                        onClick={() => {
                          setExportMenuOpen(false);
                          if (previewRef.current)
                            exportNodeAsPdf(previewRef.current);
                        }}
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
                    maxWidth: "100%",
                    maxHeight: "70vh",
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
                      background: hasMat3
                        ? mat3Color
                        : hasMat2
                        ? mat2Color
                        : hasMat1
                        ? mat1Color
                        : "#EEE",
                      borderRadius: 0,
                      overflow: "hidden",
                    }}
                  >
                    {/* BASIC MODE stacked mats */}
                    {mode === "basic" && basicMatMarkup}

                    {/* PRO MODE openings */}
                    {mode === "pro" &&
                      openings.map((o) => {
                        const left = px(o.xCm);
                        const top = px(o.yCm);
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
                            onMouseEnter={() =>
                              setHoveredOpeningId(o.id)
                            }
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
                            <div
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
                            {hoveredOpeningId === o.id && (
                              <>
                                <Handle
                                  o={o}
                                  handle="nw"
                                  style={{
                                    left: -6,
                                    top: -6,
                                    cursor:
                                      "nwse-resize",
                                  }}
                                />
                                <Handle
                                  o={o}
                                  handle="ne"
                                  style={{
                                    right: -6,
                                    top: -6,
                                    cursor:
                                      "nesw-resize",
                                  }}
                                />
                                <Handle
                                  o={o}
                                  handle="sw"
                                  style={{
                                    left: -6,
                                    bottom: -6,
                                    cursor:
                                      "nesw-resize",
                                  }}
                                />
                                <Handle
                                  o={o}
                                  handle="se"
                                  style={{
                                    right: -6,
                                    bottom: -6,
                                    cursor:
                                      "nwse-resize",
                                  }}
                                />
                                <Handle
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
                                <Handle
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
                                <Handle
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
                                <Handle
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
                    openings={
                      mode === "pro" ? openings : undefined
                    }
                    artSizeCm={{
                      widthCm: artWcm,
                      heightCm: artHcm,
                    }}
                    onOpeningsChange={(next) =>
                      setOpenings(next)
                    }
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
                  <span>Cost</span>
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">
                    Admin currency: {currencyCode}
                  </span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Frame</span>
                    <span>{moneyIntl(frameCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Glazing</span>
                    <span>{moneyIntl(glazingCost)}</span>
                  </div>
                  {hasMat1 && (
                    <div className="flex justify-between">
                      <span>Mat 1</span>
                      <span>{moneyIntl(mat1Cost)}</span>
                    </div>
                  )}
                  {hasMat2 && (
                    <div className="flex justify-between">
                      <span>Mat 2</span>
                      <span>{moneyIntl(mat2Cost)}</span>
                    </div>
                  )}
                  {hasMat3 && (
                    <div className="flex justify-between">
                      <span>Mat 3</span>
                      <span>{moneyIntl(mat3Cost)}</span>
                    </div>
                  )}
                  {includePrint && (
                    <div className="flex justify-between">
                      <span>Printing</span>
                      <span>{moneyIntl(printingCost)}</span>
                    </div>
                  )}
                  {includeBacker && (
                    <div className="flex justify-between">
                      <span>Backer</span>
                      <span>{moneyIntl(backerCost)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Labour</span>
                    <span>{moneyIntl(labourBase)}</span>
                  </div>
                  {marginMultiplier !== 1 && (
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>Margin multiplier</span>
                      <span>× {marginMultiplier.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="border-t border-slate-700 pt-1 flex justify-between">
                    <span>Subtotal</span>
                    <span>{moneyIntl(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-200">
                    <span>Tax</span>
                    <span>{moneyIntl(subtotal * taxRate)}</span>
                  </div>
                  <div className="font-semibold border-t border-slate-700 pt-1 flex justify-between text-lg">
                    <span>Total</span>
                    <span className="text-emerald-300">
                      {moneyIntl(total)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT */}
        <aside className="space-y-3">
          {/* Presets */}
          <div className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-slate-900">
                  Presets
                </h3>
                <p className="text-xs text-slate-500">
                  Save this exact setup for reuse.
                </p>
              </div>
              <div className="relative" ref={presetMenuRef}>
                <button
                  type="button"
                  className="relative inline-flex items-center justify-between gap-1 rounded-lg px-3 py-1.5 text-sm bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm whitespace-nowrap"
                  onClick={() =>
                    setPresetMenuOpen((o) => !o)
                  }
                  title="Save current setup as a preset"
                >
                  <span>Save preset</span>
                  <span className="text-[10px] leading-none">
                    ▾
                  </span>
                </button>
                {presetMenuOpen && (
                  <div className="absolute right-0 mt-1 w-40 rounded-lg border bg-white shadow-lg z-20 text-xs">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
                      onClick={() => {
                        closePresetMenu();
                        handleSavePreset("me");
                      }}
                    >
                      Save for user
                    </button>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
                      onClick={() => {
                        closePresetMenu();
                        handleSavePreset("shared");
                      }}
                    >
                      Save preset
                    </button>
                  </div>
                )}
              </div>
            </div>

            {presets.length === 0 ? (
              <p className="text-sm text-slate-500">
                No presets yet for this customer.
              </p>
            ) : (
              <ul className="space-y-2">
                {presets.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate text-slate-900">
                        {p.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(
                          p.createdAt
                        ).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        className="rounded-lg px-2 py-1 text-xs bg-white ring-1 ring-slate-300 hover:bg-slate-100"
                        onClick={() => applyPreset(p)}
                      >
                        Load
                      </button>
                      <button
                        className="rounded-lg px-2 py-1 text-xs bg-white ring-1 ring-rose-200 text-rose-600 hover:bg-rose-50"
                        onClick={() =>
                          removePreset(p.id)
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Customer */}
          <div className="bg-white/95 rounded-2xl shadow-sm ring-1 ring-emerald-100 p-4">
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
                onClick={saveToCRM}
                className="rounded-lg border border-emerald-300 px-3 py-2 text-sm bg-white 
                        hover:bg-emerald-600 hover:text-white transition"
              >
                Save to CRM
              </button>

              {/* Add to Quotes */}
              <button
                onClick={addQuoteNow}
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
                  addJobNow();
                }}
                className="rounded-lg border border-blue-300 px-3 py-2 text-sm bg-white 
                        hover:bg-blue-600 hover:text-white transition"
              >
                Add to Jobs
              </button>

              {/* Add to Invoices */}
              <button
                onClick={invoiceNow}
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
