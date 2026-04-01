// api/automations/send-review-request.ts
// Serverless function to send automated review requests via WhatsApp/Email/Mailchimp

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

interface ReviewRequest {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobCompletedDate: string;
  channel: 'whatsapp' | 'email' | 'mailchimp';
  reviewLinks: {
    google?: string;
    facebook?: string;
    instagram?: string;
  };
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
      channel,
      reviewLinks,
    } = req.body as ReviewRequest;

    const credentials = await getUserApiCredentials(userId);
    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials configured. Please add them in API Settings.',
      });
    }

    const message = [
      `Hi ${customerName}! 👋`,
      '',
      "We hope you're enjoying your beautifully framed piece.",
      "If you have a moment, we'd really appreciate a quick review:",
      '',
      reviewLinks.google && `⭐ Google: ${reviewLinks.google}`,
      reviewLinks.facebook && `📘 Facebook: ${reviewLinks.facebook}`,
      reviewLinks.instagram && `📸 Instagram: ${reviewLinks.instagram}`,
      '',
      'Thank you for choosing us! 🙏',
    ]
      .filter(Boolean)
      .join('\n');

    let result;

    if (channel === 'whatsapp') {
      // Send via Twilio WhatsApp API
      if (!credentials.twilio_account_sid || !credentials.twilio_auth_token || !credentials.twilio_whatsapp_number) {
        return res.status(400).json({ error: 'Twilio credentials not configured' });
      }

      if (!customerPhone) {
        return res.status(400).json({ error: 'Customer phone number required for WhatsApp' });
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
      // Send via Microsoft Graph API (Outlook)
      if (!credentials.microsoft_client_id || !credentials.microsoft_client_secret || !credentials.outlook_from_email) {
        return res.status(400).json({ error: 'Microsoft credentials not configured' });
      }

      if (!customerEmail) {
        return res.status(400).json({ error: 'Customer email required for email channel' });
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

      // Send email via Graph API
      const emailResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(credentials.outlook_from_email)}/sendMail`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject: "We'd love your feedback! ⭐",
            body: {
              contentType: 'Text',
              content: message,
            },
            toRecipients: [
              {
                emailAddress: {
                  address: customerEmail,
                },
              },
            ],
          },
        }),
      });

      if (!emailResponse.ok) {
        const text = await emailResponse.text().catch(() => '');
        return res.status(502).json({ error: 'Microsoft send failed', details: text });
      }

      result = { status: 'sent', email: customerEmail };
    } else if (channel === 'mailchimp') {
      // Send via Mailchimp Transactional API (Mandrill)
      if (!credentials.mailchimp_api_key || !credentials.mailchimp_server) {
        return res.status(400).json({ error: 'Mailchimp credentials not configured' });
      }

      if (!customerEmail) {
        return res.status(400).json({ error: 'Customer email required for Mailchimp' });
      }

      // Note: This uses Mailchimp Transactional (Mandrill)
      // For Marketing campaigns, use the Campaigns API instead
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
              subject: "We'd love your feedback! ⭐",
              text: message,
              from_email: credentials.outlook_from_email || 'noreply@framingapp.com',
              from_name: 'Your Framing Business', // Replace with your business name
              to: [
                {
                  email: customerEmail,
                  name: customerName,
                  type: 'to',
                },
              ],
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
      result,
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending review request:', error);
    if (details === 'Trial expired' || details === 'Account is read-only') {
      return res.status(403).json({
        error: details,
      });
    }
    return res.status(500).json({
      error: 'Failed to send review request',
      details,
    });
  }
}
