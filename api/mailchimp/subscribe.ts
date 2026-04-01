type VercelRequest = {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => VercelResponse;
};

import { createClient } from '@supabase/supabase-js';
import { requireActiveTrialUserId } from '../_lib/auth';

const createSupabaseServerClient = () => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase not configured');
  }

  return createClient(url, serviceRoleKey);
};

const getUserApiCredentials = async (userId: string) => {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('user_api_credentials')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data;
};

const isValidEmail = (value: unknown): value is string => {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = await requireActiveTrialUserId(req);
    const { email, audienceId } = req.body || {};

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    if (typeof audienceId !== 'string' || audienceId.trim().length === 0) {
      return res.status(400).json({ error: 'Audience ID is required' });
    }

    const credentials = await getUserApiCredentials(userId);
    if (!credentials?.mailchimp_api_key || !credentials?.mailchimp_server) {
      return res.status(400).json({
        error: 'Mailchimp credentials not configured. Please add them in API Settings.',
      });
    }

    const auth = Buffer.from(`anystring:${credentials.mailchimp_api_key}`).toString('base64');
    const response = await fetch(
      `https://${credentials.mailchimp_server}.api.mailchimp.com/3.0/lists/${encodeURIComponent(audienceId)}/members`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_address: email,
          status: 'subscribed',
          status_if_new: 'subscribed',
        }),
      }
    );

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(200).json({ success: true, data });
    }

    const errorData = await response.json().catch(() => ({}));
    if (errorData?.title === 'Member Exists') {
      return res.status(200).json({ success: true, alreadySubscribed: true });
    }

    return res.status(502).json({
      error: 'Mailchimp subscribe request failed',
      details: errorData?.detail || errorData?.title || `HTTP ${response.status}`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to subscribe contact';
    console.error('Mailchimp subscribe error:', error);
    if (message === 'Trial expired' || message === 'Account is read-only') {
      return res.status(403).json({
        error: message,
      });
    }
    return res.status(500).json({ error: message });
  }
}
