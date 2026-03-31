# Subscription Model Implementation Plan

## Overview
Add a 3-tier subscription model (Free, Pro, Enterprise) to limit app functionality based on user plan.

**Estimated Time:** 4-6 hours total  
**Difficulty:** 6/10

---

## 1. Database Setup (30 min)

### Add to Supabase SQL Editor:

```sql
-- Add subscription columns to users table (or create subscriptions table)
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free';
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Or create separate subscriptions table (recommended)
CREATE TABLE user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free', -- 'free', 'pro', 'enterprise'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'cancelled', 'expired', 'trialing'
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own subscription
CREATE POLICY "Users can view own subscription"
  ON user_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Create usage tracking table (optional, for enforcing limits)
CREATE TABLE usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  customers_count INT DEFAULT 0,
  quotes_count INT DEFAULT 0,
  ai_rooms_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, period_start)
);

ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON usage_tracking FOR SELECT
  USING (auth.uid() = user_id);
```

---

## 2. Tier Configuration (15 min)

Create `src/lib/subscription.ts`:

```typescript
export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export type TierLimits = {
  customers: number; // -1 = unlimited
  quotes_per_month: number;
  invoices_per_month: number;
  jobs_per_month: number;
  ai_rooms_per_month: number;
  stock_management: boolean;
  marketing_automation: boolean;
  advanced_reports: boolean;
  api_access: boolean;
  custom_branding: boolean;
  priority_support: boolean;
};

export const TIER_CONFIG: Record<SubscriptionTier, TierLimits> = {
  free: {
    customers: 10,
    quotes_per_month: 5,
    invoices_per_month: 5,
    jobs_per_month: 5,
    ai_rooms_per_month: 0,
    stock_management: false,
    marketing_automation: false,
    advanced_reports: false,
    api_access: false,
    custom_branding: false,
    priority_support: false,
  },
  pro: {
    customers: 100,
    quotes_per_month: 50,
    invoices_per_month: 50,
    jobs_per_month: 50,
    ai_rooms_per_month: 10,
    stock_management: true,
    marketing_automation: true,
    advanced_reports: true,
    api_access: false,
    custom_branding: false,
    priority_support: false,
  },
  enterprise: {
    customers: -1, // unlimited
    quotes_per_month: -1,
    invoices_per_month: -1,
    jobs_per_month: -1,
    ai_rooms_per_month: -1,
    stock_management: true,
    marketing_automation: true,
    advanced_reports: true,
    api_access: true,
    custom_branding: true,
    priority_support: true,
  },
};

export const TIER_PRICES = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 49, yearly: 490 }, // ~$40/mo if paid yearly
  enterprise: { monthly: 149, yearly: 1490 }, // ~$124/mo if paid yearly
};
```

---

## 3. Subscription Hook (45 min)

Add to `src/lib/subscription.ts`:

```typescript
import { useState, useEffect } from 'react';
import { supabase } from './supabase';

export type Subscription = {
  tier: SubscriptionTier;
  status: 'active' | 'cancelled' | 'expired' | 'trialing';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSubscription();
  }, []);

  const loadSubscription = async () => {
    if (!supabase) {
      setSubscription({
        tier: 'free',
        status: 'active',
        current_period_end: null,
        cancel_at_period_end: false,
      });
      setLoading(false);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading subscription:', error);
      }

      setSubscription(data || {
        tier: 'free',
        status: 'active',
        current_period_end: null,
        cancel_at_period_end: false,
      });
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const tier = subscription?.tier || 'free';
  const limits = TIER_CONFIG[tier];

  // Check if user can access a feature
  const canAccess = (feature: keyof TierLimits): boolean => {
    return !!limits[feature];
  };

  // Check if user is within usage limits
  const canCreate = async (type: 'customer' | 'quote' | 'invoice' | 'job' | 'ai_room'): Promise<boolean> => {
    const limitKey = `${type}s${type === 'customer' ? '' : '_per_month'}` as keyof TierLimits;
    const limit = limits[limitKey] as number;
    
    if (limit === -1) return true; // unlimited
    
    // TODO: Query usage_tracking table to check current month's usage
    // For now, return true (implement usage tracking later)
    return true;
  };

  return {
    subscription,
    tier,
    limits,
    loading,
    canAccess,
    canCreate,
    refresh: loadSubscription,
  };
}
```

---

## 4. Stripe Integration (1-2 hours)

### A. Create Stripe Account & Products
1. Sign up at https://stripe.com
2. Create products in Dashboard → Products:
   - **Pro Plan**: $49/month, $490/year
   - **Enterprise Plan**: $149/month, $1490/year
3. Note the Price IDs (e.g., `price_xxxxx`)

### B. Install Stripe
```bash
npm install stripe @stripe/stripe-js
```

### C. Create Stripe Webhook Handler
Create `api/stripe/webhook.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

type VercelRequest = any;
type VercelResponse = any;

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdate(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;
  }

  res.json({ received: true });
}

async function handleSubscriptionUpdate(subscription: any) {
  const customerId = subscription.customer;
  const subscriptionId = subscription.id;
  
  // Get user by stripe customer ID
  const { data: userData } = await supabase
    .from('user_subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!userData) return;

  // Determine tier from price ID
  const priceId = subscription.items.data[0].price.id;
  const tier = getTierFromPriceId(priceId);

  // Update subscription
  await supabase
    .from('user_subscriptions')
    .upsert({
      user_id: userData.user_id,
      tier,
      status: subscription.status,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id'
    });
}

async function handleSubscriptionDeleted(subscription: any) {
  const customerId = subscription.customer;
  
  await supabase
    .from('user_subscriptions')
    .update({
      tier: 'free',
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);
}

function getTierFromPriceId(priceId: string): 'free' | 'pro' | 'enterprise' {
  // Map your Stripe price IDs to tiers
  const PRICE_TO_TIER: Record<string, 'pro' | 'enterprise'> = {
    'price_xxxxx': 'pro', // Replace with your actual price IDs
    'price_yyyyy': 'enterprise',
  };
  return PRICE_TO_TIER[priceId] || 'free';
}
```

### D. Add Environment Variables to Vercel
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## 5. Pricing Page (1 hour)

Create `src/pages/Pricing.tsx`:

```typescript
import React from 'react';
import { useSubscription, TIER_PRICES } from '@/lib/subscription';

export default function PricingPage() {
  const { tier, subscription } = useSubscription();

  const handleUpgrade = async (newTier: 'pro' | 'enterprise') => {
    // Redirect to Stripe Checkout
    const response = await fetch('/api/stripe/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: newTier, billing: 'monthly' }),
    });
    
    const { url } = await response.json();
    window.location.href = url;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Pricing Plans</h1>
      <p className="text-slate-600 mb-8">Choose the plan that fits your business</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Free Tier */}
        <PricingCard
          name="Free"
          price={0}
          features={[
            'Up to 10 customers',
            '5 quotes per month',
            '5 invoices per month',
            'Basic reporting',
            'Email support',
          ]}
          current={tier === 'free'}
          onSelect={() => {}}
          disabled={tier === 'free'}
        />

        {/* Pro Tier */}
        <PricingCard
          name="Pro"
          price={TIER_PRICES.pro.monthly}
          features={[
            'Up to 100 customers',
            '50 quotes per month',
            '50 invoices per month',
            'Stock management',
            'Marketing automation',
            'Advanced reports',
            '10 AI room designs/month',
            'Priority support',
          ]}
          current={tier === 'pro'}
          onSelect={() => handleUpgrade('pro')}
          popular
        />

        {/* Enterprise Tier */}
        <PricingCard
          name="Enterprise"
          price={TIER_PRICES.enterprise.monthly}
          features={[
            'Unlimited customers',
            'Unlimited quotes & invoices',
            'Full stock management',
            'Full marketing automation',
            'Advanced analytics',
            'Unlimited AI room designs',
            'API access',
            'Custom branding',
            'Dedicated support',
          ]}
          current={tier === 'enterprise'}
          onSelect={() => handleUpgrade('enterprise')}
        />
      </div>
    </div>
  );
}

function PricingCard({ name, price, features, current, onSelect, disabled, popular }: any) {
  return (
    <div className={`border rounded-lg p-6 ${popular ? 'border-blue-500 shadow-lg' : 'border-slate-200'}`}>
      {popular && (
        <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded mb-2 inline-block">
          Most Popular
        </span>
      )}
      <h3 className="text-xl font-bold mb-2">{name}</h3>
      <div className="mb-4">
        <span className="text-4xl font-bold">${price}</span>
        <span className="text-slate-600">/month</span>
      </div>
      <ul className="space-y-2 mb-6">
        {features.map((feature: string, i: number) => (
          <li key={i} className="flex items-start gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-sm">{feature}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={onSelect}
        disabled={disabled || current}
        className={`w-full py-2 px-4 rounded ${
          current
            ? 'bg-slate-200 text-slate-600 cursor-not-allowed'
            : 'bg-blue-500 text-white hover:bg-blue-600'
        }`}
      >
        {current ? 'Current Plan' : 'Upgrade'}
      </button>
    </div>
  );
}
```

---

## 6. Feature Gating (1-2 hours)

### Example: Gate Stock Management

In `src/App.tsx`:
```typescript
import { useSubscription } from '@/lib/subscription';

// Inside App component:
const { canAccess } = useSubscription();

// In navigation:
{canAccess('stock_management') && (
  <a href="#/stock">Stock</a>
)}
```

In `src/pages/Stock.tsx`:
```typescript
export default function StockPage() {
  const { canAccess } = useSubscription();

  if (!canAccess('stock_management')) {
    return (
      <div className="p-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold mb-2">Stock Management</h2>
          <p className="text-slate-600 mb-4">
            Upgrade to Pro or Enterprise to access stock management features.
          </p>
          <a
            href="#/pricing"
            className="inline-block bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600"
          >
            View Pricing
          </a>
        </div>
      </div>
    );
  }

  // ... rest of stock page
}
```

### Example: Limit Quote Creation

In `src/pages/Quotes.tsx`:
```typescript
const { canCreate } = useSubscription();

const handleCreateQuote = async () => {
  const allowed = await canCreate('quote');
  if (!allowed) {
    toast('You\'ve reached your monthly quote limit. Upgrade to create more!');
    return;
  }
  // ... create quote logic
};
```

---

## 7. Implementation Checklist

- [ ] **Database**: Run SQL to create subscriptions table
- [ ] **Config**: Create `src/lib/subscription.ts` with tier limits
- [ ] **Hook**: Implement `useSubscription()` hook
- [ ] **Stripe**: Set up products and pricing
- [ ] **Webhook**: Create webhook handler for subscription events
- [ ] **Pricing Page**: Build pricing comparison UI
- [ ] **Feature Gates**: Add gates to Stock, Marketing, AI features
- [ ] **Usage Tracking**: Implement monthly usage counters (optional)
- [ ] **Testing**: Test upgrade/downgrade flow
- [ ] **Analytics**: Add analytics to track conversions

---

## Next Steps

1. **Start with database** - Set up Supabase tables
2. **Create config** - Define tier limits in code
3. **Build hook** - Implement subscription checking
4. **Add pricing page** - UI for users to see plans
5. **Stripe setup** - Last step, connects everything

**Note**: You can implement this incrementally. Start with feature gating on Free tier (hide Stock/Marketing), then add payment later.
