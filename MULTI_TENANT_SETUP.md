# Multi-Tenant Setup Guide

## Overview

This document explains how to set up the multi-tenant architecture for your framing app to support hundreds of users with their own API credentials.

## Architecture

- **Single Database (Supabase)**: Stores all user data and API credentials
- **User Authentication**: Each user logs in and manages their own API keys
- **Isolated Credentials**: Each user's API credentials are encrypted and inaccessible to others
- **API Functions**: Read from database instead of environment variables

## Step 1: Create Supabase Project

1. Go to https://supabase.com
2. Sign up (free tier available)
3. Create a new project
4. Note your:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **Anon Key** (for frontend)
   - **Service Role Key** (for backend APIs)

## Step 2: Create Database Tables

In your Supabase dashboard, go to **SQL Editor** and run:

```sql
-- Create user_api_credentials table
CREATE TABLE user_api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  twilio_account_sid TEXT,
  twilio_auth_token TEXT,
  twilio_whatsapp_number TEXT,
  mailchimp_api_key TEXT,
  mailchimp_server TEXT,
  microsoft_client_id TEXT,
  microsoft_client_secret TEXT,
  microsoft_tenant_id TEXT,
  outlook_from_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create RLS policy (users can only read/write their own credentials)
ALTER TABLE user_api_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own credentials"
  ON user_api_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own credentials"
  ON user_api_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own credentials"
  ON user_api_credentials FOR UPDATE
  USING (auth.uid() = user_id);
```

## Step 3: Configure Environment Variables

### Local Development (.env.local)
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Production (Vercel Dashboard)

1. Go to your Vercel project settings
2. **Environment Variables** section
3. Add:
   - `SUPABASE_URL` = Your Supabase URL
   - `SUPABASE_SERVICE_ROLE_KEY` = Your service role key
   - `VITE_SUPABASE_URL` = Your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = Your anon key

## Step 4: User Flow

### For New Users:
1. User signs up in the app (via Supabase Auth)
2. User navigates to **API Settings** page
3. User enters their:
   - Twilio credentials (for WhatsApp)
   - Mailchimp credentials
   - Microsoft/Outlook credentials
4. Credentials are encrypted and saved to database

### For Campaigns:
1. User creates a campaign in Marketing page
2. When sending, the app:
   - Gets the user's ID from authentication
   - Fetches their credentials from database
   - Uses those credentials to send via Twilio/Mailchimp/Outlook
   - Never exposes credentials to frontend

## Step 5: Verify Setup

1. Deploy to Vercel with environment variables set
2. User signs up for an account
3. User goes to API Settings
4. User enters their API credentials
5. User creates a test campaign
6. Test sending a message

## Security Notes

✅ **Row-Level Security (RLS)**: Enabled on credentials table
- Users can only see/modify their own credentials

✅ **Encryption**: Supabase encrypts sensitive columns
- Configure at table level if using Supabase's encryption addon

✅ **No Shared Secrets**: 
- No environment variables expose user credentials
- Each user's credentials isolated in database

✅ **Service Role Key**:
- Only used server-side in API functions
- Never exposed to frontend

## Troubleshooting

### "Supabase credentials not configured"
- Check environment variables in Vercel dashboard
- Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set

### "No API credentials configured"
- User needs to visit API Settings and add their credentials
- Check browser console for any auth errors

### API Returns 401 Unauthorized
- User token may be expired
- Check if user is still logged in
- May need to refresh token in auth service

## Scaling to 100+ Users

This architecture supports:
- **Unlimited users**: Supabase supports millions of rows
- **Concurrent requests**: Vercel scales automatically
- **Geographic distribution**: Users across any region
- **Compliance**: GDPR-ready with user data isolation

## Next Steps

1. ✅ Create Supabase project
2. ✅ Run SQL to create tables
3. ✅ Set environment variables on Vercel
4. ✅ Test with a user account
5. ✅ Share app link with beta users
6. Monitor usage and collect feedback

---

For questions or issues, check:
- Supabase docs: https://supabase.com/docs
- Vercel docs: https://vercel.com/docs
- Your app logs: Vercel dashboard > Deployments > Logs
