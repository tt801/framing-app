# Environment Variables Setup Guide

## Required API Keys for Marketing Automation

Create a `.env.local` file in your project root with these variables:

```bash
# Twilio (WhatsApp Integration)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=+14155238886  # Twilio WhatsApp sandbox or approved number

# Microsoft Graph (Outlook Email Integration)
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
MICROSOFT_TENANT_ID=your_tenant_id

# Mailchimp
MAILCHIMP_API_KEY=your_api_key
MAILCHIMP_SERVER=us1  # Check your Mailchimp account for your server (us1, us2, etc.)

# Cron Job Security
CRON_SECRET=your_random_secret_string
```

## Setup Instructions

### 1. Twilio (WhatsApp)
1. Sign up at https://www.twilio.com/
2. Go to Console → Messaging → Try WhatsApp
3. Get your Account SID and Auth Token
4. For production, request WhatsApp Business approval

### 2. Microsoft Graph (Outlook)
1. Go to https://portal.azure.com/
2. Navigate to Azure Active Directory → App registrations → New registration
3. Name it "Framing App Email"
4. Get Client ID, create Client Secret
5. Grant permissions: Mail.Send
6. Get Tenant ID from Azure AD overview

### 3. Mailchimp
1. Log in to https://mailchimp.com/
2. Go to Account → Extras → API keys
3. Create a new API key
4. Note your server prefix (e.g., us1, us2) from your account URL

### 4. Vercel Deployment
1. Push code to GitHub
2. Import project to Vercel
3. Add environment variables in Vercel dashboard: Settings → Environment Variables
4. Deploy!

### 5. Cron Job Setup
The `vercel.json` file is already configured to run daily at 9 AM.
No additional setup needed - Vercel handles this automatically!

## Testing Locally

Install Vercel CLI:
```bash
npm i -g vercel
```

Test functions:
```bash
vercel dev
```

Then call endpoints:
```bash
curl -X POST http://localhost:3000/api/automations/send-review-request \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "John Doe",
    "customerEmail": "john@example.com",
    "channel": "email",
    "reviewLinks": {
      "google": "https://g.page/r/..."
    }
  }'
```

## Security Notes

- Never commit `.env.local` to git (already in .gitignore)
- Use different API keys for production vs development
- Rotate CRON_SECRET regularly
- Limit API key permissions to minimum required
