import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminChildTab, AdminSection } from "@/lib/admin/sections";
import { adminTabHref } from "@/lib/admin/sections";

// One Administration page: one breadcrumb, one h1, one row of sections, an
// optional row of child tabs, then content. Child detail screens use
// ChildPageFrame, which carries its own h1 and breadcrumb, so a page never has
// two titles or two navigation systems.

export const AdminSectionNav = ({ sections, activeId, tabFor, ariaLabel = "Administration sections" }: { sections: AdminSection[]; activeId: string | null; tabFor: (s: AdminSection) => AdminChildTab | null; ariaLabel?: string }) => (
  <nav aria-label={ariaLabel} className="border-b border-adm-border overflow-x-auto">
    <ul className="flex items-stretch gap-6 min-w-max">
      {sections.map((s) => {
        const target = tabFor(s);
        if (!target) return null;
        const active = s.id === activeId;
        return (
          <li key={s.id}>
            <Link
              to={adminTabHref(target.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center h-10 text-[14px] leading-[20px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors focus-visible:outline-2 focus-visible:outline-adm-primary",
                active ? "text-adm-primary border-adm-primary" : "text-adm-muted border-transparent hover:text-adm-ink",
              )}
            >
              {s.label}
            </Link>
          </li>
        );
      })}
    </ul>
  </nav>
);

export const AdminChildTabs = ({ tabs, activeId, ariaLabel }: { tabs: AdminChildTab[]; activeId: string; ariaLabel: string }) => {
  if (tabs.length <= 1) return null;
  return (
    <nav aria-label={ariaLabel} className="border-b border-adm-border overflow-x-auto">
      <ul className="flex items-stretch gap-5 min-w-max">
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <li key={t.id}>
              <Link
                to={adminTabHref(t.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center h-9 text-[13px] leading-[18px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors focus-visible:outline-2 focus-visible:outline-adm-primary",
                  active ? "text-adm-primary border-adm-primary" : "text-adm-muted border-transparent hover:text-adm-ink",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

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
  <div data-admin-v2="" className={cn("w-full max-w-[1600px] mx-auto px-4 sm:px-6 py-5 sm:py-6 text-adm-ink", className)}>
    {children}
  </div>
);

export const AdminShell = ({
  sections,
  activeSection,
  activeTab,
  tabsForSection,
  firstTabFor,
  children,
}: {
  sections: AdminSection[];
  activeSection: AdminSection;
  activeTab: AdminChildTab;
  tabsForSection: AdminChildTab[];
  firstTabFor: (s: AdminSection) => AdminChildTab | null;
  children: ReactNode;
}) => (
  <AdminPageContainer>
    <div className="space-y-4">
      <div>
        <Breadcrumbs crumbs={[{ label: "Administration", href: "/admin" }, { label: activeSection.label }]} />
        <h1 className="mt-1 text-[28px] leading-[36px] font-bold text-adm-ink">Administration</h1>
        <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">{activeSection.description}</p>
      </div>
      <AdminSectionNav sections={sections} activeId={activeSection.id} tabFor={firstTabFor} />
      <AdminChildTabs tabs={tabsForSection} activeId={activeTab.id} ariaLabel={`${activeSection.label} views`} />
      <div className="pt-1">{children}</div>
    </div>
  </AdminPageContainer>
);

export const ChildPageFrame = ({
  crumbs,
  title,
  badge,
  subtitle,
  backHref,
  backLabel,
  sectionNav,
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
  /** Some references keep the section row visible under a child title. */
  sectionNav?: ReactNode;
  /** A child's own tab row, when it has one. */
  tabs?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <AdminPageContainer>
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Breadcrumbs crumbs={crumbs} />
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <h1 className="text-[28px] leading-[36px] font-bold text-adm-ink">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
          {backHref && (
            <Link to={backHref} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-adm-primary hover:underline whitespace-nowrap">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              {backLabel ?? "Back"}
            </Link>
          )}
        </div>
      </div>
      {sectionNav}
      {tabs}
      <div className="pt-1">{children}</div>
    </div>
  </AdminPageContainer>
);
