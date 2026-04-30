import React, { useEffect, useMemo, useState } from "react";

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

type PolicyResponse = {
  legalRegion: string;
  policy: PolicyDocument;
};

const policyTabs: { type: PolicyType; label: string }[] = [
  { type: "privacy", label: "Privacy" },
  { type: "terms", label: "Terms" },
  { type: "cookie", label: "Cookie" },
];

const FALLBACK_POLICIES: Record<PolicyType, PolicyDocument> = {
  privacy: {
    type: "privacy",
    title: "Privacy Policy",
    lastUpdated: "2026-04-29",
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
          "Account data, operational records, and technical diagnostics needed to run and secure the service.",
        ],
      },
      {
        heading: "Your Rights",
        body: [
          "Depending on your jurisdiction, you may request access, correction, deletion, export, or restriction by contacting support.",
        ],
      },
    ],
  },
  terms: {
    type: "terms",
    title: "Terms of Service",
    lastUpdated: "2026-04-29",
    summary: "These terms govern use of Framers App by businesses and authorized users worldwide.",
    sections: [
      {
        heading: "Acceptance and Eligibility",
        body: [
          "By using Framers App, you agree to these terms on behalf of yourself and, where relevant, your organization.",
        ],
      },
      {
        heading: "Accounts and Security",
        body: [
          "You are responsible for account credentials, user access controls, and lawful use of the platform.",
        ],
      },
      {
        heading: "Billing",
        body: [
          "Paid plans renew according to the selected billing cycle unless canceled, and taxes/processor fees may apply.",
        ],
      },
    ],
  },
  cookie: {
    type: "cookie",
    title: "Cookie Policy",
    lastUpdated: "2026-04-29",
    summary:
      "This policy explains how cookies and similar technologies are used on Framers App websites and applications.",
    sections: [
      {
        heading: "What Cookies Are",
        body: [
          "Cookies are small text files used to remember preferences, maintain sessions, and improve product performance.",
        ],
      },
      {
        heading: "Types We Use",
        body: [
          "Strictly necessary, performance, and preference cookies may be used to operate and improve the service.",
        ],
      },
      {
        heading: "Managing Cookies",
        body: [
          "You can manage cookies in your browser settings. Disabling some cookies may affect product functionality.",
        ],
      },
    ],
  },
};

function fallbackPolicyResponse(type: PolicyType): PolicyResponse {
  return {
    legalRegion: "Global",
    policy: FALLBACK_POLICIES[type],
  };
}

function readPolicyFromLocation(): PolicyType {
  const hash = window.location.hash.replace(/^#/, "");
  const path = hash || window.location.pathname;
  const match = path.match(/^\/legal\/(privacy|terms|cookie)/);
  const value = match?.[1];
  if (value === "privacy" || value === "terms" || value === "cookie") return value;
  return "privacy";
}

export default function LegalPolicyPage() {
  const [policyType, setPolicyType] = useState<PolicyType>("privacy");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PolicyResponse | null>(null);

  useEffect(() => {
    const onLocationChange = () => setPolicyType(readPolicyFromLocation());
    onLocationChange();
    window.addEventListener("hashchange", onLocationChange);
    window.addEventListener("popstate", onLocationChange);
    return () => {
      window.removeEventListener("hashchange", onLocationChange);
      window.removeEventListener("popstate", onLocationChange);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const response = await fetch(`/api/legal/policies?type=${policyType}`);
        if (!response.ok) {
          throw new Error("Failed to load policy");
        }
        const contentType = response.headers.get("content-type") ?? "";
        let payload: PolicyResponse;

        if (contentType.includes("application/json")) {
          payload = (await response.json()) as PolicyResponse;
        } else {
          const raw = await response.text();
          payload = JSON.parse(raw) as PolicyResponse;
        }

        if (!payload?.policy?.sections?.length) {
          payload = fallbackPolicyResponse(policyType);
        }

        if (!active) return;
        setData(payload);
      } catch (err: unknown) {
        if (!active) return;
        setData(fallbackPolicyResponse(policyType));
        setError(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [policyType]);

  const title = useMemo(() => {
    if (data?.policy?.title) return data.policy.title;
    return "Legal";
  }, [data]);

  return (
    <div className="landing-root min-h-dvh text-slate-100">
      <div className="mx-auto w-full max-w-4xl px-4 pb-20 pt-8 sm:px-6 lg:px-10">
        <a
          href="#/"
          className="inline-flex rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-100 hover:bg-white/10"
        >
          Back to site
        </a>

        <header className="mt-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Legal</p>
          <h1 className="mt-2 font-display text-3xl text-white sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-slate-300/90">
            Global policy coverage for customers and users across regions.
          </p>
        </header>

        <div className="mt-6 flex flex-wrap gap-2">
          {policyTabs.map((tab) => (
            <a
              key={tab.type}
              href={`#/legal/${tab.type}`}
              className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition ${
                policyType === tab.type
                  ? "bg-cyan-300 text-slate-950"
                  : "border border-white/20 bg-white/5 text-slate-100 hover:bg-white/10"
              }`}
            >
              {tab.label}
            </a>
          ))}
        </div>

        <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm sm:p-8">
          {loading ? (
            <p className="text-sm text-slate-300">Loading policy...</p>
          ) : error ? (
            <p className="text-sm text-rose-200">{error}</p>
          ) : data?.policy ? (
            <>
              <p className="text-sm text-slate-300/90">{data.policy.summary}</p>
              <p className="mt-2 text-xs text-slate-400">Last updated: {data.policy.lastUpdated}</p>

              <div className="mt-6 space-y-6">
                {data.policy.sections.map((section) => (
                  <article key={section.heading}>
                    <h2 className="text-lg font-bold text-white">{section.heading}</h2>
                    <div className="mt-2 space-y-2">
                      {section.body.map((line) => (
                        <p key={line} className="text-sm leading-7 text-slate-200/90">
                          {line}
                        </p>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-300">Policy unavailable.</p>
          )}
        </section>
      </div>
    </div>
  );
}