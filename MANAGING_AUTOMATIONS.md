# Managing Marketing Automation

## Overview
Once activated, marketing automations run automatically every day at 9 AM, sending review requests and quote follow-ups based on your settings.

## Where to Manage Automations

### 1. **Marketing Page** (Primary Interface)
Navigate to: **Marketing** → **Smart Campaign Automation** section

**Quick Actions:**
- Toggle automation on/off
- Select channel (WhatsApp, Email, Mailchimp)
- Enable/disable specific automations
- Test API connections
- View setup instructions

**Best for:** Day-to-day management and quick changes

---

### 2. **Admin > Integrations Page** (Configuration Hub)
Navigate to: **Admin** → **Integrations** → **Marketing Automation**

**Available Features:**
- Full configuration panel with setup guide
- API testing for each channel
- View automation logs
- Environment variables documentation
- Detailed troubleshooting

**Best for:** Initial setup and technical configuration

---

## Daily Operation

### What Happens Automatically:
Every day at **9:00 AM**, the system automatically:

1. **Checks for jobs completed 3 days ago**
   - If review requests enabled → sends review request
   - Uses your selected channel (WhatsApp/Email/Mailchimp)
   - Logs activity for tracking

2. **Checks for quotes pending 7+ days**
   - If quote follow-ups enabled → sends personalized follow-up
   - Message varies by age: Day 7 vs Day 14+ 
   - Tracks responses and failures

3. **Logs all activity**
   - Success/failure status
   - Customer contacted
   - Channel used
   - Any errors encountered

---

## How to Monitor Automations

### View Logs
**Marketing Page:**
- Click "View Logs" in Automation Settings panel

**Admin > Integrations:**
- Click "📋 View Logs" button
- Logs appear in browser console

### Log Information:
- Timestamp of each message
- Customer name and contact info
- Type (review request or quote follow-up)
- Channel used
- Status (sent or failed)
- Error details (if failed)

### Export Logs
From the logs viewer, you can:
- Download CSV report
- Filter by date range
- View success rates
- See channel performance

---

## Common Management Tasks

### ✅ Pause All Automations
**Quick Method:**
1. Go to Marketing page
2. Uncheck "Enable Automation" toggle
3. Changes apply immediately

**Note:** Scheduled job still runs, but won't send messages

---

### 🔄 Change Communication Channel
1. Go to Marketing or Admin > Integrations
2. Select different channel:
   - 📧 **Email (Outlook)** - Professional, free with Microsoft 365
   - 💬 **WhatsApp** - High engagement, requires Twilio account
   - 📬 **Mailchimp** - Bulk campaigns, marketing features
3. Test the new channel with "🧪 Test" button
4. If test succeeds, automation uses new channel

---

### 📝 Edit Message Templates
1. Go to **Marketing** page
2. Scroll to **Communication Templates Library**
3. Click "Edit" on any template
4. Update message text
5. Click "Done" to save
6. Automations use updated template next run

**Templates Used by Automations:**
- "Review Request" → for 3-day review requests
- "Day 7 Quote Follow-up" → for pending quotes
- "Day 14 Quote Follow-up" → for older quotes

---

### ⏸️ Disable Specific Automation Type
**Example:** Keep review requests ON, but turn OFF quote follow-ups

1. Go to Marketing or Admin page
2. Automation settings panel
3. Uncheck "Auto quote follow-ups"
4. Keep "Auto-review requests" checked
5. Only review requests will send automatically

---

### 📊 View Performance Stats
Run this in browser console (F12):
```javascript
// Get automation statistics
const stats = JSON.parse(localStorage.getItem('marketing.automation.logs.v1') || '[]');
console.table(stats);
```

**Stats Available:**
- Total messages sent
- Success rate
- Messages per channel
- Last 24 hours activity
- Failure reasons

---

## Troubleshooting

### ❌ Test Failed / Messages Not Sending

**1. Check Environment Variables**
- Go to Vercel Dashboard → Settings → Environment Variables
- Verify all required keys are set:
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (WhatsApp)
  - `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (Email)
  - `MAILCHIMP_API_KEY`, `MAILCHIMP_SERVER` (Mailchimp)

**2. Verify API Credentials**
- Twilio: Check [Twilio Console](https://console.twilio.com)
- Microsoft: Check [Azure Portal](https://portal.azure.com) → App Registrations
- Mailchimp: Check [Account → API Keys](https://mailchimp.com/account/api)

**3. Check Deployment**
- Ensure latest code is deployed to Vercel
- Run `vercel --prod` to redeploy
- Check Vercel deployment logs for errors

**4. Review Logs**
- Click "View Logs" button
- Look for specific error messages
- Common issues:
  - Invalid phone number format (must include country code)
  - Expired OAuth tokens (Microsoft)
  - Rate limits exceeded

---

### 🔄 Update API Credentials

**When to Update:**
- Twilio/Microsoft/Mailchimp password changed
- API keys expired
- Switching to different account

**How to Update:**
1. Get new credentials from provider
2. Update in Vercel Dashboard → Environment Variables
3. Redeploy app: `vercel --prod`
4. Test with "🧪 Test" buttons
5. If test succeeds, automation will work

---

### 📅 Change Automation Schedule

**Default:** Daily at 9:00 AM

**To Change:**
1. Edit `vercel.json` file
2. Update cron schedule:
   ```json
   {
     "crons": [{
       "path": "/api/automations/scheduled-check",
       "schedule": "0 14 * * *"  // 2 PM daily
     }]
   }
   ```
3. Deploy changes to Vercel
4. New schedule takes effect

**Cron Format:**
- `0 9 * * *` = 9 AM daily
- `0 14 * * *` = 2 PM daily
- `0 9 * * 1` = 9 AM every Monday
- `0 9 1,15 * *` = 9 AM on 1st and 15th of month

---

## Best Practices

### ✨ For Maximum Engagement:
1. **Test messages first** before enabling automations
2. **Personalize templates** with your brand voice
3. **Monitor logs weekly** to catch issues early
4. **Adjust timing** based on customer responses
5. **Keep templates short** and action-oriented
6. **Include links** in review requests (Google, Facebook)
7. **Use emojis sparingly** for personality

### 🔒 For Privacy & Compliance:
1. Only send to customers who agreed to communications
2. Include unsubscribe option in templates
3. Respect "do not contact" preferences
4. Secure API keys (never share publicly)
5. Review logs regularly for unauthorized access
6. Delete old logs periodically (privacy)

### 💰 For Cost Management:
- **WhatsApp (Twilio):** ~$0.005 per message
- **Email (Outlook):** Free with Microsoft 365 subscription
- **Mailchimp:** Free tier: 500 contacts, then paid plans

**Cost Estimates:**
- 100 customers/month × WhatsApp = ~$0.50/month
- 100 customers/month × Email = Free
- 100 customers/month × Mailchimp = Free (under 500 contacts)

---

## FAQ

**Q: Can I send test messages to myself?**  
A: Yes! Change test data in code to use your contact info, or add "test mode" that sends all automations to your number/email first.

**Q: What if a customer already left a review?**  
A: Currently, system sends to all completed jobs. Future update will track reviews and skip customers who already reviewed.

**Q: Can I see which customers received messages?**  
A: Yes! View logs show customer name, contact info, and timestamp for every sent message.

**Q: How do I stop sending to specific customer?**  
A: Add them to "excluded customers" list (coming soon), or manually mark as "do not contact" in customer record.

**Q: Can I customize the schedule (e.g., Monday/Friday only)?**  
A: Yes! Edit `vercel.json` cron schedule. See "Change Automation Schedule" section above.

**Q: What happens if API fails?**  
A: Error logged, automation skips that customer, continues with next. Check logs for details.

**Q: Can I use my own SMTP server instead of Outlook?**  
A: Yes! Modify `send-review-request.ts` to use Nodemailer with your SMTP credentials.

---

## Getting Help

**Check Logs First:**
- Marketing page → View Logs
- Look for error messages
- Note customer name and timestamp

**Review Setup Guide:**
- Admin > Integrations → Marketing Automation → Show Setup Guide
- Verify all environment variables are set correctly
- Test each channel individually

**Still Stuck?**
1. Check [AUTOMATION_SETUP.md](AUTOMATION_SETUP.md) for detailed setup
2. Review Vercel deployment logs
3. Test API endpoints manually with Postman/curl
4. Check provider status pages (Twilio, Azure, Mailchimp)
