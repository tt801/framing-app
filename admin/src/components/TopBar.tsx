import type { View } from "@/App";

const TITLES: Record<View, string> = {
  dashboard: "Dashboard",
  companies: "Companies",
  users: "Users",
  tickets: "Support Tickets",
  subscriptions: "Subscriptions",
  cms: "Content Management",
};

export default function TopBar({ view }: { view: View }) {
  return (
    <header className="topbar">
      <h1 className="topbar-title">{TITLES[view]}</h1>
    </header>
  );
}
