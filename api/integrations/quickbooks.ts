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
      "QuickBooks OAuth is not yet configured on this server. " +
      "Set up your Intuit developer credentials and implement the OAuth flow before enabling this integration.",
  });
}

async function handleSync(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  return res.status(501).json({ ok: false, error: "QuickBooks sync is not available yet" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = getAction(req);

  if (action === "connect") {
    return handleConnect(req, res);
  }

  if (action === "sync") {
    return handleSync(req, res);
  }

  return res.status(404).json({ error: "Unknown QuickBooks action" });
}