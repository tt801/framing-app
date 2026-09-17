// src/lib/store.ts
import { useEffect, useMemo, useRef, useState } from "react";
import { useBillingWriteGuard } from "@/lib/billingAccess";
import { useCompany } from "@/lib/company";
import { supabase } from "@/lib/supabase";

export type Frame = {
  id: string;
  name: string;
  pricePerMeter: number;
  faceWidthCm: number;
  color?: string;
};

export type Mat = {
  id: string;
  name: string;
  pricePerSqM: number;
  color?: string;
};

export type Glazing = {
  id: string;
  name: string;
  pricePerSqM: number;
};

export type PrintingMaterial = {
  id: string;
  name: string;
  pricePerSqM: number;
};

/** NEW: Backer boards stored in the shared catalog */
export type Backer = {
  id: string;
  name: string;
  pricePerSqM: number;
  code?: string;
  kind?: string; // e.g. MDF / Conservation / Foamcore
  markupPercent?: number;
};

export type StockFrame = {
  profileId: string;
  metersAvailable: number;
  minThreshold?: number;
};

export type StockSheet = {
  id: string;
  type: "mat" | "glazing" | "backer";
  sku?: string;
  widthCm: number;
  heightCm: number;
  qty: number;
  minThreshold?: number;
};

export type StockRoll = {
  materialId: string;
  widthCm: number;
  metersRemaining: number;
  minThreshold?: number;
};

export type Settings = {
  unit: "metric" | "imperial";
  currencySymbol: string;
  currencyCode: string;
  themeColor: string;

  labourBase: number;
  printingPerSqM: number;
  marginMultiplier: number;

  foamBackerPerSqM?: number;

  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogoDataUrl?: string;

  // Invoice config
  invoicePrefix?: string;
  invoiceStartNumber?: number; // default 1000
  bankDetails?: string;

  /**
   * @deprecated Use vatNumber instead. Kept for backward compatibility during migration.
   */
  taxNumber?: string;

  paymentTermsDays?: number; // default 14
  invoiceFooterNote?: string;

  // NEW: Tax fields used by invoice totals/PDFs
  taxRatePct?: number; // e.g. 15
  taxLabel?: string; // e.g. "VAT" or "GST"
  vatNumber?: string; // e.g. "ZA1234567890"

  // AI/backdrops
  enableAIBackdrops?: boolean;
};

export type Catalog = {
  frames: Frame[];
  mats: Mat[];
  glazing: Glazing[];
  printingMaterials?: PrintingMaterial[];

  /** NEW: shared backer-board list for Admin + Stock */
  backers?: Backer[];

  settings: Settings;
  stock?: {
    frames?: StockFrame[];
    sheets?: StockSheet[];
    rolls?: StockRoll[];
  };
};

const STORAGE_KEY = "framing_app_catalog_v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadCatalog(): Catalog | null {
  return safeParse<Catalog>(localStorage.getItem(STORAGE_KEY));
}

function saveCatalog(catalog: Catalog) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const defaultCatalog: Catalog = {
  frames: [
    {
      id: "fr1",
      name: "Black Classic 20mm",
      pricePerMeter: 120,
      faceWidthCm: 2,
      color: "#111",
    },
    {
      id: "fr2",
      name: "Oak 30mm",
      pricePerMeter: 180,
      faceWidthCm: 3,
      color: "#b88a58",
    },
  ],
  mats: [
    {
      id: "mat0",
      name: "No mat",
      pricePerSqM: 0,
      color: "transparent",
    },
    {
      id: "mat1",
      name: "Bright White",
      pricePerSqM: 220,
      color: "#F8F8F4",
    },
    {
      id: "mat2",
      name: "Museum Off-white",
      pricePerSqM: 280,
      color: "#EFEDE6",
    },
    {
      id: "mat3",
      name: "Charcoal",
      pricePerSqM: 260,
      color: "#3a3a3a",
    },
  ],
  glazing: [
    { id: "gl1", name: "Regular Glass", pricePerSqM: 250 },
    { id: "gl2", name: "UV Acrylic", pricePerSqM: 420 },
  ],
  printingMaterials: [
    { id: "pm1", name: "Photo Lustre 260gsm", pricePerSqM: 180 },
    { id: "pm2", name: "Fine Art Rag 300gsm", pricePerSqM: 350 },
  ],

  /** NEW: default backer list (empty – you can seed if you like) */
  backers: [],

  settings: {
    unit: "metric",
    currencySymbol: "R ",
    currencyCode: "ZAR",
    themeColor: "#0F172A",
    labourBase: 120,
    printingPerSqM: 180,
    marginMultiplier: 1.25,
    foamBackerPerSqM: 0,

    companyName: "FrameIT",
    companyEmail: "",
    companyPhone: "",
    companyAddress: "",
    companyLogoDataUrl: "",

    // Invoice defaults
    invoicePrefix: "INV-",
    invoiceStartNumber: 1000,
    bankDetails: "",
    taxNumber: "", // deprecated; kept for migration
    paymentTermsDays: 14,
    invoiceFooterNote: "Thank you for your business.",

    // NEW: Tax defaults
    taxRatePct: 15,
    taxLabel: "VAT",
    vatNumber: "",

    // Backdrops
    enableAIBackdrops: false,
  },
  stock: {
    frames: [],
    sheets: [],
    rolls: [],
  },
};
const emptyCatalog: Catalog = { frames: [], mats: [], glazing: [], printingMaterials: [], backers: [], settings: defaultCatalog.settings, stock: { frames: [], sheets: [], rolls: [] } };

function ensureMat0(mats: Mat[]): Mat[] {
  return mats.some((m) => m.id === "mat0")
    ? mats
    : [
        {
          id: "mat0",
          name: "No mat",
          pricePerSqM: 0,
          color: "transparent",
        },
        ...mats,
      ];
}

function migrateCatalog(oldCat: Partial<Catalog> | null): Catalog {
  if (!oldCat) return defaultCatalog;

  const frames =
    Array.isArray(oldCat.frames) && oldCat.frames.length
      ? oldCat.frames
      : defaultCatalog.frames;

  const mats = ensureMat0(
    Array.isArray(oldCat.mats) && oldCat.mats.length
      ? oldCat.mats
      : defaultCatalog.mats
  );

  const glazing =
    Array.isArray(oldCat.glazing) && oldCat.glazing.length
      ? oldCat.glazing
      : defaultCatalog.glazing;

  const printingMaterials =
    Array.isArray(oldCat.printingMaterials) &&
    oldCat.printingMaterials.length
      ? oldCat.printingMaterials
      : defaultCatalog.printingMaterials;

  /** NEW: keep any existing backer boards instead of dropping them */
  const backers: Backer[] =
    Array.isArray((oldCat as any).backers) &&
    (oldCat as any).backers.length
      ? ((oldCat as any).backers as Backer[])
      : defaultCatalog.backers ?? [];

  // Merge settings with defaults, then apply migrations/back-compat
  const settings: Settings = {
    ...defaultCatalog.settings,
    ...(oldCat.settings as Settings),
  };

  // Ensure numeric defaults
  if (typeof settings.foamBackerPerSqM !== "number")
    settings.foamBackerPerSqM = 0;
  if (typeof settings.invoiceStartNumber !== "number")
    settings.invoiceStartNumber = 1000;
  if (typeof settings.paymentTermsDays !== "number")
    settings.paymentTermsDays = 14;

  // NEW: tax defaults + back-compat mapping taxNumber -> vatNumber
  if (typeof settings.taxRatePct !== "number")
    settings.taxRatePct = defaultCatalog.settings.taxRatePct;
  if (!settings.taxLabel) settings.taxLabel = defaultCatalog.settings.taxLabel;
  if (!settings.vatNumber && settings.taxNumber)
    settings.vatNumber = settings.taxNumber; // migrate old field

  const stock = {
    frames: oldCat.stock?.frames ?? defaultCatalog.stock?.frames ?? [],
    sheets: oldCat.stock?.sheets ?? defaultCatalog.stock?.sheets ?? [],
    rolls: oldCat.stock?.rolls ?? defaultCatalog.stock?.rolls ?? [],
  };

  // Basic sanity on a few key fields
  settings.currencySymbol =
    settings.currencySymbol || defaultCatalog.settings.currencySymbol;
  settings.currencyCode =
    settings.currencyCode || defaultCatalog.settings.currencyCode;
  settings.unit =
    (settings.unit as any) === "imperial" ? "imperial" : "metric";

  return {
    frames,
    mats,
    glazing,
    printingMaterials,
    backers,
    settings,
    stock,
  };
}

export function useCatalog() {
  const allowWrite = useBillingWriteGuard();
  const company = useCompany();
  const companyAccountId = (company as any).companyAccountId;
  const [catalog, _setCatalog] = useState<Catalog>(() => emptyCatalog);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [revision, setRevision] = useState(1);
  const [hasServerCatalog, setHasServerCatalog] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const request = ++requestId.current;
    if (!supabase || !companyAccountId) { _setCatalog(emptyCatalog); setCatalogLoading(false); return; }
    setCatalogLoading(true); _setCatalog(emptyCatalog);
    void supabase.from('company_catalog').select('catalog, revision').eq('company_account_id', companyAccountId).maybeSingle().then(({ data, error }) => {
      if (requestId.current !== request) return;
      if (error) { setCatalogError(error.message); setCatalogLoading(false); return; }
      _setCatalog(data?.catalog ? migrateCatalog(data.catalog) : emptyCatalog); setRevision(data?.revision || 1); setHasServerCatalog(Boolean(data)); setCatalogError(null); setCatalogLoading(false);
    });
  }, [companyAccountId]);

  const setCatalog = async (updater: Catalog | ((prev: Catalog) => Catalog)) => {
    if (!allowWrite("update your catalog")) return { ok: false, error: "Read-only account" };
    if (!supabase || !companyAccountId) return { ok: false, error: "No active company account" };
    const previous = catalog;
    const nextCatalog = migrateCatalog(typeof updater === "function" ? (updater as any)(previous) : updater);
    if (JSON.stringify({ ...nextCatalog, settings: undefined }) === JSON.stringify({ ...previous, settings: undefined })) return { ok: true, unchanged: true };
    const { data, error } = hasServerCatalog
      ? await supabase.rpc('update_company_catalog', { p_company_account_id: companyAccountId, p_catalog: { ...nextCatalog, settings: undefined }, p_revision: revision })
      : await supabase.from('company_catalog').insert({ company_account_id: companyAccountId, catalog: { ...nextCatalog, settings: undefined }, revision: 1 }).select('catalog, revision').single();
    if (error || !data) {
      const conflict = !hasServerCatalog && error?.code === '23505';
      const message = conflict ? 'Catalog already contains products or stock. Resolve conflicts before importing.' : (error?.message || 'Could not save catalog');
      setCatalogError(message); return { ok: false, error: message };
    }
    _setCatalog({ ...migrateCatalog(data.catalog), settings: company.profile }); setRevision(data.revision); setHasServerCatalog(true); return { ok: true };
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(catalog, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `frameit-catalog-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importJSON = async (file: File) => {
    if (!allowWrite("import catalog data")) return;
    const text = await file.text();
    const parsed = safeParse<Catalog>(text);
    if (!parsed) throw new Error("Invalid JSON");
    setCatalog(migrateCatalog(parsed));
  };

  const resetCatalog = () => {
    if (!allowWrite("reset your catalog")) return;
    setCatalog(defaultCatalog);
  };

  const effectiveCatalog = useMemo(() => ({ ...catalog, settings: company.profile }), [catalog, company.profile]);
  const maps = useMemo(() => {
    const frameMap = new Map(catalog.frames.map((f) => [f.id, f]));
    const matMap = new Map(catalog.mats.map((m) => [m.id, m]));
    const glazingMap = new Map(catalog.glazing.map((g) => [g.id, g]));
    const printMap = new Map(
      (catalog.printingMaterials || []).map((pm) => [pm.id, pm])
    );
    // backerMap can be added later if needed
    return { frameMap, matMap, glazingMap, printMap };
  }, [catalog]);

  const legacyCatalogPreview = useMemo(() => { const legacy = migrateCatalog(loadCatalog()); return { frameCount: legacy.frames.length, matCount: legacy.mats.length, glazingCount: legacy.glazing.length, stockCount: (legacy.stock?.frames?.length || 0) + (legacy.stock?.sheets?.length || 0) + (legacy.stock?.rolls?.length || 0) }; }, []);
  const importLegacyCatalog = async () => {
    const legacy = migrateCatalog(loadCatalog());
    const hasExisting = catalog.frames.length || catalog.mats.length || catalog.glazing.length || (catalog.printingMaterials?.length || 0) || (catalog.backers?.length || 0) || (catalog.stock?.frames?.length || 0) || (catalog.stock?.sheets?.length || 0) || (catalog.stock?.rolls?.length || 0);
    if (hasExisting) return { ok: false, error: 'Catalog already contains products or stock. Resolve conflicts before importing.' };
    return setCatalog(legacy);
  };
  return { catalog: effectiveCatalog, setCatalog, saveSettings: company.save, importLegacySettings: company.importLegacy, legacySettingsPreview: company.getLegacyCompanyPreview(), legacyCatalogPreview, importLegacyCatalog, exportJSON, importJSON, resetCatalog, maps, loading: catalogLoading, error: catalogError, settingsLoading: company.loading, settingsError: company.error };
}

export function newFrame(partial?: Partial<Frame>): Frame {
  return {
    id: partial?.id || `fr_${uid()}`,
    name: partial?.name || "New Frame",
    pricePerMeter: partial?.pricePerMeter ?? 0,
    faceWidthCm: partial?.faceWidthCm ?? 2,
    color: partial?.color ?? "#111",
  };
}

export function newMat(partial?: Partial<Mat>): Mat {
  return {
    id: partial?.id || `mat_${uid()}`,
    name: partial?.name || "New Mat",
    pricePerSqM: partial?.pricePerSqM ?? 0,
    color: partial?.color ?? "#EEEEEE",
  };
}

export function newGlazing(partial?: Partial<Glazing>): Glazing {
  return {
    id: partial?.id || `gl_${uid()}`,
    name: partial?.name || "New Glazing",
    pricePerSqM: partial?.pricePerSqM ?? 0,
  };
}

export function newPrintingMaterial(
  partial?: Partial<PrintingMaterial>
): PrintingMaterial {
  return {
    id: partial?.id || `pm_${uid()}`,
    name: partial?.name || "New Printing Material",
    pricePerSqM: partial?.pricePerSqM ?? 0,
  };
}

/** NEW: Backer board factory for Admin + Stock */
export function newBacker(partial?: Partial<Backer>): Backer {
  return {
    id: partial?.id || `back_${uid()}`,
    name: partial?.name || "New backer",
    pricePerSqM: partial?.pricePerSqM ?? 0,
    code: partial?.code ?? "",
    kind: partial?.kind ?? "",
    markupPercent: partial?.markupPercent ?? 0,
  };
}
