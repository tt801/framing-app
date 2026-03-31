// api/integrations/xero/connect.ts
// Xero OAuth integration is not yet implemented.
// Returns 501 so the UI shows a clear "not available" error instead of
// falsely marking the integration as connected.

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.status(501).json({
    error: 'Not implemented',
    message:
      'Xero OAuth is not yet configured on this server. ' +
      'Set up your Xero developer app credentials and implement the OAuth flow before enabling this integration.',
  });
}
