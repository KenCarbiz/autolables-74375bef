import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useViewTransitionNavigate } from "@/lib/navigation";
import {
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CreditCard,
  ExternalLink,
  FilePlus2,
  FileText,
  FileWarning,
  Folder,
  FolderOpen,
  Grid2X2,
  HelpCircle,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  Package,
  Palette,
  QrCode,
  RefreshCw,
  Rocket,
  ScanLine,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Tag,
  ToggleLeft,
  TrendingUp,
  Truck,
  Users,
  Wrench,
  X,
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
  const { entries } = useAudit();
  const location = useLocation();
  const navigate = useViewTransitionNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showMobileQr, setShowMobileQr] = useState(false);
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const [marketCheckConnected, setMarketCheckConnected] = useState(false);
  const [marketCheckLabel, setMarketCheckLabel] = useState("MarketCheck Pending");
  const [lastMarketCheckSync, setLastMarketCheckSync] = useState<string | null>(null);
  const [marketCheckCount, setMarketCheckCount] = useState<number | null>(null);

  const role = member?.role;
  const isManager = isAdmin || !role || role === "owner" || role === "admin" || role === "manager";

  const openScan = useCallback(() => {
    if (prefersLiveScanner()) navigate("/scan");
    else setShowMobileQr(true);
  }, [navigate]);
  const vinScanApi = useMemo(() => ({ openScan }), [openScan]);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("sidebar_collapsed") === "1";
    return false;
  });

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      if (typeof window !== "undefined") localStorage.setItem("sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  };

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    main: true,
    create: true,
    compliance: true,
    settings: true,
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
    items.filter((item) =>
      (!item.featureKey || (settings as unknown as Record<string, unknown>)[item.featureKey]) &&
      (!item.requireManager || isManager) &&
      (!item.requireAdmin || isAdmin)
    );

  const visibleSections = Object.entries(sections)
    .map(([key, section]) => [key, { ...section, items: filterItems(section.items) }] as const)
    .filter(([, section]) => section.items.length > 0);

  const isActive = (path: string) => {
    const [pathname, search = ""] = path.split("?");
    if (location.pathname !== pathname) return false;
    if (!search) return true;
    return location.search === `?${search}`;
  };

  const activeItem = visibleSections.flatMap(([, section]) => section.items).find((item) => isActive(item.path));

  const pageTitles: Record<string, { title: string; subtitle: string }> = {
    "/dashboard": { title: "Home", subtitle: "Your dealership command center." },
    "/inventory": { title: "Inventory Command Center", subtitle: "Manage, optimize, and publish your inventory with confidence." },
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
  const dealerLocation = [currentStore?.city || (settings as any)?.dealer_city, currentStore?.state || (settings as any)?.dealer_state].filter(Boolean).join(", ") || "Manchester, CT";
  const unreadAudit = entries.filter((entry) => entry.action === "compliance_block" || entry.action === "price_integrity_block").length;
  const inventoryHasOwnMobileChrome = location.pathname === "/inventory";
  const syncWhen = lastMarketCheckSync
    ? (() => {
        const d = new Date(lastMarketCheckSync);
        const sameDay = d.toDateString() === new Date().toDateString();
        return sameDay
          ? `${formatSyncTime(lastMarketCheckSync)} Today`
          : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      })()
    : "Never";
  const accountName = (() => {
    const raw = user?.email?.split("@")[0].split(/[._]/)[0] || "Account";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  })();
  const accountRole = isAdmin ? "Admin" : (role ? role.charAt(0).toUpperCase() + role.slice(1) : "Member");

  useEffect(() => {
    setOpenSections((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.entries(sections).forEach(([key, section]) => {
        const hasActive = section.items.some((item) => isActive(item.path));
        if (hasActive && !next[key]) {
          next[key] = true;
          changed = true;
        }
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
        setLastMarketCheckSync(null);
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
        setLastMarketCheckSync(data?.last_run_at || null);
        const st = (data?.last_status || {}) as Record<string, unknown>;
        setMarketCheckCount(typeof st.seen === "number" ? st.seen : (typeof st.num_found === "number" ? st.num_found : null));
      } catch {
        if (!mounted) return;
        setMarketCheckConnected(false);
        setMarketCheckLabel("MarketCheck Pending");
        setLastMarketCheckSync(null);
        setMarketCheckCount(null);
      }
    };
    loadMarketCheck();
    return () => { mounted = false; };
  }, [tenant?.id]);

  useEffect(() => {
    if (!user) return;
    if (tenant?.id !== "house") return;
    if (location.pathname === "/onboarding") return;
    const timer = setTimeout(() => {
      toast.info("Finish setup to activate your dealership workspace", {
        action: { label: "Continue", onClick: () => navigate("/onboarding") },
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [user, tenant?.id, location.pathname, navigate]);

  const toggleSection = (key: string) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const handleManageBilling = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("billing-portal-session", { body: { return_url: window.location.href } });
      if (error || !data?.url) {
        toast.error("Couldn't open billing portal");
        return;
      }
      window.location.href = data.url as string;
    } catch {
      toast.error("Couldn't open billing portal");
    }
  };

  const openProduct = (url: string) => {
    if (url.startsWith("http")) window.open(url, "_blank", "noreferrer");
    else navigate(url);
  };

  const bottomNavItems = [
    { label: "Home", path: "/dashboard", icon: Grid2X2 },
    { label: "Vehicles", path: "/inventory", icon: Car },
    { label: "Scan", path: "scan", icon: ScanLine, raised: true },
    { label: "Deals", path: "/saved", icon: Folder },
    { label: "Create", path: "/add-inventory", icon: FilePlus2 },
  ];

  return (
    <VinScanContext.Provider value={vinScanApi}>
      <div className="min-h-screen bg-background flex w-full overflow-hidden">
        {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}

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
                    <button onClick={() => toggleSection(key)} className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">
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
                            {!collapsed && item.badge && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-primary-foreground/20">{item.badge}</span>}
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
          {!inventoryHasOwnMobileChrome && (
            <header className="lg:hidden shrink-0 border-b border-slate-200 bg-white px-4 pb-4 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-4">
                  <button onClick={() => setMobileOpen(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-slate-950 active:bg-slate-100" aria-label="Open menu">
                    <Menu className="h-7 w-7" />
                  </button>
                  <div className="h-12 w-px bg-slate-200" />
                  {stores.length > 1 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="min-w-0 text-left">
                          <div className="flex items-center gap-2 text-[24px] font-black leading-none tracking-tight text-slate-950">
                            <span className="truncate">{companyName}</span>
                            <ChevronDown className="h-5 w-5 shrink-0" />
                          </div>
                          <div className="mt-1 text-lg font-medium text-slate-500">{dealerLocation}</div>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-72 bg-card">
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
                    <div className="min-w-0">
                      <div className="truncate text-[24px] font-black leading-none tracking-tight text-slate-950">{companyName}</div>
                      <div className="mt-1 text-lg font-medium text-slate-500">{dealerLocation}</div>
                    </div>
                  )}
                </div>
                <button onClick={() => navigate("/admin?tab=audit")} className="relative mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-slate-950 active:bg-slate-100" aria-label="Recent updates">
                  <Bell className="h-7 w-7" />
                  {unreadAudit > 0 && <span className="absolute -right-0.5 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1.5 text-xs font-black text-white">{unreadAudit}</span>}
                </button>
              </div>

              <div className="ml-[70px] mt-4 flex flex-wrap items-center gap-3 text-base font-medium text-slate-500">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Last sync: {formatSyncTime(lastMarketCheckSync)}</span>
                <span className="h-5 w-px bg-slate-300" />
                <span className="flex items-center gap-2"><CheckCircle2 className={`h-5 w-5 ${marketCheckConnected ? "text-emerald-500" : "text-amber-500"}`} /> {marketCheckLabel}</span>
              </div>
            </header>
          )}

          <header className="hidden h-16 border-b border-border bg-card/95 backdrop-blur-sm lg:flex items-center gap-3 px-6 flex-shrink-0">
            <div className="min-w-0 shrink-0">
              <h1 className="truncate text-xl font-black tracking-tight text-foreground">{pageMeta.title}</h1>
              <p className="truncate text-xs font-medium text-muted-foreground">{pageMeta.subtitle}</p>
            </div>

            {/* Global search pill → command palette */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden lg:flex w-[260px] xl:w-[340px] ml-4 items-center gap-2.5 h-9 px-4 rounded-full border border-border bg-background hover:bg-muted/60 hover:border-foreground/15 text-sm shadow-sm transition-all"
              title="Search (Cmd/Ctrl + K)"
            >
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="flex-1 text-left text-muted-foreground truncate">Search VIN, stock #, make, model…</span>
            </button>

            <div className="flex shrink-0 items-center gap-2 ml-auto">
              {/* Dealer card — doubles as the store switcher when multi-store */}
              {stores.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="hidden xl:flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 hover:bg-muted">
                      <Building2 className="h-4 w-4 shrink-0 text-blue-700" />
                      <div className="min-w-0 text-left leading-tight">
                        <p className="truncate max-w-[140px] text-[11px] font-bold text-foreground">{companyName}</p>
                        {dealerLocation && <p className="text-[10px] text-muted-foreground">{dealerLocation}</p>}
                      </div>
                      <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
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
                <div className="hidden xl:flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3">
                  <Building2 className="h-4 w-4 shrink-0 text-blue-700" />
                  <div className="min-w-0 leading-tight">
                    <p className="truncate max-w-[140px] text-[11px] font-bold text-foreground">{companyName}</p>
                    {dealerLocation && <p className="text-[10px] text-muted-foreground">{dealerLocation}</p>}
                  </div>
                </div>
              )}

              {/* Inventory last synced */}
              <div className="hidden xl:flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3">
                <CheckCircle2 className={`h-4 w-4 shrink-0 ${marketCheckConnected ? "text-emerald-500" : "text-amber-500"}`} />
                <div className="leading-tight">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Inventory last synced</p>
                  <p className="text-[11px] font-semibold text-foreground">{syncWhen}</p>
                  {marketCheckCount != null && <p className="text-[10px] font-semibold text-emerald-600">{marketCheckCount} vehicles updated</p>}
                </div>
              </div>

              {/* MarketCheck status */}
              <div className="hidden xl:flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3">
                <CheckCircle2 className={`h-4 w-4 shrink-0 ${marketCheckConnected ? "text-emerald-500" : "text-amber-500"}`} />
                <div className="leading-tight">
                  <p className="text-[11px] font-bold text-foreground">MarketCheck</p>
                  <p className="text-[10px] text-muted-foreground">{marketCheckConnected ? "Connected" : "Pending"}</p>
                </div>
              </div>

              <button onClick={() => navigate("/admin?tab=audit")} className="relative h-10 w-10 inline-flex items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground" title="Notifications">
                <Bell className="h-5 w-5" />
                {unreadAudit > 0 && <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadAudit}</span>}
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-muted">
                    <span className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-black shadow-sm">
                      {user?.email?.charAt(0).toUpperCase() || "U"}
                    </span>
                    <span className="hidden xl:block min-w-0 text-left leading-tight">
                      <span className="block truncate max-w-[110px] text-[12px] font-bold text-foreground">{accountName}</span>
                      <span className="block text-[10px] text-muted-foreground">{accountRole}</span>
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 bg-card">
                  <DropdownMenuLabel>
                    <div className="truncate text-sm font-black">{user?.email}</div>
                    {isAdmin && <div className="text-xs text-primary">Platform Admin</div>}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">App switcher</DropdownMenuLabel>
                  {ALL_PRODUCTS.map((product) => {
                    const Icon = productIcon(product.id);
                    return (
                      <DropdownMenuItem key={product.id} onClick={() => openProduct(product.url)} className="cursor-pointer py-2.5">
                        <div className="mr-3 flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 font-black">{product.name}{product.url.startsWith("http") && <ExternalLink className="h-3 w-3" />}</div>
                          <div className="truncate text-xs text-muted-foreground">{product.description}</div>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/admin?tab=team")} className="cursor-pointer"><Users className="h-4 w-4 mr-2" /> Profile / Team</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/admin?tab=settings")} className="cursor-pointer"><Settings className="h-4 w-4 mr-2" /> Settings</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleManageBilling} className="cursor-pointer"><CreditCard className="h-4 w-4 mr-2" /> Billing</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/trust")} className="cursor-pointer"><HelpCircle className="h-4 w-4 mr-2" /> Help & Trust</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive"><LogOut className="h-4 w-4 mr-2" /> Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main id="app-scroll" className="flex-1 overflow-y-auto pb-24 lg:pb-0">
            {children}
          </main>

          {!inventoryHasOwnMobileChrome && (
            <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-5 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
              <div className="mx-auto grid max-w-[520px] grid-cols-5 items-end gap-1">
                {bottomNavItems.map((item) => {
                  const Icon = item.icon;
                  const active = item.path !== "scan" && location.pathname === item.path;
                  return (
                    <button key={item.label} onClick={() => item.path === "scan" ? openScan() : navigate(item.path)} className={`flex flex-col items-center justify-end gap-1 text-[12px] font-bold ${active ? "text-blue-700" : "text-slate-500"}`}>
                      <span className={`${item.raised ? "-mt-8 flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-white text-blue-700 shadow-lg" : "flex h-7 items-center justify-center"}`}>
                        <Icon className={item.raised ? "h-7 w-7" : "h-6 w-6"} />
                      </span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
          )}
        </div>

        {showMobileQr && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowMobileQr(false)}>
            <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center" onClick={(event) => event.stopPropagation()}>
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
};

function formatSyncTime(value: string | null) {
  if (!value) return "--";
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "--";
  }
}

export default AppShell;
