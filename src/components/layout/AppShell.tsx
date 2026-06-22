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
  LayoutTemplate,
  QrCode,
  FileWarning,
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
  // Collapse the mobile header's action row once the content scrolls, so the
  // long inventory list isn't fighting a tall fixed header for space.
  const [mScrolled, setMScrolled] = useState(false);
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
        { label: "Setup", path: "/setup", icon: Rocket, requireManager: true },
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
        { label: "Sticker Studio", path: "/sticker-studio", icon: Sparkles },
        { label: "CPO Info Sheet", path: "/cpo-sheet", icon: Award },
        { label: "Trade-Up Sticker", path: "/trade-up", icon: TrendingUp },
        { label: "Buyers Guide", path: "/buyers-guide", icon: ScrollText, featureKey: "feature_buyers_guide" },
        { label: "Used Vehicle Docs", path: "/used-vehicle-documents", icon: ScrollText, requireManager: true },
        { label: "Description Writer", path: "/description-writer", icon: Sparkles },
      ],
    },
    compliance: {
      title: "COMPLIANCE",
      defaultOpen: false,
      items: [
        { label: "Compliance Guide", path: "/compliance", icon: BookOpen },
        { label: "CT MVP Smoke Test", path: "/admin/smoke-test", icon: ShieldCheck, requireManager: true },
        { label: "Certification History", path: "/admin/certification-history", icon: CheckCircle2, requireManager: true },
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
        { label: "QR Analytics", path: "/dashboard/qr-analytics", icon: QrCode, requireManager: true },
        { label: "AutoLabels Reports", path: "/dashboard/reports", icon: BarChart3, requireManager: true },
        { label: "Document Review", path: "/dashboard/document-review", icon: FileWarning, requireManager: true },
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
        { label: "Sticker Templates",  path: "/platform-admin?tab=templates",    icon: LayoutTemplate, requireAdmin: true },
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
    const [pathname, search = ""] = path.split("?");
    if (location.pathname !== pathname) return false;
    if (!search) return true;
    return location.search === `?${search}`;
  };

  // Force-open any section that contains the active route; this fixes
  // deep links into collapsed sections (e.g. /setup or /admin?tab=...).
  useEffect(() => {
    setOpenSections(prev => {
      const next = { ...prev };
      let changed = false;
      Object.entries(sections).forEach(([key, section]) => {
        const hasActive = section.items.some(i => isActive(i.path));
        if (hasActive && !next[key]) { next[key] = true; changed = true; }
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const unreadAudit = entries.filter(e => e.action === "compliance_block" || e.action === "price_integrity_block").length;

  const visibleSections = Object.entries(sections)
    .map(([key, section]) => [key, { ...section, items: filterItems(section.items) }] as const)
    .filter(([, section]) => section.items.length > 0);

  const currentLabel = visibleSections
    .flatMap(([, s]) => s.items)
    .find(i => isActive(i.path))?.label || "Dashboard";

  const shell = (
    <VinScanContext.Provider value={vinScanApi}>
      <div className="min-h-screen bg-background flex w-full overflow-hidden">
        {/* Mobile overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* Sidebar */}
        <aside className={`fixed lg:sticky top-0 left-0 z-50 h-screen bg-card border-r border-border transition-all duration-200 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "lg:w-20" : "lg:w-64"} w-64 flex flex-col`}>
          <div className="h-16 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
            <Link to="/dashboard" className={`flex items-center gap-3 min-w-0 ${collapsed ? "lg:justify-center lg:w-full" : ""}`}>
              <Logo size={collapsed ? "sm" : "md"} showText={!collapsed} />
            </Link>
            <button onClick={() => setMobileOpen(false)} className="lg:hidden p-1 rounded-md hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {visibleSections.map(([key, section]) => {
              const open = section.defaultOpen || openSections[key];
              return (
                <div key={key} className="mb-2">
                  {section.title && !collapsed && (
                    <button
                      onClick={() => toggleSection(key)}
                      className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      {section.title}
                      <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                  )}
                  {(open || collapsed || !section.title) && (
                    <div className="space-y-1">
                      {section.items.map((item) => {
                        const active = isActive(item.path);
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.path}
                            onClick={() => { navigate(item.path); setMobileOpen(false); }}
                            title={collapsed ? item.label : undefined}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"} ${collapsed ? "lg:justify-center" : ""}`}
                          >
                            <Icon className="h-4 w-4 flex-shrink-0" />
                            {!collapsed && <span className="truncate">{item.label}</span>}
                            {!collapsed && item.badge && (
                              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-primary-foreground/20">{item.badge}</span>
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

          <div className="p-3 border-t border-border flex-shrink-0 space-y-2">
            <button onClick={() => setPaletteOpen(true)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted ${collapsed ? "lg:justify-center" : ""}`} title={collapsed ? "Search" : undefined}>
              <Search className="h-4 w-4" />
              {!collapsed && <span>Search</span>}
            </button>
            <button onClick={toggleCollapsed} className="hidden lg:flex w-full items-center justify-center px-3 py-1.5 rounded-lg text-muted-foreground hover:bg-muted" title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
          {/* Top bar */}
          <header className={`h-14 lg:h-16 border-b border-border bg-card/95 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 flex-shrink-0 transition-transform duration-200 ${mScrolled ? "-translate-y-14 lg:translate-y-0" : "translate-y-0"}`}>
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 rounded-md hover:bg-muted">
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-foreground hidden sm:block">{currentLabel}</h1>
                <p className="text-xs text-muted-foreground hidden lg:block">{tenant?.name || "AutoLabels"}{currentStore ? ` · ${currentStore.name}` : ""}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={openScan} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:opacity-90">
                <ScanLine className="h-4 w-4" />
                <span className="hidden sm:inline">Scan VIN</span>
              </button>

              <button onClick={() => navigate("/admin?tab=audit")} className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
                <Bell className="h-5 w-5" />
                {unreadAudit > 0 && <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center">{unreadAudit}</span>}
              </button>

              {/* Store selector */}
              {stores.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium flex items-center gap-2 hover:bg-muted max-w-[180px]">
                      <Store className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate hidden sm:inline">{currentStore?.name || "Select store"}</span>
                      <ChevronsUpDown className="h-3 w-3 flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-card">
                    <DropdownMenuLabel>Dealership</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {stores.map((store) => (
                      <DropdownMenuItem key={store.id} onClick={() => setCurrentStore(store)} className="cursor-pointer">
                        <Store className="h-4 w-4 mr-2" />
                        <div>
                          <div className="font-medium">{store.name}</div>
                          <div className="text-xs text-muted-foreground">{store.city}, {store.state}</div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* App switcher */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-9 px-3 rounded-lg border border-border bg-background text-sm font-medium flex items-center gap-2 hover:bg-muted">
                    <Package className="h-4 w-4" />
                    <span className="hidden sm:inline">Apps</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 bg-card">
                  <DropdownMenuLabel>Autocurb Suite</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {getSubscribedProducts(ALL_PRODUCTS, { autolabels: true }).map((p) => (
                    <DropdownMenuItem key={p.key} asChild>
                      <a href={p.href} target="_blank" rel="noreferrer" className="cursor-pointer">
                        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center mr-2">
                          {p.key === "autolabels" ? <Tag className="h-4 w-4" /> : p.key === "autocorp" ? <Building2 className="h-4 w-4" /> : p.key === "autocurb" ? <Car className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium flex items-center gap-1">{p.name}{p.key !== "autolabels" && <ExternalLink className="h-3 w-3" />}</div>
                          <div className="text-xs text-muted-foreground truncate">{p.description}</div>
                        </div>
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                    {user?.email?.charAt(0).toUpperCase() || "U"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-card">
                  <DropdownMenuLabel>
                    <div className="truncate">{user?.email}</div>
                    {isAdmin && <div className="text-xs text-primary">Platform Admin</div>}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/admin?tab=settings")} className="cursor-pointer">
                    <Settings className="h-4 w-4 mr-2" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleManageBilling} className="cursor-pointer">
                    <CreditCard className="h-4 w-4 mr-2" /> Billing
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/trust")} className="cursor-pointer">
                    <HelpCircle className="h-4 w-4 mr-2" /> Help & Trust
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive">
                    <LogOut className="h-4 w-4 mr-2" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* Mobile secondary bar */}
          <div className={`lg:hidden border-b border-border bg-card/95 px-3 py-2 flex items-center gap-2 overflow-x-auto transition-all duration-200 ${mScrolled ? "h-0 py-0 border-0 overflow-hidden" : ""}`}>
            <button onClick={() => navigate("/addendum")} className="flex-shrink-0 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Addendum
            </button>
            <button onClick={() => navigate("/sticker-studio")} className="flex-shrink-0 h-8 px-3 rounded-md border border-border text-xs font-medium flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Studio
            </button>
            <button onClick={() => navigate("/used-vehicle-documents")} className="flex-shrink-0 h-8 px-3 rounded-md border border-border text-xs font-medium flex items-center gap-1.5">
              <ScrollText className="h-3.5 w-3.5" /> Used Docs
            </button>
            <button onClick={openScan} className="flex-shrink-0 h-8 px-3 rounded-md border border-border text-xs font-medium flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5" /> Scan
            </button>
          </div>

          {/* Content */}
          <main
            id="app-scroll"
            className="flex-1 overflow-y-auto"
            onScroll={(e) => {
              const top = (e.currentTarget as HTMLElement).scrollTop;
              setMScrolled(top > 12);
            }}
          >
            {children}
          </main>
        </div>

        {/* Desktop QR modal for mobile scan handoff */}
        {showMobileQr && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowMobileQr(false)}>
            <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center" onClick={e => e.stopPropagation()}>
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <ScanLine className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Scan with your phone</h2>
              <p className="text-sm text-muted-foreground mb-4">Open the live VIN scanner on your mobile device.</p>
              <div className="bg-white p-4 rounded-xl inline-block">
                <QRCodeSVG value={`${window.location.origin}/scan`} size={180} />
              </div>
              <button onClick={() => setShowMobileQr(false)} className="mt-4 w-full h-10 rounded-lg border border-border hover:bg-muted text-sm font-medium">
                Close
              </button>
            </div>
          </div>
        )}

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} sections={visibleSections} onNavigate={(p) => navigate(p)} />
      </div>
    </VinScanContext.Provider>
  );

  // Desktop-only onboarding nudge: if a signed-in user has the house fallback
  // tenant and isn't already on onboarding, guide them to finish setup.
  useEffect(() => {
    if (!user) return;
    if (tenant?.id !== "house") return;
    if (location.pathname === "/onboarding") return;
    const t = setTimeout(() => {
      toast.info("Finish setup to activate your dealership workspace", {
        action: { label: "Continue", onClick: () => navigate("/onboarding") },
      });
    }, 800);
    return () => clearTimeout(t);
  }, [user, tenant?.id, location.pathname, navigate]);

  return shell;
};

export default AppShell;
