import { useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CreditCard,
  Database,
  LayoutGrid,
  ListChecks,
  Printer,
  Search,
  Smartphone,
  Tag,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOptionalDealerSettings } from "./optionalDealerSettings";
import { adminTabHref, type AdminVisibilityContext } from "@/lib/admin/sections";
import {
  categoryHref,
  rowHref,
  searchSettings,
  visibleCategories,
  visibleGroups,
  type AdminCategory,
  type AdminCrumb,
  type CategoryIcon,
} from "@/lib/admin/categories";

// Administration V3 surfaces: the settings directory, a category page of
// grouped rows, the compact Browse settings menu and the page header with its
// breadcrumb. Everything here is navigation: nothing reads or writes a setting
// value, calls a provider or sends a message.

const CATEGORY_ICONS: Record<CategoryIcon, LucideIcon> = {
  building: Building2,
  users: UsersRound,
  tag: Tag,
  smartphone: Smartphone,
  printer: Printer,
  "list-checks": ListChecks,
  database: Database,
  "credit-card": CreditCard,
};

export const V3Page = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div data-admin-v2="" data-admin-v3="" className="min-h-full bg-adm-workspace">
    <div className={cn("w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-7 text-adm-ink", className)}>{children}</div>
  </div>
);

export const V3Breadcrumbs = ({ crumbs }: { crumbs: AdminCrumb[] }) => (
  <nav aria-label="Breadcrumb" className="text-[14px] leading-[20px] text-adm-muted">
    <ol className="flex items-center gap-2 flex-wrap">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <li key={`${c.label}-${i}`} className="flex items-center gap-2 min-w-0">
            {i > 0 && <span aria-hidden="true" className="text-adm-muted">/</span>}
            {c.href && !last ? (
              <Link to={c.href} className="max-sm:inline-flex max-sm:items-center max-sm:min-h-[44px] text-adm-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary rounded-sm">{c.label}</Link>
            ) : (
              <span aria-current={last ? "page" : undefined} className="truncate">{c.label}</span>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

/** Compact category switcher shown on category and setting pages (not on the directory). */
export const BrowseSettingsMenu = ({ ctx, activeCategory }: { ctx: AdminVisibilityContext; activeCategory?: string | null }) => {
  const navigate = useNavigate();
  const categories = visibleCategories(ctx);
  if (categories.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-adm-border bg-adm-surface text-[14px] font-semibold text-adm-ink hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary whitespace-nowrap"
        >
          <LayoutGrid className="w-[18px] h-[18px]" aria-hidden="true" />
          Browse settings
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[280px]">
        <DropdownMenuItem onSelect={() => navigate("/admin")} className="text-[14px] font-medium">All settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[12px] font-medium text-adm-muted">Categories</DropdownMenuLabel>
        {categories.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.icon];
          const active = cat.id === activeCategory;
          return (
            <DropdownMenuItem
              key={cat.id}
              onSelect={() => navigate(categoryHref(cat.id))}
              aria-current={active ? "page" : undefined}
              className={cn("gap-2.5 text-[14px]", active && "font-semibold text-adm-primary")}
            >
              <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
              {cat.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Page header shared by category pages and setting pages. */
export const V3Header = ({
  crumbs,
  title,
  badge,
  description,
  actions,
  scope,
}: {
  crumbs: AdminCrumb[];
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  scope?: ReactNode;
}) => (
  <header className="space-y-2">
    <V3Breadcrumbs crumbs={crumbs} />
    <div className="flex flex-wrap items-start justify-between gap-4 pt-2">
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[28px] leading-[34px] lg:text-[32px] lg:leading-[40px] font-bold tracking-[-0.01em] text-adm-ink">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1.5 text-[15px] leading-[22px] text-adm-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
    {scope && <div className="pt-1 text-[13px] leading-[18px] text-adm-muted">{scope}</div>}
  </header>
);

const StoreScope = () => {
  const name = useOptionalDealerSettings()?.settings.dealer_name?.trim();
  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Building2 className="w-4 h-4" aria-hidden="true" />
      <span>This store</span>
      <span className="font-medium text-adm-ink">{name}</span>
    </span>
  );
};

export const V3Surface = ({ children, className, labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) => (
  <section aria-labelledby={labelledBy} className={cn("rounded-xl bg-adm-surface shadow-[0_1px_2px_rgba(27,43,59,0.06)] border border-adm-divider", className)}>
    {children}
  </section>
);

const SettingRowLink = ({ href, title, description, external }: { href: string; title: string; description: string; external?: boolean }) => (
  <li className="border-b border-adm-divider last:border-b-0">
    <Link
      to={href}
      className="group flex items-center gap-4 py-4 min-h-[64px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary rounded-sm"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-[22px] font-semibold text-adm-ink group-hover:text-adm-primary">{title}</span>
        <span className="block mt-0.5 text-[14px] leading-[20px] text-adm-muted">{description}</span>
      </span>
      {external && <span className="text-[12px] font-medium text-adm-muted whitespace-nowrap">Opens elsewhere</span>}
      <ChevronRight className="w-[18px] h-[18px] text-adm-muted flex-shrink-0" aria-hidden="true" />
    </Link>
  </li>
);

// ------------------------------------------------------------ directory

export const SettingsSearch = ({ ctx, autoFocus }: { ctx: AdminVisibilityContext; autoFocus?: boolean }) => {
  const [query, setQuery] = useState("");
  const id = useId();
  const hits = useMemo(() => searchSettings(query, ctx), [query, ctx]);
  const navigate = useNavigate();
  const listId = `${id}-results`;
  const trimmed = query.trim();
  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="sr-only">Find a setting</label>
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-adm-muted pointer-events-none" aria-hidden="true" />
      <input
        id={`${id}-input`}
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) navigate(hits[0].href);
          if (e.key === "Escape") setQuery("");
        }}
        placeholder="Find a setting: pricing, routing, printing…"
        aria-controls={trimmed ? listId : undefined}
        autoComplete="off"
        className="w-full h-12 pl-12 pr-4 rounded-lg bg-adm-preview/60 border border-adm-border text-[15px] text-adm-ink placeholder:text-adm-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-adm-primary focus-visible:border-adm-primary"
      />
      {trimmed && (
        <div id={listId} className="mt-3" aria-live="polite">
          {hits.length === 0 ? (
            <p className="py-3 text-[14px] text-adm-muted">No settings match “{trimmed}”. Try another word, such as fee, logo or routing.</p>
          ) : (
            <ul aria-label="Matching settings">
              {hits.map((h) => (
                <SettingRowLink
                  key={h.row.key}
                  href={h.href}
                  title={h.row.title}
                  description={`${h.category.label}${h.matchedAlias ? ` · also called “${h.matchedAlias}”` : ` · ${h.row.description}`}`}
                  external={h.row.external}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

const CategoryTile = ({ category }: { category: AdminCategory }) => {
  const Icon = CATEGORY_ICONS[category.icon];
  return (
    <li className="border-b border-adm-divider">
      <Link
        to={categoryHref(category.id)}
        className="group flex items-center gap-4 py-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary rounded-sm"
      >
        <span className="flex items-center justify-center w-10 h-10 rounded-[10px] bg-adm-selected text-adm-primary flex-shrink-0">
          <Icon className="w-[22px] h-[22px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] leading-[24px] font-semibold text-adm-ink group-hover:text-adm-primary">{category.label}</span>
          <span className="block mt-0.5 text-[14px] leading-[20px] text-adm-muted">{category.description}</span>
        </span>
        <ChevronRight className="w-[18px] h-[18px] text-adm-muted flex-shrink-0" aria-hidden="true" />
      </Link>
    </li>
  );
};

export const AdminDirectory = ({ ctx, canSeeOverview }: { ctx: AdminVisibilityContext; canSeeOverview: boolean }) => {
  const settings = useOptionalDealerSettings()?.settings;
  const categories = visibleCategories(ctx);
  const name = settings?.dealer_name?.trim();
  const logo = settings?.dealer_logo_url?.trim();
  return (
    <V3Page>
      <div className="space-y-6">
        <header>
          <V3Breadcrumbs crumbs={[{ label: "Administration" }]} />
          <h1 className="mt-3 text-[28px] leading-[34px] lg:text-[32px] lg:leading-[40px] font-bold tracking-[-0.01em]">Administration</h1>
          <p className="mt-1.5 text-[15px] leading-[22px] text-adm-muted">Every setting for your dealership, in one place.</p>
        </header>
        <V3Surface labelledBy="adm-directory-heading" className="p-5 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="adm-directory-heading" className="text-[12px] leading-[16px] font-semibold uppercase tracking-[0.08em] text-adm-muted">Your dealership workspace</h2>
              {name && <p className="mt-1.5 text-[14px] leading-[20px] text-adm-muted">Everything you need to configure {name}.</p>}
            </div>
            {logo && <img src={logo} alt={name ? `${name} logo` : "Dealership logo"} className="max-h-12 max-w-[160px] object-contain flex-shrink-0" />}
          </div>
          <div className="mt-6">
            <SettingsSearch ctx={ctx} />
          </div>
          <ul aria-label="Settings categories" className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-x-14">
            {categories.map((cat) => <CategoryTile key={cat.id} category={cat} />)}
          </ul>
        </V3Surface>
        {canSeeOverview && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <p className="inline-flex items-center gap-2 text-[14px] leading-[20px] text-adm-muted">
              <CircleAlert className="w-[18px] h-[18px] text-adm-warning flex-shrink-0" aria-hidden="true" />
              See what still needs attention in your store setup.
            </p>
            <Link to={adminTabHref("overview")} className="text-[14px] font-semibold text-adm-primary hover:underline whitespace-nowrap">Review setup →</Link>
          </div>
        )}
      </div>
    </V3Page>
  );
};

// ------------------------------------------------------------- category

export const AdminCategoryPage = ({ category, ctx }: { category: AdminCategory; ctx: AdminVisibilityContext }) => {
  const groups = visibleGroups(category, ctx);
  return (
    <V3Page>
      <div className="space-y-6">
        <V3Header
          crumbs={[{ label: "Administration", href: "/admin" }, { label: category.label }]}
          title={category.label}
          description={category.description}
          actions={<BrowseSettingsMenu ctx={ctx} activeCategory={category.id} />}
          scope={<StoreScope />}
        />
        <div className="max-w-[880px] space-y-5">
          {groups.map((g, i) => {
            const headingId = `adm-group-${category.id}-${i}`;
            return (
              <V3Surface key={g.title} labelledBy={headingId} className="px-5 sm:px-8 pt-6 pb-2">
                <h2 id={headingId} className="text-[18px] leading-[24px] font-semibold text-adm-ink">{g.title}</h2>
                {g.description && <p className="mt-1 text-[14px] leading-[20px] text-adm-muted">{g.description}</p>}
                <ul className="mt-2">
                  {g.rows.map((r) => <SettingRowLink key={r.key} href={rowHref(r)} title={r.title} description={r.description} external={r.external} />)}
                </ul>
              </V3Surface>
            );
          })}
        </div>
      </div>
    </V3Page>
  );
};

export { StoreScope };
