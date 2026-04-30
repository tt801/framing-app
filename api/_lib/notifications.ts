type EmailPayload = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

function getNotificationConfig() {
  const resendApiKey = (process.env.RESEND_API_KEY || "").trim();
  const fromEmail = (process.env.SUPPORT_FROM_EMAIL || "support@framersapp.co.za").trim();
  const notifyListRaw = (process.env.SUPPORT_TICKET_NOTIFY_TO || "support@framersapp.co.za").trim();
  const notifyList = notifyListRaw
    .split(",")
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
    console.warn("[support-notifications] RESEND_API_KEY missing, skipping email send");
    return { skipped: true };
  }

  const to = Array.isArray(payload.to) ? payload.to : [payload.to];

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to,
      subject: payload.subject,
      text: payload.text,
      ...(payload.html ? { html: payload.html } : {}),
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Email send failed: ${raw}`);
  }

  return response.json().catch(() => ({}));
}
