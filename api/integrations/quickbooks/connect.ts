// api/integrations/quickbooks/connect.ts
// Stub handler for "Connect to QuickBooks" button in Admin Integrations tab.
// For now this just returns a fake auth URL so you can prove the wiring works.

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // TODO: Replace this with real QuickBooks OAuth logic.
  // For example: create an OAuth state, build the QuickBooks authorize URL,
  // save state in a DB, then return the URL here.

  res.status(200).json({
    ok: true,
    provider: 'quickbooks',
    // Front-end will redirect the browser to this URL if present.
    authUrl: 'https://example.com/quickbooks-oauth-demo'
  })
}
