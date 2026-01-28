type VercelRequest = any;
type VercelResponse = any;

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
const MS_GRAPH_TOKEN_URL = process.env.MS_GRAPH_TOKEN_URL;
const OUTLOOK_CLIENT_ID = process.env.OUTLOOK_CLIENT_ID;
const OUTLOOK_CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET;
const OUTLOOK_FROM_EMAIL = process.env.OUTLOOK_FROM_EMAIL;
const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY;
const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { campaignId, campaignName, message, channel, recipientEmails, recipientPhones } = req.body;

  if (!campaignId || !campaignName || !message || !channel) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    let sent = 0;

    if (channel === 'whatsapp') {
      // Send via Twilio WhatsApp
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
        return res.status(400).json({
          error: 'WhatsApp integration not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM',
        });
      }

      // Filter and send to phone numbers
      const phones = recipientPhones?.filter((p: string) => p && p.startsWith('+'));
      if (!phones?.length) {
        return res.status(400).json({ error: 'No valid phone numbers provided for WhatsApp' });
      }

      for (const phone of phones) {
        try {
          const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
          await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
            {
              method: 'POST',
              headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                From: TWILIO_WHATSAPP_FROM,
                To: phone,
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
      if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET || !OUTLOOK_FROM_EMAIL) {
        return res.status(400).json({
          error: 'Email integration not configured. Set OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_FROM_EMAIL',
        });
      }

      // Get access token
      const tokenResponse = await fetch(MS_GRAPH_TOKEN_URL || 'https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: OUTLOOK_CLIENT_ID,
          client_secret: OUTLOOK_CLIENT_SECRET,
          grant_type: 'client_credentials',
          scope: 'https://graph.microsoft.com/.default',
        }).toString(),
      });

      const tokenData = (await tokenResponse.json()) as any;
      if (!tokenData.access_token) {
        return res.status(400).json({ error: 'Failed to get access token for email' });
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
      if (!MAILCHIMP_API_KEY || !MAILCHIMP_SERVER) {
        return res.status(400).json({
          error: 'Mailchimp integration not configured. Set MAILCHIMP_API_KEY, MAILCHIMP_SERVER',
        });
      }

      for (const email of recipientEmails || []) {
        try {
          await fetch(
            `https://${MAILCHIMP_SERVER}.api.mailchimp.com/3.0/messages/send`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${MAILCHIMP_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: {
                  subject: `Campaign: ${campaignName}`,
                  text: message,
                  from_email: OUTLOOK_FROM_EMAIL || 'noreply@framingapp.com',
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
