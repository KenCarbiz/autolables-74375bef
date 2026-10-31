import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminChildTab, AdminSection, AdminSectionId } from "@/lib/admin/sections";
import { ADMIN_SECTIONS, adminTabHref, firstVisibleTab, visibleSections } from "@/lib/admin/sections";
import { useAdminVisibility } from "./useAdminVisibility";
import { ScrollRegion } from "./ScrollRegion";

// One Administration page: one h1, the eight-section row, at most one row of child tabs, then content. The breadcrumb and description show only on the
// sections whose approved mock draws them (AdminSection.intro). Child detail screens use
// ChildPageFrame, which carries its own h1 and breadcrumb, so a page never has
// two titles or two navigation systems.

export const AdminSectionNav = ({ sections, activeId, tabFor, ariaLabel = "Administration sections" }: { sections: AdminSection[]; activeId: string | null; tabFor: (s: AdminSection) => AdminChildTab | null; ariaLabel?: string }) => (
  <nav aria-label={ariaLabel} className="border-b border-adm-border">
    <ScrollRegion label={ariaLabel} tone="workspace" revealSelector='[aria-current="page"]'>
    <ul className="flex items-stretch gap-9 min-w-max">
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
                "inline-flex items-center h-[38px] text-[14px] leading-[20px] whitespace-nowrap border-b-2 -mb-px transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary",
                active ? "font-semibold text-adm-primary border-adm-primary" : "font-medium text-adm-muted border-transparent hover:text-adm-ink",
              )}
            >
              {s.label}
            </Link>
          </li>
        );
      })}
    </ul>
    </ScrollRegion>
  </nav>
);

const BOXED_TAB_SECTIONS: string[] = ["people", "publishing", "documents"];

export const AdminChildTabs = ({ tabs, activeId, ariaLabel, boxed = false }: { tabs: AdminChildTab[]; activeId: string; ariaLabel: string; boxed?: boolean }) => {
  const [showMore, setShowMore] = useState(false);
  if (tabs.length <= 1) return null;
  const shown = tabs.filter((t) => showMore || !t.unpictured || t.id === activeId);
  const more = tabs.filter((t) => t.unpictured && t.id !== activeId);
  return (
    <nav aria-label={ariaLabel} className={boxed ? "rounded-t-[6px] border border-adm-border bg-adm-surface px-4" : "border-b border-adm-border"}>
      <ScrollRegion label={ariaLabel} tone="workspace" revealSelector='[aria-current="page"]'>
      <ul className="flex items-stretch gap-9 min-w-max">
        {shown.map((t) => {
          const active = t.id === activeId;
          return (
            <li key={t.id}>
              <Link
                to={adminTabHref(t.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center h-10 text-[14px] leading-[20px] whitespace-nowrap border-b-2 -mb-px transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary",
                  active ? "font-semibold text-adm-primary border-adm-primary" : "font-medium text-adm-muted border-transparent hover:text-adm-ink",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
        {more.length > 0 && !showMore && (
          <li>
            <button type="button" onClick={() => setShowMore(true)} className="inline-flex items-center h-10 text-[14px] leading-[20px] font-medium text-adm-muted hover:text-adm-ink whitespace-nowrap">More</button>
          </li>
        )}
      </ul>
      </ScrollRegion>
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
  <div data-admin-v2="" className={cn("w-full max-w-[1600px] mx-auto px-4 sm:px-6 py-5 sm:py-[22px] text-adm-ink", className)}>
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
}) => {
  const isOverview = activeSection.id === "overview";
  const title = activeSection.heading ?? "Administration";
  return (
    <AdminPageContainer>
      <div className="space-y-4">
        <div>
          {activeSection.intro?.breadcrumb && <Breadcrumbs crumbs={[{ label: "Administration", href: "/admin" }, { label: isOverview ? "Overview" : activeSection.label }]} />}
          <h1 className={cn("text-[28px] leading-[36px] lg:text-[32px] lg:leading-[40px] font-bold text-adm-ink", activeSection.intro?.breadcrumb && "mt-1")}>{title}</h1>
          {activeSection.intro?.description && <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">{activeSection.description}</p>}
        </div>
        <AdminSectionNav sections={sections} activeId={activeSection.id} tabFor={firstTabFor} />
        {activeSection.subheading && <h2 className="text-[24px] leading-[32px] font-bold text-adm-ink !mt-5">{activeSection.subheading}</h2>}
        <AdminChildTabs tabs={tabsForSection} activeId={activeTab.id} ariaLabel={`${activeSection.label} views`} boxed={BOXED_TAB_SECTIONS.includes(activeSection.id)} />
        <div className={BOXED_TAB_SECTIONS.includes(activeSection.id) && tabsForSection.length > 1 ? "!mt-0 [&>*:first-child]:!mt-0 [&>*:first-child]:rounded-t-none [&>*:first-child]:border-t-0" : undefined}>{children}</div>
      </div>
    </AdminPageContainer>
  );
};

const ChildSectionNav = ({ section }: { section: AdminSectionId }) => {
  const { ctx } = useAdminVisibility();
  const visible = visibleSections(ctx);
  return <AdminSectionNav sections={visible.length ? visible : [...ADMIN_SECTIONS]} activeId={section} tabFor={(s) => firstVisibleTab(s, ctx) ?? s.tabs[0]} />;
};

// Child detail screens: optionally the section row (sectionRow), then breadcrumb, the
// child's h1 and back link, then the child's own tabs and content.
export const ChildPageFrame = ({
  crumbs,
  title,
  badge,
  subtitle,
  backHref,
  backLabel,
  section,
  sectionRow,
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
  /** The parent section the breadcrumb leads back to. */
  section?: AdminSectionId;
  /** Where the approved mock draws the section row: under an "Administration" title above the breadcrumb, or between the child header and its tabs. */
  sectionRow?: "above" | "below";
  /** A child's own tab row, when it has one. */
  tabs?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <AdminPageContainer>
    <div className="space-y-4">
      {section && sectionRow === "above" && (
        <>
          <div className="text-[28px] leading-[36px] lg:text-[32px] lg:leading-[40px] font-bold text-adm-ink">Administration</div>
          <ChildSectionNav section={section} />
        </>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Breadcrumbs crumbs={crumbs} />
          <div className="mt-1 lg:mt-3 flex items-center gap-3 flex-wrap">
            <h1 className="text-[28px] leading-[36px] lg:text-[32px] lg:leading-[40px] font-bold text-adm-ink">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
          {backHref && (
            <Link to={backHref} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-adm-primary hover:underline whitespace-nowrap">
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              {backLabel ?? "Back"}
            </Link>
          )}
        </div>
      </div>
      {section && sectionRow === "below" && <ChildSectionNav section={section} />}
      {tabs}
      <div className="pt-1">{children}</div>
    </div>
  </AdminPageContainer>
);
