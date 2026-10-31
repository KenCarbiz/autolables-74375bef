import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import { useDealerSettings, DealerSettings, DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import type { ProductUpgrade } from "@/hooks/useProducts";
import { useAudit } from "@/contexts/AuditContext";
import { useTenant } from "@/contexts/TenantContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { ADMIN_TABS, canSeeAdminTab, firstPermittedAdminTab, type AdminTab } from "@/lib/permissions/adminTabAccess";
import { supabase } from "@/integrations/supabase/client";
import InstallerContactsCard from "@/components/admin/InstallerContactsCard";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVinScan } from "@/contexts/VinScanContext";
import { toast } from "sonner";
import MerchandisingSeoPanel from "@/components/admin/MerchandisingSeoPanel";
import InstallerInvoicesPanel from "@/components/admin/InstallerInvoicesPanel";
import PassportPublishingCard from "@/components/admin/PassportPublishingCard";
import PacketDefaultsPanel from "@/components/admin/PacketDefaultsPanel";
import OemDistributionPanel from "@/components/admin/OemDistributionPanel";
import { useInstantSave } from "@/hooks/useInstantSave";
import StickyButtonsPanel from "@/components/admin/StickyButtonsPanel";
import DealershipTrustPanel from "@/components/admin/DealershipTrustPanel";
import PassportContactRoutingPanel from "@/components/admin/PassportContactRoutingPanel";
import EnabledFeaturesPanel from "@/components/admin/EnabledFeaturesPanel";
import { InventoryFeedHealth } from "@/components/admin/InventoryFeedHealth";
import IngestOutcomePanel from "@/components/admin/IngestOutcomePanel";
import MarketcheckSyncCard from "@/components/admin/MarketcheckSyncCard";
import MarketcheckDataHealthCard from "@/components/admin/MarketcheckDataHealthCard";
import TeamPanel from "@/components/admin/TeamPanel";
import { format } from "date-fns";
import { useLeads } from "@/hooks/useLeads";
import { useVehicleFiles } from "@/hooks/useVehicleFiles";
import { useGetReady } from "@/hooks/useGetReady";
import { useWarranty } from "@/hooks/useWarranty";
import { useSyndicationFeed } from "@/hooks/useSyndicationFeed";
import { useServiceSticker } from "@/hooks/useServiceSticker";
import { useDmsFeed } from "@/hooks/useDmsFeed";
import { useTradeInLifecycle } from "@/hooks/useTradeInLifecycle";
import type { VehicleFile as VehicleFileType, StickerType } from "@/types/vehicleFile";
import {
  Download,
  ShieldCheck,
  Search,
  ArrowUpRight,
  FileText,
  CheckCircle2,
  Clock,
  ScanLine,
  Printer,
  Car,
  Circle,
  Check,
  Copy,
  PlayCircle,
  TrendingUp,
  ListChecks,
  AlertTriangle,
  FileSignature,
  Sparkles,
  Plus,
} from "lucide-react";

interface Product {
  id: string;
  name: string;
  subtitle: string | null;
  warranty: string | null;
  badge_type: string;
  price: number;
  price_label: string | null;
  disclosure: string | null;
  sort_order: number;
  is_active: boolean;
  benefit_justification: string;
  benefit_justification_optional: string | null;
  disclosure_optional: string | null;
  price_in_advertised: boolean;
  available_preinstalled: boolean;
  upgrade: ProductUpgrade | null;
  contract_url: string | null;
  contract_doc_type: string | null;
  price_tiers: Record<string, number> | null;
  icon_type?: string;
}

const FEATURE_TOGGLES: { key: keyof DealerSettings; label: string; description: string; status: "active" | "beta" | "coming_soon" }[] = [
  { key: "feature_vin_decode", label: "VIN Decode", description: "Auto-populate vehicle info from VIN using NHTSA database", status: "active" },
  { key: "feature_vin_barcode", label: "VIN Barcode", description: "Show scannable VIN barcode on addendum", status: "active" },
  { key: "feature_product_icons", label: "Product Icons", description: "Show category icons next to products on the addendum", status: "active" },
  { key: "feature_product_rules", label: "Product Rules", description: "Auto-assign products based on vehicle Year/Make/Model/Trim", status: "active" },
  { key: "feature_buyers_guide", label: "Buyers Guide", description: "Generate FTC-aligned Buyers Guides (As-Is / Implied / Warranty)", status: "active" },
  { key: "feature_spanish_buyers_guide", label: "Spanish Buyers Guide", description: "Enable Spanish language option for Buyers Guides (FTC-canonical translation per 16 CFR Part 455)", status: "active" },
  { key: "feature_multilang_buyers_guide", label: "Multilang Buyers Guide", description: "Enable Vietnamese / Korean / Chinese options for the FTC Buyers Guide. Dealer-courtesy translations for the California market — verify each language reads correctly for your customer base before enabling.", status: "active" },
  { key: "feature_lead_capture", label: "Lead Capture", description: "Capture customer name, phone, and email when sending QR signing links", status: "active" },
  { key: "feature_cobuyer_signature", label: "Co-Buyer Signature", description: "Show co-buyer signature pad on the addendum", status: "active" },
  { key: "feature_ink_saving", label: "Ink-Saving Mode", description: "Show ink-saving toggle for lighter print output", status: "active" },
  { key: "feature_url_scrape", label: "Website URL Import", description: "Paste a vehicle listing URL from your website to auto-fill vehicle details (VIN, stock #, mileage, color, price)", status: "active" },
  { key: "feature_custom_branding", label: "Custom Branding", description: "Use custom dealer logo and branding on addendums", status: "active" },
  { key: "feature_inventory", label: "Inventory Management", description: "Import and manage vehicle inventory via CSV or manual entry", status: "active" },
  { key: "feature_invoicing", label: "Installer Invoicing", description: "Create and manage invoices for product installations with RO/PO numbers", status: "active" },
  { key: "feature_warranty", label: "Warranty Tracking", description: "Track product warranty registrations and expirations", status: "active" },
  { key: "feature_analytics", label: "Analytics Dashboard", description: "View addendum stats, product acceptance rates, and revenue metrics", status: "active" },
  // Beta — UI surfaces exist but the underlying integration is partial.
  // Leave the toggle visible so a dealer can opt in once the secret is
  // wired, but mark it BETA so nobody thinks it's already live.
  { key: "feature_sms", label: "SMS Delivery", description: "Send signing links by text message. Contact support to enable for your store.", status: "beta" },
  { key: "feature_blackbook", label: "Black Book Data", description: "Pull factory equipment and live market data from Black Book. Contact support to enable for your store.", status: "beta" },
  // Coming soon — no functional consumer yet. Hidden from the
  // Feature Toggles list entirely until the underlying feature
  // ships, so the panel only shows switches that actually do
  // something. The settings keys stay on DealerSettings so any
  // stored values survive untouched.
  { key: "feature_payroll", label: "Payroll Tracking", description: "Track installer piece-work pay per invoice", status: "coming_soon" },
  { key: "feature_ai_descriptions", label: "AI Descriptions", description: "Generate vehicle descriptions automatically", status: "coming_soon" },
];

const VALID_TABS: AdminTab[] = ADMIN_TABS;

const Admin = ({ embedded = false, legacyTab }: { embedded?: boolean; legacyTab?: AdminTab } = {}) => {
  const { user, isAdmin, loading, signOut } = useAuth();
  const { settings, updateSettings, loading: settingsLoading } = useDealerSettings();
  const { entries: auditEntries, exportCsv: exportAuditCsv } = useAudit();
  const { currentStore, updateTenant, tenant } = useTenant();

  // Doc-fee recalculation is no longer a side effect of settings state. It is
  // an explicit Review & Apply step on Pricing & Products; opening, reloading
  // or switching store in Admin never writes a vehicle price.
  const navigate = useNavigate();
  const { openScan } = useVinScan();
  const { member, loading: entitlementsLoading } = useEntitlements();
  const role = member?.role;
  const [searchParams, setSearchParams] = useSearchParams();

  // Read tab from URL ?tab= and keep in sync
  const urlTab = searchParams.get("tab") as AdminTab | null;
  const [tabState, setTabState] = useState<AdminTab>(urlTab && VALID_TABS.includes(urlTab) ? urlTab : "home");
  // A tab the role can't see falls back to its first permitted tab, mirroring
  // the unknown-tab handling above.
  const tab: AdminTab = legacyTab ?? (canSeeAdminTab(role, tabState, isAdmin)
    ? tabState
    : (firstPermittedAdminTab(role, isAdmin) ?? "home"));

  const setTab = (t: AdminTab) => {
    setTabState(t);
    setSearchParams({ tab: t }, { replace: true });
  };

  // Sync tab from URL changes (sidebar links, back/forward)
  useEffect(() => {
    const paramTab = searchParams.get("tab") as AdminTab | null;
    if (paramTab && VALID_TABS.includes(paramTab) && paramTab !== tabState) {
      setTabState(paramTab);
    }
  }, [searchParams]);

  // Retired tab ids stay valid so old deep links resolve, but their content
  // now lives on standalone screens — redirect instead of rendering here.
  useEffect(() => {
    if (legacyTab) return;
    if (tab === "inventory") navigate("/inventory", { replace: true });
    else if (tab === "analytics") navigate("/dashboard/reports?tab=analytics", { replace: true });
    else if (tab === "funnel") navigate("/dashboard/reports?tab=signings", { replace: true });
    else if (tab === "leads") navigate("/leads", { replace: true });
    else if (tab === "queue") navigate("/queue", { replace: true });
  }, [tab, navigate, legacyTab]);

  // Command-palette deep links carry ?panel=<anchor>; scroll to the card once
  // the tab body has rendered. Presentation-only.
  const panelParam = searchParams.get("panel");
  useEffect(() => {
    if (!panelParam) return;
    const t = setTimeout(() => {
      document.getElementById(panelParam)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(t);
  }, [panelParam, tab]);

  // Leads count for the home KPI (the lead workspace itself lives at /leads)
  const { leads } = useLeads(currentStore?.id || "");

  // Vehicle files for compliance tracking
  const { files: vehicleFiles, stats: fileStats, findByVin, isError: vehicleFilesFailed, loading: vehicleFilesLoading } = useVehicleFiles(currentStore?.id || "");
  const [fileSearch, setFileSearch] = useState("");

  // Get-Ready pending count for the home KPI. The service catalog and prep
  // sign-off rules are edited on Documents & Service > Service policy.
  const { getPending: getPendingGetReady } = useGetReady(currentStore?.id || "");

  // Warranty
  const { records: warrantyRecords, getExpiringSoon } = useWarranty(currentStore?.id || "");
  const expiringSoon = getExpiringSoon(30);

  // Additional integrations
  const { pushFeed, pushing: syndicating } = useSyndicationFeed();
  const { stickers: serviceStickers } = useServiceSticker();
  const { getConfig: getDmsConfig, syncInventory, syncing: dmsSyncing } = useDmsFeed();
  const { getPending: getPendingTradeIns } = useTradeInLifecycle();

  const [products, setProducts] = useState<Product[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showComplianceBanner, setShowComplianceBanner] = useState<boolean>(
    typeof window !== "undefined" ? localStorage.getItem("admin_home_compliance_banner_dismissed") !== "1" : true
  );



  const [isTenantManager, setIsTenantManager] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setIsTenantManager(false); return; }
      if (isAdmin) { setIsTenantManager(true); return; }
      if (!tenant?.id || tenant.id === "house") { setIsTenantManager(false); return; }
      const { data } = await supabase.rpc("is_tenant_manager", { _tenant_id: tenant.id, _user_id: user.id });
      if (!cancelled) setIsTenantManager(Boolean(data));
    })();
    return () => { cancelled = true; };
  }, [user, isAdmin, tenant?.id]);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/login"); return; }
    if (isTenantManager === false) { navigate("/dashboard"); }
  }, [user, isAdmin, loading, isTenantManager, navigate]);

  const fetchProducts = async () => {
    const { data } = await supabase
      .from("products")
      .select("*")
      .order("sort_order");
    if (data) setProducts(data as any);
    setFetching(false);
  };

  useEffect(() => { fetchProducts(); }, []);

  const handleToggleFeature = (key: keyof DealerSettings) => {
    updateSettings({ [key]: !settings[key] });
  };

  // Wait for the member row too — the tab filter needs the role before it can
  // decide which tabs exist, otherwise deep links flash the wrong tab.
  if (loading || fetching || entitlementsLoading) {
    if (embedded) return <div className="h-40 rounded-[10px] border border-border bg-card animate-pulse" aria-busy="true" aria-label="Loading" />;
    return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading...</p></div>;
  }

  const tabs: { id: AdminTab; label: string; group?: "dealer" | "platform" }[] = ([
    { id: "home", label: "Home" },
    { id: "settings", label: "Store Settings" },
    { id: "branding", label: "Branding" },
    { id: "labels", label: "Label Templates" },
    { id: "merchandising-seo", label: "Merchandising & SEO" },
    { id: "passport-ctas", label: "Passport Buttons" },
    { id: "passport-trust", label: "Why Buy From Us" },
    { id: "passport-routing", label: "Lead Routing" },
    { id: "print-settings", label: "Printer Calibration" },
    { id: "document-rules", label: "Approval & Review Rules" },
    { id: "features", label: "Plan & Billing" },
    { id: "getready", label: "Get-Ready Setup" },
    ...(settings.feature_invoicing ? [{ id: "invoices" as const, label: "Invoices" }] : []),
    ...(settings.feature_warranty ? [{ id: "warranty" as const, label: "Warranty Records" }] : []),
    { id: "files", label: "Vehicle Files" },
    { id: "audit", label: "Audit Log" },
    { id: "team", label: "Team" },
    // Platform-admin tabs moved to /platform-admin.
  ] as { id: AdminTab; label: string; group?: "dealer" | "platform" }[])
    .filter((t) => canSeeAdminTab(role, t.id, isAdmin));

  return (
    <div className={embedded ? "" : "max-w-6xl mx-auto"}>
        {/* Page header — clean light surface, no gradient. Hidden when the V2
            shell embeds this body: the shell owns the title and navigation. */}
        {!embedded && (
        <div className="px-6 lg:px-10 pt-8 pb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-border">
          <div>
            <div className="inline-flex items-center gap-1.5 text-al-meta font-bold uppercase tracking-label text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Control Center
            </div>
            <h1 className="text-al-page mt-2 lg: font-display leading-tight text-foreground">
              Administration
            </h1>
            <p className="text-xs lg:text-sm text-muted-foreground mt-1 max-w-xl">
              Manage products, compliance, analytics, and integrations for{" "}
              <span className="font-semibold text-foreground">
                {currentStore?.name || "your store"}
              </span>.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="px-3 py-1.5 rounded-lg bg-muted border border-border text-al-meta font-semibold uppercase tracking-label text-muted-foreground">
              FTC-aligned · 50-state engine
            </div>
          </div>
        </div>
        )}

        <div className={embedded ? "" : "p-4 lg:p-6"}>

        {/* Grouped section nav. Collapses the flat tab set into ~6 groups a
            manager uses (+ Advanced). Each group maps to existing ?tab= keys,
            so every deep link still resolves; this is a presentation layer only. */}
        {!embedded && (() => {
          const labelFor = (id: AdminTab) => tabs.find((t) => t.id === id)?.label || id;
          const availIds = new Set(tabs.map((t) => t.id));
          const groupDefs: { id: string; label: string; ids: AdminTab[] }[] = [
            { id: "home", label: "Home", ids: ["home"] },
            { id: "store", label: "Store", ids: ["settings", "branding", "team", "features", "getready"] },
            { id: "pricing", label: "Pricing", ids: ["incentives"] },
            { id: "products", label: "Products & Programs", ids: ["products", "rules", "programs", "factory-warranty"] },
            { id: "passport", label: "Customer Passport", ids: ["passport-ctas", "passport-trust", "passport-routing"] },
            { id: "merchandising", label: "Merchandising & SEO", ids: ["merchandising-seo"] },
            { id: "printing", label: "Printing & Documents", ids: ["labels", "print-settings", "document-rules", "invoices"] },
            { id: "compliance", label: "Compliance", ids: ["audit", "files", "warranty"] },
          ];
          const groups = groupDefs
            .map((g) => ({ ...g, ids: g.ids.filter((id) => availIds.has(id)) }))
            .filter((g) => g.ids.length > 0);
          const activeGroup = groups.find((g) => g.ids.includes(tab)) || groups[0];
          return (
            <div className="mb-4 space-y-2">
              <div className="overflow-x-auto">
                <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1">
                  {groups.map((g) => {
                    const active = g.id === activeGroup?.id;
                    return (
                      <button
                        key={g.id}
                        onClick={() => setTab(g.ids[0])}
                        className={`h-8 px-3.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {activeGroup && activeGroup.ids.length > 1 && (
                <div className="overflow-x-auto">
                  <div className="inline-flex items-center gap-1">
                    {activeGroup.ids.map((id) => (
                      <button
                        key={id}
                        onClick={() => setTab(id)}
                        className={`h-7 px-3 rounded-md text-[12px] font-semibold whitespace-nowrap transition-colors ${id === tab ? "bg-blue-50 text-[#2563EB]" : "text-muted-foreground hover:bg-muted"}`}
                      >
                        {labelFor(id)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ─── Home Tab ─── */}
        {tab === "home" && (() => {
          const now = new Date();
          const hour = now.getHours();
          const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
          const displayName = user?.email ? user.email.split("@")[0] : "Dealer";
          const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

          // This month's addendums = stickers printed since firstDayOfMonth
          const thisMonthAddendums = vehicleFiles.reduce(
            (sum, f) => sum + f.stickers.filter(s => s.printed_at && new Date(s.printed_at) >= firstDayOfMonth).length,
            0
          );
          const lastMonthAddendums = vehicleFiles.reduce(
            (sum, f) =>
              sum +
              f.stickers.filter(s => {
                if (!s.printed_at) return false;
                const d = new Date(s.printed_at);
                return d >= firstDayLastMonth && d <= lastDayLastMonth;
              }).length,
            0
          );
          const addendumDelta = lastMonthAddendums > 0
            ? Math.round(((thisMonthAddendums - lastMonthAddendums) / lastMonthAddendums) * 100)
            : null;

          const pendingGetReadyCount = getPendingGetReady().length;
          const recentLeadsCount = leads.filter(l => l.captured_at && new Date(l.captured_at) >= thirtyDaysAgo).length;
          const warrantyAlertsCount = expiringSoon.length;

          // Setup checklist predicates
          const brandedOk = !!settings.dealer_logo_url && !!settings.dealer_name && !!settings.dealer_tagline;
          const productsOk = products.length >= 4;
          const docFeeOk = !!settings.doc_fee_enabled && !!settings.doc_fee_state;
          const firstStickerOk = fileStats.totalFiles > 0;
          const addendumSignedOk = auditEntries.some(e => e.action === "addendum_signed");
          const portalPublishedOk = fileStats.totalFiles > 0;

          const checklist: { key: string; label: string; done: boolean; cta: string; onClick: () => void }[] = [
            { key: "brand", label: "Brand your stickers", done: brandedOk, cta: "Open Branding", onClick: () => setTab("branding") },
            { key: "products", label: "Add your products", done: productsOk, cta: "Manage Products", onClick: () => setTab("products") },
            { key: "docfee", label: "Set your doc fee", done: docFeeOk, cta: "Open Settings", onClick: () => setTab("settings") },
            { key: "print", label: "Print your first sticker", done: firstStickerOk, cta: "Open Lot", onClick: () => navigate("/dashboard") },
            { key: "addendum", label: "Capture a signed addendum", done: addendumSignedOk, cta: "Create Addendum", onClick: () => navigate("/addendum") },
            {
              key: "portal",
              label: "Publish your shopper portal link",
              done: portalPublishedOk,
              cta: "Copy embed code",
              onClick: () => {
                const embed = `<iframe src="${window.location.origin}/v/${currentStore?.slug || "demo"}" width="100%" height="900" frameborder="0"></iframe>`;
                navigator.clipboard.writeText(embed);
                toast.success("Embed code copied");
              },
            },
          ];
          const completedCount = checklist.filter(c => c.done).length;
          const progressPct = Math.round((completedCount / checklist.length) * 100);

          const quickActions: { icon: typeof FileText; title: string; subtitle: string; onClick: () => void }[] = [
            { icon: ScanLine, title: "Scan VIN", subtitle: "Camera on phone/tablet, QR hand-off on desktop", onClick: openScan },
            { icon: FileSignature, title: "Build Addendum", subtitle: "Create a signable addendum", onClick: () => navigate("/addendum") },
            { icon: Sparkles, title: "OEM Window Sticker Studio", subtitle: "Manufacturer-style reproduction", onClick: () => navigate("/window-sticker-studio") },
            { icon: Sparkles, title: "Inventory Intelligence", subtitle: "Pipeline state per document family", onClick: () => navigate("/inventory-intelligence") },
            { icon: Car, title: "Used Car Sticker", subtitle: "Addendum for used inventory", onClick: () => navigate("/used-car-sticker") },
            { icon: ShieldCheck, title: "Compliance Center", subtitle: "Audit trail and regs", onClick: () => navigate("/compliance") },
          ];

          const recentActivity = auditEntries.slice(-10).reverse();

          return (
            <div className="space-y-6">
              {/* Compliance Banner */}
              {showComplianceBanner && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 text-xs text-amber-900">
                    <strong className="font-semibold">California SB 766 takes effect October 1, 2026.</strong>{" "}
                    Make sure your multi-language addendums are on.{" "}
                    <button
                      onClick={() => navigate("/compliance")}
                      className="underline font-semibold hover:text-amber-700"
                    >
                      Learn more
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setShowComplianceBanner(false);
                      localStorage.setItem("admin_home_compliance_banner_dismissed", "1");
                    }}
                    className="text-amber-700 hover:text-amber-900 text-xs font-medium flex-shrink-0"
                    aria-label="Dismiss"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Welcome Banner */}
              <div className="bg-card rounded-xl border border-border shadow-premium p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-xl font-semibold text-foreground font-display">
                      {greeting}, {displayName} — {currentStore?.name || "Your store"}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(now, "EEEE, MMMM d, yyyy")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 min-w-[200px]">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ListChecks className="w-3.5 h-3.5" />
                      <span>Setup checklist — {completedCount}/{checklist.length}</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{progressPct}% complete</span>
                  </div>
                </div>
              </div>

              {/* Setup Checklist */}
              <div className="bg-card rounded-xl border border-border shadow-premium p-5">
                <div className="flex items-center gap-2 mb-3">
                  <ListChecks className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-foreground">Setup checklist</h3>
                </div>
                <div className="space-y-2">
                  {/* Wave 15.2 — completed items visually retreat
                      to 60% opacity so the dealer's eye lands on
                      the open TODOs first. Stripe/Linear pattern:
                      retired rows recede, action rows lead. The
                      open rows also get a subtle white card +
                      slightly stronger shadow so they pop. */}
                  {checklist.map(item => (
                    <div
                      key={item.key}
                      className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                        item.done
                          ? "border-border/60 opacity-60 hover:opacity-90"
                          : "border-border bg-card shadow-sm hover:bg-muted/20"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {item.done ? (
                          <Check className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                        ) : (
                          <Circle className="w-5 h-5 text-muted-foreground/50 flex-shrink-0" />
                        )}
                        <span className={`text-sm ${item.done ? "text-muted-foreground line-through" : "text-foreground font-semibold"}`}>
                          {item.label}
                        </span>
                      </div>
                      <button
                        onClick={item.onClick}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border transition-colors flex-shrink-0 ${
                          item.done
                            ? "border-border text-muted-foreground hover:bg-muted"
                            : "border-border bg-card hover:bg-muted"
                        }`}
                      >
                        {item.key === "portal" ? <Copy className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        {item.cta}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* This month's addendums */}
                <button
                  onClick={() => setTab("files")}
                  className="text-left bg-card rounded-xl border border-border shadow-premium p-4 hover:shadow-md transition-shadow"
                >
                  <p className="text-al-meta font-semibold uppercase tracking-label" style={{ color: "#3BB4FF" }}>
                    This month's addendums
                  </p>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-4xl font-bold tabular-nums text-foreground">{thisMonthAddendums}</span>
                    {addendumDelta !== null && (
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          addendumDelta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                        }`}
                      >
                        {addendumDelta >= 0 ? "+" : ""}{addendumDelta}%
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">vs last month</p>
                </button>

                {/* Pending get-ready */}
                <button
                  onClick={() => navigate("/prep?view=installs")}
                  className="text-left bg-card rounded-xl border border-border shadow-premium p-4 hover:shadow-md transition-shadow"
                >
                  <p className="text-al-meta font-semibold uppercase tracking-label" style={{ color: "#F59E0B" }}>
                    Pending get-ready
                  </p>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-4xl font-bold tabular-nums text-foreground">{pendingGetReadyCount}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">awaiting prep/install before sale</p>
                </button>

                {/* Leads (30 days) */}
                <button
                  onClick={() => navigate("/leads")}
                  className="text-left bg-card rounded-xl border border-border shadow-premium p-4 hover:shadow-md transition-shadow"
                >
                  <p className="text-al-meta font-semibold uppercase tracking-label" style={{ color: "#10B981" }}>
                    Leads (30 days)
                  </p>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-4xl font-bold tabular-nums text-foreground">{recentLeadsCount}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">captured from QR &amp; portal</p>
                </button>

                {/* Warranty alerts (30 days) */}
                <button
                  onClick={() => setTab("warranty")}
                  className="text-left bg-card rounded-xl border border-border shadow-premium p-4 hover:shadow-md transition-shadow"
                >
                  <p className="text-al-meta font-semibold uppercase tracking-label" style={{ color: "#DC2626" }}>
                    Warranty alerts
                  </p>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-4xl font-bold tabular-nums text-foreground">{warrantyAlertsCount}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">expiring in the next 30 days</p>
                </button>
              </div>

              {/* Quick Actions */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <PlayCircle className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-foreground">Quick actions</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {quickActions.map((a) => (
                    <button
                      key={a.title}
                      onClick={a.onClick}
                      className="text-left rounded-xl border border-border bg-card p-4 hover:shadow-premium transition-shadow"
                    >
                      <a.icon className="w-5 h-5 text-blue-600 mb-2" />
                      <p className="text-sm font-semibold text-foreground">{a.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{a.subtitle}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-card rounded-xl border border-border shadow-premium p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-semibold text-foreground">Recent activity</h3>
                  </div>
                  <button
                    onClick={() => setTab("audit")}
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    View all
                  </button>
                </div>
                {recentActivity.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">
                    No activity yet. Create and sign your first addendum to see it here.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {recentActivity.map(e => (
                      <div key={e.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground capitalize truncate">
                            {e.action.replace(/_/g, " ")}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {e.entity_type}{e.entity_id ? ` · ${e.entity_id.slice(0, 8)}` : ""}
                          </p>
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0 ml-3">
                          {format(new Date(e.created_at), "MMM d, h:mm a")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ─── Feature Toggles Tab ─── */}
        {tab === "settings" && (
          <div>
            <div className="bg-card rounded-lg p-4 shadow-sm mb-4">
              <h3 className="text-sm font-bold text-foreground mb-1">Optional Features</h3>
              <p className="text-xs text-muted-foreground">
                Turn features on or off for your dealership. Disabled features won't appear on the employee-facing addendum, keeping the interface clean and focused.
              </p>
            </div>

            {/* Addendum paper size moved to Documents & Service > Templates. */}

            {/* Product Default Mode */}
            <div id="product-default-mode" className="bg-card rounded-lg p-4 shadow-sm mb-3">
              <h4 className="text-sm font-bold text-foreground mb-2">Product Default Mode</h4>
              <p className="text-xs text-muted-foreground mb-3">Choose how products appear on every addendum by default. Employees can override per-product at signing if enabled.</p>
              <div className="flex gap-2 flex-wrap">
                {(["selective", "all_installed", "all_optional"] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => updateSettings({ product_default_mode: mode })}
                    className={`text-xs px-3 py-1.5 rounded border ${settings.product_default_mode === mode ? "bg-navy text-primary-foreground border-navy" : "bg-card text-foreground border-border-custom"}`}
                  >
                    {mode === "selective" && "Selective (per product)"}
                    {mode === "all_installed" && "All as Installed"}
                    {mode === "all_optional" && "All as Optional"}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-custom">
                <div>
                  <p className="text-sm font-semibold text-foreground">Allow Type Override at Signing</p>
                  <p className="text-xs text-muted-foreground">Employee can toggle installed ↔ optional live with the customer</p>
                </div>
                <Switch
                  checked={!!settings.allow_type_override_at_signing}
                  onCheckedChange={(v) => updateSettings({ allow_type_override_at_signing: v })}
                  className="data-[state=checked]:bg-teal"
                />
              </div>
            </div>

            {/* Doc fee + customer price display + comps + Today's Price moved
                to the Pricing & Incentives tab (?tab=incentives). */}

            {/* Title / MCO, recon approval and the customer-signing gates are
                edited on Documents & Service > Service policy. */}

            {/* Shopper engagement loop */}
            <div id="shopper-engagement" className="bg-card rounded-lg p-4 shadow-premium mb-3">
              <h4 className="text-sm font-bold text-foreground mb-1">Shopper Engagement</h4>
              <p className="text-xs text-muted-foreground mb-3">Get alerted when a shopper opens a vehicle packet, and automatically re-engage shoppers by email when a price drops.</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Email me when a packet is viewed</span>
                  <Switch checked={!!settings.view_notify_enabled} onCheckedChange={(v) => updateSettings({ view_notify_enabled: v })} className="data-[state=checked]:bg-teal" />
                </div>
                {settings.view_notify_enabled && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Alert recipient(s)</label>
                    <textarea
                      value={settings.view_notify_email || ""}
                      onChange={(e) => updateSettings({ view_notify_email: e.target.value })}
                      rows={2}
                      placeholder="sales@dealership.com, bdc@dealership.com"
                      className="w-full px-3 py-2 border border-border-custom rounded text-sm resize-none"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">One alert per shopper visit (deduped per session) so you're not buried by refreshes or scrapers.</p>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Let shoppers watch for price drops</span>
                  <Switch checked={settings.price_drop_watch_enabled !== false} onCheckedChange={(v) => updateSettings({ price_drop_watch_enabled: v })} className="data-[state=checked]:bg-teal" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Send price-drop re-engagement emails</span>
                  <Switch checked={settings.price_drop_emails_enabled !== false} onCheckedChange={(v) => updateSettings({ price_drop_emails_enabled: v })} className="data-[state=checked]:bg-teal" />
                </div>
                <p className="text-[11px] text-muted-foreground">When the advertised price falls, watchers get one email per drop with the new price and a link back to the packet.</p>
              </div>
            </div>

            {/* Nightly-ingest automation */}
            <div id="feed-automation" className="bg-card rounded-lg p-4 shadow-premium mb-3">
              <h4 className="text-sm font-bold text-foreground mb-1">Feed Automation</h4>
              <p className="text-xs text-muted-foreground mb-3">When a new vehicle is ingested overnight, choose what fires automatically vs. what waits for a person to send it.</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="pr-3">
                    <span className="text-sm font-semibold text-foreground">Auto-publish customer passport on intake</span>
                    <p className="text-xs text-muted-foreground">No prep gate at intake — the passport goes live immediately. Recon, K-208, and installs happen afterward.</p>
                  </div>
                  <Switch
                    checked={settings.ingest_auto_publish !== false}
                    onCheckedChange={(v) => {
                      if (v && !window.confirm("Auto-publish puts the customer passport live the moment a vehicle is ingested, before recon, K-208, or installs are done. Enable it?")) return;
                      updateSettings({ ingest_auto_publish: v });
                    }}
                    className="data-[state=checked]:bg-teal"
                  />
                </div>
                <div>
                  <span className="text-sm font-semibold text-foreground">Recon estimate</span>
                  <div className="flex gap-2 mt-1.5">
                    {(["manual", "auto"] as const).map((m) => (
                      <button key={m} onClick={() => updateSettings({ ingest_recon_dispatch: m })}
                        className={`flex-1 h-9 rounded-lg text-xs font-semibold border ${settings.ingest_recon_dispatch === m ? "border-primary bg-primary/10 text-primary" : "border-border-custom text-foreground"}`}>
                        {m === "manual" ? "Manager sends it" : "Auto-send on ingest"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-sm font-semibold text-foreground">Detail get-ready</span>
                  <div className="flex gap-2 mt-1.5">
                    {(["manual", "auto"] as const).map((m) => (
                      <button key={m} onClick={() => updateSettings({ ingest_detail_dispatch: m })}
                        className={`flex-1 h-9 rounded-lg text-xs font-semibold border ${settings.ingest_detail_dispatch === m ? "border-primary bg-primary/10 text-primary" : "border-border-custom text-foreground"}`}>
                        {m === "manual" ? "Send manually" : "Auto-send on ingest"}
                      </button>
                    ))}
                  </div>
                  <input
                    value={settings.detail_email || ""}
                    onChange={(e) => updateSettings({ detail_email: e.target.value })}
                    placeholder="Detail shop email(s) — comma separated (up to 3)"
                    className="w-full mt-2 px-3 py-2 border border-border-custom rounded text-sm"
                  />
                  <textarea
                    value={settings.detail_default_instructions || ""}
                    onChange={(e) => updateSettings({ detail_default_instructions: e.target.value })}
                    rows={2}
                    placeholder="Standing instructions sent to the detail shop (optional)"
                    className="w-full mt-2 px-3 py-2 border border-border-custom rounded text-sm resize-none"
                  />
                </div>
                <div className="border border-border-custom rounded-xl p-3">
                  <span className="text-sm font-semibold text-foreground">Service work order (K-208)</span>
                  <p className="text-xs text-muted-foreground mt-0.5">When set, accepting an addendum also sends the service department its own work order — scoped to the safety inspection, never the detail sheet.</p>
                  <input
                    value={settings.service_email || ""}
                    onChange={(e) => updateSettings({ service_email: e.target.value })}
                    placeholder="Service dept email(s) — comma separated (up to 3)"
                    className="w-full mt-2 px-3 py-2 border border-border-custom rounded text-sm"
                  />
                  <textarea
                    value={settings.service_default_instructions || ""}
                    onChange={(e) => updateSettings({ service_default_instructions: e.target.value })}
                    rows={2}
                    placeholder="Standing instructions sent to the service department (optional)"
                    className="w-full mt-2 px-3 py-2 border border-border-custom rounded text-sm resize-none"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Auto-notify third-party installers on preinstall</span>
                  <Switch checked={settings.thirdparty_auto_notify !== false} onCheckedChange={(v) => updateSettings({ thirdparty_auto_notify: v })} className="data-[state=checked]:bg-teal" />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-foreground">Get-Ready drives the addendum</span>
                    <p className="text-xs text-muted-foreground mt-0.5">When a Get-Ready install is signed off with a photo, mark that product Installed on the addendum and move the rest to optional. Leave off if your advertised price already includes every add-on.</p>
                  </div>
                  <Switch checked={settings.getready_drives_addendum === true} onCheckedChange={(v) => updateSettings({ getready_drives_addendum: v })} className="data-[state=checked]:bg-teal" />
                </div>
                <InstallerContactsCard />
              </div>
            </div>

            {/* Integrations status */}
            <div id="integrations" className="bg-card rounded-lg p-4 shadow-premium mb-3">
              <h4 className="text-sm font-bold text-foreground mb-2">Integration Status</h4>
              <p className="text-xs text-muted-foreground mb-3">Optional services that power scraping, SMS, and AI. Contact AutoLabels support to turn these on for your store.</p>
              <div className="space-y-2 text-xs">
                <IntegrationRow label="AI Descriptions (Claude)" secretKey="ANTHROPIC_API_KEY" feature={settings.feature_ai_descriptions} />
                <IntegrationRow label="Email Distribution" secretKey="RESEND_API_KEY or SENDGRID_API_KEY" feature={settings.feature_sms} />
                <IntegrationRow label="SMS (Signal House)" secretKey="SIGNALHOUSE_API_KEY" feature={settings.feature_sms} />
                <IntegrationRow label="OEM Build Sheet (DataOne)" secretKey="DATAONE_API_KEY" feature={false} />
                <IntegrationRow label="Black Book Market Data" secretKey="BLACKBOOK_API_KEY" feature={settings.feature_blackbook} />
                <IntegrationRow label="Zebra CloudPrint" secretKey="ZEBRA_API_KEY" feature={false} />
                <IntegrationRow label="Photo Background Removal" secretKey="REMOVEBG_API_KEY" feature={false} />
              </div>
            </div>

            {/* Feature Toggle list — coming_soon entries hidden so the
                panel only shows switches that actually do something. */}
            <div id="feature-toggles" className="space-y-2">
              {FEATURE_TOGGLES.filter(ft => ft.status !== "coming_soon").map((ft) => (
                <div key={ft.key} className="bg-card rounded-lg p-4 shadow-sm flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground inline-flex items-center gap-1.5">
                      {ft.label}
                      {ft.status === "beta" && (
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Beta
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{ft.description}</p>
                  </div>
                  <Switch
                    checked={!!(settings[ft.key] as boolean)}
                    onCheckedChange={() => handleToggleFeature(ft.key)}
                    className="flex-shrink-0 ml-3 data-[state=checked]:bg-teal"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Branding Tab ─── */}
        {tab === "merchandising-seo" && <MerchandisingSeoPanel />}

        {tab === "passport-ctas" && (
          <div className="space-y-5">
            <PacketDefaultsPanel />
            <OemDistributionPanel />
            <PassportPublishingCard />
            <StickyButtonsPanel />
          </div>
        )}
        {tab === "passport-trust" && <DealershipTrustPanel />}
        {tab === "passport-routing" && <PassportContactRoutingPanel />}

        {/* Analytics + Deal Signings live at /dashboard/reports; Leads at
            /leads; the VIN print queue at /queue. Their ?tab= ids redirect. */}

        {/* ─── Invoices Tab ─── */}
        {tab === "invoices" && <InstallerInvoicesPanel />}

        {/* ─── Warranty Tab ─── */}
        {tab === "warranty" && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Warranty Tracking</h3>
            <p className="text-xs text-muted-foreground">Track product warranty registrations and expirations.</p>
            {expiringSoon.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-amber-800">{expiringSoon.length} warranty(ies) expiring within 30 days</p>
                {expiringSoon.map(w => (
                  <p key={w.id} className="text-xs text-amber-700 mt-1">{w.product_name} — {w.vehicle_ymm} ({w.customer_name}) expires {w.warranty_end}</p>
                ))}
              </div>
            )}
            <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
              <div className="px-5 py-2.5 bg-muted/30 text-al-meta font-semibold uppercase tracking-wider text-muted-foreground">{warrantyRecords.length} warranties</div>
              {warrantyRecords.length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-muted-foreground">No warranty records yet. Warranties are registered when products with warranty info are installed.</p>
              ) : warrantyRecords.slice(0, 20).map(w => (
                <div key={w.id} className="px-5 py-3 border-b border-border last:border-0 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{w.product_name}</p>
                    <p className="text-xs text-muted-foreground">{w.vehicle_ymm} · {w.customer_name} · {w.provider}</p>
                    <p className="text-[10px] text-muted-foreground">{w.warranty_start} → {w.warranty_end}</p>
                  </div>
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    w.status === "active" ? "bg-emerald-50 text-emerald-700" :
                    w.status === "expired" ? "bg-red-50 text-red-700" :
                    "bg-muted text-muted-foreground"
                  }`}>{w.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Vehicle Files Tab ─── */}
        {tab === "files" && (
          <div className="space-y-4">
            {/* Wave 22 — feed health surfaces the cross-app
                inventory contract above the file index so a
                dealer who notices "I'm missing rows" can check
                the pull status without leaving this tab. */}
            <InventoryFeedHealth />

            {/* Per-vehicle ingest outcome sits directly under feed health: the
                feed answers "did the row arrive", this answers "did anything
                actually get produced for it, and if not, why". */}
            <IngestOutcomePanel />

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-foreground">Vehicle Files</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Every stickered vehicle has a permanent compliance file with tracking codes, signing links, and audit trail.
                </p>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatMini icon={Car} label="Total Vehicles" value={fileStats.totalFiles} color="text-blue-600" />
              <StatMini icon={Printer} label="Total Stickers" value={fileStats.totalStickers} color="text-purple-600" />
              <StatMini icon={Clock} label="Pending Sign" value={fileStats.pendingSign} color="text-amber-600" />
              <StatMini icon={CheckCircle2} label="Signed" value={fileStats.signed} color="text-emerald-600" />
              <StatMini icon={FileText} label="Delivered" value={fileStats.delivered} color="text-blue-600" />
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm" aria-label="Vehicle file ownership">
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">Account total</dt>
                <dd className="text-lg font-semibold text-foreground">{vehicleFilesFailed ? "Unavailable" : fileStats.tenantTotal}</dd>
              </div>
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">Assigned to {currentStore?.name || "this store"}</dt>
                <dd className="text-lg font-semibold text-foreground">{vehicleFilesFailed ? "Unavailable" : fileStats.storeAssigned}</dd>
              </div>
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">Not assigned to a store</dt>
                <dd className="text-lg font-semibold text-foreground">{vehicleFilesFailed ? "Unavailable" : fileStats.unassigned}</dd>
              </div>
            </dl>
            {!vehicleFilesFailed && fileStats.unassigned > 0 && (
              <p role="note" className="text-xs text-muted-foreground">
                {fileStats.unassigned} older {fileStats.unassigned === 1 ? "file has" : "files have"} no store yet. {fileStats.unassigned === 1 ? "It is" : "They are"} listed below under every store until a reviewed association assigns {fileStats.unassigned === 1 ? "it" : "them"}. Signed documents, tracking codes and QR links are unchanged.
              </p>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                aria-label="Search vehicle files"
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="Search by VIN, stock #, customer name, or vehicle..."
                className="w-full h-10 pl-10 pr-3 rounded-md border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Vehicle file list */}
            <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
              {vehicleFilesFailed ? (
                <div role="alert" className="px-5 py-12 text-center">
                  <p className="text-sm font-medium text-foreground">Vehicle files could not be read</p>
                  <p className="text-xs text-muted-foreground mt-1">This is a read failure, not an empty file cabinet. Reload to try again.</p>
                </div>
              ) : vehicleFilesLoading ? (
                <div role="status" className="px-5 py-12 text-center text-sm text-muted-foreground">Loading vehicle files...</div>
              ) : vehicleFiles.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <Car className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">No vehicle files yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Scan VINs and print stickers to create vehicle files automatically.</p>
                </div>
              ) : (
                (() => {
                  const q = fileSearch.toLowerCase();
                  const filtered = vehicleFiles.filter(f => {
                    if (!q) return true;
                    return (
                      f.vin.toLowerCase().includes(q) ||
                      f.stock_number.toLowerCase().includes(q) ||
                      `${f.year} ${f.make} ${f.model}`.toLowerCase().includes(q) ||
                      f.customer_name.toLowerCase().includes(q)
                    );
                  });
                  return (
                    <div>
                      <div className="px-5 py-2.5 bg-muted/30 text-al-meta font-semibold uppercase tracking-wider text-muted-foreground">
                        {filtered.length} vehicle{filtered.length !== 1 ? "s" : ""}
                      </div>
                      {filtered.map(f => {
                        const stickerCount = f.stickers.length;
                        const signedCount = f.stickers.filter(s => s.status === "signed").length;
                        const latestSticker = f.stickers[f.stickers.length - 1];
                        return (
                          <div key={f.id} className="px-5 py-4 border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-foreground truncate">
                                    {f.year} {f.make} {f.model} {f.trim}
                                  </p>
                                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                    f.deal_status === "signed" ? "bg-emerald-50 text-emerald-700" :
                                    f.deal_status === "pending_sign" ? "bg-amber-50 text-amber-700" :
                                    f.deal_status === "delivered" ? "bg-blue-50 text-blue-700" :
                                    "bg-muted text-muted-foreground"
                                  }`}>
                                    {f.deal_status.replace(/_/g, " ")}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                                  <span className="font-mono">{f.vin}</span>
                                  {f.stock_number && <span>Stock: {f.stock_number}</span>}
                                  <span>{f.mileage.toLocaleString()} mi</span>
                                  <span className="capitalize">{f.condition}</span>
                                </div>
                                {f.customer_name && (
                                  <p className="text-xs text-foreground mt-1">Customer: {f.customer_name}</p>
                                )}
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-xs text-muted-foreground">{stickerCount} sticker{stickerCount !== 1 ? "s" : ""}</p>
                                <p className="text-xs text-muted-foreground">{signedCount} signed</p>
                              </div>
                            </div>

                            {/* Sticker tracking codes */}
                            {f.stickers.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {f.stickers.map(s => (
                                  <div
                                    key={s.id}
                                    className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border ${
                                      s.status === "signed" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                                      s.status === "voided" ? "bg-red-50 border-red-200 text-red-700 line-through" :
                                      "bg-muted border-border text-foreground"
                                    }`}
                                  >
                                    <span className="font-sans text-[9px] uppercase font-semibold">
                                      {s.type.replace(/_/g, " ").replace("car ", "")}
                                    </span>
                                    {s.tracking_code}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        )}

        {/* ─── Audit Log Tab ─── */}
        {tab === "team" && <TeamPanel />}

        {tab === "features" && <EnabledFeaturesPanel />}

        {tab === "audit" && (
          <div className="space-y-4">
            {/* MarketCheck card self-hides for dealers without the grant; the
                cross-VIN price reconciliation overview stays super-admin only. */}
            <MarketcheckSyncCard />
            <MarketcheckDataHealthCard />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-foreground">Compliance Audit Log</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Immutable record of every action for FTC and state AG audit compliance.</p>
              </div>
              <div className="flex items-center gap-2">
                <AuditChainVerifier storeId={currentStore?.id || ""} />
                <button
                  onClick={() => {
                    const csv = exportAuditCsv(currentStore?.id);
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `audit-log-${currentStore?.name || "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("Audit log exported as CSV");
                  }}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
              {auditEntries.filter(e => !currentStore?.id || e.store_id === currentStore.id).length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <ShieldCheck className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">No audit events yet</p>
                  <p className="text-xs text-muted-foreground mt-1">All addendum creation, signing, printing, and changes will be logged here automatically.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr className="text-al-meta font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="text-left px-4 py-2.5">Timestamp</th>
                      <th className="text-left py-2.5">Action</th>
                      <th className="text-left py-2.5">Entity</th>
                      <th className="text-left py-2.5">ID</th>
                      <th className="text-left py-2.5">User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEntries
                      .filter(e => !currentStore?.id || e.store_id === currentStore.id)
                      .slice(-100).reverse()
                      .map(e => (
                        <tr key={e.id} className="border-t border-border hover:bg-muted/20">
                          <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">{format(new Date(e.created_at), "M/d/yy h:mm:ss a")}</td>
                          <td className="py-2.5"><span className="text-xs font-medium capitalize">{e.action.replace(/_/g, " ")}</span></td>
                          <td className="py-2.5 text-xs text-muted-foreground">{e.entity_type}</td>
                          <td className="py-2.5 text-xs font-mono text-muted-foreground truncate max-w-[120px]">{e.entity_id || "—"}</td>
                          <td className="py-2.5 text-xs text-muted-foreground truncate max-w-[120px]">{e.user_id?.slice(0, 8) || "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Platform-admin tabs moved to the dedicated /platform-admin
            route (src/pages/PlatformAdmin.tsx) so the platform bundle
            doesn't ship with every dealer page load. */}
        </div>
    </div>
  );
};

const StatMini = ({ icon: Icon, label, value, color }: { icon: typeof FileText; label: string; value: number; color: string }) => (
  <div className="bg-card rounded-xl border border-border shadow-premium p-4">
    <Icon className={`w-4 h-4 ${color} mb-2`} />
    <div className="text-2xl font-semibold tracking-tight font-display tabular-nums text-foreground">{value}</div>
    <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
  </div>
);

// Audit chain verifier. Calls verify_audit_chain(_store_id) which
// walks the hash chain on audit_log server-side and returns
// {total, verified, first_break_id, first_break_at}. All-verified
// chains read as "Chain verified"; any break points at the first
// tampered row so a regulator can see exactly where the record was
// altered.
const AuditChainVerifier = ({ storeId }: { storeId: string }) => {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; total: number; verified: number }
    | { kind: "break"; total: number; verified: number; breakId: string; breakAt: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const verify = async () => {
    setState({ kind: "loading" });
    try {
      const { data, error } = await (supabase as any).rpc("verify_audit_chain", {
        _store_id: storeId,
      });
      if (error) {
        setState({ kind: "error", message: error.message });
        toast.error("Chain check failed");
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        setState({ kind: "ok", total: 0, verified: 0 });
        return;
      }
      if (row.first_break_id) {
        setState({
          kind: "break",
          total: row.total,
          verified: row.verified,
          breakId: row.first_break_id,
          breakAt: row.first_break_at,
        });
        toast.error("Audit chain break detected");
      } else {
        setState({ kind: "ok", total: row.total, verified: row.verified });
        toast.success("Audit chain verified");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      setState({ kind: "error", message: msg });
    }
  };

  const label = (() => {
    switch (state.kind) {
      case "loading": return "Verifying…";
      case "ok":      return `Chain verified · ${state.verified}/${state.total}`;
      case "break":   return `Break at ${new Date(state.breakAt).toLocaleDateString()}`;
      case "error":   return "Check failed";
      default:        return "Verify chain";
    }
  })();

  const cls = (() => {
    switch (state.kind) {
      case "ok":    return "border-emerald-300 bg-emerald-50 text-emerald-700";
      case "break": return "border-red-300 bg-red-50 text-red-700";
      case "error": return "border-amber-300 bg-amber-50 text-amber-700";
      default:      return "border-border bg-card text-foreground hover:bg-muted";
    }
  })();

  const Icon =
    state.kind === "ok" ? CheckCircle2 :
    state.kind === "break" ? AlertTriangle :
    state.kind === "error" ? AlertTriangle :
    ShieldCheck;

  return (
    <button
      onClick={verify}
      disabled={state.kind === "loading"}
      className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm font-medium transition-colors disabled:opacity-60 ${cls}`}
      title="Run SHA-256 chain verification across every audit_log row for this store"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
};

const IntegrationRow = ({ label, feature }: { label: string; secretKey?: string; feature: boolean }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
    <div>
      <p className="font-medium text-foreground">{label}</p>
    </div>
    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${feature ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
      {feature ? "Enabled" : "Contact support"}
    </span>
  </div>
);

export default Admin;
