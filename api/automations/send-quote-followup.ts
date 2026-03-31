// api/automations/send-quote-followup.ts
// Serverless function to send automated quote follow-ups

type VercelRequest = {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => VercelResponse;
};
import { createClient } from '@supabase/supabase-js';
import { requireActiveTrialUserId } from '../_lib/auth';

type UserApiCredentials = {
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  twilio_whatsapp_number?: string;
  microsoft_client_id?: string;
  microsoft_client_secret?: string;
  microsoft_tenant_id?: string;
  outlook_from_email?: string;
  mailchimp_api_key?: string;
  mailchimp_server?: string;
};

type MicrosoftTokenResponse = {
  access_token?: string;
};

const createSupabaseServerClient = () => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase not configured');
  }

  return createClient(url, serviceRoleKey);
};

const getUserApiCredentials = async (userId: string): Promise<UserApiCredentials | null> => {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('user_api_credentials')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return (data as UserApiCredentials | null) ?? null;
};

interface QuoteFollowup {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  quotedItem: string;
  quoteDate: string;
  daysOld: number;
  channel: 'whatsapp' | 'email' | 'mailchimp';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = await requireActiveTrialUserId(req);

    const {
      customerName,
      customerEmail,
      customerPhone,
      quotedItem,
      daysOld,
      channel,
    } = req.body as QuoteFollowup;

    const credentials = await getUserApiCredentials(userId);
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials configured. Please add them in API Settings.',
      });
    }

    // Determine message based on days old
    let message;
    if (daysOld <= 7) {
      message = `Hi ${customerName}! 👋\n\nThanks for requesting a quote for ${quotedItem}. We'll have your estimate ready soon!\n\nFeel free to reach out if you have any questions.`;
    } else if (daysOld <= 14) {
      message = `Hi ${customerName}! 👋\n\nStill interested in framing your ${quotedItem}? We have some new frame options in stock that might be perfect for you!\n\nLet us know if you'd like to see them. 🖼️`;
    } else {
      message = `Hi ${customerName}! 👋\n\n✨ Special offer: 10% off your frame order this week only!\n\nLet's turn that quote for ${quotedItem} into beautiful framed art. Ready when you are! 🎨`;
    }

    let result;

    if (channel === 'whatsapp') {
      if (!credentials.twilio_account_sid || !credentials.twilio_auth_token || !credentials.twilio_whatsapp_number) {
        return res.status(400).json({ error: 'Twilio credentials not configured' });
      }

      if (!customerPhone) {
        return res.status(400).json({ error: 'Customer phone number required' });
      }

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${credentials.twilio_account_sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${credentials.twilio_account_sid}:${credentials.twilio_auth_token}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            From: `whatsapp:${credentials.twilio_whatsapp_number}`,
            To: `whatsapp:${customerPhone}`,
            Body: message,
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return res.status(502).json({ error: 'Twilio send failed', details: text });
      }

      result = await response.json();
    } else if (channel === 'email') {
      if (!credentials.microsoft_client_id || !credentials.microsoft_client_secret || !credentials.outlook_from_email) {
        return res.status(400).json({ error: 'Microsoft credentials not configured' });
      }

      if (!customerEmail) {
        return res.status(400).json({ error: 'Customer email required' });
      }

      // Get access token
      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${credentials.microsoft_tenant_id || 'common'}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: credentials.microsoft_client_id,
            client_secret: credentials.microsoft_client_secret,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
          }),
        }
      );

      if (!tokenResponse.ok) {
        const text = await tokenResponse.text().catch(() => '');
        return res.status(502).json({ error: 'Microsoft token request failed', details: text });
      }

      const { access_token } = (await tokenResponse.json()) as MicrosoftTokenResponse;
      if (!access_token) {
        return res.status(400).json({ error: 'Failed to authenticate with Microsoft' });
      }

      // Send email
      const emailResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(credentials.outlook_from_email)}/sendMail`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject: daysOld > 14 ? '✨ Special 10% off offer!' : `About your ${quotedItem} quote`,
            body: {
              contentType: 'Text',
              content: message,
            },
            toRecipients: [{ emailAddress: { address: customerEmail } }],
          },
        }),
      });

      if (!emailResponse.ok) {
        const text = await emailResponse.text().catch(() => '');
        return res.status(502).json({ error: 'Microsoft send failed', details: text });
      }

      result = { status: 'sent', email: customerEmail };
    } else if (channel === 'mailchimp') {
      if (!credentials.mailchimp_api_key || !credentials.mailchimp_server) {
        return res.status(400).json({ error: 'Mailchimp credentials not configured' });
      }

      if (!customerEmail) {
        return res.status(400).json({ error: 'Customer email required' });
      }

      const response = await fetch(
        `https://${credentials.mailchimp_server}.api.mailchimp.com/3.0/messages/send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${credentials.mailchimp_api_key}`,
          },
          body: JSON.stringify({
            message: {
              subject: daysOld > 14 ? '✨ Special 10% off offer!' : `About your ${quotedItem} quote`,
              text: message,
              from_email: credentials.outlook_from_email || 'noreply@framingapp.com',
              from_name: 'Your Framing Business',
              to: [{ email: customerEmail, name: customerName, type: 'to' }],
            },
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return res.status(502).json({ error: 'Mailchimp send failed', details: text });
      }

      result = await response.json();
    } else {
      return res.status(400).json({ error: 'Invalid channel' });
    }

    return res.status(200).json({
      success: true,
      channel,
      customerName,
      daysOld,
      result,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending quote follow-up:', error);
    if (details === 'Trial expired') {
      return res.status(403).json({
        error: 'Trial expired',
      });
    }
    return res.status(500).json({
      error: 'Failed to send quote follow-up',
      details,
    });
  }
}
