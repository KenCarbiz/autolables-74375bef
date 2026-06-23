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
  CreditCard,
  RefreshCw,
  Search,
  HelpCircle,
  CheckCircle2,
  Truck,
  Building2,
  ExternalLink,
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
import { ALL_PRODUCTS } from "@/components/layout/AppSwitcher";
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
  requireManager?: boolean;
  requireAdmin?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const productIcon = (id: string) => {
  if (id === "autolabels") return Tag;
  if (id === "autocurb") return Car;
  if (id === "autoframe") return Building2;
  return Truck;
};

const AppShell = ({ children }: AppShellProps) => {
  const { user, isAdmin, signOut } = useAuth();
  const { tenant, currentStore, stores, setCurrentStore } = useTenant();
  const { settings } = useDealerSettings();
  const { member } = useEntitlements();
  const role = member?.role;
  const isManager = isAdmin || !role || role === "owner" || role === "admin" || role === "manager";
  const { entries } = useAudit();
  const location = useLocation();
  const navigate = useViewTransitionNavigate();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _baseNavigate = useBaseNavigate;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showMobileQr, setShowMobileQr] = useState(false);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const [marketCheckConnected, setMarketCheckConnected] = useState(false);
  const [marketCheckLabel, setMarketCheckLabel] = useState("MarketCheck Pending");

  const openScan = useCallback(() => {
    if (prefersLiveScanner()) navigate("/scan");
    else setShowMobileQr(true);
  }, [navigate]);
  const vinScanApi = useMemo(() => ({ openScan }), [openScan]);

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
        { label: "Tenants", path: "/platform-admin?tab=tenants", icon: Store, requireAdmin: true },
        { label: "Members", path: "/platform-admin?tab=members", icon: Users, requireAdmin: true },
        { label: "Entitlements", path: "/platform-admin?tab=entitlements", icon: Award, requireAdmin: true },
        { label: "Platform Audit", path: "/platform-admin?tab=audit", icon: ShieldCheck, requireAdmin: true },
        { label: "Recall Refresh", path: "/platform-admin?tab=recalls", icon: RefreshCw, requireAdmin: true },
        { label: "Billing Handshake", path: "/platform-admin?tab=billing", icon: CreditCard, requireAdmin: true },
        { label: "Sticker Templates", path: "/platform-admin?tab=templates", icon: LayoutTemplate, requireAdmin: true },
      ],
    },
  };

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

  useEffect(() => {
    let mounted = true;
    const loadMarketCheck = async () => {
      if (!tenant?.id) {
        setMarketCheckConnected(false);
        setMarketCheckLabel("MarketCheck Pending");
        return;
      }
      try {
        const { data } = await (supabase as any)
          .from("marketcheck_sync_config")
          .select("last_run_at,last_status")
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!mounted) return;
        const connected = !!data?.last_run_at || !!data?.last_status;
        setMarketCheckConnected(connected);
        setMarketCheckLabel(connected ? "MarketCheck Connected" : "MarketCheck Pending");
      } catch {
        if (!mounted) return;
        setMarketCheckConnected(false);
        setMarketCheckLabel("MarketCheck Pending");
      }
    };
    loadMarketCheck();
    return () => { mounted = false; };
  }, [tenant?.id]);

  const unreadAudit = entries.filter(e => e.action === "compliance_block" || e.action === "price_integrity_block").length;

  const visibleSections = Object.entries(sections)
    .map(([key, section]) => [key, { ...section, items: filterItems(section.items) }] as const)
    .filter(([, section]) => section.items.length > 0);

  const activeItem = visibleSections
    .flatMap(([, s]) => s.items)
    .find(i => isActive(i.path));

  const pageTitles: Record<string, { title: string; subtitle: string }> = {
    "/dashboard": { title: "Home", subtitle: "Your dealership command center." },
    "/inventory": { title: "Inventory", subtitle: "Manage vehicles, labels, readiness, and publishing." },
    "/saved": { title: "Deals", subtitle: "Review saved addendums, signatures, and delivery status." },
    "/setup": { title: "Setup", subtitle: "Configure your dealership workspace." },
    "/addendum": { title: "New Addendum", subtitle: "Create compliant addendum labels and forms." },
    "/new-car-sticker": { title: "New Car Sticker", subtitle: "Generate new vehicle window labels." },
    "/used-car-sticker": { title: "Used Car Sticker", subtitle: "Generate used vehicle buyer-facing labels." },
    "/sticker-studio": { title: "Sticker Studio", subtitle: "Build and customize label templates." },
    "/compliance": { title: "Compliance", subtitle: "Track dealership forms, rules, and audit items." },
  };
  const pageMeta = pageTitles[location.pathname] || { title: activeItem?.label || "Dashboard", subtitle: "AutoLabels admin workspace." };
  const companyName = currentStore?.name || tenant?.name || (settings.dealer_name && settings.dealer_name !== "Your Dealership" ? settings.dealer_name : "Select store");

  const openProduct = (url: string) => {
    if (url.startsWith("http")) window.open(url, "_blank", "noreferrer");
    else navigate(url);
  };

  const shell = (
    <VinScanContext.Provider value={vinScanApi}>
      <div className="min-h-screen bg-background flex w-full overflow-hidden">
        {mobileOpen && (
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
        )}

        <aside className={`fixed lg:sticky top-0 left-0 z-50 h-screen bg-card border-r border-border transition-all duration-200 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "lg:w-20" : "lg:w-64"} w-64 flex flex-col`}>
          <div className="h-16 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
            <Link to="/dashboard" className={`flex items-center gap-3 min-w-0 ${collapsed ? "lg:justify-center lg:w-full" : ""}`}>
              <Logo size={collapsed ? 24 : 32} variant={collapsed ? "mark" : "full"} />
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

        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
          <header className="h-16 border-b border-border bg-card/95 backdrop-blur-sm flex items-center justify-between gap-3 px-4 lg:px-6 flex-shrink-0">
            <div className="flex min-w-0 items-center gap-3">
              <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 rounded-md hover:bg-muted">
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-black tracking-tight text-foreground sm:text-xl">{pageMeta.title}</h1>
                <p className="hidden truncate text-xs font-medium text-muted-foreground md:block">{pageMeta.subtitle}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className={`hidden h-9 items-center gap-2 rounded-full border px-3 text-xs font-black lg:flex ${marketCheckConnected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                <span className={`h-2 w-2 rounded-full ${marketCheckConnected ? "bg-emerald-500" : "bg-amber-500"}`} />
                {marketCheckLabel}
              </div>

              {stores.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="hidden h-9 max-w-[220px] items-center gap-2 rounded-full border border-border bg-background px-3 text-sm font-black hover:bg-muted md:flex">
                      <Store className="h-4 w-4 flex-shrink-0 text-primary" />
                      <span className="truncate">{companyName}</span>
                      <ChevronsUpDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 bg-card">
                    <DropdownMenuLabel>Switch location</DropdownMenuLabel>
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
              ) : (
                <div className="hidden h-9 max-w-[220px] items-center gap-2 rounded-full border border-border bg-background px-3 text-sm font-black md:flex">
                  <Store className="h-4 w-4 flex-shrink-0 text-primary" />
                  <span className="truncate">{companyName}</span>
                </div>
              )}

              <button onClick={openScan} className="hidden h-9 items-center gap-2 rounded-full bg-primary px-3 text-sm font-black text-primary-foreground hover:opacity-90 sm:flex">
                <ScanLine className="h-4 w-4" />
                <span className="hidden lg:inline">Scan VIN</span>
              </button>

              <button onClick={() => navigate("/admin?tab=audit")} className="relative p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground">
                <Bell className="h-5 w-5" />
                {unreadAudit > 0 && <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center">{unreadAudit}</span>}
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-black shadow-sm">
                    {user?.email?.charAt(0).toUpperCase() || "U"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 bg-card">
                  <DropdownMenuLabel>
                    <div className="truncate text-sm font-black">{user?.email}</div>
                    {isAdmin && <div className="text-xs text-primary">Platform Admin</div>}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">App switcher</DropdownMenuLabel>
                  {ALL_PRODUCTS.map((p) => {
                    const Icon = productIcon(p.id);
                    return (
                      <DropdownMenuItem key={p.id} onClick={() => openProduct(p.url)} className="cursor-pointer py-2.5">
                        <div className="mr-3 flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 font-black">{p.name}{p.url.startsWith("http") && <ExternalLink className="h-3 w-3" />}</div>
                          <div className="truncate text-xs text-muted-foreground">{p.description}</div>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/admin?tab=team")} className="cursor-pointer">
                    <Users className="h-4 w-4 mr-2" /> Profile / Team
                  </DropdownMenuItem>
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

          <div className="lg:hidden border-b border-border bg-card/95 px-3 py-2 flex items-center gap-2 overflow-x-auto">
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

          <main id="app-scroll" className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>

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

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </VinScanContext.Provider>
  );

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
