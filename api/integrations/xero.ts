import type { VercelRequest, VercelResponse } from "@vercel/node";

const getAction = (req: VercelRequest) => {
  const action = req.query?.integrationAction;
  return Array.isArray(action) ? action[0] : action;
};

function handleConnect(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.status(501).json({
    error: "Not implemented",
    message:
      "Xero OAuth is not yet configured on this server. " +
      "Set up your Xero developer app credentials and implement the OAuth flow before enabling this integration.",
  });
}

async function handleSync(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    console.log("[Xero] Sync stub hit", {
      body,
      time: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true,
      kind: "xero-sync",
      message: "Xero sync stub reached. Implement real export logic here.",
      received: {
        invoicesCount: Array.isArray((body as { invoices?: unknown[] })?.invoices)
          ? (body as { invoices?: unknown[] }).invoices?.length
          : 0,
      },
    });
  } catch (err) {
    const error = err as { message?: string };
    console.error("[Xero] Sync stub error", err);
    return res.status(500).json({
      ok: false,
      error: "Xero sync stub failed",
      details: error?.message || String(err),
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = getAction(req);

  if (action === "connect") {
    return handleConnect(req, res);
  }

  if (action === "sync") {
    return handleSync(req, res);
  }

  return res.status(404).json({ error: "Unknown Xero action" });
}