import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-03-25.dahlia" });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const getPeriodEnd = (subscription: Stripe.Subscription) => subscription.items.data[0]?.current_period_end ?? null;
const mapStatus = (subscription: Stripe.Subscription) => {
  if (["past_due", "unpaid", "paused"].includes(subscription.status)) return "past_due";
  if (["canceled", "incomplete_expired"].includes(subscription.status)) return "expired";
  if (subscription.status === "trialing") return "trialing";
  return "active";
};

function verifyWebhookSignature(body: string, signature: string, secret: string): Stripe.Event | null {
  try { return stripe.webhooks.constructEvent(body, signature, secret); }
  catch (error) { console.error("[webhook] Signature verification failed:", error instanceof Error ? error.message : "unknown signature error"); return null; }
}

async function requireUpdatedAccount(companyAccountId: string, values: Record<string, unknown>) {
  const { data, error } = await supabase.from("company_accounts").update(values).eq("id", companyAccountId).select("id").single();
  if (error || !data) throw error || new Error("Target company account was not updated");
}

// Checkout persists this association and stamps company metadata on its Stripe
// customer and subscription. Unknown customers without either marker are not ours;
// conflicting or incomplete FramersApp identity must not be acknowledged.
function customerIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined) {
  return typeof customer === "string" ? customer : customer?.id;
}

async function resolveCompanyAccount(customerId: string | undefined, metadataCompanyId: string | undefined) {
  if (!customerId) throw new Error("Billing event has no Stripe customer identity");
  const { data: account, error } = await supabase.from("company_accounts")
    .select("id, stripe_customer_id").eq("stripe_customer_id", customerId).maybeSingle();
  if (error) throw error;
  if (metadataCompanyId) {
    if (!account || account.id !== metadataCompanyId) throw new Error("Company/customer billing identity mismatch");
    return account as { id: string; stripe_customer_id: string };
  }
  if (account) throw new Error("FramersApp billing event is missing company metadata");
  const customer = await stripe.customers.retrieve(customerId);
  if (!("metadata" in customer)) throw new Error("Stripe customer is deleted; cannot classify billing event");
  if (customer.metadata?.company_account_id) throw new Error("Company-marked Stripe customer is missing its account association");
  return null; // No stored association and no FramersApp customer metadata.
}

async function reconcileCompanySubscription(companyAccountId: string, customerId: string, eventId: string, claimToken: string) {
  const reconcileToken = randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_stripe_subscription_reconciliation", {
    p_company_account_id: companyAccountId,
    p_lease_token: reconcileToken,
    p_lease_seconds: 300,
  });
  if (claimError) throw claimError;
  if (claimed !== true) throw new Error("Subscription reconciliation is busy; retry webhook");

  try {
    const subscriptions: Stripe.Subscription[] = [];
    let startingAfter: string | undefined;
    while (true) {
      const page = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}) });
      if (!Array.isArray(page.data) || typeof page.has_more !== "boolean") throw new Error("Incomplete Stripe subscription response");
      for (const subscription of page.data) {
        if (customerIdOf(subscription.customer) !== customerId || subscription.metadata?.company_account_id !== companyAccountId) {
          throw new Error("Subscription does not match verified company/customer identity");
        }
        subscriptions.push(subscription);
      }
      if (!page.has_more) break;
      const lastId = page.data.at(-1)?.id;
      if (!lastId || lastId === startingAfter) throw new Error("Stripe subscription pagination did not advance");
      startingAfter = lastId;
    }
    const matching = subscriptions
      .filter(subscription => ["active", "trialing", "past_due", "unpaid", "paused"].includes(subscription.status))
      .sort((left, right) => (getPeriodEnd(right) ?? 0) - (getPeriodEnd(left) ?? 0));
    const current = matching[0];
    const { data, error } = await supabase.rpc("reconcile_stripe_subscription_state", {
      p_company_account_id: companyAccountId,
      p_event_id: eventId,
      p_claim_token: claimToken,
      p_reconcile_token: reconcileToken,
      p_subscription_id: current?.id || null,
      p_status: current ? mapStatus(current) : "expired",
      p_price_id: current?.items.data[0]?.price.id || null,
      p_period_end: current && getPeriodEnd(current) ? new Date(getPeriodEnd(current)! * 1000).toISOString() : null,
      p_cancel_at: current?.cancel_at ? new Date(current.cancel_at * 1000).toISOString() : null,
    });
    if (error) throw error;
    if (data !== true) throw new Error("Target company account was not updated");
  } finally {
    const { error } = await supabase.rpc("release_stripe_subscription_reconciliation", {
      p_company_account_id: companyAccountId,
      p_lease_token: reconcileToken,
    });
    if (error) console.error("[webhook] Failed to release reconciliation lease:", error);
  }
}

async function handleFounderPayment(session: Stripe.Checkout.Session) {
  const companyAccountId = session.payment_intent
    ? (await stripe.paymentIntents.retrieve(session.payment_intent as string)).metadata?.company_account_id
    : undefined;
  const account = await resolveCompanyAccount(customerIdOf(session.customer), companyAccountId);
  if (!account) return; // Unrelated Stripe checkout.
  if (!companyAccountId) throw new Error("Founder payment is missing company metadata");
  if (session.mode !== "payment" || session.payment_status !== "paid") throw new Error("Founder checkout is not paid");
  const customerId = customerIdOf(session.customer) || null;
  const founderPriceId = process.env.VITE_STRIPE_PRICE_FOUNDER || "";
  const { data, error } = await supabase.rpc("complete_founder_checkout", {
    p_company_account_id: account.id,
    p_session_id: session.id,
    p_customer_id: customerId,
    p_founder_price_id: founderPriceId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Founder checkout reservation was not found or could not be completed");
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, eventId: string, claimToken: string) {
  if (session.mode !== "subscription") {
    await resolveCompanyAccount(customerIdOf(session.customer), undefined);
    return; // Unknown customer is unrelated; a known company throws for retry.
  }
  const sessionCustomerId = customerIdOf(session.customer);
  if (!session.subscription) {
    await resolveCompanyAccount(sessionCustomerId, undefined);
    return; // Unrelated Stripe checkout; a known one throws for retry.
  }
  const subscription = await stripe.subscriptions.retrieve(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
  if (customerIdOf(subscription.customer) !== sessionCustomerId) throw new Error("Checkout and subscription customer mismatch");
  const account = await resolveCompanyAccount(sessionCustomerId, subscription.metadata?.company_account_id);
  if (!account) return;
  await reconcileCompanySubscription(account.id, account.stripe_customer_id, eventId, claimToken);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription, eventId: string, claimToken: string) {
  const account = await resolveCompanyAccount(customerIdOf(subscription.customer), subscription.metadata?.company_account_id);
  if (!account) return;
  await reconcileCompanySubscription(account.id, account.stripe_customer_id, eventId, claimToken);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, eventId: string, claimToken: string) {
  const account = await resolveCompanyAccount(customerIdOf(subscription.customer), subscription.metadata?.company_account_id);
  if (!account) return;
  await reconcileCompanySubscription(account.id, account.stripe_customer_id, eventId, claimToken);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const signature = req.headers["stripe-signature"];
  if (!signature) return res.status(400).json({ error: "Missing signature" });
  let body = "";
  for await (const chunk of req) body += chunk.toString();
  const event = verifyWebhookSignature(body, Array.isArray(signature) ? signature[0] : signature, process.env.STRIPE_WEBHOOK_SECRET!);
  if (!event) return res.status(400).json({ error: "Invalid signature" });

  const claimToken = randomUUID();
  const { data: claim, error: claimError } = await supabase.rpc("claim_stripe_webhook", {
    p_event_id: event.id, p_event_type: event.type, p_payload: event.data, p_claim_token: claimToken, p_lease_seconds: 300,
  });
  if (claimError) return res.status(500).json({ error: "Webhook claim failed" });
  const claimRow = Array.isArray(claim) ? claim[0] : claim;
  if (claimRow?.claimed === false && claimRow.status === "processed") return res.status(200).json({ received: true, duplicate: true });
  if (claimRow?.claimed !== true || claimRow.status !== "pending") {
    return res.status(503).json({ error: "Webhook event has not been claimed for processing; retry delivery" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment") await handleFounderPayment(session);
        else await handleCheckoutSessionCompleted(session, event.id, claimToken);
        break;
      }
      case "customer.subscription.updated": await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, event.id, claimToken); break;
      case "customer.subscription.deleted": await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, event.id, claimToken); break;
      default: break;
    }
    const { data: finished, error: finishError } = await supabase.rpc("finish_stripe_webhook", { p_event_id: event.id, p_claim_token: claimToken, p_status: "processed" });
    if (finishError || finished !== true) throw finishError || new Error("Webhook completion was not recorded");
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("[webhook] Error processing event:", error);
    await supabase.rpc("finish_stripe_webhook", { p_event_id: event.id, p_claim_token: claimToken, p_status: "failed" });
    return res.status(400).json({ error: "Webhook processing failed" });
  }
}
