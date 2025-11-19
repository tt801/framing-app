// /api/integrations/quickbooks/sync.ts

// Stub for "export invoices / sync" from FrameIT -> QuickBooks.
// Called when user clicks "Sync now" or similar.

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    console.log("[QuickBooks] Sync stub hit", {
      body,
      time: new Date().toISOString(),
    });

    // Expected shape (you can adjust later):
    // {
    //   invoices: [...],  // invoices you're exporting
    //   settings: {...},  // integration / mapping settings from Admin
    // }

    // TODO:
    //  - Use stored QuickBooks access token
    //  - Map your internal invoice schema -> QuickBooks schema
    //  - Call QuickBooks API
    //  - Return per-invoice results (success / duplicate / error etc.)

    return res.status(200).json({
      ok: true,
      kind: "quickbooks-sync",
      message: "QuickBooks sync stub reached. Implement real export logic here.",
      received: {
        invoicesCount: Array.isArray(body?.invoices) ? body.invoices.length : 0,
      },
    });
  } catch (err: any) {
    console.error("[QuickBooks] Sync stub error", err);
    return res.status(500).json({
      ok: false,
      error: "QuickBooks sync stub failed",
      details: err?.message || String(err),
    });
  }
}
