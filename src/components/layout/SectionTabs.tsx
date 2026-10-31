import { LocalTabs } from "@/components/product";
import { formatBadgeCount, isNavItemActive, type AdminNavSection } from "@/components/layout/adminNav";

// The rail lists sections only. This strip is how a section's other screens
// stay reachable: it is built from the same permission-filtered nav model the
// rail draws, so a screen appears here exactly when the rail's row would have
// offered it. It renders only on the section's landing page (its first screen);
// every other screen keeps a single header, as the V2 screens show.

export function sectionForRoute(sections: AdminNavSection[], pathname: string, search: string): AdminNavSection | undefined {
  const path = pathname.replace(/\/+$/, "") || "/";
  return sections.find((s) => s.title && s.items.length > 1 && s.items[0].path.split("?")[0] === path);
}

export function SectionTabs({ sections, pathname, search = "", className }: { sections: AdminNavSection[]; pathname: string; search?: string; className?: string }) {
  const section = sectionForRoute(sections, pathname, search);
  if (!section) return null;
  const activeItem = section.items.find((i) => isNavItemActive(i, pathname, search));
  return (
    <LocalTabs
      label={`${section.title} pages`}
      className={className}
      tabs={section.items.map((item) => ({
        label: item.label,
        to: item.path,
        key: item.path,
        active: item === activeItem,
        count: formatBadgeCount(item.badge),
      }))}
    />
  );
}

export default SectionTabs;
