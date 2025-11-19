// api/integrations/xero/connect.ts
// Stub handler for "Connect to Xero" button in Admin Integrations tab.

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // TODO: Replace this with real Xero OAuth logic.

  res.status(200).json({
    ok: true,
    provider: 'xero',
    authUrl: 'https://example.com/xero-oauth-demo'
  })
}
