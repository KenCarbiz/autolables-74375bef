import { ReactNode, useState, useCallback, useMemo, useEffect } from "react";
import { useLocation, useNavigate as useBaseNavigate, Link } from "react-router-dom";
import { useViewTransitionNavigate } from "@/lib/navigation";
import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  Package,
  Users,
  BarChart3,
  ShieldCheck,
  Settings,
  Bell,
  ChevronsUpDown,
  LogOut,
  Store,
  Menu,
  X,
  Sparkles,
  ScrollText,
  Wrench,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Rocket,
  Palette,
  ToggleLeft,
  Tag,
  TrendingUp,
  ScanLine,
  Printer,
  BookOpen,
  Car,
  Award,
  Clock,
  CreditCard,
  RefreshCw,
  Search,
  HelpCircle,
  PenLine,
  CheckCircle2,
  Truck,
  Building2,
  ExternalLink,
  Lock,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAudit } from "@/contexts/AuditContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Logo from "@/components/brand/Logo";

import CommandPalette, { useCommandPalette } from "@/components/layout/CommandPalette";
import { ALL_PRODUCTS, getSubscribedProducts } from "@/components/layout/AppSwitcher";
import { VinScanContext, prefersLiveScanner } from "@/contexts/VinScanContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppShellProps {
  children: ReactNode;
}

interface NavItem {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  badge?: string | number;
  featureKey?: string;
  // Visibility predicates (fail-open). requireManager = dealership
  // owner/admin/manager; requireAdmin = platform super-admin.
  requireManager?: boolean;
  requireAdmin?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const AppShell = ({ children }: AppShellProps) => {
  const { user, isAdmin, signOut } = useAuth();
  const { tenant, currentStore, stores, setCurrentStore } = useTenant();
  const { settings } = useDealerSettings();
  const { member } = useEntitlements();
  // Dealership role gate. Unknown/missing role fails open to manager so a
  // slow membership read never hides a manager's nav.
  const role = member?.role;
  const isManager = isAdmin || !role || role === "owner" || role === "admin" || role === "manager";
  const { entries } = useAudit();
  const location = useLocation();
  const navigate = useViewTransitionNavigate();
  // Keep the base hook import exported in case any legacy code below
  // still needs the raw version without view transitions.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _baseNavigate = useBaseNavigate;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showMobileQr, setShowMobileQr] = useState(false);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  // Device-aware VIN scan, shared with every page via VinScanContext:
  // live camera on phone/tablet, QR hand-off on desktop.
  const openScan = useCallback(() => {
    if (prefersLiveScanner()) navigate("/scan");
    else setShowMobileQr(true);
  }, [navigate]);
  const vinScanApi = useMemo(() => ({ openScan }), [openScan]);
  // Wave 14.5.1 — collapsible icon-rail. Persisted per-user so a
  // pinned-collapsed dealer doesn't have to re-collapse every
  // session. Mobile (lg:) keeps the existing slide-in behaviour;
  // collapse only applies to the desktop persistent rail.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar_collapsed") === "1";
    }
    return false;
  });
  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c;
      if (typeof window !== "undefined") {
        localStorage.setItem("sidebar_collapsed", next ? "1" : "0");
      }
      return next;
    });
  };
  // Sections start with sensible defaults, but any section whose
  // items include the current route is force-opened below so links
  // are actually visible while you're on the matching page.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    documents: true,
    inventory: true,
    admin: true,
    compliance: true,
    platform: true,
  });

  const sections: Record<string, NavSection> = {
    main: {
      title: "",
      defaultOpen: true,
      items: [
        { label: "Home", path: "/dashboard", icon: LayoutDashboard },
        { label: "Vehicles", path: "/inventory", icon: Car },
        { label: "Deals", path: "/saved", icon: FolderOpen },
      ],
    },
    create: {
      title: "CREATE",
      defaultOpen: true,
      items: [
        { label: "New Addendum", path: "/addendum", icon: FileText },
        { label: "New Car Sticker", path: "/new-car-sticker", icon: FileText },
        { label: "Used Car Sticker", path: "/used-car-sticker", icon: Car },
        { label: "CPO Info Sheet", path: "/cpo-sheet", icon: Award },
        { label: "Trade-Up Sticker", path: "/trade-up", icon: TrendingUp },
        { label: "Buyers Guide", path: "/buyers-guide", icon: ScrollText, featureKey: "feature_buyers_guide" },
        { label: "Description Writer", path: "/description-writer", icon: Sparkles },
      ],
    },
    compliance: {
      title: "COMPLIANCE",
      defaultOpen: false,
      items: [
        { label: "Compliance Guide", path: "/compliance", icon: BookOpen },
        { label: "Prep & Install", path: "/prep", icon: Wrench },
        { label: "Vehicle Files", path: "/admin?tab=files", icon: FolderOpen },
        { label: "Audit Log", path: "/admin?tab=audit", icon: ShieldCheck },
      ],
    },
    settings: {
      title: "SETTINGS",
      defaultOpen: false,
      items: [
        { label: "Admin Home", path: "/admin?tab=home", icon: LayoutDashboard, requireManager: true },
        { label: "Products", path: "/admin?tab=products", icon: Package, requireManager: true },
        { label: "Product Rules", path: "/admin?tab=rules", icon: Wrench, featureKey: "feature_product_rules", requireManager: true },
        { label: "Branding & Setup", path: "/admin?tab=branding", icon: Palette, requireManager: true },
        { label: "Programs", path: "/admin?tab=programs", icon: Award, requireManager: true },
        { label: "Team", path: "/admin?tab=team", icon: Users, requireManager: true },
        { label: "Reports", path: "/admin?tab=analytics", icon: BarChart3, featureKey: "feature_analytics", requireManager: true },
        { label: "Leads", path: "/admin?tab=leads", icon: Users, featureKey: "feature_lead_capture", requireManager: true },
        { label: "Feature Toggles", path: "/admin?tab=settings", icon: ToggleLeft, requireManager: true },
      ],
    },
    platform: {
      title: "PLATFORM",
      defaultOpen: false,
      items: [
        { label: "Tenants",            path: "/platform-admin?tab=tenants",      icon: Store,       requireAdmin: true },
        { label: "Members",            path: "/platform-admin?tab=members",      icon: Users,       requireAdmin: true },
        { label: "Entitlements",       path: "/platform-admin?tab=entitlements", icon: Award,       requireAdmin: true },
        { label: "Platform Audit",     path: "/platform-admin?tab=audit",        icon: ShieldCheck, requireAdmin: true },
        { label: "Recall Refresh",     path: "/platform-admin?tab=recalls",      icon: RefreshCw,   requireAdmin: true },
        { label: "Billing Handshake",  path: "/platform-admin?tab=billing",      icon: CreditCard,  requireAdmin: true },
      ],
    },
  };

  // Compose feature-flag + role gating. Fail-open: only hide when we
  // positively know the user lacks the role.
  const filterItems = (items: NavItem[]) =>
    items.filter(i =>
      (!i.featureKey || (settings as unknown as Record<string, unknown>)[i.featureKey]) &&
      (!i.requireManager || isManager) &&
      (!i.requireAdmin || isAdmin)
    );

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  // Manage billing opens the Stripe Customer Portal via the
  // billing-portal-session edge function. All four apps in the
  // Autocurb family use the same Stripe Customer, so this works
  // identically wherever the dealer clicks it.
  const handleManageBilling = async () => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "billing-portal-session",
        { body: { return_url: window.location.href } }
      );
      if (error || !data?.url) {
        toast.error("Couldn't open billing portal");
        return;
      }
      window.location.href = data.url as string;
    } catch {
      toast.error("Couldn't open billing portal");
    }
  };


  const toggleSection = (key: string) => {
    setOpenSections({ ...openSections, [key]: !openSections[key] });
  };

  const isActive = (path: string): boolean => {
    const [pathname, query] = path.split("?");
    if (location.pathname !== pathname) return false;
    if (!query) return !location.search;
    return location.search.includes(query);
  };

  // Build breadcrumbs from current path
  const breadcrumbs = (() => {
    const pathname = location.pathname;
    const search = location.search;
    const crumbs: { label: string; path?: string }[] = [{ label: "Dashboard", path: "/dashboard" }];

    if (pathname === "/dashboard") return crumbs;
    if (pathname === "/addendum") { crumbs.push({ label: "Create" }); crumbs.push({ label: "New Addendum" }); return crumbs; }
    if (pathname === "/saved") { crumbs.push({ label: "Deals" }); crumbs.push({ label: "Drafts" }); return crumbs; }
    if (pathname === "/buyers-guide") { crumbs.push({ label: "Create" }); crumbs.push({ label: "Buyers Guide" }); return crumbs; }
    if (pathname === "/used-car-sticker") { crumbs.push({ label: "Create" }); crumbs.push({ label: "Used Car Sticker" }); return crumbs; }
    if (pathname === "/cpo-sheet") { crumbs.push({ label: "Create" }); crumbs.push({ label: "CPO Info Sheet" }); return crumbs; }
    if (pathname === "/trade-up") { crumbs.push({ label: "Create" }); crumbs.push({ label: "Trade-Up Sticker" }); return crumbs; }
    if (pathname === "/new-car-sticker") { crumbs.push({ label: "Create" }); crumbs.push({ label: "New Car Sticker" }); return crumbs; }
    if (pathname === "/description-writer") { crumbs.push({ label: "Create" }); crumbs.push({ label: "Description Writer" }); return crumbs; }
    if (pathname === "/compliance") { crumbs.push({ label: "Compliance" }); crumbs.push({ label: "Compliance Guide" }); return crumbs; }
    if (pathname === "/admin") {
      const tab = new URLSearchParams(search).get("tab") || "home";
      const tabLabels: Record<string, string> = {
        home: "Admin Home",
        products: "Products",
        rules: "Product Rules",
        branding: "Branding",
        settings: "Feature Toggles",
        analytics: "Analytics",
        leads: "Leads",
        funnel: "Signing Funnel",
        audit: "Audit Log",
        queue: "Print Queue",
        getready: "Get-Ready",
        files: "Vehicle Files",
        inventory: "Inventory",
        invoices: "Invoices",
        warranty: "Warranty",
      };
      const sectionMap: Record<string, string> = {
        home: "Administration",
        products: "Administration", rules: "Administration", branding: "Administration", settings: "Administration",
        analytics: "Compliance", leads: "Compliance", funnel: "Compliance", audit: "Compliance",
        queue: "Inventory", getready: "Inventory", files: "Inventory",
        inventory: "Inventory", invoices: "Inventory", warranty: "Inventory",
      };
      crumbs.push({ label: sectionMap[tab] || "Administration" });
      crumbs.push({ label: tabLabels[tab] || "Admin Home" });
      return crumbs;
    }
    if (pathname === "/platform-admin") {
      const tab = new URLSearchParams(search).get("tab") || "tenants";
      const tabLabels: Record<string, string> = {
        tenants:      "Tenants",
        members:      "Members",
        entitlements: "Entitlements",
        audit:        "Platform Audit",
        recalls:      "Recall Refresh",
        billing:      "Billing Handshake",
      };
      crumbs.push({ label: "Platform" });
      crumbs.push({ label: tabLabels[tab] || "Platform" });
      return crumbs;
    }
    return crumbs;
  })();

  const userInitial = user?.email?.[0]?.toUpperCase() || "U";
  const recentNotifications = entries.slice(-8).reverse();
  // Autocurb family apps for the in-menu app switcher (lives inside the
  // user dropdown rather than as a separate top-bar control).
  const subscribedAppIds = getSubscribedProducts();
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();
  const firstName = user?.email?.split("@")[0].split(".")[0] || "there";
  const capitalized = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  // Page title shown directly in the (thicker) top bar, replacing the
  // breadcrumb strip. Falls back to the last breadcrumb label for routes
  // without an explicit title (keeps `breadcrumbs` referenced).
  const pageMeta = (() => {
    const p = location.pathname;
    if (p === "/inventory") return { title: "Inventory Command Center", subtitle: "Manage, optimize, and publish your inventory with confidence." };
    if (p.startsWith("/vehicle-file")) return { title: "Vehicle Command Center", subtitle: "" };
    const last = breadcrumbs[breadcrumbs.length - 1];
    return { title: last?.label || "", subtitle: "" };
  })();

  // Best-effort last MarketCheck sync for the dealer status cards in the top bar.
  const [syncInfo, setSyncInfo] = useState<{ at: string | null; count: number | null }>({ at: null, count: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tenant?.id) return;
      try {
        const { data } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { last_run_at: string | null; last_status: Record<string, unknown> | null } | null }> } } } })
          .from("marketcheck_sync_config").select("last_run_at, last_status").eq("tenant_id", tenant.id).maybeSingle();
        const st = (data?.last_status || {}) as Record<string, unknown>;
        const count = typeof st.seen === "number" ? st.seen : (typeof st.num_found === "number" ? st.num_found : null);
        if (!cancelled) setSyncInfo({ at: data?.last_run_at ?? null, count });
      } catch { /* ignore — cards just show "not synced" */ }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);
  const dealerLoc = [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", ");
  // Multi-store group switcher state. "All Locations" is a group-level
  // view that does not bind a specific rooftop's address into stickers.
  const [viewAllStores, setViewAllStores] = useState(false);
  const pickStore = useCallback((s: typeof stores[number]) => {
    setViewAllStores(false);
    setCurrentStore(s);
  }, [setCurrentStore]);
  const dealerActiveLabel = viewAllStores
    ? "All Locations"
    : (currentStore?.name || tenant?.name || "Dealership");
  const dealerActiveSub = viewAllStores
    ? `${stores.length} locations`
    : (dealerLoc || tenant?.name || "");
  const syncWhen = syncInfo.at ? (() => {
    const d = new Date(syncInfo.at);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay ? `${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} today` : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  })() : "Never";

  return (
   <VinScanContext.Provider value={vinScanApi}>
    <div className="min-h-screen bg-background flex">
      {/* Sidebar — shimmer-sidebar paints the landing-page blue shine.
          vt-sidebar opts into a stable view-transition-name so route
          changes only cross-fade the main content area, not the chrome. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 shimmer-sidebar vt-sidebar border-r border-sidebar-border flex flex-col transform transition-all duration-200 ease-out lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-16 w-64" : "w-64"}`}
      >
        {/* Sidebar header — height matches the top command bar (h-[72px]) so
            the logo bar and the topbar share one baseline. */}
        <div className="flex items-center justify-between h-[72px] px-4 border-b border-sidebar-border flex-shrink-0">
          {tenant?.logo_url && !["/logo-mark.svg", "/autolabels-mark.svg", "/autolabels-logo.svg", "/favicon.svg"].includes(tenant.logo_url) ? (
            <div className="flex items-center gap-2 min-w-0">
              <img src={tenant.logo_url} alt={tenant.name} className="w-8 h-8 rounded-md object-contain bg-muted p-1 flex-shrink-0" />
              <div className={`min-w-0 transition-opacity duration-150 ${collapsed ? "lg:hidden" : ""}`}>
                <p className="text-sm font-semibold text-sidebar-foreground leading-none tracking-tight truncate">
                  {tenant?.name}
                </p>
                <p className="text-[9px] text-sidebar-foreground/55 mt-1 uppercase tracking-[0.18em] font-semibold">
                  Clear · Compliant · Consistent
                </p>
              </div>
            </div>
          ) : (
            <Logo variant={collapsed ? "mark" : "full"} size={30} />
          )}
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Primary actions — every workflow starts with adding or
            scanning a vehicle. Collapsed-rail mode stacks them
            vertically as icon-only buttons. */}
        <div className={`px-3 pt-3 flex-shrink-0 grid gap-2 ${collapsed ? "lg:grid-cols-1 grid-cols-[1fr_auto]" : "grid-cols-[1fr_auto]"}`}>
          <button
            onClick={() => {
              setMobileOpen(false);
              navigate("/inventory?add=1");
            }}
            className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center justify-center gap-2 text-[13px] font-semibold shadow-sm shadow-blue-600/30 ring-1 ring-inset ring-white/15 transition-colors"
            title="Add a vehicle to inventory"
          >
            <Car className="w-4 h-4 stroke-2" />
            <span className={`tracking-tight whitespace-nowrap ${collapsed ? "lg:hidden" : ""}`}>Add Vehicle</span>
          </button>
          <button
            onClick={() => {
              setMobileOpen(false);
              openScan();
            }}
            className="h-10 w-10 justify-self-center rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 dark:text-blue-300 dark:border-blue-900 inline-flex items-center justify-center transition-colors"
            title="Scan a VIN — opens the camera on a phone/tablet, or a QR hand-off on desktop"
            aria-label="Scan VIN"
          >
            <ScanLine className="w-[18px] h-[18px] stroke-2" />
          </button>
        </div>

        {/* Store Selector */}
        {stores.length > 0 && (
          <div className={`py-3 border-b border-sidebar-border flex-shrink-0 ${collapsed ? "lg:px-2 px-3" : "px-3"}`}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`w-full flex items-center gap-2 rounded-lg bg-sidebar-accent/60 hover:bg-sidebar-accent transition-colors text-left group border border-sidebar-border/50 ${collapsed ? "lg:justify-center lg:px-0 lg:py-2 px-2.5 py-2" : "px-2.5 py-2"}`}
                  title={collapsed ? `Store: ${currentStore?.name || "No store"}` : undefined}
                >
                  <div className="w-7 h-7 rounded-md bg-blue-50 text-[#2563EB] flex items-center justify-center flex-shrink-0">
                    <Store className="w-3.5 h-3.5" />
                  </div>
                  <div className={`flex-1 min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
                    <p className="text-[9px] text-sidebar-foreground/70 uppercase tracking-[0.18em] font-bold">Store</p>
                    <p className="text-xs font-semibold text-sidebar-foreground truncate">
                      {currentStore?.name || "No store"}
                    </p>
                  </div>
                  <ChevronsUpDown className={`w-3.5 h-3.5 text-sidebar-foreground/60 flex-shrink-0 ${collapsed ? "lg:hidden" : ""}`} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel className="text-xs">Switch Store</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {stores.map(s => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => setCurrentStore(s)}
                    className={currentStore?.id === s.id ? "bg-accent" : ""}
                  >
                    <Store className="w-3.5 h-3.5 mr-2" />
                    {s.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Nav sections */}
        <nav className={`flex-1 overflow-y-auto py-3 space-y-4 ${collapsed ? "lg:px-2 px-3" : "px-3"}`}>
          {Object.entries(sections).map(([key, section]) => {
            const visibleItems = filterItems(section.items);
            if (visibleItems.length === 0) return null;
            const isOpen = openSections[key] !== false;
            return (
              <div key={key}>
                {/* Section header — hidden when the rail is collapsed on
                    desktop, and omitted entirely for the headerless "main"
                    group (Home/Vehicles/Deals are top-level, no label). */}
                {section.title && (
                  <button
                    onClick={() => toggleSection(key)}
                    className={`w-full flex items-center justify-between px-2 mb-1.5 group ${collapsed ? "lg:hidden" : ""}`}
                  >
                    <span className="text-[10px] font-bold text-sidebar-foreground/70 uppercase tracking-[0.18em]">
                      {section.title}
                    </span>
                    {isOpen ? (
                      <ChevronDown className="w-3 h-3 text-sidebar-foreground/40" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-sidebar-foreground/40" />
                    )}
                  </button>
                )}
                {(isOpen || collapsed || !section.title) && (
                  <div className="space-y-0.5">
                    {visibleItems.map(item => {
                      const Icon = item.icon;
                      const active = isActive(item.path);
                      return (
                        <button
                          key={item.path}
                          onClick={() => {
                            navigate(item.path);
                            setMobileOpen(false);
                          }}
                          title={collapsed ? item.label : undefined}
                          className={`w-full flex items-center rounded-md text-sm transition-all relative ${collapsed ? "lg:justify-center lg:px-2 lg:py-2 gap-2.5 px-2.5 py-2" : "gap-2.5 px-2.5 py-2"} ${
                            active
                              ? "bg-blue-50 text-[#2563EB] font-semibold pl-3 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-[#2563EB] before:rounded-full"
                              : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          }`}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span className={`flex-1 text-left truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                          {item.badge && (
                            <span className={`text-[10px] font-semibold text-sidebar-foreground/60 tabular-nums ${collapsed ? "lg:hidden" : ""}`}>
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sidebar footer — Platform Updates + Command Center +
            collapse/expand pin. The collapse toggle is desktop-
            only (lg:); mobile uses the slide-in close button. */}
        <div className={`border-t border-sidebar-border space-y-1 flex-shrink-0 ${collapsed ? "lg:px-2 p-3" : "p-3"}`}>
          {/* Account — mobile only (desktop keeps the header avatar menu). */}
          <div className="lg:hidden pb-1 mb-1 border-b border-sidebar-border">
            <div className="flex items-center gap-2 px-1 py-1.5">
              <span className="w-8 h-8 rounded-full bg-[#2563EB] text-white flex items-center justify-center text-[12px] font-bold flex-shrink-0">{userInitial}</span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-sidebar-foreground truncate">{user?.email || "Signed in"}</p>
                <p className="text-[10px] text-sidebar-foreground/55 truncate">{currentStore?.name || tenant?.name}</p>
              </div>
            </div>
            <button onClick={() => { setMobileOpen(false); navigate("/admin?tab=settings"); }} className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent">
              <Settings className="w-4 h-4" /> Settings
            </button>
            <button onClick={handleManageBilling} className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent">
              <CreditCard className="w-4 h-4" /> Manage billing
            </button>
            <button onClick={() => window.open("https://autolabels.io/help", "_blank")} className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent">
              <HelpCircle className="w-4 h-4" /> Help
            </button>
            <button onClick={handleSignOut} className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-rose-600 hover:bg-rose-50">
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
          {/* Collapse / expand pin (desktop only) */}
          <button
            onClick={toggleCollapsed}
            className={`hidden lg:flex w-full items-center rounded-md text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors ${collapsed ? "justify-center px-2 py-2" : "gap-2 px-2.5 py-2"}`}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            {!collapsed && <span className="flex-1 text-left">Collapse sidebar</span>}
          </button>

          <div className={`pt-2 text-center ${collapsed ? "lg:hidden" : ""}`}>
            <p className="text-[9px] text-sidebar-foreground/40 uppercase tracking-[0.2em] font-semibold">
              {tenant?.name?.toUpperCase() || "AUTOLABELS.IO"}
            </p>
            <p className="text-[8px] text-sidebar-foreground/30 mt-0.5 uppercase tracking-[0.22em]">
              Clear · Compliant · Consistent
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main content area — left padding tracks the rail width
          on desktop; on mobile (no lg:), the rail overlays as a
          slide-in so no padding is needed. */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-200 ease-out ${collapsed ? "lg:pl-16" : "lg:pl-64"}`}>
        {/* ── Mobile header — dealership-first task center (lg:hidden) ──
            Compact: dealer switcher + inline sync/MarketCheck status + a
            full-width Scan / Add action row. Account lives in the hamburger. */}
        <header className="lg:hidden sticky top-0 z-20 topbar-navy text-foreground border-b border-border">
          <div className="px-3 pt-2 pb-2.5 space-y-2">
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setMobileOpen(true)}
                className="h-9 w-9 flex-shrink-0 rounded-lg border border-border bg-card hover:bg-muted text-foreground inline-flex items-center justify-center"
                aria-label="Menu"
              >
                <Menu className="w-4 h-4" />
              </button>

              {/* Dealer / tenant switcher */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex-1 min-w-0 text-left">
                    <span className="inline-flex items-center gap-1 max-w-full">
                      <span className="text-[15px] font-display font-bold text-foreground truncate leading-tight">{dealerActiveLabel}</span>
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    </span>
                    <span className="block text-[11px] text-muted-foreground truncate leading-tight">{dealerActiveSub}</span>
                    <span className="flex items-center gap-3 mt-0.5">
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Sync {syncWhen}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                        <CheckCircle2 className="w-3 h-3" /> MarketCheck
                      </span>
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{tenant?.name}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {stores.length > 1 && (
                    <DropdownMenuItem onClick={() => setViewAllStores(true)} className={viewAllStores ? "bg-accent" : ""}>
                      <Store className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
                      <span className="flex-1">All Locations</span>
                      {viewAllStores && <CheckCircle2 className="w-3.5 h-3.5 text-[#2563EB]" />}
                    </DropdownMenuItem>
                  )}
                  {stores.map((s) => {
                    const active = !viewAllStores && currentStore?.id === s.id;
                    const loc = [s.city, s.state].filter(Boolean).join(", ");
                    return (
                      <DropdownMenuItem key={s.id} onClick={() => pickStore(s)} className={active ? "bg-accent" : ""}>
                        <Store className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate">{s.name}</p>
                          {loc && <p className="text-[10px] text-muted-foreground truncate">{loc}</p>}
                        </div>
                        {active && <CheckCircle2 className="w-3.5 h-3.5 text-[#2563EB] flex-shrink-0" />}
                      </DropdownMenuItem>
                    );
                  })}
                  {stores.length === 0 && (
                    <DropdownMenuItem disabled><Store className="w-3.5 h-3.5 mr-2" />{tenant?.name}</DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/admin?tab=branding")}>
                    <Settings className="w-3.5 h-3.5 mr-2" /> Manage locations
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Notifications */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="relative h-9 w-9 flex-shrink-0 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center justify-center" aria-label="Notifications">
                    <Bell className="w-4 h-4" />
                    {recentNotifications.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-card" />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Recent Activity</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {recentNotifications.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">No recent activity</div>
                  ) : (
                    recentNotifications.map((e) => {
                      const d = (e.details || {}) as Record<string, unknown>;
                      const cust = String(d.customer_name || "").trim();
                      const stock = String(d.stock || d.vehicle_stock || "").trim();
                      const vin = String(d.vin || e.entity_id || "").trim();
                      const label = cust && stock ? `${cust} · #${stock}` : cust || vin || "—";
                      return (
                        <div key={e.id} className="px-3 py-2 text-xs border-b border-border last:border-0">
                          <p className="font-medium text-foreground capitalize">{e.action.replace(/_/g, " ")}</p>
                          <p className="text-muted-foreground truncate">{label}</p>
                        </div>
                      );
                    })
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Primary actions */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={openScan} className="h-12 rounded-xl bg-[#2563EB] hover:bg-[#1d4ed8] text-white inline-flex items-center justify-center gap-2 text-[14px] font-semibold shadow-sm">
                <ScanLine className="w-4 h-4 stroke-2" /> Scan VIN
              </button>
              <button onClick={() => navigate("/inventory?add=1")} className="h-12 rounded-xl border border-border bg-card hover:bg-muted text-foreground inline-flex items-center justify-center gap-2 text-[14px] font-semibold">
                <Car className="w-4 h-4 stroke-2" /> Add Vehicle
              </button>
            </div>
          </div>
        </header>

        {/* Topbar — premium SaaS surface, max 72px tall. Aligns the
            page title with the sidebar logo's left edge (px-4) and
            keeps a single unified dealer/sync/MarketCheck status card
            on the right. Theme toggle + app switcher intentionally
            removed to reduce visual noise. */}
        <header className="hidden lg:block sticky top-0 z-20 topbar-navy vt-topbar text-foreground border-b border-border">
          <div className="flex items-center h-16 lg:h-[72px] px-3 lg:px-4 gap-3 lg:gap-4">
            {/* Left: hamburger (mobile) + page title aligned to logo edge.
                On mobile the title fills the row (no search bar there), so the
                bar reads balanced instead of an empty gap. */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1 lg:flex-none lg:w-[260px] lg:max-w-[40%]">
              <button
                onClick={() => setMobileOpen(true)}
                className="lg:hidden h-9 w-9 flex-shrink-0 rounded-lg border border-border bg-card hover:bg-muted text-foreground inline-flex items-center justify-center transition-colors"
              >
                <Menu className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <p className="text-[15px] sm:text-[17px] font-display font-semibold text-foreground truncate leading-tight tracking-tight">
                  {pageMeta.title || `${greeting}, ${capitalized}`}
                </p>
                {pageMeta.subtitle && (
                  <p className="text-xs text-muted-foreground truncate hidden lg:block mt-0.5">{pageMeta.subtitle}</p>
                )}
              </div>
            </div>

            {/* Centre: dominant search bar */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden md:flex flex-1 min-w-0 items-center gap-3 h-11 px-4 rounded-xl border border-border bg-card hover:bg-muted/60 hover:border-foreground/20 text-sm shadow-sm transition-all"
              title="Command palette (⌘K)"
            >
              <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="flex-1 text-left text-muted-foreground truncate">
                Search VIN, stock #, make, model, trim, customer…
              </span>
              <kbd className="inline-flex items-center justify-center h-5 min-w-[28px] px-1.5 rounded-md bg-muted border border-border text-[10px] font-mono text-muted-foreground tracking-wider">
                ⌘K
              </kbd>
            </button>

            {/* Right cluster */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              {/* Mobile search — the full search bar is desktop-only, so phones
                  get a compact icon that opens the same command palette. */}
              <button
                onClick={() => setPaletteOpen(true)}
                className="md:hidden h-9 w-9 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center justify-center transition-colors"
                title="Search"
                aria-label="Search"
              >
                <Search className="w-4 h-4" />
              </button>
              {/* Unified operational status block — tenant switcher · sync · MarketCheck.
                  Visually dominant, grouped into one pill so the dealership selector,
                  sync state, and feed connection read as a single command surface. */}
              {tenant?.name && (
                <div className="hidden xl:flex items-stretch h-11 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                  {/* Dealer / tenant switcher */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex items-center gap-2.5 h-full px-3 hover:bg-muted/60 transition-colors"
                        title="Switch dealership / location"
                      >
                        <span className="w-7 h-7 rounded-lg bg-[#2563EB]/10 text-[#2563EB] flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-4 h-4" />
                        </span>
                        <div className="leading-tight text-left min-w-0">
                          <p className="text-[12px] font-semibold text-foreground truncate max-w-[150px]">{dealerActiveLabel}</p>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">{dealerActiveSub}</p>
                        </div>
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {tenant.name}
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {stores.length > 1 && (
                        <DropdownMenuItem
                          onClick={() => setViewAllStores(true)}
                          className={viewAllStores ? "bg-accent" : ""}
                        >
                          <Store className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
                          <span className="flex-1">All Locations</span>
                          {viewAllStores && <CheckCircle2 className="w-3.5 h-3.5 text-[#2563EB]" />}
                        </DropdownMenuItem>
                      )}
                      {stores.map((s) => {
                        const active = !viewAllStores && currentStore?.id === s.id;
                        const loc = [s.city, s.state].filter(Boolean).join(", ");
                        return (
                          <DropdownMenuItem
                            key={s.id}
                            onClick={() => pickStore(s)}
                            className={active ? "bg-accent" : ""}
                          >
                            <Store className="w-3.5 h-3.5 mr-2 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="truncate">{s.name}</p>
                              {loc && <p className="text-[10px] text-muted-foreground truncate">{loc}</p>}
                            </div>
                            {active && <CheckCircle2 className="w-3.5 h-3.5 text-[#2563EB] flex-shrink-0" />}
                          </DropdownMenuItem>
                        );
                      })}
                      {stores.length === 0 && (
                        <DropdownMenuItem disabled>
                          <Store className="w-3.5 h-3.5 mr-2" />
                          {tenant.name}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="w-px bg-border my-2" />

                  {/* Sync status */}
                  <div className="flex flex-col justify-center px-3 leading-tight">
                    <p className="text-[10px] font-medium text-muted-foreground">Last sync</p>
                    <p className="text-[12px] font-semibold text-foreground tabular-nums truncate">
                      {syncWhen}{syncInfo.count != null ? ` · ${syncInfo.count}` : ""}
                    </p>
                  </div>

                  <div className="w-px bg-border my-2" />

                  {/* MarketCheck connection */}
                  <span className="flex items-center gap-1.5 px-3 text-[11px] font-medium text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    MarketCheck
                  </span>
                </div>
              )}

              {/* Primary CTA: Scan VIN */}
              <button
                onClick={openScan}
                className="h-9 px-3.5 rounded-lg bg-[#2563EB] hover:bg-[#1d4ed8] text-white inline-flex items-center gap-1.5 text-[13px] font-semibold shadow-sm transition-colors"
                title="Scan a VIN — camera on phone/tablet, QR hand-off on desktop"
              >
                <ScanLine className="w-4 h-4 stroke-2" />
                <span className="hidden lg:inline">Scan VIN</span>
              </button>

              {/* Notifications */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="relative h-9 w-9 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center justify-center transition-colors"
                    title="Notifications"
                  >
                    <Bell className="w-4 h-4" />
                    {recentNotifications.length > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-card" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Recent Activity</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {recentNotifications.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No recent activity
                    </div>
                  ) : (
                    recentNotifications.map(e => {
                      const d = (e.details || {}) as Record<string, unknown>;
                      const cust = String(d.customer_name || "").trim();
                      const stock = String(d.stock || d.vehicle_stock || "").trim();
                      const vin = String(d.vin || e.entity_id || "").trim();
                      const label = cust && stock ? `${cust} · #${stock}` : cust || vin || "—";
                      return (
                        <div key={e.id} className="px-3 py-2 text-xs border-b border-border last:border-0">
                          <p className="font-medium text-foreground capitalize">{e.action.replace(/_/g, " ")}</p>
                          <p className="text-muted-foreground truncate">{label}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(e.created_at).toLocaleString()}
                          </p>
                        </div>
                      );
                    })
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* User cluster */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-2 h-9 pl-1 pr-1.5 rounded-lg hover:bg-muted transition-colors group">
                    <span className="w-7 h-7 rounded-full bg-[#2563EB] text-white flex items-center justify-center text-[11px] font-bold">
                      {userInitial}
                    </span>
                    <ChevronDown className="hidden md:inline-block w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>
                    <div>
                      <p className="text-sm font-medium">{user?.email || "Signed in"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{currentStore?.name}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />

                  {/* Autocurb Family app switcher */}
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-bold pt-1">
                    Autocurb Family
                  </DropdownMenuLabel>
                  {ALL_PRODUCTS.map((product) => {
                    const hasAccess = subscribedAppIds.includes(product.id);
                    const isCurrent = product.id === "autolabels";
                    const AppIcon = product.icon;
                    return (
                      <DropdownMenuItem
                        key={product.id}
                        disabled={!hasAccess}
                        onClick={() => {
                          if (!hasAccess || isCurrent) return;
                          if (product.url.startsWith("http")) window.open(product.url, "_blank");
                          else navigate(product.url);
                        }}
                        className={`gap-2 ${isCurrent ? "bg-accent" : ""} ${!hasAccess ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <span className={`w-5 h-5 rounded-md ${product.color} text-white flex items-center justify-center flex-shrink-0`}>
                          <AppIcon className="w-3 h-3" />
                        </span>
                        <span className="flex-1 truncate text-sm">{product.shortName}</span>
                        {isCurrent ? (
                          <span className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded font-semibold flex-shrink-0">Current</span>
                        ) : hasAccess ? (
                          product.url.startsWith("http") ? <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : null
                        ) : (
                          <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={handleManageBilling}>
                    <CreditCard className="w-3.5 h-3.5 mr-2" />
                    Manage billing
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/admin?tab=settings")}>
                    <Settings className="w-3.5 h-3.5 mr-2" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.open("https://autolabels.io/help", "_blank")}>
                    <HelpCircle className="w-3.5 h-3.5 mr-2" />
                    Help
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="w-3.5 h-3.5 mr-2" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>


        {/* Page content — only this swaps on route change. Chrome
            above (topbar + breadcrumb) and the sidebar stay
            mounted and visually still. */}
        <main id="app-scroll" className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          {children}
        </main>

        {/* Mobile bottom tab bar — thumb-reachable daily nav. Hidden on
            desktop (lg:) where the sidebar is persistent. The center Scan is
            the device-aware VIN capture. */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl no-print">
          <div className="grid grid-cols-5 h-16">
            {[
              { label: "Home", to: "/dashboard", icon: LayoutDashboard, match: ["/dashboard"] },
              { label: "Vehicles", to: "/inventory", icon: Car, match: ["/inventory", "/queue"] },
              { label: "Scan", to: "__scan__", icon: ScanLine, match: [] as string[] },
              { label: "Deals", to: "/saved", icon: FolderOpen, match: ["/saved", "/signatures", "/signed", "/delivered"] },
              { label: "Create", to: "/addendum", icon: FileText, match: ["/addendum", "/new-car-sticker", "/used-car-sticker", "/cpo-sheet", "/trade-up", "/buyers-guide", "/description-writer"] },
            ].map((t) => {
              const isScan = t.to === "__scan__";
              const active = !isScan && t.match.some((m) => location.pathname === m);
              const Icon = t.icon;
              // Flat, equal-weight tabs — Scan is a peer, not a floating CTA.
              return (
                <button
                  key={t.to}
                  onClick={() => (isScan ? openScan() : navigate(t.to))}
                  className={`flex flex-col items-center justify-center gap-0.5 ${active ? "text-[#2563EB]" : "text-muted-foreground"}`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-semibold">{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Command Palette — global ⌘K / Ctrl+K */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {/* Mobile QR Code Modal */}
      {showMobileQr && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowMobileQr(false)}>
          <div className="bg-card rounded-2xl p-8 max-w-sm w-full text-center space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <ScanLine className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Open Lot Scanner</h2>
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your iPhone or iPad to open the mobile vehicle scanner.
            </p>
            <div className="flex justify-center py-4">
              <QRCodeSVG value={`https://autolabels.io/scan`} size={200} level="M" />
            </div>
            <p className="text-xs text-muted-foreground break-all font-mono">
              autolabels.io/scan
            </p>
            {/* Text link to phone */}
            <div className="flex gap-2">
              <input
                id="sms-phone-input"
                type="tel"
                placeholder="(555) 555-5555"
                className="flex-1 h-10 px-3 rounded-lg border-2 border-border text-sm text-foreground outline-none focus:border-primary"
              />
              <button
                onClick={() => {
                  const phone = (document.getElementById("sms-phone-input") as HTMLInputElement)?.value?.replace(/\D/g, "");
                  if (!phone || phone.length < 10) { alert("Enter a valid phone number"); return; }
                  const smsBody = encodeURIComponent(`Open the lot scanner on your phone: https://autolabels.io/scan`);
                  window.open(`sms:${phone}?body=${smsBody}`, "_blank");
                }}
                className="h-10 px-4 rounded-lg bg-teal text-primary-foreground text-sm font-semibold hover:opacity-90"
              >
                Text Link
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`https://autolabels.io/scan`);
                  alert("Link copied!");
                }}
                className="flex-1 h-10 rounded-lg border-2 border-border text-sm font-semibold text-foreground hover:bg-muted"
              >
                Copy Link
              </button>
              <button
                onClick={() => setShowMobileQr(false)}
                className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
   </VinScanContext.Provider>
  );
};

export default AppShell;
