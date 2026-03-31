import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acpi",
});

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

// Handle checkout.session.completed
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  if (!session.subscription) return;

  const companyAccountId = session.subscription instanceof Stripe.Subscription
    ? (session.subscription.metadata?.company_account_id)
    : undefined;

  if (!companyAccountId) {
    console.warn("[webhook] No company_account_id in subscription metadata");
    return;
  }

  // Fetch the subscription to get current period end
  const subscription = await stripe.subscriptions.retrieve(
    session.subscription as string
  );

  await supabase
    .from("company_accounts")
    .update({
      stripe_subscription_id: subscription.id,
      stripe_price_id: subscription.items.data[0]?.price.id,
      plan_status: "active",
      subscription_renewed_at: new Date(subscription.current_period_end * 1000),
    })
    .eq("id", companyAccountId);

  console.log("[webhook] Subscription activated:", companyAccountId);
}

// Handle customer.subscription.updated
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const companyAccountId = subscription.metadata?.company_account_id;
  if (!companyAccountId) return;

  const status =
    subscription.cancel_at_period_end || subscription.status === "canceled"
      ? "expired"
      : subscription.status === "active"
      ? "active"
      : "trialing";

  await supabase
    .from("company_accounts")
    .update({
      stripe_subscription_id: subscription.id,
      plan_status: status,
      subscription_cancel_at: subscription.cancel_at
        ? new Date(subscription.cancel_at * 1000)
        : null,
      subscription_renewed_at: new Date(subscription.current_period_end * 1000),
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

  // Log webhook
  await supabase.from("stripe_webhook_logs").insert({
    event_id: event.id,
    event_type: event.type,
    payload: event.data,
    status: "pending",
  });

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

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
