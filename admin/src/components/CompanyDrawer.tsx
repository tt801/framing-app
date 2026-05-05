import { useEffect, useState } from "react";
import {
  getPlatformMembers,
  listPlatformTickets,
  type PlatformCompany,
  type PlatformMember,
  type PlatformTicket,
} from "@/lib/api";
import { Building2, X } from "lucide-react";

const PRICE_LABELS: Record<string, string> = {
  price_1TH4B24PYXZ7QbRFY7GS9ASi: "Starter",
  price_1TH4FR4PYXZ7QbRFFDEn6KND: "Growth",
  price_1TH4Fw4PYXZ7QbRFrPXkfoCT: "Pro",
  price_1TH4GP4PYXZ7QbRFT7X5wKbU: "Founder",
  founder_lifetime: "Founder (Lifetime)",
};

const PLAN_BADGE: Record<string, string> = {
  active: "badge-green",
  trialing: "badge-amber",
  past_due: "badge-red",
  expired: "badge-slate",
};

const STATUS_BADGE: Record<string, string> = {
  open: "badge-red",
  in_progress: "badge-blue",
  waiting_customer: "badge-amber",
  resolved: "badge-green",
  closed: "badge-slate",
};

const ROLE_BADGE: Record<string, string> = {
  owner: "badge-purple",
  manager: "badge-blue",
  sales: "badge-slate",
  workshop: "badge-slate",
  staff: "badge-slate",
};

function fmt(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString();
}

function planLabel(priceId: string | null) {
  if (!priceId) return "—";
  return PRICE_LABELS[priceId] ?? "Custom";
}

interface Props {
  company: PlatformCompany;
  onClose: () => void;
}

export default function CompanyDrawer({ company, onClose }: Props) {
  const [members, setMembers] = useState<PlatformMember[]>([]);
  const [tickets, setTickets] = useState<PlatformTicket[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingTickets, setLoadingTickets] = useState(true);

  useEffect(() => {
    setLoadingMembers(true);
    getPlatformMembers(company.id)
      .then((d) => setMembers(d.members))
      .catch(() => setMembers([]))
      .finally(() => setLoadingMembers(false));

    setLoadingTickets(true);
    listPlatformTickets("all", company.id)
      .then((d) => setTickets(d.tickets.slice(0, 20)))
      .catch(() => setTickets([]))
      .finally(() => setLoadingTickets(false));
  }, [company.id]);

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={company.company_name ?? "Company details"}>
        {/* Header */}
        <div className="drawer-header">
          <h2 className="drawer-title">
            <Building2 size={16} />
            {company.company_name ?? <em style={{ color: "#94a3b8" }}>Unnamed</em>}
          </h2>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body">
          {/* Overview */}
          <section>
            <p className="drawer-section-label">Overview</p>
            <div className="drawer-info-grid">
              <div className="drawer-info-item">
                <span className="drawer-info-label">Plan</span>
                <span className="drawer-info-value">{planLabel(company.stripe_price_id)}</span>
              </div>
              <div className="drawer-info-item">
                <span className="drawer-info-label">Status</span>
                <span>
                  <span className={`badge ${PLAN_BADGE[company.plan_status] ?? "badge-slate"}`}>
                    {company.plan_status}
                  </span>
                </span>
              </div>
              <div className="drawer-info-item">
                <span className="drawer-info-label">Renewal date</span>
                <span className="drawer-info-value muted">{fmt(company.subscription_renewed_at)}</span>
              </div>
              <div className="drawer-info-item">
                <span className="drawer-info-label">Trial ends</span>
                <span className="drawer-info-value muted">{fmt(company.trial_ends_at)}</span>
              </div>
              <div className="drawer-info-item">
                <span className="drawer-info-label">Created</span>
                <span className="drawer-info-value muted">{fmt(company.created_at)}</span>
              </div>
              <div className="drawer-info-item">
                <span className="drawer-info-label">Open tickets</span>
                <span className="drawer-info-value">
                  {company.open_tickets > 0 ? (
                    <span className="badge badge-red">{company.open_tickets}</span>
                  ) : (
                    <span className="drawer-info-value muted">0</span>
                  )}
                </span>
              </div>
            </div>
          </section>

          {/* Members */}
          <section>
            <p className="drawer-section-label">Members ({loadingMembers ? "…" : members.length})</p>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {loadingMembers ? (
                <p className="drawer-empty">Loading…</p>
              ) : members.length === 0 ? (
                <p className="drawer-empty">No members found.</p>
              ) : (
                <table className="drawer-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id}>
                        <td style={{ fontWeight: 600 }}>
                          {m.full_name ?? <em style={{ color: "#94a3b8" }}>—</em>}
                        </td>
                        <td style={{ color: "#64748b" }}>{m.email}</td>
                        <td>
                          <span className={`badge ${ROLE_BADGE[m.role] ?? "badge-slate"}`}>
                            {m.role}
                          </span>
                        </td>
                        <td style={{ color: "#64748b" }}>
                          {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : (
                            <span className="badge badge-amber">Invited</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Recent Tickets */}
          <section>
            <p className="drawer-section-label">
              Recent tickets ({loadingTickets ? "…" : tickets.length})
            </p>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {loadingTickets ? (
                <p className="drawer-empty">Loading…</p>
              ) : tickets.length === 0 ? (
                <p className="drawer-empty">No tickets found.</p>
              ) : (
                <table className="drawer-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Subject</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      <tr key={t.id}>
                        <td style={{ color: "#94a3b8", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {t.ticket_number}
                        </td>
                        <td
                          style={{
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontWeight: 600,
                          }}
                          title={t.subject}
                        >
                          {t.subject}
                        </td>
                        <td>
                          <span className={`badge ${STATUS_BADGE[t.status] ?? "badge-slate"}`}>
                            {t.status.replace("_", " ")}
                          </span>
                        </td>
                        <td style={{ color: "#64748b", whiteSpace: "nowrap" }}>
                          {new Date(t.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
