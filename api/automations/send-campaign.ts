type VercelRequest = {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => VercelResponse;
};

type MicrosoftTokenResponse = {
  access_token?: string;
};

// Import Supabase server client
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    campaignId,
    campaignName,
    message,
    messageTemplate,
    channel,
    recipientEmails,
    recipientPhones,
    recipients,
  } = req.body || {};

  const normalizedMessage = typeof message === 'string' ? message : messageTemplate;
  const normalizedCampaignName = typeof campaignName === 'string' && campaignName.trim().length > 0
    ? campaignName
    : 'Campaign';
  const normalizedEmails = (Array.isArray(recipientEmails) ? recipientEmails : Array.isArray(recipients) ? recipients : [])
    .filter((e: unknown) => typeof e === 'string' && e.includes('@'));
  const normalizedPhones = (Array.isArray(recipientPhones) ? recipientPhones : [])
    .filter((p: unknown) => typeof p === 'string' && p.startsWith('+'));

  if (!normalizedMessage || !channel) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const userId = await requireActiveTrialUserId(req);

    // Get user's API credentials
    const credentials = await getUserApiCredentials(userId);

    if (!credentials) {
      return res.status(400).json({
        error: 'No API credentials configured. Please add them in API Settings.',
      });
    }

    let sent = 0;

    if (channel === 'whatsapp') {
      // Send via Twilio WhatsApp
      if (!credentials.twilio_account_sid || !credentials.twilio_auth_token || !credentials.twilio_whatsapp_number) {
        return res.status(400).json({
          error: 'WhatsApp not configured. Add Twilio credentials in API Settings.',
        });
      }

      // Filter and send to phone numbers
      if (!normalizedPhones.length) {
        return res.status(400).json({ error: 'No valid phone numbers provided for WhatsApp' });
      }

      for (const phone of normalizedPhones) {
        try {
          const auth = Buffer.from(`${credentials.twilio_account_sid}:${credentials.twilio_auth_token}`).toString('base64');
          const providerResponse = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${credentials.twilio_account_sid}/Messages.json`,
            {
              method: 'POST',
              headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                From: `whatsapp:${credentials.twilio_whatsapp_number}`,
                To: `whatsapp:${phone}`,
                Body: message,
              }).toString(),
            }
          );

          if (!providerResponse.ok) {
            const text = await providerResponse.text().catch(() => '');
            console.error(`Failed to send WhatsApp to ${phone}:`, text);
            continue;
          }

          sent++;
        } catch (error) {
          console.error(`Failed to send WhatsApp to ${phone}:`, error);
        }
      }
    } else if (channel === 'email') {
      // Send via Microsoft Graph / Outlook
      if (!credentials.microsoft_client_id || !credentials.microsoft_client_secret || !credentials.outlook_from_email) {
        return res.status(400).json({
          error: 'Email not configured. Add Microsoft credentials in API Settings.',
        });
      }

      if (!normalizedEmails.length) {
        return res.status(400).json({ error: 'No valid email addresses provided' });
      }

      // Get access token
      const tenantId = credentials.microsoft_tenant_id || 'common';
      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: credentials.microsoft_client_id,
            client_secret: credentials.microsoft_client_secret,
            grant_type: 'client_credentials',
            scope: 'https://graph.microsoft.com/.default',
          }).toString(),
        }
      );

      const tokenData = (await tokenResponse.json()) as MicrosoftTokenResponse;
      if (!tokenData.access_token) {
        return res.status(400).json({ error: 'Failed to authenticate with Microsoft' });
      }

      // Send to each email address
      for (const email of normalizedEmails) {
        try {
          const providerResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(credentials.outlook_from_email)}/sendMail`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                subject: `Campaign: ${campaignName}`,
                body: {
                  contentType: 'Text',
                  content: message,
                },
                toRecipients: [
                  {
                    emailAddress: {
                      address: email,
                    },
                  },
                ],
              },
              saveToSentItems: true,
            }),
          });

          if (!providerResponse.ok) {
            const text = await providerResponse.text().catch(() => '');
            console.error(`Failed to send email to ${email}:`, text);
            continue;
          }

          sent++;
        } catch (error) {
          console.error(`Failed to send email to ${email}:`, error);
        }
      }
    } else if (channel === 'mailchimp') {
      // Send via Mailchimp Transactional Email API
      if (!credentials.mailchimp_api_key || !credentials.mailchimp_server) {
        return res.status(400).json({
          error: 'Mailchimp not configured. Add credentials in API Settings.',
        });
      }

      if (!normalizedEmails.length) {
        return res.status(400).json({ error: 'No valid email addresses provided' });
      }

      for (const email of normalizedEmails) {
        try {
          const providerResponse = await fetch(
            `https://${credentials.mailchimp_server}.api.mailchimp.com/3.0/messages/send`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${credentials.mailchimp_api_key}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: {
                  subject: `Campaign: ${campaignName}`,
                  text: message,
                  from_email: credentials.outlook_from_email || 'noreply@framingapp.com',
                  to: [{ email }],
                },
              }),
            }
          );

          if (!providerResponse.ok) {
            const text = await providerResponse.text().catch(() => '');
            console.error(`Failed to send Mailchimp to ${email}:`, text);
            continue;
          }

          sent++;
        } catch (error) {
          console.error(`Failed to send Mailchimp to ${email}:`, error);
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid channel' });
    }

    // Log the campaign send
    const sendLog = {
      campaignId,
      campaignName: normalizedCampaignName,
      channel,
      sentAt: new Date().toISOString(),
      recipientCount: normalizedEmails.length || normalizedPhones.length || 0,
      sent,
    };

    console.log('Campaign sent:', sendLog);

    return res.status(200).json({
      success: true,
      message: `Campaign "${normalizedCampaignName}" sent to ${sent} recipients`,
      sent,
      log: sendLog,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to send campaign';
    console.error('Campaign send error:', error);
    if (message === 'Trial expired') {
      return res.status(403).json({
        error: 'Trial expired',
      });
    }
    return res.status(500).json({
      error: message,
    });
  }
}
