import { useEffect, useState } from "react";
import { getPlatformCompanies, type PlatformCompany } from "@/lib/api";
import { RefreshCw, Building2 } from "lucide-react";

const PLAN_BADGE: Record<string, string> = {
  active: "badge-green",
  trialing: "badge-amber",
  past_due: "badge-red",
  expired: "badge-slate",
};

const PRICE_LABELS: Record<string, string> = {
  price_1TH4B24PYXZ7QbRFY7GS9ASi: "Starter",
  price_1TH4FR4PYXZ7QbRFFDEn6KND: "Growth",
  rice_1TH4Fw4PYXZ7QbRFrPXkfoCT: "Pro",
  price_1TH4GP4PYXZ7QbRFT7X5wKbU: "Founder",
  founder_lifetime: "Founder (Lifetime)",
};

function planLabel(priceId: string | null) {
  if (!priceId) return "—";
  return PRICE_LABELS[priceId] ?? priceId.slice(0, 16) + "…";
}

export default function Companies() {
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<string>("all");

  function load() {
    setLoading(true);
    setError(null);
    getPlatformCompanies()
      .then((d) => setCompanies(d.companies))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = companies.filter((c) => {
    const matchSearch =
      !search || (c.company_name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchPlan = planFilter === "all" || c.plan_status === planFilter;
    return matchSearch && matchPlan;
  });

  return (
    <div className="page">
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search companies…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="filter-select"
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
        >
          <option value="all">All plans</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="past_due">Past due</option>
          <option value="expired">Expired</option>
        </select>
        <button className="btn-icon" onClick={load} title="Refresh">
          <RefreshCw size={15} />
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Members</th>
              <th>Open Tickets</th>
              <th>Renewal</th>
              <th>Trial Ends</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="table-empty">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="table-empty">
                  No companies found.
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="cell-with-icon">
                      <Building2 size={13} className="text-muted" />
                      <span className="cell-primary">
                        {c.company_name ?? <em className="text-muted">Unnamed</em>}
                      </span>
                    </div>
                  </td>
                  <td className="text-muted">{planLabel(c.stripe_price_id)}</td>
                  <td>
                    <span className={`badge ${PLAN_BADGE[c.plan_status] ?? "badge-slate"}`}>
                      {c.plan_status}
                    </span>
                  </td>
                  <td>{c.member_count}</td>
                  <td>
                    {c.open_tickets > 0 ? (
                      <span className="badge badge-red">{c.open_tickets}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="text-muted">
                    {c.subscription_renewed_at
                      ? new Date(c.subscription_renewed_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="text-muted">
                    {c.trial_ends_at
                      ? new Date(c.trial_ends_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="text-muted">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && (
        <p className="table-footer">
          {filtered.length} of {companies.length} companies
        </p>
      )}
    </div>
  );
}
