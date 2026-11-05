type EmailPayload = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

function getNotificationConfig() {
  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  const fromEmail = (process.env.SUPPORT_FROM_EMAIL || 'support@framersapp.co.za').trim();
  const notifyListRaw = (process.env.SUPPORT_TICKET_NOTIFY_TO || 'support@framersapp.co.za').trim();
  const notifyList = notifyListRaw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    resendApiKey,
    fromEmail,
    notifyList,
  };
}

export function getSupportNotificationRecipients() {
  return getNotificationConfig().notifyList;
}

export async function sendSupportEmail(payload: EmailPayload) {
  const { resendApiKey, fromEmail } = getNotificationConfig();
  if (!resendApiKey) {
    console.warn('[support-notifications] RESEND_API_KEY missing, skipping email send');
    return { skipped: true };
  }

  // Keep the existing recipient set, but never disclose support/customer addresses to each other.
  const recipients = [...new Set((Array.isArray(payload.to) ? payload.to : [payload.to]).map(value => value.trim()).filter(Boolean))];
  const outcomes = await Promise.allSettled(recipients.map(async recipient => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient],
        subject: payload.subject,
        text: payload.text,
        ...(payload.html ? { html: payload.html } : {}),
      }),
    });
    if (!response.ok) throw new Error('Support email could not be submitted');
    return response.json().catch(() => ({}));
  }));
  if (outcomes.some(outcome => outcome.status === 'rejected')) throw new Error('Support email could not be submitted');
  return { submitted: outcomes.length };
}
