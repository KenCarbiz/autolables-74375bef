import { ReactNode, useState } from "react";
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
  Moon,
  Sun,
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
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAudit } from "@/contexts/AuditContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Logo from "@/components/brand/Logo";
import AppSwitcher from "@/components/layout/AppSwitcher";
import CommandPalette, { useCommandPalette } from "@/components/layout/CommandPalette";
import { LiveBadge } from "@/components/layout/LiveBadge";
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
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("dark_mode") === "true" ||
        document.documentElement.classList.contains("dark");
    }
    return false;
  });
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
    documents: {
      title: "DOCUMENTS",
      defaultOpen: true,
      items: [
        { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
        { label: "New Addendum", path: "/addendum", icon: FileText },
        { label: "New Car Sticker", path: "/new-car-sticker", icon: FileText },
        { label: "Used Car Sticker", path: "/used-car-sticker", icon: Car },
        { label: "Buyers Guide", path: "/buyers-guide", icon: ScrollText, featureKey: "feature_buyers_guide" },
        { label: "CPO Info Sheet", path: "/cpo-sheet", icon: Award },
        { label: "Trade-Up Sticker", path: "/trade-up", icon: TrendingUp },
        { label: "Description Writer", path: "/description-writer", icon: Sparkles },
      ],
    },
    inventory: {
      title: "INVENTORY",
      defaultOpen: true,
      items: [
        { label: "All Vehicles", path: "/inventory", icon: Car },
        { label: "Saved Addendums", path: "/saved", icon: FolderOpen },
        { label: "Get-Ready", path: "/admin?tab=getready", icon: Clock },
        { label: "Vehicle Files", path: "/admin?tab=files", icon: FolderOpen },
        { label: "Print Queue", path: "/admin?tab=queue", icon: Printer },
      ],
    },
    admin: {
      title: "ADMINISTRATION",
      defaultOpen: false,
      items: [
        { label: "Admin Home", path: "/admin?tab=home", icon: LayoutDashboard },
        { label: "Products", path: "/admin?tab=products", icon: Package },
        { label: "Product Rules", path: "/admin?tab=rules", icon: Wrench, featureKey: "feature_product_rules" },
        { label: "Branding", path: "/admin?tab=branding", icon: Palette },
        { label: "Feature Toggles", path: "/admin?tab=settings", icon: ToggleLeft },
      ],
    },
    compliance: {
      title: "COMPLIANCE",
      defaultOpen: false,
      items: [
        { label: "Compliance Guide", path: "/compliance", icon: BookOpen },
        { label: "Audit Log", path: "/admin?tab=audit", icon: ShieldCheck },
        { label: "Analytics", path: "/admin?tab=analytics", icon: BarChart3, featureKey: "feature_analytics" },
        { label: "Leads", path: "/admin?tab=leads", icon: Users, featureKey: "feature_lead_capture" },
      ],
    },
    platform: {
      title: "PLATFORM",
      defaultOpen: false,
      items: isAdmin ? [
        { label: "Tenants",            path: "/platform-admin?tab=tenants",      icon: Store },
        { label: "Members",            path: "/platform-admin?tab=members",      icon: Users },
        { label: "Entitlements",       path: "/platform-admin?tab=entitlements", icon: Award },
        { label: "Platform Audit",     path: "/platform-admin?tab=audit",        icon: ShieldCheck },
        { label: "Recall Refresh",     path: "/platform-admin?tab=recalls",      icon: RefreshCw },
        { label: "Billing Handshake",  path: "/platform-admin?tab=billing",      icon: CreditCard },
      ] : [],
    },
  };

  const filterItems = (items: NavItem[]) =>
    items.filter(i => !i.featureKey || (settings as unknown as Record<string, unknown>)[i.featureKey]);

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

  const handleToggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("dark_mode", String(next));
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
    if (pathname === "/addendum") { crumbs.push({ label: "Documents" }); crumbs.push({ label: "New Addendum" }); return crumbs; }
    if (pathname === "/saved") { crumbs.push({ label: "Inventory" }); crumbs.push({ label: "Saved Addendums" }); return crumbs; }
    if (pathname === "/buyers-guide") { crumbs.push({ label: "Documents" }); crumbs.push({ label: "Buyers Guide" }); return crumbs; }
    if (pathname === "/used-car-sticker") { crumbs.push({ label: "Documents" }); crumbs.push({ label: "Used Car Sticker" }); return crumbs; }
    if (pathname === "/cpo-sheet") { crumbs.push({ label: "Documents" }); crumbs.push({ label: "CPO Info Sheet" }); return crumbs; }
    if (pathname === "/trade-up") { crumbs.push({ label: "Documents" }); crumbs.push({ label: "Trade-Up Sticker" }); return crumbs; }
    if (pathname === "/new-car-sticker") { crumbs.push({ label: "Documents" }); crumbs.push({ label: "New Car Sticker" }); return crumbs; }
    if (pathname === "/description-writer") { crumbs.push({ label: "Documents" }); crumbs.push({ label: "Description Writer" }); return crumbs; }
    if (pathname === "/compliance") { crumbs.push({ label: "Compliance" }); crumbs.push({ label: "Compliance Guide" }); return crumbs; }
    if (pathname === "/admin") {
      const tab = new URLSearchParams(search).get("tab") || "products";
      const tabLabels: Record<string, string> = {
        products: "Products",
        rules: "Product Rules",
        branding: "Branding",
        settings: "Feature Toggles",
        analytics: "Analytics",
        leads: "Leads",
        audit: "Audit Log",
        queue: "Print Queue",
        getready: "Get-Ready",
        files: "Vehicle Files",
      };
      const sectionMap: Record<string, string> = {
        products: "Administration", rules: "Administration", branding: "Administration", settings: "Administration",
        analytics: "Compliance", leads: "Compliance", audit: "Compliance",
        queue: "Inventory", getready: "Inventory", files: "Inventory",
      };
      crumbs.push({ label: sectionMap[tab] || "Admin" });
      crumbs.push({ label: tabLabels[tab] || "Settings" });
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
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();
  const firstName = user?.email?.split("@")[0].split(".")[0] || "there";
  const capitalized = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar — shimmer-sidebar paints the landing-page blue shine.
          vt-sidebar opts into a stable view-transition-name so route
          changes only cross-fade the main content area, not the chrome. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 shimmer-sidebar vt-sidebar border-r border-white/10 flex flex-col transform transition-all duration-200 ease-out lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-16 w-64" : "w-64"}`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-sidebar-border flex-shrink-0">
          {tenant?.logo_url && tenant.logo_url !== "/logo-mark.svg" ? (
            <div className="flex items-center gap-2 min-w-0">
              <img src={tenant.logo_url} alt={tenant.name} className="w-8 h-8 rounded-md object-contain bg-white p-1 flex-shrink-0" />
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
            <Logo variant={collapsed ? "mark" : "full"} size={28} tagline={!collapsed} inverted />
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
        <div className={`px-2 pt-3 flex-shrink-0 grid gap-2 ${collapsed ? "lg:grid-cols-1 grid-cols-2" : "grid-cols-2"}`}>
          <button
            onClick={() => {
              setMobileOpen(false);
              navigate("/inventory?add=1");
            }}
            className="h-12 rounded-xl bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white inline-flex items-center justify-center gap-1.5 shadow-premium hover:brightness-110 transition-all"
            title="Add a vehicle to inventory"
          >
            <Car className="w-4 h-4 stroke-[2.5]" />
            <span className={`font-display font-black tracking-tight text-[15px] whitespace-nowrap ${collapsed ? "lg:hidden" : ""}`}>Add Vehicle</span>
          </button>
          <button
            onClick={() => {
              setMobileOpen(false);
              navigate("/scan");
            }}
            className="h-12 rounded-xl bg-sidebar-accent/60 hover:bg-sidebar-accent text-sidebar-foreground inline-flex items-center justify-center gap-1.5 border border-sidebar-border transition-all"
            title="Scan a VIN barcode or windshield sticker"
          >
            <ScanLine className="w-4 h-4 stroke-[2.5]" />
            <span className={`font-display font-black tracking-tight text-[15px] whitespace-nowrap ${collapsed ? "lg:hidden" : ""}`}>Scan Vehicle</span>
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
                  <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#3BB4FF] to-[#1E90FF] flex items-center justify-center flex-shrink-0 shadow-premium">
                    <Store className="w-3.5 h-3.5 text-white" />
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
                {/* Section header — hidden when the rail is
                    collapsed on desktop; on mobile the rail is
                    full-width so the header stays. */}
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
                {(isOpen || collapsed) && (
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
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold pl-3 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-gradient-to-b before:from-[#3BB4FF] before:to-[#1E90FF] before:rounded-full"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
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
          <button
            className={`w-full flex items-center rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors ${collapsed ? "lg:justify-center lg:px-2 lg:py-2 gap-2.5 px-2.5 py-2" : "gap-2.5 px-2.5 py-2"}`}
            title={collapsed ? "Platform Updates" : undefined}
          >
            <Rocket className="w-4 h-4 flex-shrink-0" />
            <span className={`flex-1 text-left ${collapsed ? "lg:hidden" : ""}`}>Platform Updates</span>
          </button>
          <button
            className={`w-full flex items-center rounded-md text-sm text-amber-500 hover:bg-amber-500/10 transition-colors ${collapsed ? "lg:justify-center lg:px-2 lg:py-2 gap-2.5 px-2.5 py-2" : "gap-2.5 px-2.5 py-2"}`}
            title={collapsed ? "Command Center" : undefined}
          >
            <Tag className="w-4 h-4 flex-shrink-0" />
            <span className={`flex-1 text-left font-medium ${collapsed ? "lg:hidden" : ""}`}>Command Center</span>
          </button>

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
        {/* Top bar — HarteCash/Autocurb chrome: bordered translucent
            pills on navy, full-width search bar in the centre, avatar
            with role-stack on the right. topbar-navy already paints
            the shimmer-roll animation; vt-topbar stabilises the
            header across admin tab switches so only the main pane
            cross-fades. */}
        <header className="sticky top-0 z-20 topbar-navy vt-topbar text-white border-b border-white/10">
          <div className="flex items-center h-14 px-3 lg:px-5 gap-3">
            {/* Left: hamburger (mobile) + greeting block */}
            <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
              <button
                onClick={() => setMobileOpen(true)}
                className="lg:hidden h-9 w-9 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 hover:border-white/25 inline-flex items-center justify-center transition-all"
              >
                <Menu className="w-4 h-4" />
              </button>
              <div className="min-w-0 hidden sm:block">
                <p className="text-sm font-semibold text-white truncate leading-tight">
                  {greeting}, {capitalized}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold bg-amber-400 text-amber-950 px-1.5 py-0.5 rounded-sm uppercase tracking-[0.12em]">
                    <Sparkles className="w-2.5 h-2.5" />
                    {isAdmin ? "Super Admin" : "Admin"}
                  </span>
                  {/* Wave 15.1 — family-positioning tagline. Reads
                      as "this is one app in a suite", not "this is
                      a standalone tool". Hides on xs so we don't
                      crowd the greeting on phones. */}
                  <span className="hidden lg:inline-flex items-center text-[10px] text-white/55 tracking-[0.08em]">
                    by <span className="ml-1 font-semibold text-white/75">Autocurb</span>
                  </span>
                  {currentStore?.name && (
                    <span className="text-[11px] text-white/65 truncate">
                      · {currentStore.name}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Centre: command-palette as a full-width search bar */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden md:flex flex-1 min-w-0 max-w-xl items-center gap-2 h-10 px-3.5 rounded-xl border border-white/15 bg-white/[0.06] hover:bg-white/[0.10] hover:border-white/25 text-sm transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              title="Command palette (⌘K)"
            >
              <Search className="w-4 h-4 text-white/55 flex-shrink-0" />
              <span className="flex-1 text-left text-white/55 truncate">
                Search vehicles, VIN, customers…
              </span>
              <kbd className="inline-flex items-center justify-center h-5 min-w-[28px] px-1.5 rounded-md bg-white/10 border border-white/10 text-[10px] font-mono text-white/75 tracking-wider">
                ⌘K
              </kbd>
            </button>

            {/* Right cluster */}
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
              {/* App switcher */}
              <AppSwitcher currentApp="autolabels" />

              {/* Live realtime indicator — pulses on any
                  vehicle_listings change in this tenant
                  (Wave 15.3 surfaces the Wave 14.6 sync). */}
              <LiveBadge />

              {/* Mobile-scan QR launcher */}
              <button
                onClick={() => setShowMobileQr(true)}
                className="h-9 w-9 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 hover:border-white/25 text-white/85 hover:text-white inline-flex items-center justify-center transition-all"
                title="Open scanner on your phone"
              >
                <ScanLine className="w-4 h-4" />
              </button>

              {/* Dark mode toggle */}
              <button
                onClick={handleToggleDark}
                className="h-9 w-9 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 hover:border-white/25 text-white/85 hover:text-white inline-flex items-center justify-center transition-all"
                title="Toggle dark mode"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {/* Notifications */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="relative h-9 w-9 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 hover:border-white/25 text-white/85 hover:text-white inline-flex items-center justify-center transition-all"
                    title="Notifications"
                  >
                    <Bell className="w-4 h-4" />
                    {recentNotifications.length > 0 && (
                      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#0B2041]" />
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
                    recentNotifications.map(e => (
                      <div key={e.id} className="px-3 py-2 text-xs border-b border-border last:border-0">
                        <p className="font-medium text-foreground capitalize">{e.action.replace(/_/g, " ")}</p>
                        <p className="text-muted-foreground truncate">{e.entity_type} · {e.entity_id}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(e.created_at).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Admin role pill — only renders for platform admins */}
              {isAdmin && (
                <span className="hidden lg:inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-white/15 bg-white/[0.04] text-[10px] font-bold uppercase tracking-[0.14em] text-white/90">
                  Admin
                </span>
              )}

              {/* Divider */}
              <div className="hidden lg:block w-px h-6 bg-white/12 mx-0.5" />

              {/* User cluster — avatar + name/role stack */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-2 h-10 pl-1 pr-2 rounded-lg hover:bg-white/[0.08] transition-colors group">
                    <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3BB4FF] to-[#1E90FF] text-white flex items-center justify-center text-[11px] font-bold ring-1 ring-white/20 shadow-premium">
                      {userInitial}
                    </span>
                    <span className="hidden md:flex flex-col items-start min-w-0 leading-tight">
                      <span className="text-xs font-semibold text-white truncate max-w-[110px]">{capitalized}</span>
                      <span className="text-[10px] text-white/60 truncate">{isAdmin ? "Admin" : "Member"}</span>
                    </span>
                    <ChevronDown className="hidden md:inline-block w-3 h-3 text-white/55 group-hover:text-white/80 transition-colors" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div>
                      <p className="text-sm font-medium">{user?.email || "Signed in"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{currentStore?.name}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleManageBilling}>
                    <CreditCard className="w-3.5 h-3.5 mr-2" />
                    Manage billing
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/admin?tab=branding")}>
                    <Settings className="w-3.5 h-3.5 mr-2" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="w-3.5 h-3.5 mr-2" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Help */}
              <button
                onClick={() => window.open("https://autolabels.io/help", "_blank")}
                className="h-9 w-9 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 hover:border-white/25 text-white/85 hover:text-white inline-flex items-center justify-center transition-all"
                title="Help"
              >
                <HelpCircle className="w-4 h-4" />
              </button>

              {/* Logout — explicit text button on md+, icon on mobile */}
              <button
                onClick={handleSignOut}
                className="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 hover:border-white/25 text-white/90 hover:text-white text-xs font-semibold transition-all"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                Logout
              </button>
              <button
                onClick={handleSignOut}
                className="md:hidden h-9 w-9 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 hover:border-white/25 text-white/85 hover:text-white inline-flex items-center justify-center transition-all"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Breadcrumbs — sticky below the topbar with backdrop-blur so
            content scrolls beneath it like a native toolbar.
            vt-crumbs keeps this strip out of the route cross-fade. */}
        <div className="sticky top-14 z-10 h-10 flex items-center px-4 lg:px-6 surface-blur vt-crumbs border-b border-border flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs overflow-x-auto whitespace-nowrap">
            {breadcrumbs.map((crumb, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />}
                {crumb.path ? (
                  <Link
                    to={crumb.path}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-foreground font-medium">{crumb.label}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Page content — only this swaps on route change. Chrome
            above (topbar + breadcrumb) and the sidebar stay
            mounted and visually still. */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
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
  );
};

export default AppShell;
