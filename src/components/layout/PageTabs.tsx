import { useNavigate, useLocation } from "react-router-dom";

// Shared in-page tab strip used to consolidate lifecycle views into one nav
// entry (Deals: Drafts/Out for Signature/Signed/Delivered; Vehicles:
// All/Lot Queue/Get-Ready). Each tab is a real route, so deep links keep
// working — these just present them as one tabbed surface. Horizontally
// scrollable so it never clips on a phone.

export interface PageTab {
  label: string;
  to: string;
  badge?: string | number;
}

export default function PageTabs({ tabs, className = "" }: { tabs: PageTab[]; className?: string }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const current = pathname + search;
  return (
    <div className={`overflow-x-auto no-print ${className}`}>
      <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1">
        {tabs.map((t) => {
          const base = t.to.split("?")[0];
          const active = t.to.includes("?") ? current.startsWith(t.to) : pathname === base;
          return (
            <button
              key={t.to}
              onClick={() => navigate(t.to)}
              className={`h-8 px-3.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-colors inline-flex items-center gap-1.5 ${
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {t.label}
              {t.badge != null && (
                <span className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${active ? "bg-white/20" : "bg-muted-foreground/15"}`}>
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const DEALS_TABS: PageTab[] = [
  { label: "Drafts", to: "/saved" },
  { label: "Out for Signature", to: "/signatures" },
  { label: "Signed", to: "/signed" },
  { label: "Delivered", to: "/delivered" },
];

export const VEHICLES_TABS: PageTab[] = [
  { label: "All vehicles", to: "/inventory" },
  { label: "Lot Queue", to: "/queue" },
  { label: "Get-Ready", to: "/admin?tab=getready" },
];
