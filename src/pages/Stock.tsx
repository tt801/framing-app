// src/pages/Stock.tsx
import React, { useRef, useState } from "react";
import {
  useCatalog,
  type StockFrame,
  type StockSheet,
  type StockRoll,
} from "../lib/store";

// SKUs we never want in sheet stock (legacy junk / samples)
const SKUS_TO_DROP = new Set<string>([
  "mat0",
  "mat2",
  "mat3",
  "mat_b8bc4yk9",
  "g1",
  "g2",
  "g3",
  "gl_q9cc7xmy",
]);

export default function StockPage() {
  const { catalog, setCatalog } = useCatalog();

  const [scanCode, setScanCode] = useState("");
  const [highlight, setHighlight] = useState<{
    section: "frames" | "sheets" | "rolls" | null;
    index: number;
  }>({ section: null, index: -1 });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const n = (v: any, fb = 0) => {
    const x = typeof v === "string" ? parseFloat(v) : Number(v);
    return Number.isFinite(x) ? x : fb;
  };

  // Safely tap into catalog items (frames only; others handled via prev inside setCatalog)
  const anyCatalog: any = catalog || {};
  const frameCatalog: any[] = anyCatalog.frames || [];

  // ---------- Frame name / id mapping (Admin -> Stock) ----------
  const frameNameById: Record<string, string> = {};
  frameCatalog.forEach((f) => {
    const id = String(f?.id ?? f?.profileId ?? f?.code ?? "").trim();
    const name = String(f?.name ?? id);
    if (!id) return;
    frameNameById[id] = name;
  });

  const frames: StockFrame[] = catalog.stock?.frames || [];
  const sheets: StockSheet[] = catalog.stock?.sheets || [];
  const rolls: StockRoll[] = catalog.stock?.rolls || [];

  // ----------------------------------------------------------------
  // ONE-TIME CLEANUP: remove specific junk SKUs from sheets
  // ----------------------------------------------------------------
  React.useEffect(() => {
    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const currentSheets: StockSheet[] = stockPrev.sheets || [];
      const cleaned = currentSheets.filter((s: any) => {
        const skuRaw = String(s?.sku ?? "").trim();
        if (!skuRaw) return true;
        return !SKUS_TO_DROP.has(skuRaw);
      });

      if (cleaned.length === currentSheets.length) return prev;
      return {
        ...prev,
        stock: {
          ...stockPrev,
          sheets: cleaned,
        },
      };
    });
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------------------
  // ONE-TIME SEED: if stock is empty, seed from Admin
  // ----------------------------------------------------------------

  // 1) Frames -> stock.frames (one row per Admin frame) if empty
  React.useEffect(() => {
    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const currentFrames: StockFrame[] = stockPrev.frames || [];

      if (currentFrames.length > 0) return prev; // already have frame stock

      const newFrames: StockFrame[] = (prev.frames || []).map((f: any) => ({
        profileId: String(f.id ?? f.profileId ?? f.code ?? "").trim(),
        metersAvailable: 0,
        minThreshold: 0,
      }));

      return {
        ...prev,
        stock: {
          ...stockPrev,
          frames: newFrames,
        },
      };
    });
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Mats + Glazing + Backers -> stock.sheets if empty
  React.useEffect(() => {
    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const currentSheets: StockSheet[] = stockPrev.sheets || [];
      if (currentSheets.length > 0) return prev; // already have sheet stock

      const mats: any[] = prev.mats || [];
      const glazing: any[] = prev.glazing || [];
      const backers: any[] =
        (prev as any).backers || (prev as any).backerBoards || [];

      const newSheets: StockSheet[] = [];

      // Mats (skip "No mat" mat0 and any SKUS_TO_DROP)
      mats.forEach((m: any) => {
        if (String(m.id ?? "").trim() === "mat0") return;
        const sku = String(m.code || m.name || m.id || "").trim();
        if (!sku || SKUS_TO_DROP.has(sku)) return;
        newSheets.push({
          id: rid(),
          type: "mat",
          sku,
          widthCm: 100,
          heightCm: 70,
          qty: 0,
          minThreshold: 0,
        });
      });

      // Glazing (skip junk SKUs)
      glazing.forEach((g: any) => {
        const sku = String(g.code || g.name || g.id || "").trim();
        if (!sku || SKUS_TO_DROP.has(sku)) return;
        newSheets.push({
          id: rid(),
          type: "glazing",
          sku,
          widthCm: 100,
          heightCm: 70,
          qty: 0,
          minThreshold: 0,
        });
      });

      // Backers (skip junk SKUs)
      backers.forEach((b: any) => {
        const sku = String(b.code || b.name || b.id || "").trim();
        if (!sku || SKUS_TO_DROP.has(sku)) return;
        newSheets.push({
          id: rid(),
          type: "backer",
          sku,
          widthCm: 100,
          heightCm: 70,
          qty: 0,
          minThreshold: 0,
        });
      });

      return {
        ...prev,
        stock: {
          ...stockPrev,
          sheets: newSheets,
        },
      };
    });
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3) Printing materials -> stock.rolls if empty
  React.useEffect(() => {
    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const currentRolls: StockRoll[] = stockPrev.rolls || [];
      if (currentRolls.length > 0) return prev; // already have rolls

      const printing: any[] = (prev as any).printingMaterials || [];
      const newRolls: StockRoll[] = printing
        .map((pm: any) => {
          // Prefer code/name/id for the visible materialId
          const id = String(pm.code || pm.name || pm.id || "").trim();
          if (!id) return null;
          return {
            materialId: id,
            widthCm: 61,
            metersRemaining: 0,
            minThreshold: 0,
          } as StockRoll;
        })
        .filter(Boolean) as StockRoll[];

      return {
        ...prev,
        stock: {
          ...stockPrev,
          rolls: newRolls,
        },
      };
    });
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------------------
  // RESET: rebuild all stock strictly from Admin
  // ----------------------------------------------------------------
  const resetStockFromAdmin = () => {
    let stats:
      | {
          framesBefore: number;
          framesAfter: number;
          sheetsBefore: number;
          sheetsAfter: number;
          rollsBefore: number;
          rollsAfter: number;
        }
      | null = null;

    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const mats: any[] = prev.mats || [];
      const glazing: any[] = prev.glazing || [];
      const backers: any[] =
        (prev as any).backers || (prev as any).backerBoards || [];
      const printing: any[] = (prev as any).printingMaterials || [];
      const framesAdmin: any[] = prev.frames || [];

      const framesBefore = (stockPrev.frames || []).length;
      const sheetsBefore = (stockPrev.sheets || []).length;
      const rollsBefore = (stockPrev.rolls || []).length;

      // Frames
      const newFrames: StockFrame[] = framesAdmin.map((f: any) => ({
        profileId: String(f.id ?? f.profileId ?? f.code ?? "").trim(),
        metersAvailable: 0,
        minThreshold: 0,
      }));

      // Sheets from mats/glazing/backers
      const newSheets: StockSheet[] = [];

      mats.forEach((m) => {
        if (String(m.id ?? "").trim() === "mat0") return;
        const sku = String(m.code || m.name || m.id || "").trim();
        if (!sku || SKUS_TO_DROP.has(sku)) return;
        newSheets.push({
          id: rid(),
          type: "mat",
          sku,
          widthCm: 100,
          heightCm: 70,
          qty: 0,
          minThreshold: 0,
        });
      });

      glazing.forEach((g) => {
        const sku = String(g.code || g.name || g.id || "").trim();
        if (!sku || SKUS_TO_DROP.has(sku)) return;
        newSheets.push({
          id: rid(),
          type: "glazing",
          sku,
          widthCm: 100,
          heightCm: 70,
          qty: 0,
          minThreshold: 0,
        });
      });

      backers.forEach((b) => {
        const sku = String(b.code || b.name || b.id || "").trim();
        if (!sku || SKUS_TO_DROP.has(sku)) return;
        newSheets.push({
          id: rid(),
          type: "backer",
          sku,
          widthCm: 100,
          heightCm: 70,
          qty: 0,
          minThreshold: 0,
        });
      });

      // Rolls
      const newRolls: StockRoll[] = printing
        .map((pm) => {
          const id = String(pm.code || pm.name || pm.id || "").trim();
          if (!id) return null;
          return {
            materialId: id,
            widthCm: 61,
            metersRemaining: 0,
            minThreshold: 0,
          } as StockRoll;
        })
        .filter(Boolean) as StockRoll[];

      stats = {
        framesBefore,
        framesAfter: newFrames.length,
        sheetsBefore,
        sheetsAfter: newSheets.length,
        rollsBefore,
        rollsAfter: newRolls.length,
      };

      return {
        ...prev,
        stock: {
          ...stockPrev,
          frames: newFrames,
          sheets: newSheets,
          rolls: newRolls,
        },
      };
    });

    if (stats) {
      window.alert(
        `Stock reset from Admin.\n` +
          `Frames: ${stats.framesBefore} → ${stats.framesAfter}\n` +
          `Sheets: ${stats.sheetsBefore} → ${stats.sheetsAfter}\n` +
          `Rolls: ${stats.rollsBefore} → ${stats.rollsAfter}`
      );
    }
  };

  // ----------------------------------------------------------------
  // MANUAL SYNC HELPERS: Admin → Stock
  // Admin is treated as the source of truth per category
  // ----------------------------------------------------------------

  const syncFramesFromAdmin = () => {
    let added = 0;
    let removed = 0;
    let kept = 0;

    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const currentFrames: StockFrame[] = stockPrev.frames || [];
      const adminFrames: any[] = prev.frames || [];

      const existingById = new Map<string, StockFrame>();
      currentFrames.forEach((f) => {
        const id = String(f.profileId ?? "").trim();
        if (!id) return;
        existingById.set(id, f);
      });

      kept = 0;
      added = 0;
      const newFrames: StockFrame[] = adminFrames
        .map((f) => {
          const id = String(f.id ?? f.profileId ?? f.code ?? "").trim();
          if (!id) return null;
          const existing = existingById.get(id);
          if (existing) kept++;
          else added++;
          return {
            profileId: id,
            metersAvailable: existing?.metersAvailable ?? 0,
            minThreshold: existing?.minThreshold ?? 0,
          } as StockFrame;
        })
        .filter(Boolean) as StockFrame[];

      removed = existingById.size - kept;

      return {
        ...prev,
        stock: {
          ...stockPrev,
          frames: newFrames,
        },
      };
    });

    window.alert(
      `Frames sync complete.\nKept: ${kept}\nAdded: ${added}\nRemoved: ${removed}`
    );
  };

  const syncMatsFromAdmin = () => {
    let added = 0;
    let removed = 0;
    let kept = 0;

    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const currentSheets: StockSheet[] = stockPrev.sheets || [];
      const mats: any[] = prev.mats || [];

      // Map existing mat rows by SKU
      const existingBySku = new Map<string, StockSheet>();
      const currentMatSheets = currentSheets.filter((s) => s.type === "mat");
      currentMatSheets.forEach((s: any) => {
        const sku = String(s.sku ?? "").trim();
        if (!sku) return;
        existingBySku.set(sku, s as StockSheet);
      });

      const otherTypes = currentSheets.filter((s) => s.type !== "mat");

      const nextMatSheets: StockSheet[] = [];
      kept = 0;
      added = 0;

      mats.forEach((m) => {
        if (String(m.id ?? "").trim() === "mat0") return; // skip "No mat"
        const sku = String(m.code || m.name || m.id || "").trim();
        if (!sku || SKUS_TO_DROP.has(sku)) return;

        const existing = existingBySku.get(sku);
        if (existing) {
          kept++;
          nextMatSheets.push(existing);
        } else {
          added++;
          nextMatSheets.push({
            id: rid(),
            type: "mat",
            sku,
            widthCm: 100,
            heightCm: 70,
            qty: 0,
            minThreshold: 0,
          });
        }
      });

      removed = existingBySku.size - kept;

      return {
        ...prev,
        stock: {
          ...stockPrev,
          sheets: [...otherTypes, ...nextMatSheets],
        },
      };
    });

    window.alert(
      `Mat sync complete.\nKept: ${kept}\nAdded: ${added}\nRemoved: ${removed}`
    );
  };

  const syncGlazingFromAdmin = () => {
    let added = 0;
    let removed = 0;
    let kept = 0;

    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const currentSheets: StockSheet[] = stockPrev.sheets || [];
      const glazing: any[] = prev.glazing || [];

      const existingBySku = new Map<string, StockSheet>();
      const currentGlazingSheets = currentSheets.filter(
        (s) => s.type === "glazing"
      );
      currentGlazingSheets.forEach((s: any) => {
        const sku = String(s.sku ?? "").trim();
        if (!sku) return;
        existingBySku.set(sku, s as StockSheet);
      });

      const otherTypes = currentSheets.filter((s) => s.type !== "glazing");

      const nextGlazingSheets: StockSheet[] = [];
      kept = 0;
      added = 0;

      glazing.forEach((g) => {
        const sku = String(g.code || g.name || g.id || "").trim();
        if (!sku || SKUS_TO_DROP.has(sku)) return;

        const existing = existingBySku.get(sku);
        if (existing) {
          kept++;
          nextGlazingSheets.push(existing);
        } else {
          added++;
          nextGlazingSheets.push({
            id: rid(),
            type: "glazing",
            sku,
            widthCm: 100,
            heightCm: 70,
            qty: 0,
            minThreshold: 0,
          });
        }
      });

      removed = existingBySku.size - kept;

      return {
        ...prev,
        stock: {
          ...stockPrev,
          sheets: [...otherTypes, ...nextGlazingSheets],
        },
      };
    });

    window.alert(
      `Glazing sync complete.\nKept: ${kept}\nAdded: ${added}\nRemoved: ${removed}`
    );
  };

  const syncBackersFromAdmin = () => {
    let added = 0;
    let removed = 0;
    let kept = 0;

    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const currentSheets: StockSheet[] = stockPrev.sheets || [];
      const backers: any[] =
        (prev as any).backers || (prev as any).backerBoards || [];

      const existingBySku = new Map<string, StockSheet>();
      const currentBackerSheets = currentSheets.filter(
        (s) => s.type === "backer"
      );
      currentBackerSheets.forEach((s: any) => {
        const sku = String(s.sku ?? "").trim();
        if (!sku) return;
        existingBySku.set(sku, s as StockSheet);
      });

      const otherTypes = currentSheets.filter((s) => s.type !== "backer");

      const nextBackerSheets: StockSheet[] = [];
      kept = 0;
      added = 0;

      backers.forEach((b) => {
        const sku = String(b.code || b.name || b.id || "").trim();
        if (!sku || SKUS_TO_DROP.has(sku)) return;

        const existing = existingBySku.get(sku);
        if (existing) {
          kept++;
          nextBackerSheets.push(existing);
        } else {
          added++;
          nextBackerSheets.push({
            id: rid(),
            type: "backer",
            sku,
            widthCm: 100,
            heightCm: 70,
            qty: 0,
            minThreshold: 0,
          });
        }
      });

      removed = existingBySku.size - kept;

      return {
        ...prev,
        stock: {
          ...stockPrev,
          sheets: [...otherTypes, ...nextBackerSheets],
        },
      };
    });

    window.alert(
      `Backer sync complete.\nKept: ${kept}\nAdded: ${added}\nRemoved: ${removed}`
    );
  };

  const syncPrintingFromAdmin = () => {
    let added = 0;
    let removed = 0;
    let kept = 0;

    setCatalog((prev) => {
      const stockPrev = prev.stock || {};
      const currentRolls: StockRoll[] = stockPrev.rolls || [];
      const printing: any[] = (prev as any).printingMaterials || [];

      const existingById = new Map<string, StockRoll>();
      currentRolls.forEach((r) => {
        const id = String(r.materialId ?? "").trim();
        if (!id) return;
        existingById.set(id, r);
      });

      kept = 0;
      added = 0;
      const nextRolls: StockRoll[] = printing
        .map((pm) => {
          const id = String(pm.code || pm.name || pm.id || "").trim();
          if (!id) return null;
          const existing = existingById.get(id);
          if (existing) kept++;
          else added++;
          return {
            materialId: id,
            widthCm: existing?.widthCm ?? 61,
            metersRemaining: existing?.metersRemaining ?? 0,
            minThreshold: existing?.minThreshold ?? 0,
          } as StockRoll;
        })
        .filter(Boolean) as StockRoll[];

      removed = existingById.size - kept;

      return {
        ...prev,
        stock: {
          ...stockPrev,
          rolls: nextRolls,
        },
      };
    });

    window.alert(
      `Printing sync complete.\nKept: ${kept}\nAdded: ${added}\nRemoved: ${removed}`
    );
  };

  const lowFrames =
    frames.filter((f) => n(f.metersAvailable) <= n(f.minThreshold)).length;
  const lowSheets =
    sheets.filter((s) => n(s.qty) <= n(s.minThreshold)).length;
  const lowRolls =
    rolls.filter((r) => n(r.metersRemaining) <= n(r.minThreshold)).length;
  const totalSkus = frames.length + sheets.length + rolls.length;

  // ------- CSV Export / Import -------

  const handleExportCSV = () => {
    const csv = buildStockCSV(frames, sheets, rolls);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "frameit-stock.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const { frames: f, sheets: s, rolls: r } = parseStockCSV(text);
        setCatalog((prev) => {
          const stock = prev.stock || {};
          return {
            ...prev,
            stock: {
              ...stock,
              frames: f,
              sheets: s,
              rolls: r,
            },
          };
        });
        window.alert(
          `Imported ${f.length} frames, ${s.length} sheets, ${r.length} rolls from CSV.`
        );
      } catch (err) {
        console.error(err);
        window.alert("Could not import stock CSV. Please check the format.");
      }
    };
    reader.readAsText(file);
    // reset input so same file can be re-selected
    e.target.value = "";
  };

  // ------- Barcode / scan search -------

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanCode.trim();
    if (!code) return;

    // 1) Try frames by profileId
    let section: "frames" | "sheets" | "rolls" | null = null;
    let index = -1;

    const frameIndex = frames.findIndex(
      (f) => String(f.profileId ?? "") === code
    );
    if (frameIndex >= 0) {
      section = "frames";
      index = frameIndex;
    } else {
      // 2) Try sheets by SKU
      const sheetIndex = sheets.findIndex(
        (s) => String((s as any).sku ?? "") === code
      );
      if (sheetIndex >= 0) {
        section = "sheets";
        index = sheetIndex;
      } else {
        // 3) Try rolls by materialId
        const rollIndex = rolls.findIndex(
          (r) => String(r.materialId ?? "") === code
        );
        if (rollIndex >= 0) {
          section = "rolls";
          index = rollIndex;
        }
      }
    }

    if (section && index >= 0) {
      setHighlight({ section, index });
    } else {
      window.alert(`No stock item found for code: ${code}`);
      setHighlight({ section: null, index: -1 });
    }

    setScanCode("");
  };

  // ---------- Derived sheet views for separate Mat / Glazing / Backer sections ----------

  const sheetRowsWithIndex = sheets.map((s, index) => ({ ...s, __index: index }));

  const matRows = sheetRowsWithIndex.filter((s: any) => s.type === "mat");
  const glazingRows = sheetRowsWithIndex.filter(
    (s: any) => s.type === "glazing"
  );
  const backerRows = sheetRowsWithIndex.filter(
    (s: any) => s.type === "backer"
  );

  const matHighlightIndex =
    highlight.section === "sheets"
      ? matRows.findIndex((r: any) => r.__index === highlight.index)
      : -1;
  const glazingHighlightIndex =
    highlight.section === "sheets"
      ? glazingRows.findIndex((r: any) => r.__index === highlight.index)
      : -1;
  const backerHighlightIndex =
    highlight.section === "sheets"
      ? backerRows.findIndex((r: any) => r.__index === highlight.index)
      : -1;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-lg font-semibold">Stock</h1>
          <button
            type="button"
            onClick={resetStockFromAdmin}
            className="inline-flex items-center rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-600 hover:text-white"
          >
            Reset stock from Admin
          </button>
        </header>

        {/* Top tools split into 2 cards (1x2 format) */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* CSV tools */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                CSV import / export
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Download your current stock as a CSV, edit it in Excel/Sheets,
                and re-import to update FrameIT.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExportCSV}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={handleImportClick}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white"
              >
                Import CSV
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Barcode / code scanner */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                Barcode / code scanner
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Scan or type a frame profile ID, sheet SKU, or print material ID
                to jump to that row. USB barcode scanners that act like a
                keyboard will work here.
              </p>
            </div>

            <form
              onSubmit={handleScanSubmit}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
            >
              <label className="text-xs font-medium text-slate-700 sm:w-32">
                Scan / search code
              </label>
              <input
                type="text"
                className="w-full max-w-sm rounded border px-2 py-1 text-sm"
                placeholder="Scan or type code..."
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
              />
              <button
                type="submit"
                className="mt-1 inline-flex items-center justify-center rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white sm:mt-0"
              >
                Go
              </button>
            </form>
          </div>
        </section>

        {/* Overview tiles */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewTile
            label="Frames (low / total)"
            value={`${lowFrames} / ${frames.length || 0}`}
            tone={lowFrames > 0 ? "warn" : "ok"}
          />
          <OverviewTile
            label="Sheets (low / total)"
            value={`${lowSheets} / ${sheets.length || 0}`}
            tone={lowSheets > 0 ? "warn" : "ok"}
          />
          <OverviewTile
            label="Print rolls (low / total)"
            value={`${lowRolls} / ${rolls.length || 0}`}
            tone={lowRolls > 0 ? "warn" : "ok"}
          />
          <OverviewTile label="Total SKUs" value={totalSkus} tone="neutral" />
        </section>

        {/* Frames by meters */}
        <Card
          title="Frames (meters available)"
          actions={
            <button
              type="button"
              onClick={syncFramesFromAdmin}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white"
            >
              Sync from Admin
            </button>
          }
        >
          <StockTable
            columns={[
              {
                key: "profileName",
                label: "Frame profile",
                type: "label", // now read-only label
              },
              { key: "metersAvailable", label: "Meters Available", type: "number" },
              { key: "minThreshold", label: "Min Threshold", type: "number" },
            ]}
            // rows include a derived profileName so the table can show the Admin name
            rows={frames.map((f) => ({
              ...f,
              profileName:
                frameNameById[String(f.profileId ?? "").trim()] ?? "",
            }))}
            onChange={(idx, key, val) => {
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const list = stock.frames ? [...stock.frames] : [];
                const current = list[idx] || {};

                // Only numeric fields are actually editable (metersAvailable / minThreshold)
                list[idx] = {
                  ...current,
                  [key]:
                    key === "metersAvailable" || key === "minThreshold"
                      ? n(val)
                      : val,
                } as StockFrame;

                return { ...prev, stock: { ...stock, frames: list } };
              });
            }}
            onDelete={(idx) =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                return {
                  ...prev,
                  stock: {
                    ...stock,
                    frames: (stock.frames || []).filter((_, i) => i !== idx),
                  },
                };
              })
            }
            rowClassName={(row) =>
              n(row.metersAvailable) <= n(row.minThreshold) &&
              n(row.minThreshold) > 0
                ? "bg-red-50"
                : ""
            }
            cellClassName={(row, _idx, key) =>
              key === "metersAvailable" &&
              n(row.metersAvailable) <= n(row.minThreshold) &&
              n(row.minThreshold) > 0
                ? "font-semibold text-red-700"
                : ""
            }
            addLabel="Add frame run"
            highlightIndex={highlight.section === "frames" ? highlight.index : -1}
          />
        </Card>

        {/* Mats */}
        <Card
          title="Mat stock"
          actions={
            <button
              type="button"
              onClick={syncMatsFromAdmin}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white"
            >
              Sync from Admin
            </button>
          }
        >
          <StockTable
            columns={[
              { key: "sku", label: "Mat ID", type: "label" }, // read-only
              { key: "widthCm", label: "Width (cm)", type: "number" },
              { key: "heightCm", label: "Height (cm)", type: "number" },
              { key: "qty", label: "Quantity", type: "number" },
              { key: "minThreshold", label: "Min Threshold", type: "number" },
            ]}
            rows={matRows}
            onChange={(localIdx, key, val) => {
              const sheetIdx = (matRows[localIdx] as any).__index as number;
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const list = stock.sheets ? [...stock.sheets] : [];
                const numeric = ["widthCm", "heightCm", "qty", "minThreshold"].includes(
                  key
                );
                list[sheetIdx] = {
                  ...list[sheetIdx],
                  [key]: numeric ? n(val) : val,
                } as StockSheet;
                return { ...prev, stock: { ...stock, sheets: list } };
              });
            }}
            onDelete={(localIdx) =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const sheetIdx = (matRows[localIdx] as any).__index as number;
                return {
                  ...prev,
                  stock: {
                    ...stock,
                    sheets: (stock.sheets || []).filter((_, i) => i !== sheetIdx),
                  },
                };
              })
            }
            rowClassName={(row) =>
              n(row.qty) <= n(row.minThreshold) && n(row.minThreshold) > 0
                ? "bg-red-50"
                : ""
            }
            cellClassName={(row, _idx, key) =>
              key === "qty" &&
              n(row.qty) <= n(row.minThreshold) && n(row.minThreshold) > 0
                ? "font-semibold text-red-700"
                : ""
            }
            addLabel="Add mat sheet"
            highlightIndex={matHighlightIndex}
          />
        </Card>

        {/* Glazing */}
        <Card
          title="Glazing stock"
          actions={
            <button
              type="button"
              onClick={syncGlazingFromAdmin}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white"
            >
              Sync from Admin
            </button>
          }
        >
          <StockTable
            columns={[
              { key: "sku", label: "Glazing ID", type: "label" }, // read-only
              { key: "widthCm", label: "Width (cm)", type: "number" },
              { key: "heightCm", label: "Height (cm)", type: "number" },
              { key: "qty", label: "Quantity", type: "number" },
              { key: "minThreshold", label: "Min Threshold", type: "number" },
            ]}
            rows={glazingRows}
            onChange={(localIdx, key, val) => {
              const sheetIdx = (glazingRows[localIdx] as any).__index as number;
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const list = stock.sheets ? [...stock.sheets] : [];
                const numeric = ["widthCm", "heightCm", "qty", "minThreshold"].includes(
                  key
                );
                list[sheetIdx] = {
                  ...list[sheetIdx],
                  [key]: numeric ? n(val) : val,
                } as StockSheet;
                return { ...prev, stock: { ...stock, sheets: list } };
              });
            }}
            onDelete={(localIdx) =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const sheetIdx = (glazingRows[localIdx] as any).__index as number;
                return {
                  ...prev,
                  stock: {
                    ...stock,
                    sheets: (stock.sheets || []).filter((_, i) => i !== sheetIdx),
                  },
                };
              })
            }
            rowClassName={(row) =>
              n(row.qty) <= n(row.minThreshold) && n(row.minThreshold) > 0
                ? "bg-red-50"
                : ""
            }
            cellClassName={(row, _idx, key) =>
              key === "qty" &&
              n(row.qty) <= n(row.minThreshold) && n(row.minThreshold) > 0
                ? "font-semibold text-red-700"
                : ""
            }
            addLabel="Add glazing sheet"
            highlightIndex={glazingHighlightIndex}
          />
        </Card>

        {/* Backer */}
        <Card
          title="Backer stock"
          actions={
            <button
              type="button"
              onClick={syncBackersFromAdmin}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white"
            >
              Sync from Admin
            </button>
          }
        >
          <StockTable
            columns={[
              { key: "sku", label: "Backer ID", type: "label" }, // read-only
              { key: "widthCm", label: "Width (cm)", type: "number" },
              { key: "heightCm", label: "Height (cm)", type: "number" },
              { key: "qty", label: "Quantity", type: "number" },
              { key: "minThreshold", label: "Min Threshold", type: "number" },
            ]}
            rows={backerRows}
            onChange={(localIdx, key, val) => {
              const sheetIdx = (backerRows[localIdx] as any).__index as number;
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const list = stock.sheets ? [...stock.sheets] : [];
                const numeric = ["widthCm", "heightCm", "qty", "minThreshold"].includes(
                  key
                );
                list[sheetIdx] = {
                  ...list[sheetIdx],
                  [key]: numeric ? n(val) : val,
                } as StockSheet;
                return { ...prev, stock: { ...stock, sheets: list } };
              });
            }}
            onDelete={(localIdx) =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const sheetIdx = (backerRows[localIdx] as any).__index as number;
                return {
                  ...prev,
                  stock: {
                    ...stock,
                    sheets: (stock.sheets || []).filter((_, i) => i !== sheetIdx),
                  },
                };
              })
            }
            rowClassName={(row) =>
              n(row.qty) <= n(row.minThreshold) && n(row.minThreshold) > 0
                ? "bg-red-50"
                : ""
            }
            cellClassName={(row, _idx, key) =>
              key === "qty" &&
              n(row.qty) <= n(row.minThreshold) && n(row.minThreshold) > 0
                ? "font-semibold text-red-700"
                : ""
            }
            addLabel="Add backer sheet"
            highlightIndex={backerHighlightIndex}
          />
        </Card>

        {/* Printing rolls */}
        <Card
          title="Printing rolls"
          actions={
            <button
              type="button"
              onClick={syncPrintingFromAdmin}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-black hover:text-white"
            >
              Sync from Admin
            </button>
          }
        >
          <StockTable
            columns={[
              {
                key: "materialId",
                label: "Print material",
                type: "label", // now a read-only label
              },
              { key: "widthCm", label: "Width (cm)", type: "number" },
              { key: "metersRemaining", label: "Meters Remaining", type: "number" },
              { key: "minThreshold", label: "Min Threshold", type: "number" },
            ]}
            rows={rolls}
            onChange={(idx, key, val) => {
              setCatalog((prev) => {
                const stock = prev.stock || {};
                const list = stock.rolls ? [...stock.rolls] : [];
                const numeric = ["widthCm", "metersRemaining", "minThreshold"].includes(
                  key
                );
                list[idx] = {
                  ...list[idx],
                  [key]: numeric ? n(val) : val,
                } as StockRoll;
                return { ...prev, stock: { ...stock, rolls: list } };
              });
            }}
            onDelete={(idx) =>
              setCatalog((prev) => {
                const stock = prev.stock || {};
                return {
                  ...prev,
                  stock: {
                    ...stock,
                    rolls: (stock.rolls || []).filter((_, i) => i !== idx),
                  },
                };
              })
            }
            rowClassName={(row) =>
              n(row.metersRemaining) <= n(row.minThreshold) &&
              n(row.minThreshold) > 0
                ? "bg-red-50"
                : ""
            }
            cellClassName={(row, _idx, key) =>
              key === "metersRemaining" &&
              n(row.metersRemaining) <= n(row.minThreshold) &&
              n(row.minThreshold) > 0
                ? "font-semibold text-red-700"
                : ""
            }
            addLabel="Add print roll"
            highlightIndex={highlight.section === "rolls" ? highlight.index : -1}
          />
        </Card>
      </div>
    </main>
  );
}

function OverviewTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn" | "neutral";
}) {
  const toneClasses =
    tone === "warn"
      ? "border-red-100 bg-red-50 text-red-800"
      : tone === "ok"
      ? "border-emerald-100 bg-emerald-50 text-emerald-800"
      : "border-slate-100 bg-slate-50 text-slate-800";

  return (
    <div className={`rounded-2xl border px-3 py-3 text-sm shadow-sm ${toneClasses}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Card({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

type ColumnDef = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "label";
  options?: string[];
};

function StockTable({
  columns,
  rows,
  onChange,
  onDelete,
  rowClassName,
  cellClassName,
  addLabel = "Add",
  highlightIndex = -1,
  onAdd,
}: {
  columns: ColumnDef[];
  rows: any[];
  onChange: (index: number, key: string, value: any) => void;
  onDelete: (index: number) => void;
  rowClassName?: (row: any, index: number) => string;
  cellClassName?: (row: any, index: number, colKey: string) => string;
  addLabel?: string;
  highlightIndex?: number;
  onAdd?: () => void; // optional now
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b">
              {columns.map((col) => (
                <th key={col.key} className="px-3 py-2 text-left">
                  {col.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const baseRowClass = rowClassName ? rowClassName(row, idx) : "";
              const highlightClass =
                highlightIndex === idx ? " ring-2 ring-sky-400 ring-offset-0" : "";
              return (
                <tr key={idx} className={`border-b ${baseRowClass}${highlightClass}`}>
                  {columns.map((col) => {
                    const baseCell = "px-3 py-1.5";
                    const extra =
                      cellClassName?.(row, idx, col.key) ??
                      (col.type === "number" ? " text-right" : "");
                    const cellClasses = `${baseCell}${extra ? " " + extra : ""}`;

                    return (
                      <td key={col.key} className={cellClasses}>
                        {col.type === "number" ? (
                          <input
                            type="number"
                            className="w-full rounded border px-2 py-1 text-sm text-right"
                            value={row[col.key] ?? 0}
                            onChange={(e) => onChange(idx, col.key, e.target.value)}
                          />
                        ) : col.type === "select" ? (
                          <select
                            className="w-full rounded border px-2 py-1 text-sm bg-white"
                            value={row[col.key] ?? (col.options?.[0] ?? "")}
                            onChange={(e) => onChange(idx, col.key, e.target.value)}
                          >
                            <option value="">Select…</option>
                            {col.options?.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : col.type === "label" ? (
                          <span className="inline-block rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
                            {row[col.key] ?? ""}
                          </span>
                        ) : (
                          <input
                            className="w-full rounded border px-2 py-1 text-sm"
                            value={row[col.key] ?? ""}
                            onChange={(e) => onChange(idx, col.key, e.target.value)}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => onDelete(idx)}
                      className="rounded border px-2 py-1 text-xs hover:bg-black hover:text-white"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={columns.length + 1}>
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {onAdd && (
        <button
          onClick={onAdd}
          className="rounded border px-3 py-2 text-sm hover:bg-black hover:text-white"
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

// ------- CSV helpers -------

function csvEscape(value: any): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildStockCSV(
  frames: StockFrame[],
  sheets: StockSheet[],
  rolls: StockRoll[]
): string {
  const header = [
    "type",
    "profileId",
    "metersAvailable",
    "sheetType",
    "sku",
    "widthCm",
    "heightCm",
    "qty",
    "materialId",
    "metersRemaining",
    "minThreshold",
  ];

  const rows: string[][] = [header];

  frames.forEach((f) => {
    rows.push([
      "frame",
      csvEscape(f.profileId),
      csvEscape(f.metersAvailable),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      csvEscape(f.minThreshold),
    ]);
  });

  sheets.forEach((s) => {
    rows.push([
      "sheet",
      "",
      "",
      csvEscape(s.type),
      csvEscape((s as any).sku ?? ""),
      csvEscape(s.widthCm),
      csvEscape(s.heightCm),
      csvEscape(s.qty),
      "",
      "",
      csvEscape(s.minThreshold),
    ]);
  });

  rolls.forEach((r) => {
    rows.push([
      "roll",
      "",
      "",
      "",
      "",
      csvEscape(r.widthCm),
      "",
      "",
      csvEscape(r.materialId),
      csvEscape(r.metersRemaining),
      csvEscape(r.minThreshold),
    ]);
  });

  return rows.map((r) => r.join(",")).join("\r\n");
}

function parseStockCSV(text: string): {
  frames: StockFrame[];
  sheets: StockSheet[];
  rolls: StockRoll[];
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return { frames: [], sheets: [], rolls: [] };
  }

  const header = lines[0].split(",").map((h) => h.trim());
  const idxOf = (name: string) => header.indexOf(name);

  const frames: StockFrame[] = [];
  const sheets: StockSheet[] = [];
  const rolls: StockRoll[] = [];

  const num = (v: string | undefined, fb = 0): number => {
    const x = v ? parseFloat(v) : NaN;
    return Number.isFinite(x) ? x : fb;
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (!cols.length) continue;

    const get = (name: string): string => {
      const idx = idxOf(name);
      if (idx < 0 || idx >= cols.length) return "";
      const raw = cols[idx] ?? "";
      const trimmed = raw.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replace(/""/g, '"').trim();
      }
      return trimmed;
    };

    const type = get("type").toLowerCase();
    if (!type) continue;

    if (type === "frame") {
      frames.push({
        profileId: get("profileId"),
        metersAvailable: num(get("metersAvailable")),
        minThreshold: num(get("minThreshold")),
      });
    } else if (type === "sheet") {
      sheets.push({
        id: rid(),
        type: (get("sheetType") as StockSheet["type"]) || "mat",
        sku: get("sku"),
        widthCm: num(get("widthCm"), 100),
        heightCm: num(get("heightCm"), 70),
        qty: num(get("qty"), 1),
        minThreshold: num(get("minThreshold")),
      } as StockSheet);
    } else if (type === "roll") {
      rolls.push({
        materialId: get("materialId"),
        widthCm: num(get("widthCm"), 61),
        metersRemaining: num(get("metersRemaining"), 0),
        minThreshold: num(get("minThreshold")),
      } as StockRoll);
    }
  }

  return { frames, sheets, rolls };
}
