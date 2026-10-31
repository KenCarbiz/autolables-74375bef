import { createContext, useContext } from "react";
import { Link } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatBadgeCount, isNavItemActive, type AdminNavSection } from "@/components/layout/adminNav";

// The rail lists sections only. These links are how a section's other screens
// stay reachable: they come from the same permission-filtered nav model the
// rail draws, so a screen appears exactly when the rail's row would have
// offered it. They are offered only on the section's landing page (its first
// screen), inside the page header's overflow menu, so no tab layer sits above
// the title and no link row sits below the content.

export interface SectionLink {
  path: string;
  label: string;
  count: string | null;
}

export function sectionForRoute(sections: AdminNavSection[], pathname: string, search: string): AdminNavSection | undefined {
  const path = pathname.replace(/\/+$/, "") || "/";
  return sections.find((s) => s.title && s.items.length > 1 && s.items[0].path.split("?")[0] === path);
}

export function sectionLinksForRoute(sections: AdminNavSection[], pathname: string, search = ""): SectionLink[] {
  const section = sectionForRoute(sections, pathname, search);
  if (!section) return [];
  const activeItem = section.items.find((i) => isNavItemActive(i, pathname, search));
  return section.items
    .filter((i) => i !== activeItem)
    .map((i) => ({ path: i.path, label: i.label, count: formatBadgeCount(i.badge) || null }));
}

export const SectionLinksContext = createContext<SectionLink[]>([]);

export const useSectionLinks = () => useContext(SectionLinksContext);

export function SectionLinksMenu() {
  const links = useSectionLinks();
  if (links.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Related pages"
        className="inline-flex h-10 w-10 items-center justify-center rounded-[6px] border border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {links.map((link) => (
          <DropdownMenuItem key={link.path} asChild className="min-h-[36px] text-[14px]">
            <Link to={link.path}>{link.label}{link.count ? ` (${link.count})` : ""}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
