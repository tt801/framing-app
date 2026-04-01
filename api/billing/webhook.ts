import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const getSubscriptionPeriodEnd = (subscription: Stripe.Subscription) =>
  subscription.items.data[0]?.current_period_end ?? null;

const mapSubscriptionStatus = (subscription: Stripe.Subscription) => {
  if (subscription.status === "past_due" || subscription.status === "unpaid" || subscription.status === "paused") {
    return "past_due" as const;
  }

  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
    return "expired" as const;
  }

  if (subscription.status === "trialing") {
    return "trialing" as const;
  }

  return "active" as const;
};

// Verify webhook signature
function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Stripe.Event | null {
  try {
    return stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err);
    return null;
  }
}

// Handle Founder one-time payment
async function handleFounderPayment(session: Stripe.Checkout.Session) {
  const companyAccountId = session.payment_intent
    ? (await stripe.paymentIntents.retrieve(session.payment_intent as string))
        .metadata?.company_account_id
    : undefined;

  if (!companyAccountId) {
    console.warn("[webhook] No company_account_id in Founder payment metadata");
    return;
  }

  await supabase
    .from("company_accounts")
    .update({
      plan_status: "active",
      stripe_price_id: "founder_lifetime",
      subscription_renewed_at: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000), // 100 years
    })
    .eq("id", companyAccountId);

  console.log("[webhook] Founder lifetime access activated:", companyAccountId);
}

// Handle checkout.session.completed (subscription)
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  if (!session.subscription) return;

  const subscription = await stripe.subscriptions.retrieve(
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id
  );

  const companyAccountId = subscription.metadata?.company_account_id;

  if (!companyAccountId) {
    console.warn("[webhook] No company_account_id in subscription metadata");
    return;
  }

  const periodEnd = getSubscriptionPeriodEnd(subscription);

  await supabase
    .from("company_accounts")
    .update({
      stripe_subscription_id: subscription.id,
      stripe_price_id: subscription.items.data[0]?.price.id,
      plan_status: "active",
      subscription_renewed_at: periodEnd ? new Date(periodEnd * 1000) : null,
    })
    .eq("id", companyAccountId);

  console.log("[webhook] Subscription activated:", companyAccountId);
}

// Handle customer.subscription.updated
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const companyAccountId = subscription.metadata?.company_account_id;
  if (!companyAccountId) return;

  const status = mapSubscriptionStatus(subscription);
  const periodEnd = getSubscriptionPeriodEnd(subscription);

  await supabase
    .from("company_accounts")
    .update({
      stripe_subscription_id: subscription.id,
      stripe_price_id: subscription.items.data[0]?.price.id,
      plan_status: status,
      subscription_cancel_at: subscription.cancel_at
        ? new Date(subscription.cancel_at * 1000)
        : null,
      subscription_renewed_at: periodEnd ? new Date(periodEnd * 1000) : null,
    })
    .eq("id", companyAccountId);

  console.log("[webhook] Subscription updated:", companyAccountId, "→", status);
}

// Handle customer.subscription.deleted
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const companyAccountId = subscription.metadata?.company_account_id;
  if (!companyAccountId) return;

  await supabase
    .from("company_accounts")
    .update({
      stripe_subscription_id: null,
      plan_status: "expired",
    })
    .eq("id", companyAccountId);

  console.log("[webhook] Subscription deleted:", companyAccountId);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const signature = req.headers["stripe-signature"];
  if (!signature) return res.status(400).json({ error: "Missing signature" });

  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }

  const event = verifyWebhookSignature(
    body,
    Array.isArray(signature) ? signature[0] : signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  if (!event) return res.status(400).json({ error: "Invalid signature" });

  const { data: existingLog, error: existingLogError } = await supabase
    .from("stripe_webhook_logs")
    .select("event_id, status")
    .eq("event_id", event.id)
    .maybeSingle();

  if (existingLogError) {
    console.error("[webhook] Failed to query webhook log:", existingLogError);
    return res.status(500).json({ error: "Webhook log lookup failed" });
  }

  if (existingLog) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  // Log webhook
  await supabase.from("stripe_webhook_logs").insert({
    event_id: event.id,
    event_type: event.type,
    payload: event.data,
    status: "pending",
  });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment") {
          // Founder one-time payment
          await handleFounderPayment(session);
        } else {
          await handleCheckoutSessionCompleted(session);
        }
        break;
      }

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        console.log("[webhook] Unhandled event type:", event.type);
    }

    // Mark webhook as processed
    await supabase
      .from("stripe_webhook_logs")
      .update({ status: "processed" })
      .eq("event_id", event.id);

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[webhook] Error processing event:", error);

    // Mark webhook as failed
    await supabase
      .from("stripe_webhook_logs")
      .update({ status: "failed" })
      .eq("event_id", event.id);

    res.status(400).json({ error: "Webhook processing failed" });
  }
}
