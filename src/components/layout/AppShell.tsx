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
        className={`fixed inset-y-0 left-0 z-40 w-64 shimmer-sidebar vt-sidebar border-r border-white/10 flex flex-col transform transition-transform lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-sidebar-border flex-shrink-0">
          {tenant?.logo_url && tenant.logo_url !== "/logo-mark.svg" ? (
            <div className="flex items-center gap-2">
              <img src={tenant.logo_url} alt={tenant.name} className="w-8 h-8 rounded-md object-contain bg-white p-1" />
              <div>
                <p className="text-sm font-semibold text-sidebar-foreground leading-none tracking-tight">
                  {tenant?.name}
                </p>
                <p className="text-[9px] text-sidebar-foreground/55 mt-1 uppercase tracking-[0.18em] font-semibold">
                  Clear · Compliant · Consistent
                </p>
              </div>
            </div>
          ) : (
            <Logo variant="full" size={28} tagline inverted />
          )}
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Primary actions — every workflow starts with adding or
            scanning a vehicle. Add opens the modal on /inventory.
            Scan opens the barcode / VIN-plate scanner. */}
        <div className="px-3 pt-3 flex-shrink-0 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setMobileOpen(false);
              navigate("/inventory?add=1");
            }}
            className="h-12 rounded-xl bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white inline-flex items-center justify-center gap-1.5 shadow-premium hover:brightness-110 transition-all"
          >
            <Car className="w-4 h-4 stroke-[2.5]" />
            <span className="font-display font-black tracking-tight text-[15px] whitespace-nowrap">Add Vehicle</span>
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
            <span className="font-display font-black tracking-tight text-[15px] whitespace-nowrap">Scan Vehicle</span>
          </button>
        </div>

        {/* Store Selector */}
        {stores.length > 0 && (
          <div className="px-3 py-3 border-b border-sidebar-border flex-shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-sidebar-accent/60 hover:bg-sidebar-accent transition-colors text-left group border border-sidebar-border/50">
                  <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#3BB4FF] to-[#1E90FF] flex items-center justify-center flex-shrink-0 shadow-premium">
                    <Store className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] text-sidebar-foreground/70 uppercase tracking-[0.18em] font-bold">Store</p>
                    <p className="text-xs font-semibold text-sidebar-foreground truncate">
                      {currentStore?.name || "No store"}
                    </p>
                  </div>
                  <ChevronsUpDown className="w-3.5 h-3.5 text-sidebar-foreground/60 flex-shrink-0" />
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
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
          {Object.entries(sections).map(([key, section]) => {
            const visibleItems = filterItems(section.items);
            if (visibleItems.length === 0) return null;
            const isOpen = openSections[key] !== false;
            return (
              <div key={key}>
                <button
                  onClick={() => toggleSection(key)}
                  className="w-full flex items-center justify-between px-2 mb-1.5 group"
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
                {isOpen && (
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
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-all relative ${
                            active
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold pl-3 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-gradient-to-b before:from-[#3BB4FF] before:to-[#1E90FF] before:rounded-full"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                          }`}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span className="flex-1 text-left truncate">{item.label}</span>
                          {item.badge && (
                            <span className="text-[10px] font-semibold text-sidebar-foreground/60 tabular-nums">
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

        {/* Sidebar footer — Platform Updates + Command Center */}
        <div className="border-t border-sidebar-border p-3 space-y-1 flex-shrink-0">
          <button className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors">
            <Rocket className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-left">Platform Updates</span>
          </button>
          <button className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-amber-500 hover:bg-amber-500/10 transition-colors">
            <Tag className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-left font-medium">Command Center</span>
          </button>
          <div className="pt-2 text-center">
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

      {/* Main content area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top bar — topbar-navy already has the shimmer-roll animation.
            vt-topbar stabilises the header across admin tab switches so
            only the main pane cross-fades. */}
        <header className="sticky top-0 z-20 topbar-navy vt-topbar text-white border-b border-white/10">
          <div className="flex items-center justify-between h-14 px-4 lg:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileOpen(true)}
                className="lg:hidden p-1.5 rounded-md hover:bg-white/10"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate leading-tight">
                  {greeting}, {capitalized}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-500 text-amber-950 px-1.5 py-0.5 rounded-sm uppercase tracking-wider">
                    <Sparkles className="w-2.5 h-2.5" />
                    Admin
                  </span>
                  {currentStore?.name && (
                    <span className="text-[11px] text-white/70 truncate">
                      · {currentStore.name}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Command palette trigger — Cmd+K opens a fuzzy-search
                  over every page + action. Keyboard shortcut hint is
                  shown on md+ so it reads as a quick-jump affordance. */}
              <button
                onClick={() => setPaletteOpen(true)}
                className="hidden md:inline-flex items-center gap-2 h-9 pl-3 pr-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors"
                title="Command palette (⌘K)"
              >
                <span className="text-white/70">Search…</span>
                <kbd className="ml-2 inline-flex items-center gap-0.5 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-white/80">
                  ⌘K
                </kbd>
              </button>

              {/* App Switcher — switch between AutoLabels platform products */}
              <AppSwitcher currentApp="autolabels" />

              {/* Mobile QR launcher — shows QR code for phone scanning */}
              <button
                onClick={() => setShowMobileQr(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors"
                title="Open scanner on your phone"
              >
                <ScanLine className="w-4 h-4" />
                <span className="hidden md:inline">Mobile</span>
              </button>

              {/* Dark mode toggle */}
              <button
                onClick={handleToggleDark}
                className="p-2 rounded-md hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title="Toggle dark mode"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {/* Notifications */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="relative p-2 rounded-md hover:bg-white/10 text-white/80 hover:text-white transition-colors">
                    <Bell className="w-4 h-4" />
                    {recentNotifications.length > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
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

              {/* Sign out */}
              <button
                onClick={handleSignOut}
                className="p-2 rounded-md hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>

              {/* User avatar */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ml-1 w-8 h-8 rounded-full bg-gradient-to-br from-blue to-action text-white flex items-center justify-center text-xs font-semibold hover:ring-2 hover:ring-white/20 transition-all">
                    {userInitial}
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

        {/* Page content */}
        <main
          className="flex-1 overflow-y-auto"
          style={{ viewTransitionName: "main-content" }}
        >
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
