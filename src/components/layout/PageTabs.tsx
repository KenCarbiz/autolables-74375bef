import { LocalTabs } from "@/components/product";

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

export default function PageTabs({ tabs, className = "", label = "Views" }: { tabs: PageTab[]; className?: string; label?: string }) {
  return (
    <LocalTabs
      label={label}
      className={`no-print ${className}`}
      tabs={tabs.map((t) => ({ label: t.label, to: t.to, count: t.badge ?? undefined }))}
    />
  );
}

export const DEALS_TABS: PageTab[] = [
  { label: "Drafts", to: "/saved" },
  { label: "Out for Signature", to: "/signatures" },
  { label: "Signed", to: "/signed" },
  { label: "Delivered", to: "/delivered" },
  { label: "Returns", to: "/returns" },
];

