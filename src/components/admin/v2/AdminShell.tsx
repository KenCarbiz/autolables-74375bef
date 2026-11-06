import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { AdminChildTab, AdminSection, AdminSectionId } from "@/lib/admin/sections";
import { useAdminVisibility } from "./useAdminVisibility";
import { BrowseSettingsMenu, StoreScope, V3Header, V3Page } from "@/components/admin/v3/AdminV3";
import { crumbsFor, locatePath, locateTab } from "@/lib/admin/categories";

// Administration V3 page frames. The eight-section row and the child tab
// strips of V2 are retired: /admin is a searchable settings directory, each
// category is a page of grouped rows (components/admin/v3), and every setting
// page carries one breadcrumb, one h1 and a compact Browse settings menu.

export interface Crumb {
  label: string;
  href?: string;
}

export const Breadcrumbs = ({ crumbs }: { crumbs: Crumb[] }) => (
  <nav aria-label="Breadcrumb" className="text-[12px] leading-[18px] text-adm-muted">
    <ol className="flex items-center gap-1.5 flex-wrap">
      {crumbs.map((c, i) => (
        <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true">/</span>}
          {c.href && i < crumbs.length - 1 ? (
            <Link to={c.href} className="text-adm-primary hover:underline">{c.label}</Link>
          ) : (
            <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);

export const AdminPageContainer = ({ children, className }: { children: ReactNode; className?: string }) => (
  <V3Page className={className}>{children}</V3Page>
);

/**
 * A settings page inside Administration V3: breadcrumb (Administration /
 * Category / Setting), the setting's h1, and the compact Browse settings menu.
 * The old section row and child tab strips are gone; the category page lists
 * every sibling setting instead. The props keep the V2 signature so the page
 * resolver did not have to change.
 */
export const AdminShell = ({
  activeSection,
  activeTab,
  children,
}: {
  sections?: AdminSection[];
  activeSection: AdminSection;
  activeTab: AdminChildTab;
  tabsForSection?: AdminChildTab[];
  firstTabFor?: (s: AdminSection) => AdminChildTab | null;
  children: ReactNode;
}) => {
  const { ctx } = useAdminVisibility();
  const loc = locateTab(activeTab.id);
  const isOverview = activeSection.id === "overview";
  const title = isOverview ? "Setup checklist" : loc?.row.title ?? activeTab.label;
  const crumbs = isOverview ? [{ label: "Administration", href: "/admin" }, { label: "Setup checklist" }] : crumbsFor(loc, activeTab.label);
  return (
    <AdminPageContainer>
      <div className="space-y-6">
        <V3Header
          crumbs={crumbs}
          title={title}
          description={loc?.row.description}
          actions={<BrowseSettingsMenu ctx={ctx} activeCategory={loc?.category.id} />}
          scope={<StoreScope />}
        />
        <div>{children}</div>
      </div>
    </AdminPageContainer>
  );
};

// Child detail screens: breadcrumb, the child's h1 and back link, then the
// child's own tabs and content. When the route is a category row, the
// breadcrumb is derived from the category model so labels never diverge.
export const ChildPageFrame = ({
  crumbs,
  title,
  badge,
  subtitle,
  backHref,
  backLabel,
  tabs,
  actions,
  children,
}: {
  crumbs: Crumb[];
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Kept for call-site compatibility; V3 has no section row. */
  section?: AdminSectionId;
  sectionRow?: "above" | "below";
  tabs?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) => {
  const { ctx } = useAdminVisibility();
  const { pathname } = useLocation();
  const loc = locatePath(pathname);
  const resolvedCrumbs: Crumb[] = loc ? crumbsFor(loc) : crumbs.map((c, i) => (i === 0 && c.label === "Administration" ? { ...c, href: "/admin" } : c));
  return (
    <AdminPageContainer>
      <div className="space-y-5">
        <V3Header
          crumbs={resolvedCrumbs}
          title={title}
          badge={badge}
          description={subtitle}
          actions={
            <>
              {actions}
              {backHref && (
                <Link to={backHref} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-adm-primary hover:underline whitespace-nowrap">
                  <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                  {backLabel ?? "Back"}
                </Link>
              )}
              <BrowseSettingsMenu ctx={ctx} activeCategory={loc?.category.id} />
            </>
          }
        />
        {tabs}
        <div className="pt-1">{children}</div>
      </div>
    </AdminPageContainer>
  );
};
