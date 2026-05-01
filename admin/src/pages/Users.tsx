import { useEffect, useState } from "react";
import { getPlatformMembers, type PlatformMember } from "@/lib/api";
import { RefreshCw } from "lucide-react";

const ROLE_BADGE: Record<string, string> = {
  owner: "badge-purple",
  manager: "badge-blue",
  sales: "badge-slate",
  workshop: "badge-slate",
  staff: "badge-slate",
};

const STATUS_BADGE: Record<string, string> = {
  active: "badge-green",
  invited: "badge-amber",
  inactive: "badge-slate",
};

export default function Users() {
  const [members, setMembers] = useState<PlatformMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  function load() {
    setLoading(true);
    setError(null);
    getPlatformMembers()
      .then((d) => setMembers(d.members))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = members.filter((m) => {
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      (m.email ?? "").toLowerCase().includes(q) ||
      (m.full_name ?? "").toLowerCase().includes(q) ||
      (m.company_name ?? "").toLowerCase().includes(q);
    const matchRole = roleFilter === "all" || m.role === roleFilter;
    const matchStatus = statusFilter === "all" || m.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  return (
    <div className="page">
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by name, email or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="filter-select"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="all">All roles</option>
          <option value="owner">Owner</option>
          <option value="manager">Manager</option>
          <option value="sales">Sales</option>
          <option value="workshop">Workshop</option>
          <option value="staff">Staff</option>
        </select>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="inactive">Inactive</option>
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
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="table-empty">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="table-empty">
                  No users found.
                </td>
              </tr>
            ) : (
              filtered.map((m) => (
                <tr key={m.id}>
                  <td className="cell-primary">
                    {m.full_name ?? <em className="text-muted">No name</em>}
                  </td>
                  <td className="text-muted">{m.email}</td>
                  <td className="text-muted">{m.company_name ?? "—"}</td>
                  <td>
                    <span className={`badge ${ROLE_BADGE[m.role] ?? "badge-slate"}`}>
                      {m.role}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[m.status] ?? "badge-slate"}`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="text-muted">
                    {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && (
        <p className="table-footer">
          {filtered.length} of {members.length} users
        </p>
      )}
    </div>
  );
}
