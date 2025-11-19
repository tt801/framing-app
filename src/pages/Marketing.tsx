// src/pages/Marketing.tsx
import React from "react";

/** Minimal inline icons (no external deps) */
const Icon = {
  Mail: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M4 4h16v16H4z" />
      <path d="m4 7 8 5 8-5" />
    </svg>
  ),
  Link2: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 12" />
      <path d="M14 11a5 5 0 0 1 0 7L12.5 20.5a5 5 0 0 1-7-7L7 12" />
    </svg>
  ),
  MessageSquare: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M21 15a4 4 0 0 1-4 4H8l-4 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
    </svg>
  ),
  ShoppingCart: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="9" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
      <path d="M3 3h2l2 12h11l2-8H6" />
    </svg>
  ),
  Megaphone: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M3 11v2a3 3 0 0 0 3 3h1l3 4v-7l10-4V7L10 11H6a3 3 0 0 1-3-3" />
    </svg>
  ),
  Phone: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07A19.5 19.5 0 0 1 3.15 9.81 19.86 19.86 0 0 1 .08 1.18 2 2 0 0 1 2.05 0h3a2 2 0 0 1 2 1.72c.12.89.31 1.76.57 2.6a2 2 0 0 1-.45 2.11L6 8a16 16 0 0 0 10 10l1.57-1.17a2 2 0 0 1 2.11-.45c.84.26 1.71.45 2.6.57A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  Star: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="m12 17.27 6.18 3.73-1.64-7.03 5.46-4.73-7.19-.62L12 2 9.19 8.62l-7.19.62 5.46 4.73L5.82 21z" />
    </svg>
  ),
  Calendar: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  Zap: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M13 2 3 14h7l-1 8 11-12h-7l1-8z" />
    </svg>
  ),
};

type CardProps = {
  title: string;
  icon: keyof typeof Icon;
  children: React.ReactNode;
};

function Card({ title, icon, children }: CardProps) {
  const Ico = Icon[icon];
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center gap-2">
        <Ico width={18} height={18} className="text-slate-700" />
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export default function MarketingPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Marketing</h1>
        <p className="text-sm text-slate-600">
          Tools & integrations to grow a small, medium, or large framing business.
        </p>
      </header>

      {/* Plans by business size */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card title="Small studio" icon="Zap">
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            <li>Google Business Profile: keep hours, photos, and reviews fresh.</li>
            <li>Instagram & Facebook posts 2–3×/week (before/after shots).</li>
            <li>WhatsApp click-to-chat from website.</li>
            <li>Monthly email to past customers (top 3 offers).</li>
          </ul>
        </Card>

        <Card title="Growing shop" icon="Megaphone">
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            <li>Meta/Google ads for “custom framing + {`{city}`}”.</li>
            <li>Automated abandoned-quote follow-ups (email/SMS).</li>
            <li>Seasonal campaigns (graduations, weddings, holidays).</li>
            <li>Simple referral program with coupon codes.</li>
          </ul>
        </Card>

        <Card title="Multi-location" icon="ShoppingCart">
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            <li>CRM segmentation (homeowners, artists, galleries, corporates).</li>
            <li>Product feeds for e-comm (popular sizes, ready-mades).</li>
            <li>Review syndication & NPS → remarketing audiences.</li>
            <li>ROAS dashboards; POS/stock → ads & promos.</li>
          </ul>
        </Card>
      </div>

      {/* Integrations / APIs */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Messaging & Reviews" icon="MessageSquare">
          <div className="grid gap-3 sm:grid-cols-2">
            <Integration label="WhatsApp Cloud API" icon="Phone" />
            <Integration label="Twilio SMS" icon="Phone" />
            <Integration label="Google Reviews" icon="Star" />
            <Integration label="Facebook/Instagram DM" icon="MessageSquare" />
          </div>
        </Card>

        <Card title="Email & Links" icon="Mail">
          <div className="grid gap-3 sm:grid-cols-2">
            <Integration label="Mailchimp" icon="Mail" />
            <Integration label="Sendgrid" icon="Mail" />
            <Integration label="Website CTA buttons" icon="Link2" />
            <Integration label="Booking (Calendly)" icon="Calendar" />
          </div>
        </Card>

        <Card title="Commerce & Ads" icon="ShoppingCart">
          <div className="grid gap-3 sm:grid-cols-2">
            <Integration label="Shopify / WooCommerce" icon="ShoppingCart" />
            <Integration label="Meta & Google Ads" icon="Megaphone" />
            <Integration label="Google Merchant Center" icon="ShoppingCart" />
            <Integration label="Pixel & Conversions API" icon="Zap" />
          </div>
        </Card>

        <Card title="Supplier & Catalog Ingestion" icon="Link2">
          <p className="mb-3 text-sm text-slate-700">
            Import CSV/XML from mat and moulding manufacturers to keep SKUs, colors, and pricing up to date.
          </p>
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            <li>Supported: Nielsen/Bainbridge, Crescent, Larson-Juhl, Peterboro, Tru Vue, Daler-Rowney.</li>
            <li>Formats: CSV, TSV, Excel, XML. Field mapping in <code>Admin → Catalog Import</code>.</li>
            <li>Planned: direct APIs/webhooks where available.</li>
          </ul>
        </Card>
      </div>
    </main>
  );
}

function Integration({ label, icon }: { label: string; icon: keyof typeof Icon }) {
  const Ico = Icon[icon];
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <Ico width={16} height={16} className="text-slate-700" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
