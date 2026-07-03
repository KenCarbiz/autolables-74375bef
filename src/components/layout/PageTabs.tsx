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
      <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/60 p-1">
        {tabs.map((t) => {
          const base = t.to.split("?")[0];
          const active = t.to.includes("?") ? current.startsWith(t.to) : pathname === base;
          return (
            <button
              key={t.to}
              onClick={() => navigate(t.to)}
              className={`h-8 px-3.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-all inline-flex items-center gap-1.5 ${
                active ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {t.badge != null && (
                <span className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${active ? "bg-primary/10 text-primary" : "bg-muted-foreground/15"}`}>
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
  { label: "Returns", to: "/returns" },
];

