import type { VercelRequest, VercelResponse } from "@vercel/node";

type PolicyType = "privacy" | "terms" | "cookie";

type PolicySection = {
  heading: string;
  body: string[];
};

type PolicyDocument = {
  type: PolicyType;
  title: string;
  lastUpdated: string;
  summary: string;
  sections: PolicySection[];
};

const LAST_UPDATED = "2026-04-29";

const POLICIES: Record<PolicyType, PolicyDocument> = {
  privacy: {
    type: "privacy",
    title: "Privacy Policy",
    lastUpdated: LAST_UPDATED,
    summary:
      "This policy explains how Framers App collects, uses, stores, and protects personal data for users and their customers across global markets.",
    sections: [
      {
        heading: "Who We Are",
        body: [
          "Framers App provides software for framing businesses to manage customers, quotes, jobs, invoicing, and marketing workflows.",
          "For privacy requests, contact support@framersapp.co.za.",
        ],
      },
      {
        heading: "Data We Collect",
        body: [
          "Account data: name, email, company details, billing status, and workspace settings.",
          "Operational data: quote/job/invoice records, stock data, automation settings, and uploaded files.",
          "Technical data: IP address, browser details, device metadata, logs, and security signals.",
        ],
      },
      {
        heading: "How We Use Data",
        body: [
          "To provide and secure the service, process billing, and deliver customer support.",
          "To improve product performance, reliability, and usability.",
          "To send service notices and, where permitted, product and marketing updates.",
        ],
      },
      {
        heading: "Legal Bases and Global Compliance",
        body: [
          "Where required by law, processing is based on contract performance, legitimate interests, legal obligations, and consent where applicable.",
          "Framers App is designed to support global obligations including GDPR/UK GDPR, POPIA, CCPA/CPRA, and similar frameworks where applicable.",
        ],
      },
      {
        heading: "International Transfers",
        body: [
          "Data may be processed in multiple regions through trusted infrastructure and service providers.",
          "Where cross-border transfer rules apply, appropriate contractual and technical safeguards are used.",
        ],
      },
      {
        heading: "Sharing and Subprocessors",
        body: [
          "Data is shared with payment processors, cloud hosting, analytics, email, and integration providers only as needed to operate the service.",
          "Framers App does not sell personal information.",
        ],
      },
      {
        heading: "Retention",
        body: [
          "Data is retained while accounts are active and for reasonable periods required for legal, audit, fraud-prevention, or backup purposes.",
          "Users can request deletion subject to legal and contractual limits.",
        ],
      },
      {
        heading: "Your Rights",
        body: [
          "Depending on your jurisdiction, you may have rights to access, correct, delete, export, restrict, or object to processing.",
          "Requests can be submitted to support@framersapp.co.za.",
        ],
      },
    ],
  },
  terms: {
    type: "terms",
    title: "Terms of Service",
    lastUpdated: LAST_UPDATED,
    summary:
      "These terms govern use of Framers App by businesses and authorized users worldwide.",
    sections: [
      {
        heading: "Acceptance and Eligibility",
        body: [
          "By using Framers App, you agree to these terms on behalf of yourself and, where relevant, your organization.",
          "You must have authority to create and administer your workspace.",
        ],
      },
      {
        heading: "Service Scope",
        body: [
          "Framers App provides software features for quoting, jobs, invoicing, stock, room visualization, and integrations.",
          "Features may evolve as the product improves.",
        ],
      },
      {
        heading: "Accounts and Security",
        body: [
          "You are responsible for account credentials, user access controls, and lawful use of the platform.",
          "You must promptly report suspected unauthorized access.",
        ],
      },
      {
        heading: "Billing and Subscriptions",
        body: [
          "Paid plans renew according to the selected billing cycle unless canceled.",
          "Taxes, currency conversion, and processor fees may apply based on region and payment method.",
        ],
      },
      {
        heading: "Customer Data and Responsibility",
        body: [
          "You retain ownership of your business data and are responsible for obtaining any consent required to upload customer information.",
          "You are responsible for legal compliance in your jurisdiction when using data and communications features.",
        ],
      },
      {
        heading: "Acceptable Use",
        body: [
          "You may not use the service for unlawful activity, infringement, abuse, disruption, or attempts to bypass security controls.",
          "Framers App may suspend or terminate accounts for serious misuse.",
        ],
      },
      {
        heading: "Liability and Warranties",
        body: [
          "The service is provided on an as-available basis. To the fullest extent allowed by law, implied warranties are disclaimed.",
          "Liability is limited to direct damages up to fees paid in the preceding twelve months, except where limits are not permitted by law.",
        ],
      },
      {
        heading: "Governing Law and Disputes",
        body: [
          "Unless otherwise required by mandatory local law, disputes are governed by the law and venue specified in your subscription agreement or order form.",
          "If no separate agreement applies, contact support first to seek resolution in good faith.",
        ],
      },
    ],
  },
  cookie: {
    type: "cookie",
    title: "Cookie Policy",
    lastUpdated: LAST_UPDATED,
    summary:
      "This policy explains how cookies and similar technologies are used on Framers App websites and applications.",
    sections: [
      {
        heading: "What Cookies Are",
        body: [
          "Cookies are small text files stored on your device to remember preferences, maintain sessions, and improve product performance.",
        ],
      },
      {
        heading: "Types of Cookies We Use",
        body: [
          "Strictly necessary cookies: authentication, security, and core app functionality.",
          "Performance cookies: product analytics and diagnostics to improve reliability and UX.",
          "Preference cookies: settings such as language or display preferences.",
        ],
      },
      {
        heading: "Third-Party Technologies",
        body: [
          "Some cookies may be set by trusted third-party providers (for example billing, analytics, or support tooling) used to run the service.",
        ],
      },
      {
        heading: "Managing Cookies",
        body: [
          "You can manage cookies through browser controls. Disabling certain cookies may affect core product functionality.",
          "Where required by law, consent options are provided before non-essential cookies are used.",
        ],
      },
      {
        heading: "Do Not Track and Regional Preferences",
        body: [
          "Regional privacy controls and consent mechanisms may vary by jurisdiction.",
          "Framers App reviews and updates cookie handling to align with applicable legal requirements.",
        ],
      },
    ],
  },
};

function readPolicyType(req: VercelRequest): PolicyType | null {
  const raw = req.query.type;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (value === "privacy" || value === "terms" || value === "cookie") return value;
  return null;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const policyType = readPolicyType(req);

  if (!policyType) {
    return res.status(200).json({
      legalRegion: "Global",
      lastUpdated: LAST_UPDATED,
      availablePolicies: Object.keys(POLICIES),
    });
  }

  const policy = POLICIES[policyType];
  return res.status(200).json({
    legalRegion: "Global",
    policy,
  });
}