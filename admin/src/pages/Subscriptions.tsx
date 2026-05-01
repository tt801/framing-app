import { useEffect, useState } from "react";
import { getPlatformCompanies, type PlatformCompany } from "@/lib/api";
import { RefreshCw, TrendingUp, AlertCircle, Clock } from "lucide-react";

const PRICE_NAMES: Record<string, { name: string; monthlyUsd: number }> = {
  price_1TH4B24PYXZ7QbRFY7GS9ASi: { name: "Starter", monthlyUsd: 29 },
  price_1TH4FR4PYXZ7QbRFFDEn6KND: { name: "Growth", monthlyUsd: 79 },
  rice_1TH4Fw4PYXZ7QbRFrPXkfoCT: { name: "Pro", monthlyUsd: 149 },
  price_1TH4GP4PYXZ7QbRFT7X5wKbU: { name: "Founder", monthlyUsd: 0 },
  founder_lifetime: { name: "Founder Lifetime", monthlyUsd: 0 },
};

function getPlanName(priceId: string | null) {
  if (!priceId) return "None";
  return PRICE_NAMES[priceId]?.name ?? "Custom";
}

function getMRR(companies: PlatformCompany[]) {
  return companies
    .filter((c) => c.plan_status === "active")
    .reduce((sum, c) => sum + (PRICE_NAMES[c.stripe_price_id ?? ""]?.monthlyUsd ?? 0), 0);
}

const PLAN_BADGE: Record<string, string> = {
  active: "badge-green",
  trialing: "badge-amber",
  past_due: "badge-red",
  expired: "badge-slate",
};

export default function Subscriptions() {
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    getPlatformCompanies()
      .then((d) => setCompanies(d.companies))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const active = companies.filter((c) => c.plan_status === "active");
  const trialing = companies.filter((c) => c.plan_status === "trialing");
  const pastDue = companies.filter((c) => c.plan_status === "past_due");
  const expired = companies.filter((c) => c.plan_status === "expired");
  const mrr = getMRR(companies);

  const trialEndingSoon = trialing
    .filter((c) => c.trial_ends_at)
    .sort(
      (a, b) => new Date(a.trial_ends_at!).getTime() - new Date(b.trial_ends_at!).getTime()
    )
    .slice(0, 10);

  const planBreakdown = Object.entries(
    active.reduce<Record<string, number>>((acc, c) => {
      const name = getPlanName(c.stripe_price_id);
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="page">
      {error && <div className="error-banner">{error}</div>}

      <div className="stat-grid sm">
        <div className="stat-card accent-green">
          <div className="stat-icon"><TrendingUp size={18} /></div>
          <div className="stat-value">${mrr.toLocaleString()}</div>
          <div className="stat-label">Est. MRR</div>
        </div>
        <div className="stat-card accent-blue">
          <div className="stat-icon"><TrendingUp size={18} /></div>
          <div className="stat-value">{active.length}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="stat-card accent-amber">
          <div className="stat-icon"><Clock size={18} /></div>
          <div className="stat-value">{trialing.length}</div>
          <div className="stat-label">Trialing</div>
        </div>
        <div className="stat-card accent-red">
          <div className="stat-icon"><AlertCircle size={18} /></div>
          <div className="stat-value">{pastDue.length}</div>
          <div className="stat-label">Past Due</div>
        </div>
        <div className="stat-card accent-slate">
          <div className="stat-icon"><AlertCircle size={18} /></div>
          <div className="stat-value">{expired.length}</div>
          <div className="stat-label">Expired</div>
        </div>
      </div>

      <div className="page-cols mt-6">
        {/* Plan mix */}
        <div className="card">
          <div className="card-title-row">
            <h2 className="card-title">Active Plan Mix</h2>
            <button className="btn-icon" onClick={load} title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
          {loading ? (
            <p className="text-muted">Loading…</p>
          ) : planBreakdown.length === 0 ? (
            <p className="text-muted">No active subscriptions.</p>
          ) : (
            <div className="plan-bars">
              {planBreakdown.map(([name, count]) => {
                const pct = active.length ? Math.round((count / active.length) * 100) : 0;
                return (
                  <div key={name} className="plan-bar-row">
                    <span className="plan-bar-label">{name}</span>
                    <div className="plan-bar-track">
                      <div className="plan-bar-fill plan-active" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="plan-count">{count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Trials ending soon */}
        <div className="card">
          <h2 className="card-title">Trials Ending Soon</h2>
          {loading ? (
            <p className="text-muted">Loading…</p>
          ) : trialEndingSoon.length === 0 ? (
            <p className="text-muted">No active trials.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Trial ends</th>
                  <th>Members</th>
                </tr>
              </thead>
              <tbody>
                {trialEndingSoon.map((c) => {
                  const daysLeft = c.trial_ends_at
                    ? Math.ceil(
                        (new Date(c.trial_ends_at).getTime() - Date.now()) / 86400000
                      )
                    : null;
                  return (
                    <tr key={c.id}>
                      <td className="cell-primary">{c.company_name ?? "Unnamed"}</td>
                      <td>
                        <span
                          className={`badge ${
                            daysLeft !== null && daysLeft <= 3 ? "badge-red" : "badge-amber"
                          }`}
                        >
                          {daysLeft !== null ? `${daysLeft}d` : "—"}
                        </span>
                      </td>
                      <td className="text-muted">{c.member_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Past due table */}
      {pastDue.length > 0 && (
        <div className="card mt-4">
          <h2 className="card-title">Past Due Accounts</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Plan</th>
                <th>Renewal</th>
                <th>Members</th>
              </tr>
            </thead>
            <tbody>
              {pastDue.map((c) => (
                <tr key={c.id}>
                  <td className="cell-primary">{c.company_name ?? "Unnamed"}</td>
                  <td className="text-muted">{getPlanName(c.stripe_price_id)}</td>
                  <td className="text-muted">
                    {c.subscription_renewed_at
                      ? new Date(c.subscription_renewed_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td>{c.member_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All subscriptions */}
      <div className="card mt-4">
        <h2 className="card-title">All Subscriptions</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Renewal / Trial end</th>
              <th>Stripe Sub ID</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="table-empty">Loading…</td>
              </tr>
            ) : companies.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-empty">No data.</td>
              </tr>
            ) : (
              companies.map((c) => (
                <tr key={c.id}>
                  <td className="cell-primary">{c.company_name ?? "Unnamed"}</td>
                  <td className="text-muted">{getPlanName(c.stripe_price_id)}</td>
                  <td>
                    <span className={`badge ${PLAN_BADGE[c.plan_status] ?? "badge-slate"}`}>
                      {c.plan_status}
                    </span>
                  </td>
                  <td className="text-muted">
                    {c.subscription_renewed_at
                      ? new Date(c.subscription_renewed_at).toLocaleDateString()
                      : c.trial_ends_at
                      ? `Trial: ${new Date(c.trial_ends_at).toLocaleDateString()}`
                      : "—"}
                  </td>
                  <td className="text-muted mono">
                    {c.stripe_subscription_id
                      ? c.stripe_subscription_id.slice(0, 20) + "…"
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
