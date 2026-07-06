import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { Sparkles, FileText, Camera, Video, ChevronDown, Lock, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface PlatformProduct {
  id: string;
  name: string;
  shortName: string;
  /** Parenthetical of the family wordmark, e.g. "LABELS" -> auto(LABELS). */
  mark: string;
  icon: typeof Sparkles;
  url: string;
  description: string;
  color: string;
  /** Optional brand SVG (in /public) shown instead of the type wordmark. */
  logo?: string;
}

// Family type logo: "auto" + "(MARK)" in the Autocurb family style, matching
// the site auto(LABELS) wordmark. Inverted for the dark topbar.
const FamilyWordmark = ({ mark, size = 13, inverted = false }: { mark: string; size?: number; inverted?: boolean }) => (
  <span
    aria-label={`auto(${mark})`}
    style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif", fontWeight: 800, fontSize: size, letterSpacing: "-0.02em", lineHeight: 1, whiteSpace: "nowrap" }}
  >
    <span style={{ color: inverted ? "#3BB4FF" : "#2563EB" }}>auto</span>
    <span style={{ color: inverted ? "#FFFFFF" : "#0B2041" }}>({mark})</span>
  </span>
);

// Family-aligned product palette. Each sibling app gets a hue
// inside the Autocurb family blue range so the AppSwitcher reads
// as "four siblings", not "four random apps" — Wave 15.1 fixed
// the previous purple/amber placeholders that fought the navy
// chrome. AutoLabels keeps the brand primary navy; AutoFrame
// shifts to sky for the photography read; AutoVideo to indigo
// for the motion read; AutoCurb (the mothership) keeps the
// signal-blue accent.
const ALL_PRODUCTS: PlatformProduct[] = [
  { id: "autolabels", name: "AutoLabels.io", shortName: "AutoLabels", mark: "LABELS", icon: FileText, url: "/dashboard",                          description: "Dealer labels, stickers & compliance",  color: "bg-primary" },
  { id: "autocurb",   name: "Autocurb",      shortName: "Autocurb",   mark: "CURB",   icon: Sparkles, url: "https://autocurb.io",                  description: "Inventory + lead routing (the mothership)", color: "bg-[#1E90FF]", logo: "/autocurb-logo.svg" },
  { id: "autoframe",  name: "AutoFrame",     shortName: "AutoFrame",  mark: "FRAME",  icon: Camera,   url: "https://autoframe.autolabels.io",     description: "Vehicle photography & background removal", color: "bg-sky-500" },
  { id: "autovideo",  name: "AutoFilm",      shortName: "AutoFilm",   mark: "FILM",   icon: Video,    url: "https://autovideo.autolabels.io",     description: "Film walkarounds & MPI",                color: "bg-indigo-600" },
];

const SUBSCRIPTION_KEY = "platform_subscriptions";

// Get which products a tenant has access to
export function getSubscribedProducts(): string[] {
  try {
    const subs = localStorage.getItem(SUBSCRIPTION_KEY);
    if (subs) {
      const parsed = JSON.parse(subs);
      // Guard against a legacy/corrupt non-array value — `.includes` on a
      // non-array would throw and take down the app-switcher on every page.
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch { /* */ }
  // Default: AutoLabels always available (they're on it)
  return ["autolabels"];
}

export function setSubscribedProducts(productIds: string[]) {
  localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(productIds));
}

interface AppSwitcherProps {
  currentApp?: string;
  /**
   * Surface theme for the trigger button.
   * "dark"  — used inside the navy topbar (white-on-translucent).
   * "light" — used on the public landing nav (border + neutral chip).
   */
  theme?: "dark" | "light";
}

const AppSwitcher = ({ currentApp = "autolabels", theme = "dark" }: AppSwitcherProps) => {
  const subscribedIds = getSubscribedProducts();

  const current = ALL_PRODUCTS.find(p => p.id === currentApp) || ALL_PRODUCTS[1];

  const triggerClass =
    theme === "light"
      ? "inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl border border-border bg-card hover:bg-muted text-foreground text-sm font-medium transition-colors"
      : "inline-flex items-center gap-1.5 h-9 pl-1.5 pr-2 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 hover:border-white/25 text-white text-xs font-semibold transition-all";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={triggerClass} title="Switch app · Autocurb Family">
          <FamilyWordmark mark={current.mark} size={14} inverted={theme === "dark"} />
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs">
          Autocurb Family
          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
            · {ALL_PRODUCTS.length} apps for dealers
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {ALL_PRODUCTS.map(product => {
          const hasAccess = subscribedIds.includes(product.id);
          const isCurrent = product.id === currentApp;

          return (
            <DropdownMenuItem
              key={product.id}
              onClick={() => {
                if (!hasAccess) return;
                if (product.url.startsWith("http")) {
                  window.open(product.url, "_blank");
                } else {
                  window.location.href = product.url;
                }
              }}
              className={`flex items-center gap-3 py-2.5 ${!hasAccess ? "opacity-50 cursor-not-allowed" : ""} ${isCurrent ? "bg-accent" : ""}`}
              disabled={!hasAccess}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {product.logo ? (
                    <img src={product.logo} alt={product.name} className="h-[18px] w-auto" style={{ maxWidth: 110 }} />
                  ) : (
                    <FamilyWordmark mark={product.mark} size={14} />
                  )}
                  {isCurrent && <span className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded font-semibold">Current</span>}
                </div>
                <p className="text-[10px] text-muted-foreground">{product.description}</p>
              </div>
              {hasAccess ? (
                product.url.startsWith("http") && !isCurrent ? <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : null
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0"
                  title="Upgrade your Autocurb plan to unlock this app"
                >
                  <Lock className="w-2.5 h-2.5" />
                  Add
                </span>
              )}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <div className="px-2 py-2">
          <p className="text-[10px] text-muted-foreground">
            {subscribedIds.length} of {ALL_PRODUCTS.length} products active
          </p>
          <button
            onClick={() => window.open("https://autolabels.io/pricing", "_blank")}
            className="mt-1.5 w-full h-8 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
          >
            Upgrade Plan
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AppSwitcher;
export { ALL_PRODUCTS };
