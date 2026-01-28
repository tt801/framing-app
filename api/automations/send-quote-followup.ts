// api/automations/send-quote-followup.ts
// Serverless function to send automated quote follow-ups

type VercelRequest = any;
type VercelResponse = any;

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
    const {
      customerName,
      customerEmail,
      customerPhone,
      quotedItem,
      daysOld,
      channel,
    } = req.body as QuoteFollowup;

    // Get API keys from environment variables
    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
    const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
    const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
    const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID;
    const MAILCHIMP_API_KEY = process.env.MAILCHIMP_API_KEY;
    const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER;

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
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
        return res.status(400).json({ error: 'Twilio credentials not configured' });
      }

      if (!customerPhone) {
        return res.status(400).json({ error: 'Customer phone number required' });
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
      if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_TENANT_ID) {
        return res.status(400).json({ error: 'Microsoft credentials not configured' });
      }

      if (!customerEmail) {
        return res.status(400).json({ error: 'Customer email required' });
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

      // Send email
      const emailResponse = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
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

      result = { status: 'sent', email: customerEmail };
    } else if (channel === 'mailchimp') {
      if (!MAILCHIMP_API_KEY || !MAILCHIMP_SERVER) {
        return res.status(400).json({ error: 'Mailchimp credentials not configured' });
      }

      if (!customerEmail) {
        return res.status(400).json({ error: 'Customer email required' });
      }

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
              subject: daysOld > 14 ? '✨ Special 10% off offer!' : `About your ${quotedItem} quote`,
              text: message,
              from_email: 'hello@yourframingbusiness.com',
              from_name: 'Your Framing Business',
              to: [{ email: customerEmail, name: customerName, type: 'to' }],
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
      daysOld,
      result,
    });
  } catch (error: any) {
    console.error('Error sending quote follow-up:', error);
    return res.status(500).json({
      error: 'Failed to send quote follow-up',
      details: error.message,
    });
  }
}
