// api/automations/send-review-request.ts
// Serverless function to send automated review requests via WhatsApp/Email/Mailchimp

type VercelRequest = any;
type VercelResponse = any;

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
    const {
      customerName,
      customerEmail,
      customerPhone,
      channel,
      reviewLinks,
    } = req.body as ReviewRequest;

    // Get API keys from environment variables
    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
    const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
    const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
    const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID;
    const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY;
    const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER; // e.g., 'us1'

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
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
        return res.status(400).json({ error: 'Twilio credentials not configured' });
      }

      if (!customerPhone) {
        return res.status(400).json({ error: 'Customer phone number required for WhatsApp' });
      }

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            From: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
            To: `whatsapp:${customerPhone}`,
            Body: message,
          }),
        }
      );

      result = await response.json();
    } else if (channel === 'email') {
      // Send via Microsoft Graph API (Outlook)
      if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_TENANT_ID) {
        return res.status(400).json({ error: 'Microsoft credentials not configured' });
      }

      if (!customerEmail) {
        return res.status(400).json({ error: 'Customer email required for email channel' });
      }

      // Get access token
      const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: MICROSOFT_CLIENT_ID,
            client_secret: MICROSOFT_CLIENT_SECRET,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
          }),
        }
      );

      const { access_token } = await tokenResponse.json();

      // Send email via Graph API
      const emailResponse = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
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

      result = { status: 'sent', email: customerEmail };
    } else if (channel === 'mailchimp') {
      // Send via Mailchimp Transactional API (Mandrill)
      if (!MAILCHIMP_API_KEY || !MAILCHIMP_SERVER) {
        return res.status(400).json({ error: 'Mailchimp credentials not configured' });
      }

      if (!customerEmail) {
        return res.status(400).json({ error: 'Customer email required for Mailchimp' });
      }

      // Note: This uses Mailchimp Transactional (Mandrill)
      // For Marketing campaigns, use the Campaigns API instead
      const response = await fetch(
        `https://${MAILCHIMP_SERVER}.api.mailchimp.com/3.0/messages/send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MAILCHIMP_API_KEY}`,
          },
          body: JSON.stringify({
            message: {
              subject: "We'd love your feedback! ⭐",
              text: message,
              from_email: 'hello@yourframingbusiness.com', // Replace with your email
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
  } catch (error: any) {
    console.error('Error sending review request:', error);
    return res.status(500).json({
      error: 'Failed to send review request',
      details: error.message,
    });
  }
}
