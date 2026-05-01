import {
  LayoutDashboard,
  Building2,
  Users,
  TicketCheck,
  CreditCard,
  Megaphone,
  LogOut,
} from "lucide-react";
import type { View } from "@/App";

interface Props {
  view: View;
  setView: (v: View) => void;
  onSignOut: () => void;
}

const NAV = [
  {
    section: "Overview",
    items: [{ id: "dashboard" as View, label: "Dashboard", Icon: LayoutDashboard }],
  },
  {
    section: "Customers",
    items: [
      { id: "companies" as View, label: "Companies", Icon: Building2 },
      { id: "users" as View, label: "Users", Icon: Users },
      { id: "subscriptions" as View, label: "Subscriptions", Icon: CreditCard },
    ],
  },
  {
    section: "Support",
    items: [{ id: "tickets" as View, label: "Tickets", Icon: TicketCheck }],
  },
  {
    section: "Content",
    items: [{ id: "cms" as View, label: "CMS", Icon: Megaphone }],
  },
];

export default function Sidebar({ view, setView, onSignOut }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">F</div>
        <div>
          <div className="sidebar-brand-name">Framers</div>
          <div className="sidebar-brand-sub">Platform Admin</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(({ section, items }) => (
          <div key={section} className="sidebar-section">
            <div className="sidebar-section-label">{section}</div>
            {items.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`sidebar-item${view === id ? " active" : ""}`}
                onClick={() => setView(id)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-item" onClick={onSignOut}>
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
