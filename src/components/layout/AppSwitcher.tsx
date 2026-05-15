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
  icon: typeof Sparkles;
  url: string;
  description: string;
  color: string;
}

const ALL_PRODUCTS: PlatformProduct[] = [
  { id: "autolabels", name: "AutoLabels.io", shortName: "AutoLabels", icon: FileText, url: "/dashboard", description: "Dealer labels, stickers & compliance", color: "bg-primary" },
  { id: "autoframe", name: "AutoFrame", shortName: "AutoFrame", icon: Camera, url: "https://autoframe.autolabels.io", description: "Vehicle photography & media", color: "bg-purple-600" },
  { id: "autovideo", name: "AutoVideo", shortName: "AutoVideo", icon: Video, url: "https://autovideo.autolabels.io", description: "Video walkarounds & MPI", color: "bg-amber-600" },
];

const SUBSCRIPTION_KEY = "platform_subscriptions";

// Get which products a tenant has access to
export function getSubscribedProducts(): string[] {
  try {
    const subs = localStorage.getItem(SUBSCRIPTION_KEY);
    if (subs) return JSON.parse(subs);
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
  const CurrentIcon = current.icon;

  const triggerClass =
    theme === "light"
      ? "inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-border bg-card hover:bg-muted text-foreground text-sm font-medium transition-colors"
      : "inline-flex items-center gap-1.5 h-9 pl-1.5 pr-2 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 hover:border-white/25 text-white text-xs font-semibold transition-all";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={triggerClass}>
          <div className={`w-5 h-5 rounded ${current.color} flex items-center justify-center`}>
            <CurrentIcon className="w-3 h-3 text-white" />
          </div>
          <span className="hidden md:inline text-xs">{current.shortName}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs">AutoLabels Platform</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {ALL_PRODUCTS.map(product => {
          const Icon = product.icon;
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
              <div className={`w-8 h-8 rounded-lg ${current.color === product.color ? product.color : product.color} flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{product.name}</span>
                  {isCurrent && <span className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded font-semibold">Current</span>}
                </div>
                <p className="text-[10px] text-muted-foreground">{product.description}</p>
              </div>
              {hasAccess ? (
                product.url.startsWith("http") && !isCurrent ? <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : null
              ) : (
                <Lock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
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
