import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPhoto } from "@/lib/storage";
import { Switch } from "@/components/ui/switch";
import { PRICE_BUCKETS } from "@/types/product";
import { useDealerSettings, DealerSettings, DEFAULT_SETTINGS, type GetReadyService } from "@/contexts/DealerSettingsContext";
import { formatPhone } from "@/components/addendum/CustomerInfoSection";
import { useProductRules, ProductRule } from "@/hooks/useProductRules";
import type { ProductUpgrade } from "@/hooks/useProducts";
import type { Json } from "@/integrations/supabase/types";
import { useAudit } from "@/contexts/AuditContext";
import { useTenant } from "@/contexts/TenantContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { ADMIN_TABS, canSeeAdminTab, firstPermittedAdminTab, type AdminTab } from "@/lib/permissions/adminTabAccess";
import { supabase } from "@/integrations/supabase/client";
import InstallerContactsCard from "@/components/admin/InstallerContactsCard";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVinScan } from "@/contexts/VinScanContext";
import { toast } from "sonner";
import DealerProgramsPanel from "@/components/admin/DealerProgramsPanel";
import InstallerInvoicesPanel from "@/components/admin/InstallerInvoicesPanel";
import PassportPublishingCard from "@/components/admin/PassportPublishingCard";
import PacketDefaultsPanel from "@/components/admin/PacketDefaultsPanel";
import { useInstantSave } from "@/hooks/useInstantSave";
import { TODAYS_PRICE_MODE_OPTIONS, DEFAULT_TODAYS_PRICE_CUSTOM, resolveTodaysPrice } from "@/lib/todaysPrice";
import { COMP_STRATEGY_OPTIONS, type CompStrategy } from "@/lib/compStrategy";
import OemWarrantyPanel from "@/components/admin/OemWarrantyPanel";
import StickyButtonsPanel from "@/components/admin/StickyButtonsPanel";
import DealershipTrustPanel from "@/components/admin/DealershipTrustPanel";
import PassportContactRoutingPanel from "@/components/admin/PassportContactRoutingPanel";
import PrintSettingsPanel from "@/components/admin/PrintSettingsPanel";
import DocumentRulesPanel from "@/components/admin/DocumentRulesPanel";
import EnabledFeaturesPanel from "@/components/admin/EnabledFeaturesPanel";
import StickerPrintTemplates from "@/components/admin/StickerPrintTemplates";
import LabelDefaultsPanel from "@/components/admin/LabelDefaultsPanel";
import { InventoryFeedHealth } from "@/components/admin/InventoryFeedHealth";
import { AddonElectionsPanel } from "@/components/admin/AddonElectionsPanel";
import { PriceIntegrityPanel } from "@/components/admin/PriceIntegrityPanel";
import { PriceAuditPanel } from "@/components/admin/PriceAuditPanel";
import { IncentivesSettingsPanel } from "@/components/admin/IncentivesSettingsPanel";
import MarketcheckSyncCard from "@/components/admin/MarketcheckSyncCard";
import MarketcheckDataHealthCard from "@/components/admin/MarketcheckDataHealthCard";
import TeamPanel from "@/components/admin/TeamPanel";
import { ProductIcon, PRODUCT_ICON_KEYS } from "@/components/addendum/productIcons";
import { STATE_DOC_FEES } from "@/data/docFees";
import { format } from "date-fns";
import { useLeads } from "@/hooks/useLeads";
import { useVehicleFiles } from "@/hooks/useVehicleFiles";
import { useGetReady } from "@/hooks/useGetReady";
import { useWarranty } from "@/hooks/useWarranty";
import { useSyndicationFeed } from "@/hooks/useSyndicationFeed";
import { useServiceSticker } from "@/hooks/useServiceSticker";
import { useDmsFeed } from "@/hooks/useDmsFeed";
import { useProductLibrary } from "@/hooks/useProductLibrary";
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
  RotateCcw,
  Car,
  Circle,
  Check,
  Copy,
  PlayCircle,
  TrendingUp,
  ListChecks,
  AlertTriangle,
  FileSignature,
  BookOpen,
  Sparkles,
  Library,
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

const emptyProduct = {
  name: "",
  subtitle: "",
  warranty: "",
  badge_type: "installed",
  price: 0,
  price_label: "Included in Selling Price",
  disclosure: "",
  sort_order: 0,
  is_active: true,
  benefit_justification: "",
  benefit_justification_optional: "",
  disclosure_optional: "",
  price_in_advertised: true,
  available_preinstalled: true,
  upgrade: null as ProductUpgrade | null,
  contract_url: null as string | null,
  contract_doc_type: "contract",
  price_tiers: null as Record<string, number> | null,
  icon_type: "",
};

const EMPTY_UPGRADE: ProductUpgrade = {
  name: "",
  price: 0,
  disclosure: "",
  benefit_justification: "",
  disclosure_optional: "",
  benefit_justification_optional: "",
  available_preinstalled: true,
};

const emptyRule: Omit<ProductRule, "id"> = {
  product_id: "",
  year_min: "",
  year_max: "",
  makes: [],
  models: [],
  trims: [],
  body_styles: [],
  condition: "all",
  mileage_max: 0,
};

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

const Admin = () => {
  const queryClient = useQueryClient();
  const { user, isAdmin, loading, signOut } = useAuth();
  const { settings, updateSettings, loading: settingsLoading } = useDealerSettings();
  const { rules, addRule, updateRule, deleteRule } = useProductRules();
  const { entries: auditEntries, exportCsv: exportAuditCsv } = useAudit();
  const { currentStore, updateTenant, tenant } = useTenant();
  const productIconKey = `product_icons:${tenant?.id || "none"}`;

  // Auto-recalculate stored sale prices when the dealer changes their doc fee,
  // so existing inventory updates immediately instead of waiting for the next
  // sync/crawl. Debounced (the amount input fires per keystroke). Baselines the
  // fee per tenant so it never fires on initial load or a store switch — only
  // on a real change to the current tenant's doc fee.
  const docFeeSig = `${!!settings.doc_fee_enabled}:${settings.doc_fee_amount}`;
  const lastDocFee = useRef<{ tenant: string; sig: string } | null>(null);
  useEffect(() => {
    if (settingsLoading || !tenant?.id) return;
    const prev = lastDocFee.current;
    if (!prev || prev.tenant !== tenant.id) { lastDocFee.current = { tenant: tenant.id, sig: docFeeSig }; return; }
    if (prev.sig === docFeeSig) return;
    lastDocFee.current = { tenant: tenant.id, sig: docFeeSig };
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("recalc_tenant_doc_fee", { p_tenant_id: tenant.id });
      if (!error && typeof data === "number" && data > 0) {
        toast.success(`Updated ${data} vehicle${data === 1 ? "" : "s"} with the new doc fee.`);
      }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docFeeSig, tenant?.id, settingsLoading]);
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
  const tab: AdminTab = canSeeAdminTab(role, tabState, isAdmin)
    ? tabState
    : (firstPermittedAdminTab(role, isAdmin) ?? "home");

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
    if (tab === "inventory") navigate("/inventory", { replace: true });
    else if (tab === "analytics") navigate("/dashboard/reports?tab=analytics", { replace: true });
    else if (tab === "funnel") navigate("/dashboard/reports?tab=signings", { replace: true });
    else if (tab === "leads") navigate("/leads", { replace: true });
    else if (tab === "queue") navigate("/queue", { replace: true });
  }, [tab, navigate]);

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
  const { files: vehicleFiles, stats: fileStats, findByVin } = useVehicleFiles(currentStore?.id || "");
  const [fileSearch, setFileSearch] = useState("");

  // Get-Ready service catalog config (the work surface lives at /prep)
  const { getPending: getPendingGetReady } = useGetReady(currentStore?.id || "");
  const [svcDraft, setSvcDraft] = useState<GetReadyService[]>(settings.get_ready_services || []);
  const [svcOpen, setSvcOpen] = useState(false);
  useInstantSave(svcDraft, (v) => updateSettings({ get_ready_services: v }), { ready: !settingsLoading, toastId: "getready-services" });

  // Mobile prep sign-off rules (/prep/:vin). The photo-task list hydrates once
  // from async settings before instant-save arms, like the branding form.
  const prepTasksHydratedRef = useRef(false);
  const [prepTasksReady, setPrepTasksReady] = useState(false);
  const [prepPhotoTasksDraft, setPrepPhotoTasksDraft] = useState("");
  useEffect(() => {
    if (settingsLoading || prepTasksHydratedRef.current) return;
    prepTasksHydratedRef.current = true;
    setPrepTasksReady(true);
    setPrepPhotoTasksDraft(settings.prep_service_photo_tasks);
  }, [settingsLoading, settings]);
  useInstantSave(prepPhotoTasksDraft, (v) => updateSettings({ prep_service_photo_tasks: v }), { ready: prepTasksReady, toastId: "prep-rules" });

  // Warranty
  const { records: warrantyRecords, getExpiringSoon } = useWarranty(currentStore?.id || "");
  const expiringSoon = getExpiringSoon(30);

  // Additional integrations
  const { pushFeed, pushing: syndicating } = useSyndicationFeed();
  const { stickers: serviceStickers } = useServiceSticker();
  const { getConfig: getDmsConfig, syncInventory, syncing: dmsSyncing } = useDmsFeed();
  const { library: productLibrary } = useProductLibrary(currentStore?.id || "");
  const { getPending: getPendingTradeIns } = useTradeInLifecycle();

  const [products, setProducts] = useState<Product[]>([]);
  // Doc-fee edits commit on blur behind a confirm — the change recalculates
  // stored sale prices across inventory, so it must never fire per keystroke.
  const [docFeeDraft, setDocFeeDraft] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const handleUploadDoc = async (file: File) => {
    // The first path folder MUST be the tenant id so tenant-scoped storage
    // RLS can match it; never fall back to a shared prefix.
    const scope = tenant?.id || currentStore?.id;
    if (!scope) {
      toast.error("No dealership context found — reload the page and try again.");
      return;
    }
    setUploadingDoc(true);
    try {
      const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const path = `${scope}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`;
      const { error } = await supabase.storage
        .from("product-docs")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
      if (error) {
        const raw = error.message || "unknown error";
        const msg = raw.toLowerCase();
        // Surface the real Supabase error so storage problems are
        // diagnosable instead of guessed-at.
        if (msg.includes("not found") && msg.includes("bucket")) {
          toast.error("Document storage isn't set up yet. Contact AutoLabels support.");
        } else if (msg.includes("row-level security") || msg.includes("policy") || msg.includes("permission") || msg.includes("denied")) {
          toast.error("We couldn't save that file. Contact AutoLabels support.");
        } else if (msg.includes("mime") || msg.includes("content type") || msg.includes("not supported")) {
          toast.error("That file type isn't supported — upload a PDF or image.");
        } else if (msg.includes("schema") || msg.includes("incompatible")) {
          toast.error("Document storage needs attention. Contact AutoLabels support.");
        } else {
          toast.error("Upload failed. Please try again.");
        }
        return;
      }
      // Bucket is private — store the object path; resolve to a signed URL on view.
      setEditing(prev => (prev ? { ...prev, contract_url: path } : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploadingDoc(false);
    }
  };
  const [editingRule, setEditingRule] = useState<Partial<ProductRule & { _new?: boolean }> | null>(null);
  const [fetching, setFetching] = useState(true);
  const [showComplianceBanner, setShowComplianceBanner] = useState<boolean>(
    typeof window !== "undefined" ? localStorage.getItem("admin_home_compliance_banner_dismissed") !== "1" : true
  );

  // Branding form
  const [branding, setBranding] = useState({
    dealer_name: settings.dealer_name,
    dealer_tagline: settings.dealer_tagline,
    dealer_logo_url: settings.dealer_logo_url,
    primary_color: settings.primary_color,
    dealer_address: settings.dealer_address,
    dealer_city: settings.dealer_city,
    dealer_state: settings.dealer_state,
    dealer_zip: settings.dealer_zip,
    dealer_phone: settings.dealer_phone,
    dealer_principal: settings.dealer_principal,
    dealer_license_number: settings.dealer_license_number,
    dms_provider: settings.dms_provider,
    new_inventory_url: settings.new_inventory_url,
    used_inventory_url: settings.used_inventory_url,
    cargurus_url: settings.cargurus_url,
    cars_com_url: settings.cars_com_url,
    autotrader_url: settings.autotrader_url,
    capital_one_url: settings.capital_one_url,
    carfax_url: settings.carfax_url,
    vdp_price_labels: settings.vdp_price_labels,
    vdp_strip_finance_params: settings.vdp_strip_finance_params,
    why_buy_here: settings.why_buy_here,
    warranty_programs: settings.warranty_programs,
    vehicle_conditions: settings.vehicle_conditions,
    default_new_addendum: settings.default_new_addendum,
    default_used_window: settings.default_used_window,
    default_used_addendum: settings.default_used_addendum,
    default_ftc_warranty: settings.default_ftc_warranty,
  });

  // The branding form is seeded from settings at mount, but settings load
  // asynchronously — so hydrate the form once they arrive, or the fields look
  // blank and a save would write the empty defaults back.
  const brandingHydratedRef = useRef(false);
  const [brandingReady, setBrandingReady] = useState(false);
  useEffect(() => {
    if (settingsLoading || brandingHydratedRef.current) return;
    brandingHydratedRef.current = true;
    setBrandingReady(true);
    setBranding({
      dealer_name: settings.dealer_name,
      dealer_tagline: settings.dealer_tagline,
      dealer_logo_url: settings.dealer_logo_url,
      primary_color: settings.primary_color,
      dealer_address: settings.dealer_address,
      dealer_city: settings.dealer_city,
      dealer_state: settings.dealer_state,
      dealer_zip: settings.dealer_zip,
      dealer_phone: settings.dealer_phone,
      dealer_principal: settings.dealer_principal,
      dealer_license_number: settings.dealer_license_number,
      dms_provider: settings.dms_provider,
      new_inventory_url: settings.new_inventory_url,
      used_inventory_url: settings.used_inventory_url,
      cargurus_url: settings.cargurus_url,
      cars_com_url: settings.cars_com_url,
      autotrader_url: settings.autotrader_url,
      capital_one_url: settings.capital_one_url,
      carfax_url: settings.carfax_url,
      vdp_price_labels: settings.vdp_price_labels,
      vdp_strip_finance_params: settings.vdp_strip_finance_params,
      why_buy_here: settings.why_buy_here,
      warranty_programs: settings.warranty_programs,
      vehicle_conditions: settings.vehicle_conditions,
      default_new_addendum: settings.default_new_addendum,
      default_used_window: settings.default_used_window,
      default_used_addendum: settings.default_used_addendum,
      default_ftc_warranty: settings.default_ftc_warranty,
    });
  }, [settingsLoading, settings]);
  const [logoUploading, setLogoUploading] = useState(false);
  useInstantSave(branding, (v) => updateSettings(v), { ready: brandingReady, toastId: "branding" });

  // VDP price-extraction "Test" — runs the scraper against a sample URL
  // and returns which configured label matched (or why it didn't), so the
  // dealer can confirm their wording before relying on it for live addendums.
  const [priceTestUrl, setPriceTestUrl] = useState("");
  const [priceTestRunning, setPriceTestRunning] = useState(false);
  const [priceTestResult, setPriceTestResult] = useState<null | {
    error?: string;
    price?: number | null;
    matched_label?: string | null;
    source?: string | null;
    reason?: string | null;
    rendered?: boolean;
    msrp?: number | null;
    candidates?: { value: number; label: string; source: string }[];
  }>(null);
  const handleTestPriceScrape = async () => {
    if (!priceTestUrl || !tenant?.id) return;
    setPriceTestRunning(true);
    setPriceTestResult(null);
    try {
      // Save the current label config first so the test reflects what's typed.
      await updateSettings({
        vdp_price_labels: branding.vdp_price_labels,
        vdp_strip_finance_params: branding.vdp_strip_finance_params,
      });
      const { data, error } = await supabase.functions.invoke("crawl-advertised-prices", {
        body: { tenant_id: tenant.id, test_url: priceTestUrl },
      });
      if (error) {
        setPriceTestResult({ error: error.message });
      } else {
        setPriceTestResult(data?.test || data || { error: "No result" });
      }
    } catch (e) {
      setPriceTestResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPriceTestRunning(false);
    }
  };

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

  const handleSaveProduct = async () => {
    if (!editing || !editing.name) return;
    // The contract/warranty document is the substantiation behind the
    // benefit claims (FTC §5). Strongly encouraged, but do NOT hard-block
    // the save on it — that would prevent editing benefit/pricing while
    // document storage is unavailable. Surface it as a warning instead.
    if (!editing.contract_url) {
      toast.warning("Saved without a product document. Attach the contract or warranty card when you can — it substantiates the benefit claims.");
    }
    const payload = {
      name: editing.name,
      subtitle: editing.subtitle || null,
      warranty: editing.warranty || null,
      badge_type: editing.badge_type || "installed",
      price: Number(editing.price) || 0,
      price_label: editing.price_label || "Included in Selling Price",
      disclosure: editing.disclosure || null,
      sort_order: Number(editing.sort_order) || 0,
      is_active: editing.is_active ?? true,
      // Wave 16 — benefit justification seeds the per-addendum
      // line at build time. Required on installed products
      // before the red-team will release a signing link.
      benefit_justification: editing.benefit_justification || "",
      // Optional-disposition copy (used when the line is sold as a
      // customer-elected add-on rather than pre-installed).
      benefit_justification_optional: editing.benefit_justification_optional || null,
      disclosure_optional: editing.disclosure_optional || null,
      // Default included-in-advertised so an accessory is never
      // silently charged above the advertised price.
      price_in_advertised: editing.price_in_advertised ?? true,
      available_preinstalled: editing.available_preinstalled ?? true,
      upgrade: ((editing.upgrade && editing.upgrade.name?.trim()) ? editing.upgrade : null) as unknown as Json,
      contract_url: editing.contract_url || null,
      contract_doc_type: editing.contract_doc_type || null,
      price_tiers: (editing.price_tiers && Object.keys(editing.price_tiers).length ? editing.price_tiers : null) as unknown as Json,
    };

    if (editing.id) {
      const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Product updated");
    } else {
      // New products belong to this dealer's tenant (Option 1: platform
      // templates have tenant_id NULL; dealer-created products are scoped).
      const { error } = await supabase.from("products").insert({ ...payload, tenant_id: tenant?.id ?? null } as typeof payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Product added");
    }
    // Save icon_type to localStorage (extend later to DB)
    if (editing.icon_type) {
      const iconMap = JSON.parse(localStorage.getItem(productIconKey) || "{}");
      const productId = editing.id || "pending";
      iconMap[productId] = editing.icon_type;
      localStorage.setItem(productIconKey, JSON.stringify(iconMap));
    }
    setEditing(null);
    fetchProducts();
    // Refresh the shared products query the addendum/sticker builders read,
    // so a just-saved benefit/price is reflected without a hard refresh.
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    await supabase.from("products").delete().eq("id", id);
    toast.success("Product deleted");
    fetchProducts();
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const handleSaveRule = () => {
    if (!editingRule?.product_id) { toast.error("Select a product"); return; }
    if (editingRule._new) {
      const { _new, id, ...rest } = editingRule as any;
      addRule(rest);
      toast.success("Rule added");
    } else if (editingRule.id) {
      const { _new, ...rest } = editingRule as any;
      updateRule(editingRule.id, rest);
      toast.success("Rule updated");
    }
    setEditingRule(null);
  };

  const handleToggleFeature = (key: keyof DealerSettings) => {
    updateSettings({ [key]: !settings[key] });
  };

  // Wait for the member row too — the tab filter needs the role before it can
  // decide which tabs exist, otherwise deep links flash the wrong tab.
  if (loading || fetching || entitlementsLoading) return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading...</p></div>;

  const tabs: { id: AdminTab; label: string; group?: "dealer" | "platform" }[] = ([
    { id: "home", label: "Home" },
    { id: "products", label: "Products" },
    ...(settings.feature_product_rules ? [{ id: "rules" as const, label: "Rules" }] : []),
    { id: "settings", label: "Store Settings" },
    { id: "branding", label: "Branding" },
    { id: "labels", label: "Label Templates" },
    { id: "programs", label: "Included with Sale" },
    { id: "factory-warranty", label: "Factory Warranty & CPO" },
    { id: "passport-ctas", label: "Passport Buttons" },
    { id: "passport-trust", label: "Why Buy From Us" },
    { id: "passport-routing", label: "Lead Routing" },
    { id: "print-settings", label: "Printer Calibration" },
    { id: "document-rules", label: "Approval & Review Rules" },
    { id: "incentives", label: "Pricing & Incentives" },
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
    <div className="max-w-6xl mx-auto">
        {/* Page header — clean light surface, no gradient. */}
        <div className="px-6 lg:px-10 pt-8 pb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-border">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-label text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Control Center
            </div>
            <h1 className="mt-2 text-2xl lg:text-3xl font-black tracking-tight font-display leading-tight text-foreground">
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
            <div className="px-3 py-1.5 rounded-lg bg-muted border border-border text-[10px] font-semibold uppercase tracking-label text-muted-foreground">
              FTC-aligned · 50-state engine
            </div>
          </div>
        </div>

        <div className="p-4 lg:p-6">

        {/* Grouped section nav. Collapses the flat tab set into ~6 groups a
            manager uses (+ Advanced). Each group maps to existing ?tab= keys,
            so every deep link still resolves; this is a presentation layer only. */}
        {(() => {
          const labelFor = (id: AdminTab) => tabs.find((t) => t.id === id)?.label || id;
          const availIds = new Set(tabs.map((t) => t.id));
          const groupDefs: { id: string; label: string; ids: AdminTab[] }[] = [
            { id: "home", label: "Home", ids: ["home"] },
            { id: "store", label: "Store", ids: ["settings", "branding", "team", "features", "getready"] },
            { id: "pricing", label: "Pricing", ids: ["incentives"] },
            { id: "products", label: "Products & Programs", ids: ["products", "rules", "programs", "factory-warranty"] },
            { id: "passport", label: "Customer Passport", ids: ["passport-ctas", "passport-trust", "passport-routing"] },
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
            { icon: Sparkles, title: "New Car Sticker", subtitle: "Monroney-style window label", onClick: () => navigate("/new-car-sticker") },
            { icon: Car, title: "Used Car Sticker", subtitle: "Addendum for used inventory", onClick: () => navigate("/used-car-sticker") },
            { icon: BookOpen, title: "Buyers Guide", subtitle: "FTC-aligned · 16 CFR § 455", onClick: () => navigate("/buyers-guide") },
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
                  <p className="text-[10px] font-semibold uppercase tracking-label" style={{ color: "#3BB4FF" }}>
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
                  <p className="text-[10px] font-semibold uppercase tracking-label" style={{ color: "#F59E0B" }}>
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
                  <p className="text-[10px] font-semibold uppercase tracking-label" style={{ color: "#10B981" }}>
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
                  <p className="text-[10px] font-semibold uppercase tracking-label" style={{ color: "#DC2626" }}>
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

        {/* ─── Products Tab ─── */}
        {tab === "products" && (
          <div className="flex flex-col">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-foreground">Products</h2>
              <p className="text-xs text-muted-foreground">Your active products power every addendum. Open the template library below to add more.</p>
            </div>

            {/* Template Library */}
            <div className="order-2 mt-6 bg-card rounded-xl border border-border shadow-premium p-5">
              <button onClick={() => setShowLibrary((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
                <span className="inline-flex items-center gap-2">
                  <Library className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-foreground">Template Library</span>
                </span>
                <span className="text-xs font-medium text-blue-700">{showLibrary ? "Hide" : "Show templates"}</span>
              </button>
              {showLibrary && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground mb-3">
                    Browse templates and click "Add to dealership" to copy one into your active products. Need a custom one? Use "+ Add Product" in your Active Products list.
                  </p>
              {(() => {
              // Hide archive/library cards the dealer has already activated
              // (a product of the same name exists in their active list), so
              // the library stops looking like duplicates of live products.
              const activeNames = new Set(products.map((p) => (p.name || "").trim().toLowerCase()));
              const libraryToShow = productLibrary.filter((e) => !activeNames.has((e.name || "").trim().toLowerCase()));
              return libraryToShow.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">
                  No archived products to import — your active products are listed below.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {libraryToShow.map(entry => {
                    const defaultTier = entry.priceTiers.find(t => t.vehicleCategory === "default");
                    const basePrice = defaultTier ? defaultTier.price : entry.defaultPrice;
                    return (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-border bg-background p-3 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-foreground truncate">{entry.name}</p>
                            <span className="text-[9px] font-bold uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded flex-shrink-0">
                              {entry.category}
                            </span>
                          </div>
                          {entry.subtitle && (
                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{entry.subtitle}</p>
                          )}
                          <p className="text-sm font-semibold text-foreground tabular-nums mt-2">
                            ${basePrice.toFixed(2)}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setEditing({
                              ...emptyProduct,
                              name: entry.name,
                              subtitle: entry.subtitle,
                              warranty: entry.warrantyDetails || entry.warranty || "",
                              price: basePrice,
                              badge_type: entry.badge_type,
                              price_label: entry.price_label,
                              disclosure: entry.disclosure,
                              icon_type: entry.iconType || "",
                              sort_order: products.length + 1,
                              is_active: true,
                            });
                          }}
                          className="mt-3 inline-flex items-center justify-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 w-full"
                        >
                          <Plus className="w-3 h-3" />
                          Add to dealership
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
              })()}
                </div>
              )}
            </div>

            {/* Active products — the dealer's live catalog, the star of the page. */}
            <div className="order-1">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-foreground">Active Products <span className="font-normal text-muted-foreground">({products.length})</span></h3>
                <button
                  onClick={() => setEditing({ ...emptyProduct, sort_order: products.length + 1 })}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
                >
                  + Add Product
                </button>
              </div>
              <div className="space-y-2">
              {products.map((p) => {
                const iconMap = JSON.parse(localStorage.getItem(productIconKey) || "{}");
                const icon = iconMap[p.id];
                const isInstalled = p.badge_type === "installed";
                const toggleType = async () => {
                  const next = isInstalled ? "optional" : "installed";
                  const priceLabel = next === "installed" ? "Included in Selling Price" : "If Accepted";
                  const { error } = await supabase.from("products").update({ badge_type: next, price_label: priceLabel }).eq("id", p.id);
                  if (error) { toast.error(error.message); return; }
                  toast.success(`${p.name} marked as ${next}`);
                  fetchProducts();
                  queryClient.invalidateQueries({ queryKey: ["products"] });
                };
                return (
                  <div
                    key={p.id}
                    className={`bg-card rounded-lg p-4 shadow-premium border-l-4 transition-colors ${
                      isInstalled ? "border-l-blue" : "border-l-gold"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Inline type toggle — blue=installed, yellow=optional */}
                        <button
                          onClick={toggleType}
                          className="flex flex-col items-center gap-0.5 flex-shrink-0"
                          title={`Click to switch to ${isInstalled ? "Optional" : "Installed"}`}
                        >
                          <div className={`relative w-10 h-5 rounded-full transition-colors ${isInstalled ? "bg-blue" : "bg-gold"}`}>
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isInstalled ? "translate-x-0.5" : "translate-x-[22px]"}`} />
                          </div>
                          <span className={`text-[9px] font-bold uppercase tracking-wider ${isInstalled ? "text-blue" : "text-gold"}`}>
                            {isInstalled ? "Installed" : "Optional"}
                          </span>
                        </button>

                        {icon && settings.feature_product_icons && (
                          <span className="flex-shrink-0 text-muted-foreground"><ProductIcon type={icon} className="w-5 h-5" /></span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground truncate">{p.name}</span>
                            {!p.is_active && (
                              <span className="text-[10px] font-semibold bg-destructive/10 text-destructive px-1.5 py-0.5 rounded uppercase">
                                Inactive
                              </span>
                            )}
                          </div>
                          {p.subtitle && <p className="text-xs text-muted-foreground truncate">{p.subtitle}</p>}
                        </div>
                      </div>
                      <div className="flex gap-2 items-center flex-shrink-0">
                        <span className="text-sm font-semibold text-foreground tabular-nums">${p.price.toFixed(2)}</span>
                        <button onClick={() => setEditing({ ...p, icon_type: iconMap[p.id] || "" })} className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted text-foreground font-medium transition-colors">Edit</button>
                        <button onClick={() => handleDeleteProduct(p.id)} className="text-xs px-3 py-1.5 rounded-md border border-destructive/20 hover:bg-destructive/5 text-destructive font-medium transition-colors">Delete</button>
                      </div>
                    </div>
                    {p.subtitle && <p className="text-xs text-muted-foreground mt-1">{p.subtitle}</p>}
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        )}

        {/* ─── Product Rules Tab ─── */}
        {tab === "rules" && (
          <div>
            <div className="bg-card rounded-lg p-4 shadow-sm mb-4">
              <h3 className="text-sm font-bold text-foreground mb-1">Rules-Based Product Assignment</h3>
              <p className="text-xs text-muted-foreground">
                Create rules to auto-assign products based on vehicle attributes. Products without rules always appear. Products with rules only appear when a vehicle matches at least one rule.
              </p>
            </div>

            <button
              onClick={() => setEditingRule({ ...emptyRule, _new: true })}
              className="mb-4 px-4 py-2 bg-teal text-primary-foreground rounded font-semibold text-sm"
            >
              + Add Rule
            </button>

            <div className="space-y-3">
              {rules.length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">No product rules yet. All products will show on every addendum.</p>
              )}
              {rules.map((r) => {
                const product = products.find(p => p.id === r.product_id);
                return (
                  <div key={r.id} className="bg-card rounded-lg p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-foreground">{product?.name || "Unknown product"}</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {r.year_min && <span className="text-[10px] bg-blue/10 text-blue px-1.5 py-0.5 rounded">{r.year_min}–{r.year_max || "Any"}</span>}
                          {r.makes.length > 0 && <span className="text-[10px] bg-teal/10 text-teal px-1.5 py-0.5 rounded">{r.makes.join(", ")}</span>}
                          {r.models.length > 0 && <span className="text-[10px] bg-gold/10 text-gold px-1.5 py-0.5 rounded">{r.models.join(", ")}</span>}
                          {r.condition !== "all" && <span className="text-[10px] bg-navy/10 text-navy px-1.5 py-0.5 rounded">{r.condition}</span>}
                          {r.mileage_max > 0 && <span className="text-[10px] bg-action/10 text-action px-1.5 py-0.5 rounded">≤{r.mileage_max.toLocaleString()} mi</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setEditingRule({ ...r })} className="text-xs px-3 py-1 bg-blue text-primary-foreground rounded">Edit</button>
                        <button onClick={() => { deleteRule(r.id); toast.success("Rule deleted"); }} className="text-xs px-3 py-1 bg-destructive text-primary-foreground rounded">Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── Feature Toggles Tab ─── */}
        {tab === "settings" && (
          <div>
            <div className="bg-card rounded-lg p-4 shadow-sm mb-4">
              <h3 className="text-sm font-bold text-foreground mb-1">Optional Features</h3>
              <p className="text-xs text-muted-foreground">
                Turn features on or off for your dealership. Disabled features won't appear on the employee-facing addendum, keeping the interface clean and focused.
              </p>
            </div>

            {/* Paper Size Settings */}
            <div id="paper-size" className="bg-card rounded-lg p-4 shadow-sm mb-3">
              <h4 className="text-sm font-bold text-foreground mb-2">Addendum Paper Size</h4>
              <p className="text-xs text-muted-foreground mb-3">Addendum scales to this size. FTC Buyers Guide stays at its federally-mandated minimum (11" × 7¼", 16 CFR § 455).</p>
              <div className="flex gap-2 flex-wrap">
                {[
                  { key: "letter" as const, label: "Letter (8.5×11)" },
                  { key: "legal" as const, label: "Legal (8.5×14)" },
                  { key: "half-sheet" as const, label: "Half Sheet (5.5×8.5)" },
                  { key: "addendum-strip" as const, label: "Strip (4.25×11)" },
                  { key: "addendum-half" as const, label: "Half Page (5.5×12.5)" },
                  { key: "monroney" as const, label: "Monroney (7.5×10)" },
                  { key: "custom" as const, label: "Custom" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => updateSettings({ addendum_paper_size: key })}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${settings.addendum_paper_size === key ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:bg-muted"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {settings.addendum_paper_size === "custom" && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Width (in)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={settings.addendum_custom_width}
                      onChange={(e) => updateSettings({ addendum_custom_width: e.target.value })}
                      className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Height (in)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={settings.addendum_custom_height}
                      onChange={(e) => updateSettings({ addendum_custom_height: e.target.value })}
                      className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

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

            {/* Title / MCO capture */}
            <div id="title-clerk" className="bg-card rounded-lg p-4 shadow-premium mb-3">
              <h4 className="text-sm font-bold text-foreground mb-1">Title / MCO Upload</h4>
              <p className="text-xs text-muted-foreground mb-3">The office gets a per-vehicle link + QR to upload the title (used) or MCO (new), front and back, into the private vehicle file.</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Office clerk email(s)</label>
                  <textarea
                    value={settings.title_clerk_email || ""}
                    onChange={(e) => updateSettings({ title_clerk_email: e.target.value })}
                    rows={2}
                    placeholder="titles@dealership.com, backup-clerk@dealership.com"
                    className="w-full px-3 py-2 border border-border-custom rounded text-sm resize-none"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Separate multiple addresses with commas — add a backup so it still goes out when someone's out of office.</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Email the office automatically on intake</span>
                  <Switch checked={!!settings.title_email_on_intake} onCheckedChange={(v) => updateSettings({ title_email_on_intake: v })} className="data-[state=checked]:bg-teal" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="pr-3">
                    <span className="text-sm font-semibold text-foreground">Round-robin the request</span>
                    <p className="text-[11px] text-muted-foreground">Send to one clerk at a time and rotate to the next on each reminder, instead of emailing everyone at once.</p>
                  </div>
                  <Switch checked={!!settings.title_round_robin} onCheckedChange={(v) => updateSettings({ title_round_robin: v })} className="data-[state=checked]:bg-teal" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Resend reminders until received</span>
                  <Switch checked={!!settings.title_reminders_enabled} onCheckedChange={(v) => updateSettings({ title_reminders_enabled: v })} className="data-[state=checked]:bg-teal" />
                </div>
                {settings.title_reminders_enabled && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Remind every (days)</label>
                    <input
                      type="number" min={1} step={1}
                      value={settings.title_reminder_days ?? 3}
                      onChange={(e) => updateSettings({ title_reminder_days: Math.max(1, parseInt(e.target.value) || 3) })}
                      className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Re-emails the office every N days while no title/MCO is on file for an in-stock vehicle.</p>
                  </div>
                )}
              </div>
            </div>

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

            {/* Recon approval gate */}
            <div id="recon-approval" className="bg-card rounded-lg p-4 shadow-premium mb-3">
              <h4 className="text-sm font-bold text-foreground mb-1">Recon Approval</h4>
              <p className="text-xs text-muted-foreground mb-3">When service submits a recon estimate, line items at or under this amount clear automatically so work isn't stalled. Anything higher routes to the used-car manager to approve or decline.</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Auto-approve line items up to ($)</label>
                  <input
                    type="number" min={0} step={50}
                    value={settings.recon_auto_approve_amount ?? 500}
                    onChange={(e) => updateSettings({ recon_auto_approve_amount: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Set to 0 to route every estimate to the manager. Industry-typical is $500&ndash;$800.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Used-car manager email(s) for approvals</label>
                  <textarea
                    value={settings.recon_approval_email || ""}
                    onChange={(e) => updateSettings({ recon_approval_email: e.target.value })}
                    rows={2}
                    placeholder="ucm@dealership.com, gm@dealership.com"
                    className="w-full px-3 py-2 border border-border-custom rounded text-sm resize-none"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Gets the approve/decline link when an estimate needs a decision. Leave blank to send to the dealership's main contact email.</p>
                </div>
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
                <div className="flex items-center justify-between">
                  <div className="pr-3">
                    <span className="text-sm font-semibold text-foreground">Require K-208 before finalizing</span>
                    <p className="text-xs text-muted-foreground">Block the customer disclosure from being signed until the CT K-208 safety inspection is done (used/CPO only; new cars exempt).</p>
                  </div>
                  <Switch
                    checked={settings.require_safety_inspection === true}
                    onCheckedChange={(v) => {
                      if (!v && !window.confirm("Turning this off lets customer disclosures be signed without a completed K-208 safety inspection. Disable the gate?")) return;
                      updateSettings({ require_safety_inspection: v });
                    }}
                    className="data-[state=checked]:bg-teal"
                  />
                </div>
                {settings.require_safety_inspection === true && (
                  <div className="pl-1 border-l-2 border-border-custom ml-1">
                    <div className="pl-3">
                      <span className="text-xs font-semibold text-foreground">Who may sign the K-208</span>
                      <p className="text-xs text-muted-foreground mb-1.5">Leave all off to accept any signed K-208. Select roles to require the satisfying inspection be signed by a logged-in member with that role (a tech's anonymous QR sign-off won't count).</p>
                      <div className="flex flex-wrap gap-1.5">
                        {([
                          { key: "owner", label: "Owner" },
                          { key: "admin", label: "Admin" },
                          { key: "general_manager", label: "General Manager" },
                          { key: "service_manager", label: "Service Manager" },
                          { key: "service_advisor", label: "Service Writer" },
                        ] as const).map(({ key, label }) => {
                          const on = (settings.k208_authority_roles || []).includes(key);
                          return (
                            <button key={key} onClick={() => {
                              if (!window.confirm(`${on ? "Remove" : "Add"} ${label} ${on ? "from" : "to"} the roles allowed to sign the K-208? This changes which inspections satisfy the compliance gate.`)) return;
                              const cur = settings.k208_authority_roles || [];
                              updateSettings({ k208_authority_roles: on ? cur.filter((r) => r !== key) : [...cur, key] });
                            }} className={`h-8 px-3 rounded-full text-xs font-semibold border ${on ? "border-primary bg-primary/10 text-primary" : "border-border-custom text-foreground"}`}>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="pr-3">
                    <span className="text-sm font-semibold text-foreground">Require install verification before finalizing</span>
                    <p className="text-xs text-muted-foreground">Block the customer disclosure from being signed until every pre-installed product has a verified install (photo + signature).</p>
                  </div>
                  <Switch
                    checked={settings.require_install_verification === true}
                    onCheckedChange={(v) => {
                      if (!v && !window.confirm("Turning this off lets customer disclosures be signed without verified install proof (photo + signature) for pre-installed products. Disable the gate?")) return;
                      updateSettings({ require_install_verification: v });
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
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Auto-notify third-party installers on preinstall</span>
                  <Switch checked={settings.thirdparty_auto_notify !== false} onCheckedChange={(v) => updateSettings({ thirdparty_auto_notify: v })} className="data-[state=checked]:bg-teal" />
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
                <IntegrationRow label="SMS (Twilio)" secretKey="TWILIO_API_KEY" feature={settings.feature_sms} />
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
        {tab === "programs" && <DealerProgramsPanel />}
        {tab === "factory-warranty" && <OemWarrantyPanel />}
        {tab === "passport-ctas" && (
          <div className="space-y-5">
            <PacketDefaultsPanel />
            <PassportPublishingCard />
            <StickyButtonsPanel />
          </div>
        )}
        {tab === "passport-trust" && <DealershipTrustPanel />}
        {tab === "passport-routing" && <PassportContactRoutingPanel />}

        {tab === "branding" && (
          <div>
            <div className="bg-card rounded-lg p-4 shadow-sm mb-4">
              <h3 className="text-sm font-bold text-foreground mb-1">Dealership Branding</h3>
              <p className="text-xs text-muted-foreground">
                Customize how your dealership appears on addendums and buyers guides. These settings apply to all generated documents. Changes save automatically.
              </p>
            </div>

            <div className="bg-card rounded-lg p-6 shadow-sm space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Dealership Name</label>
                <input
                  value={branding.dealer_name}
                  onChange={(e) => setBranding({ ...branding, dealer_name: e.target.value })}
                  className="w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Tagline / Subtitle</label>
                <input
                  value={branding.dealer_tagline}
                  onChange={(e) => setBranding({ ...branding, dealer_tagline: e.target.value })}
                  className="w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Logo</label>
                <div className="mt-1 flex items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md border border-border bg-background text-sm font-semibold cursor-pointer hover:bg-muted/50 whitespace-nowrap">
                    {logoUploading ? "Uploading…" : "Upload logo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      disabled={logoUploading}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setLogoUploading(true);
                        try {
                          const result = await uploadPhoto("dealer-logos", f, {
                            tenantId: tenant?.id,
                            storeId: currentStore?.id,
                            vin: "brand-logo",
                          });
                          if (result?.url) {
                            setBranding({ ...branding, dealer_logo_url: result.url });
                            // Persist the logo immediately so it isn't lost if
                            // the dealer forgets to hit Save Branding. updateSettings
                            // surfaces a toast if the DB write is denied (RLS).
                            updateSettings({ dealer_logo_url: result.url });
                            toast.success("Logo uploaded");
                          }
                        } catch (err) {
                          toast.error(`Upload failed: ${err instanceof Error ? err.message : "unknown error"}`);
                        } finally {
                          setLogoUploading(false);
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    PNG, JPG, WebP, or SVG · up to 5 MB
                  </span>
                </div>
                <div className="mt-2">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-label">
                    Or paste a URL
                  </label>
                  <input
                    value={branding.dealer_logo_url}
                    onChange={(e) => setBranding({ ...branding, dealer_logo_url: e.target.value })}
                    placeholder="https://example.com/logo.png"
                    className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50"
                  />
                </div>
                {branding.dealer_logo_url && (
                  <div className="mt-2 p-3 bg-muted rounded flex items-center justify-center">
                    <img src={branding.dealer_logo_url} alt="Logo preview" className="h-12 object-contain" />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Primary Brand Color (hex)</label>
                <div className="flex gap-2">
                  <input
                    value={branding.primary_color}
                    onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                    placeholder="#1a2b4a"
                    className="flex-1 px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50"
                  />
                  {branding.primary_color && (
                    <div className="w-10 h-10 rounded border border-border-custom" style={{ backgroundColor: branding.primary_color }} />
                  )}
                </div>
              </div>
              {/* Dealership legal + contact details. These identify the
                  licensed seller on the addendum / Buyers Guide; the
                  operating state also drives state compliance rules. */}
              <div className="pt-3 mt-3 border-t border-border-custom space-y-3">
                <div>
                  <h4 className="text-sm font-bold text-foreground">Dealership Details</h4>
                  <p className="text-xs text-muted-foreground">Address, contact, dealer principal, and DMV license. Shown on generated documents.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Street Address</label>
                  <input value={branding.dealer_address} onChange={(e) => setBranding({ ...branding, dealer_address: e.target.value })} placeholder="123 Main St" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">City</label>
                    <input value={branding.dealer_city} onChange={(e) => setBranding({ ...branding, dealer_city: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">State</label>
                      <input value={branding.dealer_state} maxLength={2} onChange={(e) => setBranding({ ...branding, dealer_state: e.target.value.toUpperCase() })} placeholder="CT" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50 uppercase" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">ZIP</label>
                      <input value={branding.dealer_zip} onChange={(e) => setBranding({ ...branding, dealer_zip: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Phone</label>
                    <input value={branding.dealer_phone} onChange={(e) => setBranding({ ...branding, dealer_phone: formatPhone(e.target.value) })} placeholder="(555) 123-4567" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Dealer Principal</label>
                    <input value={branding.dealer_principal} onChange={(e) => setBranding({ ...branding, dealer_principal: e.target.value })} placeholder="Owner of record" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">DMV Dealer License / ID Number</label>
                  <input value={branding.dealer_license_number} onChange={(e) => setBranding({ ...branding, dealer_license_number: e.target.value })} placeholder="e.g. CT dealer #00000" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                </div>
              </div>

              {/* Inventory feed + website verification */}
              <div className="border-t border-border-custom pt-3">
                <h4 className="text-sm font-bold text-foreground">Inventory Feed &amp; Website</h4>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Your DMS is the source of truth for inventory and pricing. The new/used website URLs let us verify your advertised prices match the sticker (FTC Act §5).
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">DMS Provider</label>
                    <input value={branding.dms_provider} onChange={(e) => setBranding({ ...branding, dms_provider: e.target.value })} placeholder="CDK, Reynolds, Dealertrack, Tekion…" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">New Inventory Website</label>
                    <input value={branding.new_inventory_url} onChange={(e) => setBranding({ ...branding, new_inventory_url: e.target.value })} placeholder="https://yourdealer.com/inventory/new" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Used Inventory Website</label>
                    <input value={branding.used_inventory_url} onChange={(e) => setBranding({ ...branding, used_inventory_url: e.target.value })} placeholder="https://yourdealer.com/inventory/used" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-3 mb-1">Marketplace listings — we verify these match your sticker too, so a shopper sees the same price everywhere.</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">AutoTrader</label>
                    <input value={branding.autotrader_url} onChange={(e) => setBranding({ ...branding, autotrader_url: e.target.value })} placeholder="autotrader.com/dealer/…" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Cars.com</label>
                    <input value={branding.cars_com_url} onChange={(e) => setBranding({ ...branding, cars_com_url: e.target.value })} placeholder="cars.com/dealers/…" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">CarGurus</label>
                    <input value={branding.cargurus_url} onChange={(e) => setBranding({ ...branding, cargurus_url: e.target.value })} placeholder="cargurus.com/…" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Capital One</label>
                    <input value={branding.capital_one_url} onChange={(e) => setBranding({ ...branding, capital_one_url: e.target.value })} placeholder="capitalone.com/cars/…" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">CARFAX</label>
                    <input value={branding.carfax_url} onChange={(e) => setBranding({ ...branding, carfax_url: e.target.value })} placeholder="carfax.com/dealer/…" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                </div>

                {/* Per-dealer advertised-price extraction. Dealers brand the
                    selling price line differently — Harte Infiniti calls it
                    "Harte Deal", another store calls it "Internet Price",
                    "ePrice", "Your Price", "Selling Price". Hardcoding labels
                    misreads the page on every new dealer. The list below is
                    matched against the price-stack labels in priority order. */}
                <div className="mt-4 pt-3 border-t border-dashed border-border-custom">
                  <h5 className="text-sm font-bold text-foreground">Advertised price extraction</h5>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    The label your store uses for the advertised selling price. The scraper will
                    look for these labels next to a dollar amount on your VDPs, in the order listed.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-muted-foreground">VDP price label(s) — priority order</label>
                      <input
                        value={branding.vdp_price_labels}
                        onChange={(e) => setBranding({ ...branding, vdp_price_labels: e.target.value })}
                        placeholder="e.g. Harte Deal, Internet Price, Selling Price"
                        className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Comma-separated. Case-insensitive substring match. First label that has a dollar amount adjacent wins.
                      </p>
                    </div>
                    <div className="flex items-start gap-2 pt-6">
                      <Switch
                        checked={branding.vdp_strip_finance_params !== false}
                        onCheckedChange={(v) => setBranding({ ...branding, vdp_strip_finance_params: v })}
                      />
                      <div className="text-xs">
                        <div className="font-semibold text-foreground">Strip finance/lease URL params</div>
                        <div className="text-muted-foreground">Removes <code>?type=finance</code>, <code>?type=lease</code>, and similar before scraping so the page shows the standard price.</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-end gap-2">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-muted-foreground">Test URL</label>
                      <input
                        value={priceTestUrl}
                        onChange={(e) => setPriceTestUrl(e.target.value)}
                        placeholder="https://yourdealer.com/used/2025-make-model/VIN/"
                        className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50"
                      />
                    </div>
                    <button
                      onClick={handleTestPriceScrape}
                      disabled={priceTestRunning || !priceTestUrl || !tenant?.id}
                      className="px-4 py-2 bg-foreground text-background rounded font-semibold text-sm disabled:opacity-50"
                    >
                      {priceTestRunning ? "Testing…" : "Test"}
                    </button>
                  </div>
                  {priceTestResult && (
                    <div className="mt-3 rounded border border-border-custom bg-muted/30 p-3 text-xs">
                      {priceTestResult.error ? (
                        <div className="text-destructive font-semibold">Error: {priceTestResult.error}</div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-3 mb-2">
                            <span className="font-semibold text-foreground">
                              {priceTestResult.price != null
                                ? `Price: $${Number(priceTestResult.price).toLocaleString()}`
                                : "No price extracted"}
                            </span>
                            {priceTestResult.matched_label && (
                              <span className="text-muted-foreground">matched <span className="font-mono">{priceTestResult.matched_label}</span></span>
                            )}
                            {priceTestResult.source && (
                              <span className="text-muted-foreground">source: <span className="font-mono">{priceTestResult.source}</span></span>
                            )}
                            {priceTestResult.rendered && <span className="text-muted-foreground">(rendered)</span>}
                            {priceTestResult.reason && <span className="text-muted-foreground">reason: <span className="font-mono">{priceTestResult.reason}</span></span>}
                          </div>
                          {priceTestResult.msrp != null && (
                            <div className="text-muted-foreground">MSRP captured: ${Number(priceTestResult.msrp).toLocaleString()}</div>
                          )}
                          {Array.isArray(priceTestResult.candidates) && priceTestResult.candidates.length > 0 && (
                            <div className="mt-2">
                              <div className="font-semibold text-muted-foreground mb-1">Candidates found on page:</div>
                              <ul className="space-y-0.5 max-h-40 overflow-auto">
                                {priceTestResult.candidates.slice(0, 20).map((c: { value: number; label: string; source: string }, i: number) => (
                                  <li key={i} className="font-mono">
                                    ${Number(c.value).toLocaleString()} <span className="text-muted-foreground">— {c.label} [{c.source}]</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>


              {/* Marketing assets shown to shoppers */}
              <div className="border-t border-border-custom pt-3">
                <h4 className="text-sm font-bold text-foreground">Marketing &amp; Warranty</h4>
                <p className="text-[11px] text-muted-foreground mb-2">Shown to shoppers on the scanned vehicle packet and stickers.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Why Buy Here</label>
                    <textarea value={branding.why_buy_here} onChange={(e) => setBranding({ ...branding, why_buy_here: e.target.value })} rows={3} placeholder="Family-owned since 1985 · Free lifetime car washes · 7-day exchange…" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Warranty Programs</label>
                    <textarea value={branding.warranty_programs} onChange={(e) => setBranding({ ...branding, warranty_programs: e.target.value })} rows={3} placeholder="Powertrain warranty on every used vehicle · Certified pre-owned coverage…" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-xs font-semibold text-muted-foreground">Vehicle condition terms</label>
                  <input value={branding.vehicle_conditions} onChange={(e) => setBranding({ ...branding, vehicle_conditions: e.target.value })} placeholder="New, Demo, Used, CPO" className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground placeholder:text-muted-foreground/50" />
                  <p className="text-[11px] text-muted-foreground mt-1">Comma-separated. Use your own labels (e.g. OEM CPO, Dealer CPO). Each maps to new/used/cpo for storage and compliance.</p>
                </div>
              </div>

              {/* Sticker & document defaults */}
              <div className="border-t border-border-custom pt-3">
                <h4 className="text-sm font-bold text-foreground">Sticker &amp; Document Defaults</h4>
                <p className="text-[11px] text-muted-foreground mb-2">What each generator pulls by default when you start a new or used vehicle.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">New-car addendum</label>
                    <select value={branding.default_new_addendum} onChange={(e) => setBranding({ ...branding, default_new_addendum: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground">
                      <option value="standard">Standard</option><option value="premium">Premium</option><option value="compact">Compact</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Used-car window sticker</label>
                    <select value={branding.default_used_window} onChange={(e) => setBranding({ ...branding, default_used_window: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground">
                      <option value="standard">Standard</option><option value="premium">Premium</option><option value="compact">Compact</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Used-car addendum</label>
                    <select value={branding.default_used_addendum} onChange={(e) => setBranding({ ...branding, default_used_addendum: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground">
                      <option value="standard">Standard</option><option value="premium">Premium</option><option value="compact">Compact</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">FTC used-car warranty (Buyers Guide)</label>
                    <select value={branding.default_ftc_warranty} onChange={(e) => setBranding({ ...branding, default_ftc_warranty: e.target.value })} className="mt-1 w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground">
                      <option value="as_is">As-Is — No Warranty</option><option value="implied">Implied Warranties Only</option><option value="dealer">Dealer Warranty</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const defaults = {
                      dealer_name: "",
                      dealer_tagline: "",
                      dealer_logo_url: "",
                      primary_color: "",
                      dealer_address: "",
                      dealer_city: "",
                      dealer_state: "",
                      dealer_zip: "",
                      dealer_phone: "",
                      dealer_principal: "",
                      dealer_license_number: "",
                      dms_provider: "",
                      new_inventory_url: "",
                      used_inventory_url: "",
                      cargurus_url: "",
                      cars_com_url: "",
                      autotrader_url: "",
                      capital_one_url: "",
                      carfax_url: "",
                      vdp_price_labels: "",
                      vdp_strip_finance_params: true,
                      why_buy_here: "",
                      warranty_programs: "",
                      vehicle_conditions: "New, Demo, Used, CPO",
                      default_new_addendum: "standard",
                      default_used_window: "standard",
                      default_used_addendum: "standard",
                      default_ftc_warranty: "as_is",
                    };
                    setBranding(defaults);
                    updateSettings(defaults);
                    // Reset tenant colors to Autocurb defaults
                    updateTenant({
                      primary_color: "#0B2041",
                      secondary_color: "#2563EB",
                      logo_url: "/logo-mark.svg",
                      name: "AutoLabels.io",
                    });
                    // Remove any inline style overrides so index.css defaults apply
                    const root = document.documentElement;
                    root.style.removeProperty("--primary");
                    root.style.removeProperty("--navy");
                    root.style.removeProperty("--ring");
                    root.style.removeProperty("--blue");
                    root.style.removeProperty("--action");
                    root.style.removeProperty("--sidebar-primary");
                    root.style.removeProperty("--sidebar-ring");
                    toast.success("Branding reset to AutoLabels defaults");
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset to Defaults
                </button>
              </div>
            </div>

          </div>
        )}

        {/* ─── Label Templates Tab ─── */}
        {tab === "labels" && (
          <div className="space-y-3">
            <LabelDefaultsPanel />
            <div className="bg-card rounded-lg p-4 shadow-premium">
              <h4 className="text-sm font-bold text-foreground mb-1">Design your own templates</h4>
              <p className="text-xs text-muted-foreground mb-2">
                Browse the template gallery, customize one with your branding, then set it as a
                default above or from the Used / New chips on any template card.
              </p>
              <a href="/sticker-studio" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold">
                Open Sticker Studio
              </a>
            </div>
            <StickerPrintTemplates />
          </div>
        )}

        {/* Analytics + Deal Signings live at /dashboard/reports; Leads at
            /leads; the VIN print queue at /queue. Their ?tab= ids redirect. */}

        {/* ─── Get-Ready Setup Tab ─── */}
        {/* Config only. The install-proof work surface (records, photos,
            F&I notify) lives on /prep under Install Proof. */}
        {tab === "getready" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-foreground">Get-Ready Setup</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure the internal service catalog. Day-to-day install proof and records live in{" "}
                  <button onClick={() => navigate("/prep?view=installs")} className="text-blue-600 font-semibold hover:underline">Prep &amp; Install</button>.
                </p>
              </div>
            </div>

            {/* Configurable internal service catalog (non-customer charge) */}
            <div id="getready-catalog" className="rounded-2xl border border-border-custom bg-card p-4">
              <div className="flex items-center justify-between">
                <button onClick={() => setSvcOpen((o) => !o)} className="flex items-center gap-2 text-left min-w-0">
                  <span className={`text-muted-foreground transition-transform ${svcOpen ? "rotate-90" : ""}`}>›</span>
                  <span>
                    <span className="text-sm font-bold text-foreground">Get-Ready service catalog</span>
                    <span className="text-[11px] text-muted-foreground ml-2">{svcDraft.length} configured</span>
                  </span>
                </button>
                {svcOpen && (
                  <button onClick={() => setSvcDraft((s) => [...s, { name: "", responsible_name: "", responsible_email: "", cost: "" }])} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted"><Plus className="w-3.5 h-3.5" /> Add service</button>
                )}
              </div>
              {svcOpen && (<>
              <p className="text-[11px] text-muted-foreground mt-1">Internal services you can add to any Get-Ready — routed to a responsible party. Non-customer charge; never billed to the buyer. Changes save automatically.</p>
              <div className="mt-3 space-y-2">
                {svcDraft.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No services configured. Add reconditioning, emissions, key cut, etc.</p>
                ) : svcDraft.map((s, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1.4fr_0.7fr_auto] gap-2">
                    <input value={s.name} onChange={(e) => setSvcDraft((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Service (e.g. Reconditioning)" className="px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground" />
                    <input value={s.responsible_name} onChange={(e) => setSvcDraft((p) => p.map((x, j) => j === i ? { ...x, responsible_name: e.target.value } : x))} placeholder="Responsible (Service Dept.)" className="px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground" />
                    <input value={s.responsible_email} type="email" onChange={(e) => setSvcDraft((p) => p.map((x, j) => j === i ? { ...x, responsible_email: e.target.value } : x))} placeholder="responsible@email.com" className="px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground" />
                    <input value={s.cost} onChange={(e) => setSvcDraft((p) => p.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))} placeholder="$ cost" className="px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground" />
                    <button onClick={() => setSvcDraft((p) => p.filter((_, j) => j !== i))} className="h-9 w-9 inline-flex items-center justify-center rounded border border-border-custom text-muted-foreground hover:text-destructive">×</button>
                  </div>
                ))}
              </div>
              </>)}
            </div>

            {/* Mobile prep sign-off rules (QR flow at /prep/:vin) */}
            <div id="getready-prep-rules" className="rounded-2xl border border-border-custom bg-card p-4">
              <p className="text-sm font-bold text-foreground">Mobile prep sign-off</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Rules for the QR work-event flow at /prep/&lt;VIN&gt;. Changes save automatically.
              </p>
              <div className="mt-3 space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={settings.prep_require_ro}
                    onChange={async (e) => {
                      const ok = await updateSettings({ prep_require_ro: e.target.checked });
                      if (ok) toast.success("Saved", { id: "prep-rules" });
                    }}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-sm text-foreground">Require RO number on Service Install sign-offs</span>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={settings.prep_detail_photos_required}
                    onChange={async (e) => {
                      const ok = await updateSettings({ prep_detail_photos_required: e.target.checked });
                      if (ok) toast.success("Saved", { id: "prep-rules" });
                    }}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-sm text-foreground">Require photos on Initial Inventory Detail</span>
                </label>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Service tasks that require photo proof</label>
                  <input
                    value={prepPhotoTasksDraft}
                    onChange={(e) => setPrepPhotoTasksDraft(e.target.value)}
                    placeholder="Mud flaps installed, Running boards installed"
                    className="w-full px-3 py-2 border border-border-custom rounded text-sm bg-background text-foreground"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Comma-separated task labels. Matching Service Install tasks show a camera icon and block submit until a photo is attached.</p>
                </div>
              </div>
            </div>

          </div>
        )}

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
              <div className="px-5 py-2.5 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{warrantyRecords.length} warranties</div>
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

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="Search by VIN, stock #, customer name, or vehicle..."
                className="w-full h-10 pl-10 pr-3 rounded-md border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Vehicle file list */}
            <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden">
              {vehicleFiles.length === 0 ? (
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
                      <div className="px-5 py-2.5 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

        {tab === "print-settings" && <PrintSettingsPanel />}

        {tab === "document-rules" && <DocumentRulesPanel />}

        {/* ─── Pricing & Incentives Tab ─── */}
        {/* All customer-price controls in one place: doc fee, price display,
            comps, Today's Price wording, incentive programs, elections, and
            the price audit/integrity panels (moved here from the audit tab). */}
        {tab === "incentives" && (
          <div className="space-y-4">
            <div id="doc-fee" className="bg-card rounded-lg p-4 shadow-sm">
              <h4 className="text-sm font-bold text-foreground mb-2">Dealer Documentation Fee</h4>
              <p className="text-xs text-muted-foreground mb-3">Add a state-compliant documentation fee to every addendum. The correct terminology auto-applies based on your state.</p>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-foreground">Enable Doc Fee</span>
                <Switch
                  checked={!!settings.doc_fee_enabled}
                  onCheckedChange={(v) => updateSettings({ doc_fee_enabled: v })}
                  className="data-[state=checked]:bg-teal"
                />
              </div>
              {settings.doc_fee_enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">State</label>
                    <select
                      value={settings.doc_fee_state}
                      onChange={(e) => updateSettings({ doc_fee_state: e.target.value })}
                      className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                    >
                      {STATE_DOC_FEES.map(s => (
                        <option key={s.stateCode} value={s.stateCode}>{s.state} — "{s.terminology}"{s.maxFee ? ` (max $${s.maxFee})` : ""}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Amount ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={docFeeDraft ?? String(settings.doc_fee_amount)}
                      onChange={(e) => setDocFeeDraft(e.target.value)}
                      onBlur={() => {
                        if (docFeeDraft == null) return;
                        const next = parseFloat(docFeeDraft) || 0;
                        setDocFeeDraft(null);
                        if (next === settings.doc_fee_amount) return;
                        if (!window.confirm(`Change the doc fee to $${next.toFixed(2)}? This recalculates stored sale prices across your inventory.`)) return;
                        updateSettings({ doc_fee_amount: next });
                      }}
                      className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            <div id="price-display" className="bg-card rounded-lg p-4 shadow-sm">
              <h4 className="text-sm font-bold text-foreground mb-2">Customer Price Display</h4>
              <select
                value={settings.price_display_mode || "advertised_before_doc"}
                onChange={(e) => updateSettings({ price_display_mode: e.target.value as DealerSettings["price_display_mode"] })}
                className="w-full px-3 py-2 border border-border-custom rounded text-sm"
              >
                <option value="advertised_before_doc">Advertised price (before doc fee) — disclose fee separately</option>
                <option value="website_sale_price">Website sale price (doc fee included)</option>
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Controls the price shown on the customer Passport. The advertised price is always compared to market before the doc fee.
              </p>
            </div>

            <div id="comp-strategy" className="bg-card rounded-lg p-4 shadow-sm">
              <h4 className="text-sm font-bold text-foreground mb-2">Market Comparison Pricing</h4>
              <select
                value={settings.comp_settings?.compStrategy || "value_building"}
                onChange={(e) => updateSettings({ comp_settings: { ...(settings.comp_settings || {}), compStrategy: e.target.value as CompStrategy } })}
                className="w-full px-3 py-2 border border-border-custom rounded text-sm"
              >
                {COMP_STRATEGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Controls how comparable vehicles are selected for customer-facing market panels.{" "}
                {COMP_STRATEGY_OPTIONS.find((o) => o.value === (settings.comp_settings?.compStrategy || "value_building"))?.help}
              </p>
              {(settings.comp_settings?.compStrategy || "value_building") === "value_building" && (
                <label className="flex items-start gap-2 text-xs text-foreground mt-2">
                  <input
                    type="checkbox" className="mt-0.5"
                    checked={!!settings.comp_settings?.includeLowerPricedComps}
                    onChange={(e) => updateSettings({ comp_settings: { ...(settings.comp_settings || {}), includeLowerPricedComps: e.target.checked } })}
                  />
                  <span>Also allow slightly lower-priced comps (within 3% of this vehicle's price). Off by default so comps never undercut your vehicle.</span>
                </label>
              )}
            </div>

            <div id="todays-price" className="bg-card rounded-lg p-4 shadow-sm">
              <h4 className="text-sm font-bold text-foreground mb-2">Today's Price page wording</h4>
              <select
                value={settings.todays_price_mode || "payment_estimate"}
                onChange={(e) => updateSettings({ todays_price_mode: e.target.value as DealerSettings["todays_price_mode"] })}
                className="w-full px-3 py-2 border border-border-custom rounded text-sm"
              >
                {TODAYS_PRICE_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {TODAYS_PRICE_MODE_OPTIONS.find((o) => o.value === (settings.todays_price_mode || "payment_estimate"))?.hint}
              </p>
              {(() => {
                const custom = { ...DEFAULT_TODAYS_PRICE_CUSTOM, ...(settings.todays_price_custom || {}) };
                const setCustom = (patch: Partial<typeof custom>) => updateSettings({ todays_price_custom: { ...custom, ...patch } });
                const preview = resolveTodaysPrice({ todays_price_mode: settings.todays_price_mode, todays_price_custom: custom });
                return (
                  <div className="mt-2 space-y-2">
                    {settings.todays_price_mode === "custom" && (
                      <>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">Headline</label>
                          <input value={custom.headline} onChange={(e) => setCustom({ headline: e.target.value })} placeholder="Today's Price" className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">Subheadline</label>
                          <input value={custom.sub} onChange={(e) => setCustom({ sub: e.target.value })} placeholder="Personalize your payment estimate for this vehicle." className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">Button text</label>
                          <input value={custom.cta} onChange={(e) => setCustom({ cta: e.target.value })} placeholder="Request Payment Details" className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground">Disclaimer</label>
                          <textarea value={custom.disclaimer} onChange={(e) => setCustom({ disclaimer: e.target.value })} rows={2} placeholder="Estimate only, with approved credit…" className="w-full px-3 py-2 border border-border-custom rounded text-sm resize-none" />
                        </div>
                        <label className="flex items-start gap-2 text-xs text-foreground">
                          <input type="checkbox" className="mt-0.5" checked={custom.allow_otd_wording} onChange={(e) => setCustom({ allow_otd_wording: e.target.checked })} />
                          <span>Allow out-the-door / "best price" wording in custom copy. When off, copy containing that language falls back to the safe default.</span>
                        </label>
                      </>
                    )}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {([
                        ["show_calculator", "Show payment calculator"],
                        ["show_down", "Show down payment slider"],
                        ["show_term", "Show term selector"],
                        ["show_apr", "Show APR slider"],
                      ] as ["show_calculator" | "show_down" | "show_term" | "show_apr", string][]).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-xs text-foreground">
                          <input type="checkbox" checked={custom[key]} onChange={(e) => setCustom({ [key]: e.target.checked })} />
                          {label}
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                      Shoppers will see: <span className="font-semibold text-foreground">{preview.headline}</span> — {preview.sub} · Button: <span className="font-semibold text-foreground">{preview.cta}</span>
                    </p>
                  </div>
                );
              })()}
            </div>

            <div id="incentive-programs">
              <IncentivesSettingsPanel />
            </div>
            <div id="addon-elections">
              <AddonElectionsPanel storeId={currentStore?.id || ""} />
            </div>
            <div id="price-audit">
              <PriceAuditPanel />
            </div>
            {isAdmin && (
              <div id="price-integrity">
                <PriceIntegrityPanel />
              </div>
            )}
          </div>
        )}

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
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

        {/* ─── Product Edit Modal ─── */}
        {editing && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg w-full max-w-4xl max-h-[90vh] flex overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0">
              <div className="p-6 space-y-3 overflow-y-auto flex-1">
              <h2 className="text-lg font-bold font-barlow-condensed">{editing.id ? "Edit Product" : "Add Product"}</h2>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Product Name</label>
                <input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Subtitle</label>
                <input value={editing.subtitle || ""} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Warranty</label>
                <input value={editing.warranty || ""} onChange={(e) => setEditing({ ...editing, warranty: e.target.value })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Price ($)</label>
                  <input type="number" step="0.01" value={editing.price || 0} onChange={(e) => setEditing({ ...editing, price: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Sort Order</label>
                  <input type="number" value={editing.sort_order || 0} onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
                </div>
              </div>
              {/* Vehicle-category pricing — optional per-size prices. Blank
                  buckets fall back to the base Price above; the addendum
                  auto-picks the bucket from the vehicle's decoded body class. */}
              <div className="rounded-md border border-border-custom p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">Vehicle-category pricing <span className="font-normal text-muted-foreground">(optional)</span></p>
                <p className="text-[11px] text-muted-foreground">Set a price per vehicle size. Blank uses the base Price above. The addendum picks the right one from the vehicle body class.</p>
                <div className="grid grid-cols-2 gap-2">
                  {PRICE_BUCKETS.map((b) => (
                    <div key={b.id}>
                      <label className="text-[11px] font-medium text-muted-foreground">{b.label}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editing.price_tiers?.[b.id] ?? ""}
                        placeholder={`Base $${Number(editing.price) || 0}`}
                        onChange={(e) => {
                          const next = { ...(editing.price_tiers || {}) };
                          const v = parseFloat(e.target.value);
                          if (!e.target.value || isNaN(v) || v <= 0) delete next[b.id];
                          else next[b.id] = v;
                          setEditing({ ...editing, price_tiers: Object.keys(next).length ? next : null });
                        }}
                        className="w-full px-2 py-1.5 border border-border-custom rounded text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Type</label>
                  <select value={editing.badge_type || "installed"} onChange={(e) => setEditing({ ...editing, badge_type: e.target.value, price_label: e.target.value === "installed" ? "Included in Selling Price" : "If Accepted" })} className="w-full px-3 py-2 border border-border-custom rounded text-sm">
                    <option value="installed">Pre-Installed</option>
                    <option value="optional">Optional</option>
                  </select>
                </div>
                {settings.feature_product_icons && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">Icon</label>
                    <div className="flex items-center gap-2">
                      {editing.icon_type && (
                        <span className="shrink-0 text-muted-foreground"><ProductIcon type={editing.icon_type} className="w-5 h-5" /></span>
                      )}
                      <select
                        value={editing.icon_type || ""}
                        onChange={(e) => setEditing({ ...editing, icon_type: e.target.value })}
                        className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                      >
                        <option value="">No icon</option>
                        {PRODUCT_ICON_KEYS.map((key) => (
                          <option key={key} value={key}>{key.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Price Label</label>
                <input value={editing.price_label || ""} onChange={(e) => setEditing({ ...editing, price_label: e.target.value })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
              </div>
              {/* Disposition descriptions — one set for pre-installed, one
                  for customer-elected optional. Both are stored; the
                  addendum shows the set matching how the line is sold. The
                  Type above marks which is the default + which benefit the
                  red-team requires. */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-muted-foreground">Descriptions by how it's sold</label>

                <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-border-custom p-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!(editing.available_preinstalled ?? true)}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        available_preinstalled: !e.target.checked,
                        ...(e.target.checked ? { badge_type: "optional", price_label: "If Accepted" } : {}),
                      })
                    }
                  />
                  <span>
                    <span className="text-[11px] font-semibold text-foreground">Not available for pre-install</span>
                    <span className="block text-[10px] text-muted-foreground mt-0.5 leading-relaxed">On — sold only as a customer choice, never pre-installed. The pre-installed description is hidden and the addendum keeps this line optional.</span>
                  </span>
                </label>

                {(editing.available_preinstalled ?? true) && (
                <div className={`rounded-lg border p-3 space-y-2.5 ${((editing.badge_type || "installed") === "installed") ? "border-teal/50 bg-teal/5" : "border-border-custom"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">
                      Pre-installed <span className="font-normal text-muted-foreground">— already on the car, in the price</span>
                    </span>
                    {((editing.badge_type || "installed") === "installed") && (
                      <span className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded bg-teal text-primary-foreground">Default</span>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground">Disclosure</label>
                    <textarea value={editing.disclosure || ""} onChange={(e) => setEditing({ ...editing, disclosure: e.target.value })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" rows={2} placeholder="Pre-installed, non-removable; cost included in the selling price…" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-foreground inline-flex items-center gap-1.5">
                      Benefit justification
                      {((editing.badge_type || "installed") === "installed") && (
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Required</span>
                      )}
                    </label>
                    <textarea value={editing.benefit_justification || ""} onChange={(e) => setEditing({ ...editing, benefit_justification: e.target.value })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" rows={2} placeholder="This vehicle was treated before sale with… (why it benefits the buyer)" />
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer pt-0.5">
                    <input type="checkbox" className="mt-0.5" checked={editing.price_in_advertised ?? true} onChange={(e) => setEditing({ ...editing, price_in_advertised: e.target.checked })} />
                    <span>
                      <span className="text-[11px] font-semibold text-foreground">Price is included in the advertised price</span>
                      <span className="block text-[10px] text-muted-foreground mt-0.5 leading-relaxed">On — itemized for transparency, never charged again. Off — a dealer-installed upcharge above the advertised price the customer confirms.</span>
                    </span>
                  </label>
                </div>
                )}

                <div className={`rounded-lg border p-3 space-y-2.5 ${!((editing.badge_type || "installed") === "installed") ? "border-teal/50 bg-teal/5" : "border-border-custom"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">
                      Optional <span className="font-normal text-muted-foreground">— customer adds at time of sale</span>
                    </span>
                    {!((editing.badge_type || "installed") === "installed") && (
                      <span className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded bg-teal text-primary-foreground">Default</span>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground">Disclosure</label>
                    <textarea value={editing.disclosure_optional || ""} onChange={(e) => setEditing({ ...editing, disclosure_optional: e.target.value })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" rows={2} placeholder="Optional — not required to buy or finance, does not affect your rate; itemized as an add-on…" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-foreground inline-flex items-center gap-1.5">
                      Benefit justification
                      {!((editing.badge_type || "installed") === "installed") && (
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Required</span>
                      )}
                    </label>
                    <textarea value={editing.benefit_justification_optional || ""} onChange={(e) => setEditing({ ...editing, benefit_justification_optional: e.target.value })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" rows={2} placeholder="At the time of sale you chose to add… (why it benefits the buyer)" />
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Both sets are stored. The addendum shows the set matching how the line is sold on each deal (optional falls back to the pre-installed text when blank). Required benefit answers FTC §5 / CA SB 766 §11713.21.
                </p>

                {/* Upgrade tier — optional higher level (e.g. Standard ->
                    Platinum). When applied on an addendum line it swaps the
                    line to this package price + descriptions. */}
                <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-border-custom p-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!editing.upgrade}
                    onChange={(e) => setEditing({ ...editing, upgrade: e.target.checked ? (editing.upgrade ?? EMPTY_UPGRADE) : null })}
                  />
                  <span>
                    <span className="text-[11px] font-semibold text-foreground">This product has an upgrade tier</span>
                    <span className="block text-[10px] text-muted-foreground mt-0.5 leading-relaxed">A higher level (e.g. Platinum that includes Standard). On the addendum the dealer can apply it to a line — the line swaps to this package price, disclosure, and benefit.</span>
                  </span>
                </label>

                {editing.upgrade && (
                  <div className="rounded-lg border border-gold/50 bg-gold/5 p-3 space-y-2.5">
                    <span className="text-xs font-bold text-foreground">Upgrade tier</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground">Upgrade name</label>
                        <input value={editing.upgrade.name} onChange={(e) => setEditing({ ...editing, upgrade: { ...(editing.upgrade ?? EMPTY_UPGRADE), name: e.target.value } })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" placeholder="Platinum Protection" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground">Package price ($)</label>
                        <input type="number" step="0.01" value={editing.upgrade.price} onChange={(e) => setEditing({ ...editing, upgrade: { ...(editing.upgrade ?? EMPTY_UPGRADE), price: parseFloat(e.target.value) || 0 } })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" />
                      </div>
                    </div>
                    <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-border-custom p-2.5">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={!(editing.upgrade.available_preinstalled ?? true)}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            upgrade: { ...(editing.upgrade ?? EMPTY_UPGRADE), available_preinstalled: !e.target.checked },
                          })
                        }
                      />
                      <span>
                        <span className="text-[11px] font-semibold text-foreground">Not available for pre-install</span>
                        <span className="block text-[10px] text-muted-foreground mt-0.5 leading-relaxed">On — this upgrade is installed after delivery only. The pre-installed description is hidden and applying it keeps the line optional, even when the base product is pre-installed.</span>
                      </span>
                    </label>
                    {(editing.available_preinstalled ?? true) && (editing.upgrade.available_preinstalled ?? true) && (
                      <div className="rounded-lg border border-border-custom p-3 space-y-2.5">
                        <span className="text-[11px] font-bold text-foreground">Pre-installed <span className="font-normal text-muted-foreground">(upgrade)</span></span>
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground">Disclosure</label>
                          <textarea value={editing.upgrade.disclosure} onChange={(e) => setEditing({ ...editing, upgrade: { ...(editing.upgrade ?? EMPTY_UPGRADE), disclosure: e.target.value } })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" rows={2} placeholder="Upgrade pre-installed disclosure…" />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground">Benefit justification</label>
                          <textarea value={editing.upgrade.benefit_justification} onChange={(e) => setEditing({ ...editing, upgrade: { ...(editing.upgrade ?? EMPTY_UPGRADE), benefit_justification: e.target.value } })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" rows={2} placeholder="Includes Standard, plus… (why the upgrade benefits the buyer)" />
                        </div>
                      </div>
                    )}
                    <div className="rounded-lg border border-border-custom p-3 space-y-2.5">
                      <span className="text-[11px] font-bold text-foreground">Optional <span className="font-normal text-muted-foreground">(upgrade)</span></span>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground">Disclosure</label>
                        <textarea value={editing.upgrade.disclosure_optional} onChange={(e) => setEditing({ ...editing, upgrade: { ...(editing.upgrade ?? EMPTY_UPGRADE), disclosure_optional: e.target.value } })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" rows={2} placeholder="Upgrade optional disclosure…" />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground">Benefit justification</label>
                        <textarea value={editing.upgrade.benefit_justification_optional} onChange={(e) => setEditing({ ...editing, upgrade: { ...(editing.upgrade ?? EMPTY_UPGRADE), benefit_justification_optional: e.target.value } })} className="w-full px-3 py-2 border border-border-custom rounded text-sm" rows={2} placeholder="Includes Standard, plus… (why the upgrade benefits the buyer)" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
                <span className="text-xs font-bold text-foreground inline-flex items-center gap-1.5">
                  Product document
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Required</span>
                </span>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Attach the product contract — or the warranty card when there is no contract. It's the substantiation behind the benefit claims (FTC §5) and rides with the signed packet.
                </p>
                <div className="flex items-center gap-4">
                  <label className="text-[11px] font-semibold text-foreground inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="contract_doc_type" checked={(editing.contract_doc_type || "contract") === "contract"} onChange={() => setEditing({ ...editing, contract_doc_type: "contract" })} /> Contract
                  </label>
                  <label className="text-[11px] font-semibold text-foreground inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="contract_doc_type" checked={editing.contract_doc_type === "warranty"} onChange={() => setEditing({ ...editing, contract_doc_type: "warranty" })} /> Warranty card
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    disabled={uploadingDoc}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadDoc(f); }}
                    className="text-[11px]"
                  />
                  {uploadingDoc && <span className="text-[10px] text-muted-foreground">Uploading…</span>}
                </div>
                {editing.contract_url ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const url = editing.contract_url || "";
                      if (/^https?:\/\//i.test(url)) { window.open(url, "_blank", "noopener,noreferrer"); return; }
                      const { data, error } = await supabase.storage.from("product-docs").createSignedUrl(url, 3600);
                      if (error || !data?.signedUrl) { toast.error(`Could not open document: ${error?.message || "unknown error"}`); return; }
                      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                    }}
                    className="text-[11px] text-[#2563EB] hover:underline text-left"
                  >
                    View attached {editing.contract_doc_type === "warranty" ? "warranty card" : "contract"}
                  </button>
                ) : (
                  <p className="text-[10px] text-destructive font-semibold">No document attached — required to save.</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
                <label className="text-xs">Active</label>
              </div>
              </div>
              {/* Sticky footer — always visible regardless of form length. */}
              <div className="flex gap-2 p-4 border-t border-border bg-card">
                <button onClick={() => setEditing(null)} className="flex-1 py-2 bg-muted text-foreground rounded font-semibold text-sm">Cancel</button>
                <button onClick={handleSaveProduct} className="flex-1 py-2 bg-teal text-primary-foreground rounded font-semibold text-sm">{editing.id ? "Save Product" : "Add Product"}</button>
              </div>
              </div>
              <ProductEditPreview editing={editing} />
            </div>
          </div>
        )}

        {/* ─── Rule Edit Modal ─── */}
        {editingRule && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg p-6 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold font-barlow-condensed">{editingRule._new ? "Add Rule" : "Edit Rule"}</h2>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Product</label>
                <select
                  value={editingRule.product_id || ""}
                  onChange={(e) => setEditingRule({ ...editingRule, product_id: e.target.value })}
                  className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                >
                  <option value="">Select product...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.badge_type})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Year Min</label>
                  <input
                    value={editingRule.year_min || ""}
                    onChange={(e) => setEditingRule({ ...editingRule, year_min: e.target.value })}
                    placeholder="e.g. 2020"
                    className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Year Max</label>
                  <input
                    value={editingRule.year_max || ""}
                    onChange={(e) => setEditingRule({ ...editingRule, year_max: e.target.value })}
                    placeholder="e.g. 2026"
                    className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Makes (comma-separated, blank = all)</label>
                <input
                  value={editingRule.makes?.join(", ") || ""}
                  onChange={(e) => setEditingRule({ ...editingRule, makes: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  placeholder="e.g. Honda, Toyota, Nissan"
                  className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Models (comma-separated, blank = all)</label>
                <input
                  value={editingRule.models?.join(", ") || ""}
                  onChange={(e) => setEditingRule({ ...editingRule, models: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  placeholder="e.g. CR-V, RAV4, Civic"
                  className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Trims (comma-separated, blank = all)</label>
                <input
                  value={editingRule.trims?.join(", ") || ""}
                  onChange={(e) => setEditingRule({ ...editingRule, trims: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  placeholder="e.g. EX-L, Sport, Touring"
                  className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Body Styles (comma-separated, blank = all)</label>
                <input
                  value={editingRule.body_styles?.join(", ") || ""}
                  onChange={(e) => setEditingRule({ ...editingRule, body_styles: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  placeholder="e.g. SUV, Sedan, Truck"
                  className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Condition</label>
                  <select
                    value={editingRule.condition || "all"}
                    onChange={(e) => setEditingRule({ ...editingRule, condition: e.target.value as any })}
                    className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                  >
                    <option value="all">All</option>
                    <option value="new">New Only</option>
                    <option value="used">Used Only</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Max Mileage (0 = no limit)</label>
                  <input
                    type="number"
                    value={editingRule.mileage_max || 0}
                    onChange={(e) => setEditingRule({ ...editingRule, mileage_max: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-border-custom rounded text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={handleSaveRule} className="flex-1 py-2 bg-teal text-primary-foreground rounded font-semibold text-sm">Save Rule</button>
                <button onClick={() => setEditingRule(null)} className="flex-1 py-2 bg-muted text-foreground rounded font-semibold text-sm">Cancel</button>
              </div>
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

// Live customer-facing preview + FTC-readiness checklist shown beside the
// product editor. Mirrors how the line renders on the addendum so the dealer
// sees the output (and what's still missing) while editing.
const ProductEditPreview = ({ editing }: { editing: Partial<Product> }) => {
  const isInstalled = (editing.badge_type || "installed") === "installed";
  const disclosure = isInstalled
    ? (editing.disclosure || "")
    : (editing.disclosure_optional || editing.disclosure || "");
  const benefit = isInstalled
    ? (editing.benefit_justification || "")
    : (editing.benefit_justification_optional || editing.benefit_justification || "");
  const price = Number(editing.price) || 0;
  const inAdvertised = editing.price_in_advertised ?? true;

  const checks = [
    { label: "Pricing set", ok: price > 0 },
    { label: "Disclosure present", ok: !!(editing.disclosure || editing.disclosure_optional || "").trim() },
    { label: "Benefit justification present", ok: !!(editing.benefit_justification || editing.benefit_justification_optional || "").trim() },
    { label: "Contract / warranty attached", ok: !!editing.contract_url },
  ];
  const done = checks.filter((c) => c.ok).length;
  const score = Math.round((done / checks.length) * 100);
  const scoreColor = score === 100 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-destructive";

  return (
    <div className="hidden lg:flex w-80 flex-shrink-0 flex-col border-l border-border bg-muted/20 overflow-y-auto">
      <div className="p-5 space-y-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customer view</p>
          <p className="text-[11px] text-muted-foreground">This is exactly how this item appears on the addendum.</p>
        </div>

        {/* How the line renders to the customer */}
        <div className="rounded-xl border border-border bg-card shadow-premium p-4">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${isInstalled ? "bg-blue/10 text-blue" : "bg-gold/10 text-gold"}`}>
              {isInstalled ? "Pre-Installed" : "Optional"}
            </span>
            <span className="text-sm font-bold tabular-nums text-foreground">${price.toFixed(2)}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-foreground">{editing.name || "Product name"}</p>
          {editing.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{editing.subtitle}</p>}
          {editing.warranty && <p className="text-[11px] text-muted-foreground mt-2">Warranty: {editing.warranty}</p>}
          <p className="text-[10px] text-muted-foreground mt-2">
            {inAdvertised ? "Itemized — included in the advertised price." : "Dealer-installed upcharge above the advertised price."}
          </p>
          {disclosure ? (
            <p className="text-[11px] text-foreground mt-3 whitespace-pre-wrap leading-snug">{disclosure}</p>
          ) : (
            <p className="text-[11px] italic text-muted-foreground mt-3">Disclosure will appear here.</p>
          )}
          {benefit && (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Why this benefits you</p>
              <p className="text-[11px] text-foreground mt-1 whitespace-pre-wrap leading-snug">{benefit}</p>
            </div>
          )}
        </div>

        {/* FTC-readiness — the reason dealers buy AutoLabels, so it carries
            the strongest visual weight (colored border + large score). */}
        <div className={`rounded-xl border-2 p-4 shadow-premium ${score === 100 ? "border-emerald-500 bg-emerald-50" : score >= 50 ? "border-amber-300 bg-amber-50/60" : "border-destructive/40 bg-destructive/5"}`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-foreground">{score === 100 ? "FTC Ready" : "FTC Readiness"}</p>
            <span className={`text-2xl font-bold tabular-nums ${scoreColor}`}>{score}%</span>
          </div>
          <div className="mt-3 space-y-2">
            {checks.map((c) => (
              <div key={c.label} className="flex items-center gap-2">
                {c.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                )}
                <span className={`text-[11px] ${c.ok ? "text-foreground" : "text-muted-foreground"}`}>{c.label}</span>
              </div>
            ))}
          </div>
          {score < 100 && (
            <p className="text-[10px] text-muted-foreground mt-3">Complete every item before this product is sale-ready.</p>
          )}
        </div>
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
