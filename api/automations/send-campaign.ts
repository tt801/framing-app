type VercelRequest = any;
type VercelResponse = any;

// Import Supabase server client
import { createClient } from '@supabase/supabase-js';

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

  const { userId, campaignId, campaignName, message, channel, recipientEmails, recipientPhones } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'User ID required' });
  }

  if (!campaignId || !campaignName || !message || !channel) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
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
      const phones = recipientPhones?.filter((p: string) => p && p.startsWith('+'));
      if (!phones?.length) {
        return res.status(400).json({ error: 'No valid phone numbers provided for WhatsApp' });
      }

      for (const phone of phones) {
        try {
          const auth = Buffer.from(`${credentials.twilio_account_sid}:${credentials.twilio_auth_token}`).toString('base64');
          await fetch(
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

      const tokenData = (await tokenResponse.json()) as any;
      if (!tokenData.access_token) {
        return res.status(400).json({ error: 'Failed to authenticate with Microsoft' });
      }

      // Send to each email address
      for (const email of recipientEmails || []) {
        try {
          await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
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

      for (const email of recipientEmails || []) {
        try {
          await fetch(
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
          sent++;
        } catch (error) {
          console.error(`Failed to send Mailchimp to ${email}:`, error);
        }
      }
    }

    // Log the campaign send
    const sendLog = {
      campaignId,
      campaignName,
      channel,
      sentAt: new Date().toISOString(),
      recipientCount: recipientEmails?.length || recipientPhones?.length || 0,
      sent,
    };

    console.log('Campaign sent:', sendLog);

    return res.status(200).json({
      success: true,
      message: `Campaign "${campaignName}" sent to ${sent} recipients`,
      sent,
      log: sendLog,
    });
  } catch (error: any) {
    console.error('Campaign send error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to send campaign',
    });
  }
}
