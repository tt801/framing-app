import { useEffect, useState } from "react";
import { getPlatformStats, type PlatformStats } from "@/lib/api";
import { Building2, Users, TicketCheck, TrendingUp, Activity, AlertCircle } from "lucide-react";

const PLAN_BADGE: Record<string, string> = {
  active: "badge-green",
  trialing: "badge-amber",
  past_due: "badge-red",
  expired: "badge-slate",
};

export default function Dashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlatformStats()
      .then(setStats)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-state">Loading stats…</div>;
  if (error) return <div className="page-state error">{error}</div>;
  if (!stats) return null;

  const statCards = [
    { label: "Total Companies", value: stats.totalCompanies, Icon: Building2, accent: "accent-blue" },
    { label: "Active Subscriptions", value: stats.planCounts.active ?? 0, Icon: TrendingUp, accent: "accent-green" },
    { label: "Trialing", value: stats.planCounts.trialing ?? 0, Icon: Activity, accent: "accent-amber" },
    { label: "Past Due / Expired", value: (stats.planCounts.past_due ?? 0) + (stats.planCounts.expired ?? 0), Icon: AlertCircle, accent: "accent-red" },
    { label: "Total Members", value: stats.totalMembers, Icon: Users, accent: "accent-purple" },
    { label: "Open Tickets", value: stats.openTickets, Icon: TicketCheck, accent: "accent-rose" },
  ];

  return (
    <div className="page">
      <div className="stat-grid">
        {statCards.map(({ label, value, Icon, accent }) => (
          <div key={label} className={`stat-card ${accent}`}>
            <div className="stat-icon">
              <Icon size={18} />
            </div>
            <div className="stat-value">{value.toLocaleString()}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      <div className="page-cols mt-6">
        {/* Plan distribution */}
        <div className="card">
          <h2 className="card-title">Plan Distribution</h2>
          {Object.keys(stats.planCounts).length === 0 ? (
            <p className="text-muted">No data yet.</p>
          ) : (
            <div className="plan-bars">
              {Object.entries(stats.planCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([plan, count]) => {
                  const pct = stats.totalCompanies
                    ? Math.round((count / stats.totalCompanies) * 100)
                    : 0;
                  return (
                    <div key={plan} className="plan-bar-row">
                      <span className={`badge ${PLAN_BADGE[plan] ?? "badge-slate"}`}>{plan}</span>
                      <div className="plan-bar-track">
                        <div
                          className={`plan-bar-fill plan-${plan}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="plan-count">
                        {count} ({pct}%)
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Recent sign-ups */}
        <div className="card">
          <h2 className="card-title">Recent Sign-ups</h2>
          {stats.recentCompanies.length === 0 ? (
            <p className="text-muted">No recent sign-ups.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentCompanies.map((c) => (
                  <tr key={c.id}>
                    <td className="cell-primary">{c.company_name ?? <em className="text-muted">Unnamed</em>}</td>
                    <td>
                      <span className={`badge ${PLAN_BADGE[c.plan_status] ?? "badge-slate"}`}>
                        {c.plan_status}
                      </span>
                    </td>
                    <td className="text-muted">{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
