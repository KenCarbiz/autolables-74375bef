import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatBadgeCount, isNavItemActive, type AdminNavSection } from "@/components/layout/adminNav";

// The rail lists sections only. These links are how a section's other screens
// stay reachable: it is built from the same permission-filtered nav model the
// rail draws, so a screen appears here exactly when the rail's row would have
// offered it. It renders only on the section's landing page (its first screen);
// they render below the page content so no second tab layer sits above the title.

export function sectionForRoute(sections: AdminNavSection[], pathname: string, search: string): AdminNavSection | undefined {
  const path = pathname.replace(/\/+$/, "") || "/";
  return sections.find((s) => s.title && s.items.length > 1 && s.items[0].path.split("?")[0] === path);
}

export function SectionTabs({ sections, pathname, search = "", className }: { sections: AdminNavSection[]; pathname: string; search?: string; className?: string }) {
  const section = sectionForRoute(sections, pathname, search);
  if (!section) return null;
  const activeItem = section.items.find((i) => isNavItemActive(i, pathname, search));
  const others = section.items.filter((i) => i !== activeItem);
  if (others.length === 0) return null;
  return (
    <nav aria-label={`${section.title} pages`} className={cn("flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] leading-[18px]", className)}>
      <span className="text-adm-muted">{section.title}</span>
      {others.map((item) => {
        const count = formatBadgeCount(item.badge);
        return (
          <Link key={item.path} to={item.path} className="font-medium text-adm-primary hover:underline">
            {item.label}{count ? ` (${count})` : ""}
          </Link>
        );
      })}
    </nav>
  );
}

export default SectionTabs;
