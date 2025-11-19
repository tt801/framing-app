// /api/integrations/xero/sync.ts

// Stub for sending invoices from FrameIT to Xero.

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    console.log("[Xero] Sync stub hit", {
      body,
      time: new Date().toISOString(),
    });

    // Expected shape (you can adjust later):
    // {
    //   invoices: [...],
    //   settings: {...},
    // }

    // TODO:
    //  - Use stored Xero access token
    //  - Map internal invoice schema -> Xero schema
    //  - Call Xero API
    //  - Return per-invoice results (success / duplicate / error etc.)

    return res.status(200).json({
      ok: true,
      kind: "xero-sync",
      message: "Xero sync stub reached. Implement real export logic here.",
      received: {
        invoicesCount: Array.isArray(body?.invoices) ? body.invoices.length : 0,
      },
    });
  } catch (err: any) {
    console.error("[Xero] Sync stub error", err);
    return res.status(500).json({
      ok: false,
      error: "Xero sync stub failed",
      details: err?.message || String(err),
    });
  }
}
