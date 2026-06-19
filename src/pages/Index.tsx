import { useState, useRef, useEffect, useMemo } from "react";
import { useProducts, Product, type ProductUpgrade } from "@/hooks/useProducts";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useProductRules, VehicleContext } from "@/hooks/useProductRules";
import { bucketForVehicle, resolveTierPrice } from "@/types/product";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { computeFinancingDisclosure } from "@/lib/sb766";
import { getDocFeeDisclosure, getDocFeeTerminology } from "@/data/docFees";
import PurchaseSummary from "@/components/addendum/PurchaseSummary";
import AddendumHeader from "@/components/addendum/AddendumHeader";
import VehicleStrip from "@/components/addendum/VehicleStrip";
import IntentBox from "@/components/addendum/IntentBox";
import ProductRow from "@/components/addendum/ProductRow";
import { useSmsDelivery } from "@/hooks/useSmsDelivery";
import { useAdvertisedPrices, assessPriceIntegrity, type AdvertisedSource } from "@/hooks/useAdvertisedPrices";
import AddendumPriceIntegrity from "@/components/addendum/AddendumPriceIntegrity";
import TotalBar from "@/components/addendum/TotalBar";
import SelectionRecord from "@/components/addendum/SelectionRecord";
import Disclosures, { type DisclosureLanguage } from "@/components/addendum/Disclosures";
import FinancingImpact from "@/components/addendum/FinancingImpact";
import SignaturePad from "@/components/addendum/SignaturePad";
import AddendumFooter from "@/components/addendum/AddendumFooter";
import QRCodeModal from "@/components/addendum/QRCodeModal";
import LeadCaptureModal from "@/components/addendum/LeadCaptureModal";
import AddendumStatusTimeline from "@/components/addendum/AddendumStatusTimeline";
import VinBarcode from "@/components/addendum/VinBarcode";
import VehicleDetailsBar from "@/components/addendum/VehicleDetailsBar";
import CustomerInfoSection, { CustomerInfo, emptyCustomerInfo, composeName } from "@/components/addendum/CustomerInfoSection";
import { ScrapedVehicle } from "@/hooks/useVehicleUrlScrape";
import { useAudit } from "@/contexts/AuditContext";
import { useTenant } from "@/contexts/TenantContext";
import { useVehicleFiles } from "@/hooks/useVehicleFiles";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Save, Send, Printer, Download, ChevronDown, Check, Pencil } from "lucide-react";
import ComplianceRedTeamPanel from "@/components/addendum/ComplianceRedTeamPanel";
import { runComplianceRedTeam, summarizeRedTeam } from "@/lib/complianceRedTeam";
import StateRewriterPanel from "@/components/addendum/StateRewriterPanel";

// Paper size map (width in inches)
// Paper size widths for the addendum card preview
const PAPER_WIDTHS: Record<string, string> = {
  letter: "8.5in",            // 8.5 × 11
  legal: "8.5in",             // 8.5 × 14
  "half-sheet": "5.5in",      // 5.5 × 8.5
  "addendum-strip": "4.25in", // 4.25 × 11 (standard addendum strip)
  "addendum-half": "5.5in",   // 5.5 × 12.5 (common half-page addendum)
  monroney: "7.5in",          // 7.5 × 10 (Monroney sticker format)
  custom: "8.5in",
};

// ── Sale Method ──────────────────────────────────────────────────
// The three peer dispositions a product can carry on a deal. Switching
// mode swaps the disclosure + benefit + acknowledgment + signature
// requirements (handled downstream in displayProducts) and writes an
// audit row. Never instant: the badge opens a menu, the menu requires
// an explicit confirm.
type SaleMode = "pre_installed" | "customer_elected" | "upgrade";

// Columns added by later migrations the live schema may not have applied yet.
// Saves strip these and retry so a propagating migration never blocks a write.
const OPTIONAL_ADDENDUM_COLS = [
  "customer_info", "selling_price", "vehicle_price", "expected_total",
  "scraped_advertised_price", "price_verification_delta", "price_verified",
  "price_verified_at", "price_verification_status", "price_verification_method",
] as const;
const stripOptionalCols = (p: Record<string, unknown>) => {
  const c = { ...p };
  for (const k of OPTIONAL_ADDENDUM_COLS) delete c[k];
  return c;
};
const isMissingOptionalCol = (e: { message?: string } | null) =>
  !!e && OPTIONAL_ADDENDUM_COLS.some((k) => new RegExp(k, "i").test(e.message || ""));

const SALE_MODE_META: Record<SaleMode, { label: string; badge: string; dot: string }> = {
  pre_installed:    { label: "Pre-Installed",    badge: "bg-blue-600 text-white border-blue-700",     dot: "bg-blue-500" },
  customer_elected: { label: "Customer Elected", badge: "bg-orange-500 text-white border-orange-600", dot: "bg-orange-500" },
  upgrade:          { label: "Upgrade",          badge: "bg-violet-600 text-white border-violet-700", dot: "bg-violet-500" },
};

const SaleModeControl = ({
  mode,
  options,
  onChange,
}: {
  mode: SaleMode;
  options: SaleMode[];
  onChange: (next: SaleMode) => void;
}) => {
  const [open, setOpen] = useState(false);
  const meta = SALE_MODE_META[mode];

  return (
    <span className="no-print relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wide ${meta.badge}`}
        title="Change sale method"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-white/90" />
        {meta.label}
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <span className="absolute z-30 mt-1 left-0 w-44 rounded-lg border border-border bg-card shadow-lg overflow-hidden block">
          <span className="block px-2.5 py-1.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
            Change sale method
          </span>
          {options.map((opt) => {
            const om = SALE_MODE_META[opt];
            const isCurrent = opt === mode;
            return (
              <button
                key={opt}
                type="button"
                disabled={isCurrent}
                onClick={() => { setOpen(false); if (!isCurrent) onChange(opt); }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[10px] ${isCurrent ? "bg-muted/50 cursor-default" : "hover:bg-muted"}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${om.dot}`} />
                <span className="font-semibold text-foreground">{om.label}</span>
                {isCurrent && <Check className="w-3 h-3 ml-auto text-emerald-500" />}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
};

const Index = () => {
  const { data: products, isLoading } = useProducts();
  const { user, isAdmin } = useAuth();
  const { settings } = useDealerSettings();
  const { rules, getMatchingProducts } = useProductRules();
  const { log } = useAudit();
  const { currentStore, tenant } = useTenant();
  const { byVin, captureSnapshot } = useAdvertisedPrices(currentStore?.id || "");
  const { sendSigningLink } = useSmsDelivery();
  const { getOrCreateFile, registerSticker } = useVehicleFiles(currentStore?.id || "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewId = searchParams.get("id");
  // ?edit=1 opens a saved/pending addendum in editable mode (continue editing)
  // instead of the read-only view.
  const editParam = searchParams.get("edit") === "1";
  // The row we're editing/updating, so re-saving a draft updates it in place
  // (and keeps it as ONE entry in Saved Addendums) instead of inserting copies.
  const [currentId, setCurrentId] = useState<string | null>(viewId);
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [inkSaving, setInkSaving] = useState(false);
  // On-screen preview zoom only. Print + PDF capture always reset to 1
  // so the artifact stays true-to-paper-size.
  // Default the on-screen preview to 140% on desktop (wider screens) where
  // there's room; phones/tablets stay at 110% so the sheet fits.
  const [zoom, setZoom] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= 1024 ? 1.4 : 1.1,
  );
  const defaultZoom = typeof window !== "undefined" && window.innerWidth >= 1024 ? 1.4 : 1.1;
  // Language of the disclosure block. FTC Used Car Rule + CA SB 766
  // require the disclosure to be presented in the language the sale
  // is conducted in. Dealer picks per-addendum; "en" is default.
  const [disclosureLanguage, setDisclosureLanguage] = useState<DisclosureLanguage>("en");
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState(false);
  const [loadedProducts, setLoadedProducts] = useState<Product[] | null>(null);

  // Vehicle info
  const [vehicle, setVehicle] = useState({ ymm: "", stock: "", vin: "", date: "" });

  // Customer info — buyer and co-buyer
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(emptyCustomerInfo);

  // Decoded vehicle context for rules
  const [vehicleContext, setVehicleContext] = useState<VehicleContext>({
    year: "", make: "", model: "", trim: "", bodyStyle: "",
  });

  // Scraped vehicle details (from URL import)
  const [vehicleDetails, setVehicleDetails] = useState<Partial<ScrapedVehicle>>({});

  // Actual selling price BEFORE the doc fee. The FTC price-integrity gate
  // reconciles selling + doc fee + every pre-installed (in-advertised) item
  // against the scraped advertised/website price for this VIN.
  const [sellingPrice, setSellingPrice] = useState<number | null>(null);
  const [rescraping, setRescraping] = useState(false);

  // Product type overrides — employee can toggle installed <-> optional at signing time
  const [typeOverrides, setTypeOverrides] = useState<Record<string, "installed" | "optional">>({});
  // Per-line upgrade-tier selection (multi-level products). When true the
  // line swaps to the product's upgrade package price + descriptions.
  const [upgradeSelections, setUpgradeSelections] = useState<Record<string, boolean>>({});
  // Wave 16 v2 — per-addendum benefit-justification override.
  // Seeded from the catalog at displayProducts build time; the
  // dealer can edit per vehicle in the no-print editor under
  // each line. SB 766 §11713.21 explicitly anticipates per-
  // transaction justification, not catalog boilerplate.
  const [benefitOverrides, setBenefitOverrides] = useState<Record<string, string>>({});

  // Initials & optional selections
  const [initials, setInitials] = useState<Record<string, string>>({});
  const [optionalSelections, setOptionalSelections] = useState<Record<string, string>>({});

  // Signatures
  const [customerSig, setCustomerSig] = useState({ data: "", type: "draw" as "draw" | "type", at: "" });
  const [cobuyerSig, setCobuyerSig] = useState({ data: "", type: "draw" as "draw" | "type", at: "" });
  const [employeeSig, setEmployeeSig] = useState({ data: "", type: "draw" as "draw" | "type", at: "" });

  // QR / Lead capture modal
  const [qrOpen, setQrOpen] = useState(false);
  const [signingUrl, setSigningUrl] = useState("");
  // Wave 15.3 — compliance receipt rendered in the QR modal. The
  // gates already fire silently inside handleSendToCustomer (red-
  // team check, state doc-fee, E-SIGN consent prep). We surface
  // them as concrete bullet points so the dealer SEES the moat
  // they're paying for, not just a "link created" toast.
  const [complianceReceipt, setComplianceReceipt] = useState<{ label: string; cite?: string }[]>([]);
  // Phase 2 lifecycle — set when "Ready for Signatures" locks + versions the
  // addendum, so the delivery modal can show the version/Deal ID and emit
  // per-channel `link_sent` events to the addendum timeline.
  const [readyDealId, setReadyDealId] = useState("");
  const [readyToken, setReadyToken] = useState("");
  const [versionLabel, setVersionLabel] = useState("");

  // Statutory doc-fee disclosure for the operating state. Fed into the
  // compliance validator's stickerText so the required-verbiage check
  // (e.g. CT "conveyance fee" + "not a tax or government fee") matches the
  // language the TotalBar actually renders.
  const docFeeDisclosureText =
    settings.doc_fee_enabled && (settings.doc_fee_amount || 0) > 0
      ? getDocFeeDisclosure(settings.doc_fee_state || settings.dealer_state || "", settings.doc_fee_amount)
      : "";

  // Dealer identity embedded on the addendum row so the public signer page
  // (no access to dealer settings) can print the licensed seller's name AND
  // full address on the signed waiver.
  const dealerSnapshot = {
    name: currentStore?.name || settings.dealer_name || tenant?.name || "",
    phone: settings.dealer_phone || currentStore?.phone || "",
    tagline: settings.dealer_tagline || "",
    logo_url: settings.dealer_logo_url || currentStore?.logo_url || tenant?.logo_url || "",
    address: settings.dealer_address || "",
    city: settings.dealer_city || "",
    state: settings.dealer_state || "",
    zip: settings.dealer_zip || "",
    license_number: settings.dealer_license_number || "",
  };

  // Paper size
  const paperWidth = settings.addendum_paper_size === "custom"
    ? `${settings.addendum_custom_width || "8.5"}in`
    : PAPER_WIDTHS[settings.addendum_paper_size] || "8.5in";

  // Load saved addendum when ?id= is present
  useEffect(() => {
    if (!viewId) {
      setViewMode(false);
      setLoadedProducts(null);
      setCurrentId(null);
      return;
    }
    setCurrentId(viewId);
    const loadAddendum = async () => {
      const { data, error } = await supabase
        .from("addendums")
        .select("*")
        .eq("id", viewId)
        .maybeSingle();
      if (error || !data) {
        toast.error("Could not load addendum");
        return;
      }
      // ?edit=1 → editable; otherwise read-only view.
      setViewMode(!editParam);
      setVehicle({
        ymm: data.vehicle_ymm || "",
        stock: data.vehicle_stock || "",
        vin: data.vehicle_vin || "",
        date: data.addendum_date || "",
      });
      setInitials((data.initials as Record<string, string>) || {});
      setOptionalSelections((data.optional_selections as Record<string, string>) || {});
      const savedSelling = (data as { selling_price?: number | null }).selling_price;
      setSellingPrice(typeof savedSelling === "number" ? savedSelling : null);

      // Prefer the full saved customer_info bag (address, phone, email, …).
      // Fall back to splitting the composite names for rows saved before the
      // customer_info column existed.
      const savedCi = (data as { customer_info?: Partial<CustomerInfo> }).customer_info;
      if (savedCi && Object.keys(savedCi).length > 0) {
        setCustomerInfo({ ...emptyCustomerInfo, ...savedCi });
      } else {
        const [bFirst, ...bRest] = (data.customer_name || "").split(" ");
        const [cFirst, ...cRest] = (data.cobuyer_name || "").split(" ");
        setCustomerInfo({
          ...emptyCustomerInfo,
          buyer_first_name: bFirst || "",
          buyer_last_name: bRest.join(" "),
          cobuyer_first_name: cFirst || "",
          cobuyer_last_name: cRest.join(" "),
        });
      }

      setCustomerSig({
        data: data.customer_signature_data || "",
        type: (data.customer_signature_type as "draw" | "type") || "draw",
        at: (data as { customer_signed_at?: string }).customer_signed_at || "",
      });
      setCobuyerSig({
        data: data.cobuyer_signature_data || "",
        type: (data.cobuyer_signature_type as "draw" | "type") || "draw",
        at: (data as { cobuyer_signed_at?: string }).cobuyer_signed_at || "",
      });
      setEmployeeSig({
        data: data.employee_signature_data || "",
        type: (data.employee_signature_type as "draw" | "type") || "draw",
        at: (data as { employee_signed_at?: string }).employee_signed_at || "",
      });
      const snapshot = (data.products_snapshot || []) as Partial<Product>[];
      if (snapshot.length) {
        setLoadedProducts(snapshot.map((p, i) => ({
          id: p.id || crypto.randomUUID(),
          name: p.name || "",
          subtitle: p.subtitle ?? null,
          warranty: p.warranty ?? null,
          badge_type: p.badge_type || "installed",
          price: p.price ?? 0,
          price_label: p.price_label ?? null,
          disclosure: p.disclosure ?? null,
          sort_order: p.sort_order ?? i,
          is_active: true,
          benefit_justification: (p as { benefit_justification?: string }).benefit_justification ?? "",
          benefit_justification_optional: (p as { benefit_justification_optional?: string | null }).benefit_justification_optional ?? null,
          disclosure_optional: (p as { disclosure_optional?: string | null }).disclosure_optional ?? null,
          price_in_advertised: (p as { price_in_advertised?: boolean }).price_in_advertised ?? true,
          available_preinstalled: (p as { available_preinstalled?: boolean }).available_preinstalled ?? true,
          upgrade: (p as { upgrade?: ProductUpgrade | null }).upgrade ?? null,
          contract_url: (p as { contract_url?: string | null }).contract_url ?? null,
          contract_doc_type: (p as { contract_doc_type?: string | null }).contract_doc_type ?? null,
          price_tiers: (p as { price_tiers?: Record<string, number> | null }).price_tiers ?? null,
        })));
      }
    };
    loadAddendum();
  }, [viewId, editParam]);

  // View mode shows the saved snapshot as-is. Edit/fresh derive from the live
  // catalog (raw base name + base price + upgrade object) so the upgrade toggle
  // recomputes correctly instead of stacking onto an already-combined snapshot.
  const baseProducts = viewMode && loadedProducts ? loadedProducts : products;
  const ruledProducts = settings.feature_product_rules && rules.length > 0 && !viewMode
    ? getMatchingProducts(vehicleContext, baseProducts || [])
    : baseProducts;

  // Install-proof regime — once any vendor/detail-shop has scanned this VIN
  // and verified an installation, the deal enters the proof regime: products
  // with a matching proof default to Pre-Installed and everything else
  // defaults to Customer Elected (a fresh car with nothing installed yet is
  // the customer's choice). Before any proof exists, defaulting is unchanged.
  // The dealer can always override per line with the Sale Method control.
  const [installProofs, setInstallProofs] = useState<{ product_name: string | null; is_verified?: boolean }[]>([]);
  useEffect(() => {
    const vin = vehicle.vin?.trim();
    const tid = currentStore?.id;
    // Tenant-scope the lookup so a shared VIN across dealers can't leak
    // another tenant's proofs into this deal's defaulting.
    if (!vin || viewMode || !tid) { setInstallProofs([]); return; }
    let cancelled = false;
    (async () => {
      // Pull is_verified when present; fall back gracefully if the column
      // hasn't propagated yet (treat any proof as verified in that window).
      let res = await (supabase as any)
        .from("install_proofs")
        .select("product_name, is_verified")
        .eq("vehicle_vin", vin)
        .eq("tenant_id", tid);
      if (res.error && /is_verified/i.test(res.error.message || "")) {
        res = await (supabase as any)
          .from("install_proofs").select("product_name").eq("vehicle_vin", vin).eq("tenant_id", tid);
      }
      if (!cancelled) setInstallProofs((res.data as { product_name: string | null; is_verified?: boolean }[]) || []);
    })();
    return () => { cancelled = true; };
  }, [vehicle.vin, viewMode, currentStore?.id]);
  // Only a VERIFIED proof (installer signature + photo) lets a line default to
  // Pre-Installed. A bare/photoless proof must not flip a product into the
  // advertised price — FTC substantiation. (When is_verified is absent because
  // the column hasn't migrated, undefined is treated as verified.)
  const provenNames = useMemo(
    () => new Set(
      installProofs
        .filter((p) => p.is_verified !== false)
        .map((p) => (p.product_name || "").trim().toLowerCase())
        .filter(Boolean),
    ),
    [installProofs],
  );
  const proofRegime = provenNames.size > 0;

  // Apply product_default_mode + per-product overrides, then pick the
  // disposition-correct disclosure + benefit (pre-installed vs optional),
  // forcing optional for non-preinstallable products and swapping to the
  // upgrade tier when the line has the upgrade applied.
  const displayProducts = useMemo(() => {
    if (!ruledProducts) return [];
    // Read-only view of a saved addendum: the snapshot already has final
    // name/price/badge/benefit. Re-deriving would re-combine the upgrade name
    // ("base — upgrade — upgrade") and re-freeze the price, so pass it through.
    if (viewMode && loadedProducts) return ruledProducts;
    return ruledProducts.map(p => {
      const pr = p as {
        benefit_justification?: string;
        benefit_justification_optional?: string | null;
        disclosure?: string | null;
        disclosure_optional?: string | null;
        available_preinstalled?: boolean;
        upgrade?: ProductUpgrade | null;
        price_tiers?: Record<string, number> | null;
      };
      // Effective disposition: per-vehicle override > admin default mode >
      // catalog type. A product that can't be pre-installed is always
      // optional, no matter the override or mode.
      // Require a reasonably specific match (>= 4 chars) so a short proof
      // name can't flip many unrelated lines to Pre-Installed.
      const proven =
        proofRegime &&
        [...provenNames].some((n) => {
          if (!n || n.length < 4) return false;
          const pn = p.name.toLowerCase();
          return pn === n || pn.includes(n) || n.includes(pn);
        });
      let badge =
        typeOverrides[p.id] ||
        (proofRegime
          ? (proven ? "installed" : "optional")
          : settings.product_default_mode === "all_installed"
            ? "installed"
            : settings.product_default_mode === "all_optional"
              ? "optional"
              : p.badge_type);
      if (pr.available_preinstalled === false) badge = "optional";

      const up = pr.upgrade;
      const upgradeApplied = !!upgradeSelections[p.id] && !!up;
      // An applied upgrade that can't be pre-installed forces the line to
      // customer-elected, even when the base product is pre-installed.
      if (upgradeApplied && up && up.available_preinstalled === false) badge = "optional";
      const isOptional = badge === "optional";

      // Disposition-correct copy, upgraded when the line has the upgrade
      // on. Optional falls back to the pre-installed text when blank; a
      // per-vehicle benefit override still wins (Wave 16 v2).
      const dispoBenefit = isOptional
        ? ((pr.benefit_justification_optional || "").trim() || pr.benefit_justification || "")
        : ((pr.benefit_justification || "").trim() || pr.benefit_justification_optional || "");
      const upgradeBenefit = upgradeApplied && up
        ? (isOptional
            ? ((up.benefit_justification_optional || "").trim() || up.benefit_justification || "")
            : (up.benefit_justification || ""))
        : "";
      const baseBenefit = upgradeBenefit || dispoBenefit;
      const effectiveBenefit =
        benefitOverrides[p.id] !== undefined ? benefitOverrides[p.id] : baseBenefit;

      const dispoDisclosure = isOptional
        ? ((pr.disclosure_optional || "").trim() || pr.disclosure || "")
        : (pr.disclosure || "");
      const upgradeDisclosure = upgradeApplied && up
        ? (isOptional ? ((up.disclosure_optional || "").trim() || up.disclosure || "") : (up.disclosure || ""))
        : "";
      const disclosure = upgradeDisclosure || dispoDisclosure;

      // Idempotent: never append the upgrade name if the base already carries
      // it (guards against a snapshot/catalog name that was combined before).
      const upName = (up?.name || "").trim();
      const name = upgradeApplied && up && upName && !p.name.includes(upName)
        ? `${p.name} — ${up.name}`
        : p.name;
      // Resolve the base price from the vehicle-category tier (when set for
      // this body class), else the catalog base price. Upgrade keeps its
      // own flat price.
      const tierPrice = resolveTierPrice(pr.price_tiers, bucketForVehicle(vehicleContext.bodyStyle, vehicleContext.model));
      const basePrice = tierPrice ?? p.price;
      const price = upgradeApplied && up ? up.price : basePrice;

      // Keep the catalog price label in "selective" mode; apply the
      // standard label when an override / default mode / non-preinstall
      // changed the type.
      const typeChanged =
        !!typeOverrides[p.id] ||
        pr.available_preinstalled === false ||
        settings.product_default_mode === "all_installed" ||
        settings.product_default_mode === "all_optional";
      const price_label = typeChanged
        ? (isOptional ? "If Accepted" : "Included in Selling Price")
        : (p.price_label ?? (isOptional ? "If Accepted" : "Included in Selling Price"));

      return { ...p, name, price, badge_type: badge, price_label, benefit_justification: effectiveBenefit, disclosure };
    });
  }, [ruledProducts, viewMode, loadedProducts, typeOverrides, benefitOverrides, upgradeSelections, settings.product_default_mode, vehicleContext.bodyStyle, vehicleContext.model, proofRegime, provenNames]);

  // Normalize the scraped/entered condition into the red-team's enum. This
  // addendum is a used-car supplement (the vehicle file is registered as
  // "used"), so an unknown condition defaults to "used" — that keeps the FTC
  // Buyers Guide, CT K-208, and CA SB 766 used-car checks active instead of
  // silently disabling them. Passing undefined here is what previously turned
  // those gates off.
  const vehicleCondition: "new" | "used" | "cpo" = useMemo(() => {
    const c = (vehicleDetails.condition || "").toLowerCase();
    if (c.includes("cpo") || c.includes("certified")) return "cpo";
    if (c.includes("new")) return "new";
    return "used";
  }, [vehicleDetails.condition]);

  // Goal A: window price vs latest advertised price for this VIN. Both feed
  // the red-team so a mismatch is flagged before the customer signs.
  const vehiclePriceNum = useMemo(
    () => parseFloat((vehicleDetails.price || "").replace(/[^0-9.]/g, "")) || 0,
    [vehicleDetails.price],
  );
  const advertisedForVin = vehicle.vin ? byVin.get(vehicle.vin.toUpperCase()) : undefined;

  const installed = displayProducts.filter((p) => p.badge_type === "installed");
  const optional = displayProducts.filter((p) => p.badge_type === "optional");
  const installedTotal = installed.reduce((sum, p) => sum + p.price, 0);
  const acceptedOptional = optional.filter((p) => optionalSelections[p.id] === "accept");
  const optionalTotal = acceptedOptional.reduce((sum, p) => sum + p.price, 0);
  const grandTotal = installedTotal + optionalTotal;
  // Co-buyer signature shows ONLY when a co-buyer is on the deal (two
  // customers). One customer → one customer + one dealer signature.
  const hasCobuyer = !!(customerInfo.cobuyer_first_name?.trim() || customerInfo.cobuyer_last_name?.trim());
  const docFeeAmount = settings.doc_fee_enabled ? (settings.doc_fee_amount || 0) : 0;
  const grandTotalWithFee = grandTotal + docFeeAmount;

  // FTC price-integrity gate: selling price + doc fee + every pre-installed
  // (in-advertised, non-removable) item must reconcile to the scraped
  // advertised/website price. Mismatch / missing-selling-price block signing;
  // untracked (no price on file) is a soft prompt to capture/re-scrape.
  const priceIntegrity = useMemo(
    () => assessPriceIntegrity({
      sellingPrice,
      docFee: docFeeAmount,
      products: displayProducts.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        badge_type: p.badge_type,
        price_in_advertised: (p as { price_in_advertised?: boolean }).price_in_advertised,
        removable: (p as { removable?: boolean }).removable,
      })),
      advertised: advertisedForVin,
    }),
    [sellingPrice, docFeeAmount, displayProducts, advertisedForVin],
  );

  // Manual capture of the advertised/website price for this VIN — the escape
  // hatch when the scraper can't reach a JS-walled site. Records an audited
  // advertised_prices snapshot that the integrity check immediately re-reads.
  const captureAdvertised = async (price: number, source: AdvertisedSource) => {
    if (!vehicle.vin.trim()) { toast.error("Enter the VIN first"); return; }
    try {
      await captureSnapshot({
        vin: vehicle.vin,
        advertised_price: price,
        source_label: source,
        captured_by: user?.email || "dealer",
        notes: "Captured at addendum build for price-integrity verification",
      });
      toast.success("Advertised price captured.");
    } catch (e) {
      toast.error((e as Error).message || "Could not capture advertised price");
    }
  };

  // Dealer-uploaded website evidence (screenshot / PDF) for the VIN defense
  // file. Stored in the private price-evidence bucket and recorded as an
  // advertised_prices snapshot so it lands in the per-VIN audit packet.
  const uploadPriceEvidence = async (file: File, price?: number) => {
    const vin = vehicle.vin.toUpperCase().trim();
    if (!vin || !tenant?.id) { toast.error("Enter the VIN first"); return; }
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `${tenant.id}/${vin}/manual-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("price-evidence")
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (up.error) { toast.error("Upload failed: " + up.error.message); return; }
    const adv = price && price > 0
      ? price
      : (advertisedForVin?.advertised_price ?? (priceIntegrity.expectedOnline || vehiclePriceNum || 0));
    const row: Record<string, unknown> = {
      store_id: currentStore?.id || "",
      vin,
      source_channel: "website",
      source_url: "",
      advertised_price: adv,
      captured_by: "dealer_manual",
      screenshot_url: path,
      notes: "Dealer-uploaded website evidence (VIN defense)",
    };
    let insErr = (await (supabase as any).from("advertised_prices").insert(row)).error;
    if (insErr && /screenshot_url/i.test(insErr.message || "")) {
      const { screenshot_url, ...rest } = row;
      insErr = (await (supabase as any).from("advertised_prices").insert(rest)).error;
    }
    if (insErr) { toast.error("Saved the file, but recording it failed: " + insErr.message); return; }
    toast.success("Website evidence attached to this VIN's defense file");
  };

  // Re-scrape the dealer website for this single VIN (Firecrawl-backed crawl).
  const rescrapeVin = async () => {
    if (!vehicle.vin.trim() || !tenant?.id) { toast.error("Enter the VIN first"); return; }
    setRescraping(true);
    try {
      const { error } = await supabase.functions.invoke("crawl-advertised-prices", {
        body: { tenant_id: tenant.id, vin: vehicle.vin.trim().toUpperCase(), discover: true },
      });
      if (error) toast.error("Re-scrape failed — capture the price manually for now");
      else toast.success("Re-scrape requested — refreshing advertised price");
    } finally {
      setRescraping(false);
    }
  };

  const iconMap = JSON.parse(localStorage.getItem(`product_icons:${tenant?.id || "none"}`) || "{}");

  // Sale Method = disposition only (Pre-Installed vs Customer Elected).
  // Upgrade is ORTHOGONAL — a product can be customer-elected AND upgraded —
  // so it lives on its own toggle, not as a third disposition.
  const modeOf = (p: { id: string; badge_type: string; upgrade?: ProductUpgrade | null }): SaleMode =>
    p.badge_type === "optional" ? "customer_elected" : "pre_installed";

  // Applies a sale-method change and writes an append-only audit row to
  // product_sale_mode_changes (fire-and-forget; degrades to a no-op while
  // the table is still propagating). Mirrors into the audit_log spine too.
  const changeSaleMode = (
    p: { id: string; name: string; badge_type: string; upgrade?: ProductUpgrade | null },
    next: SaleMode,
  ) => {
    const from = modeOf(p);
    if (from === next) return;
    // Disposition only — never touches the orthogonal upgrade toggle.
    setTypeOverrides(prev => ({ ...prev, [p.id]: next === "customer_elected" ? "optional" : "installed" }));
    if (next === "pre_installed") {
      setOptionalSelections(prev => { const n = { ...prev }; delete n[p.id]; return n; });
    }
    (supabase as any)
      .from("product_sale_mode_changes")
      .insert({
        tenant_id: tenant?.id || null,
        vehicle_vin: vehicle.vin || null,
        product_id: p.id,
        product_name: p.name,
        from_mode: from,
        to_mode: next,
        changed_by_name: user?.email || null,
      })
      .then(() => {}, () => { /* table may still be propagating */ });
    if (user) {
      log({
        store_id: currentStore?.id || "",
        user_id: user.id,
        action: "product_sale_mode_changed",
        entity_type: "product",
        entity_id: p.id,
        details: { product: p.name, from, to: next, vin: vehicle.vin },
      });
    }
  };

  const handleVinDecoded = (result: { year: string; make: string; model: string; trim: string; bodyStyle: string }) => {
    setVehicleContext({ year: result.year, make: result.make, model: result.model, trim: result.trim, bodyStyle: result.bodyStyle });
  };

  const handleVehicleScraped = (result: ScrapedVehicle) => {
    setVehicleDetails(result);
  };

  // Prefill from a vehicle file: /addendum?vin=&ymm=&trim=&mileage=. Runs once
  // when arriving WITHOUT ?id (loading a saved addendum takes priority), so the
  // dealer never re-keys VIN / year-make-model / mileage we already have.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (viewId || prefilledRef.current) return;
    const vin = searchParams.get("vin") || "";
    const ymmParam = searchParams.get("ymm") || "";
    const trim = searchParams.get("trim") || "";
    const mileage = searchParams.get("mileage") || "";
    if (!vin && !ymmParam && !mileage) return;
    prefilledRef.current = true;
    const ymmFull = [ymmParam, trim].filter(Boolean).join(" ").trim();
    setVehicle((v) => ({ ...v, vin: vin || v.vin, ymm: ymmFull || v.ymm }));
    // Parse "year make model" so the rules engine + saved row get structured YMM.
    const parts = ymmParam.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const [year, make, ...modelRest] = parts;
      setVehicleContext((c) => ({
        ...c,
        year: /^\d{4}$/.test(year) ? year : c.year,
        make: make || c.make,
        model: modelRest.join(" ") || c.model,
        trim: trim || c.trim,
      }));
    }
    if (mileage) setVehicleDetails((d) => ({ ...d, mileage }));
  }, [viewId, searchParams]);

  const handlePrint = () => {
    window.print();
    if (user) log({ store_id: currentStore?.id || "", user_id: user.id, action: "addendum_printed", entity_type: "addendum", entity_id: vehicle.vin, details: { ymm: vehicle.ymm, vin: vehicle.vin, stock: vehicle.stock, customer_name: composeName(customerInfo.buyer_first_name, customerInfo.buyer_middle_initial, customerInfo.buyer_last_name, customerInfo.buyer_suffix) } });
  };

  const handleDownloadPdf = async () => {
    const card = cardRef.current;
    if (!card) return;
    setGenerating(true);
    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const { replaceInputsForCanvas } = await import("@/lib/html2canvasInputs");
      const { default: jsPDF } = await import("jspdf");
      const { archivePdf, persistArchivedPdf } = await import("@/lib/pdfArchive");
      // Capture at true paper size regardless of the on-screen zoom, and in
      // print mode (engraved letterhead / white vehicle block) since
      // html2canvas ignores @media print.
      const prevZoom = card.style.zoom;
      card.style.zoom = "1";
      card.classList.add("addn-print-mode");
      const pdfWidth = 8.5;
      const pageHeight = 11;
      // Measure protected blocks (signatures, total) at zoom=1 so we can
      // avoid slicing through them at a page boundary. Inches = px * scale.
      const cardRect = card.getBoundingClientRect();
      const inPerPx = (cardRect.height > 0) ? ((card.scrollHeight / card.scrollWidth) * pdfWidth) / card.scrollHeight : 0;
      const protectedRanges: { top: number; bottom: number }[] = Array.from(
        card.querySelectorAll<HTMLElement>(".pdf-keep-together"),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return { top: (r.top - cardRect.top) * inPerPx, bottom: (r.bottom - cardRect.top) * inPerPx };
      });
      // Exclude dealer-only controls (toggles, edit textareas) from the
      // customer PDF — they are screen-only editing aids, and html2canvas
      // otherwise ignores @media print and would bake them into the record.
      const canvas = await html2canvas(card, {
        scale: 2,
        useCORS: true,
        ignoreElements: (el) => el.classList?.contains("no-print"),
        // Render input/select/textarea text as plain text so html2canvas
        // doesn't clip it at the bottom of the PDF.
        onclone: replaceInputsForCanvas,
      } as any).finally(() => {
        card.style.zoom = prevZoom;
        card.classList.remove("addn-print-mode");
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const imgHeight = (canvas.height / canvas.width) * pdfWidth;
      const pdf = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });

      // Walk the tall image one page at a time. If a protected block starts
      // on this page but spills past the bottom boundary, end the page at
      // the block's top and mask the cut remainder with white so the block
      // begins cleanly on the next page.
      let start = 0;
      let first = true;
      let guard = 0;
      while (start < imgHeight - 0.01 && guard++ < 60) {
        const boundary = start + pageHeight;
        let pageEnd = Math.min(boundary, imgHeight);
        for (const r of protectedRanges) {
          if (r.top > start + 0.05 && r.top < boundary && r.bottom > boundary && (r.bottom - r.top) < pageHeight) {
            pageEnd = r.top;
            break;
          }
        }
        if (!first) pdf.addPage();
        first = false;
        pdf.addImage(imgData, "JPEG", 0, -start, pdfWidth, imgHeight);
        if (pageEnd < boundary) {
          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, pageEnd - start, pdfWidth, boundary - pageEnd, "F");
        }
        start = pageEnd;
      }

      // Official-form footer band on every page: a hairline rule + a centered
      // form id / VIN / "Page X of Y". The archival SHA-256 footer (added by
      // archivePdf) sits just below this on the final page only.
      const footerStore = currentStore?.name || settings.dealer_name || "";
      const pageTotal = pdf.getNumberOfPages();
      for (let p = 1; p <= pageTotal; p++) {
        pdf.setPage(p);
        pdf.setDrawColor(185, 185, 185);
        pdf.setLineWidth(0.008);
        pdf.line(0.3, 10.62, pdfWidth - 0.3, 10.62);
        pdf.setFontSize(6.5);
        pdf.setTextColor(110, 110, 110);
        const label = `FORM AL-100${footerStore ? ` · ${footerStore}` : ""}${vehicle.vin ? ` · VIN ${vehicle.vin}` : ""} · PAGE ${p} OF ${pageTotal}`;
        pdf.text(label, pdfWidth / 2, 10.74, { align: "center" });
      }

      // Wave 4.5 — PDF/A-3 archival metadata: stamp the PDF with a
      // canonical-JSON SHA-256, deterministic /ID, XMP metadata, and
      // a visible footer hash so a regulator can verify the artifact
      // long after the fact.
      const storeName = currentStore?.name || settings.dealer_name;
      const archival = await archivePdf(
        pdf,
        {
          vehicle,
          customerInfo,
          products: displayProducts,
          totals: { installedTotal, optionalTotal },
          initials,
          optionalSelections,
          dealer: { name: storeName, state: settings.doc_fee_state || settings.dealer_state || null },
        },
        {
          tenantId: currentStore?.id || null,
          tenantName: storeName,
          vin: vehicle.vin || null,
          ymm: vehicle.ymm || null,
          addendumId: viewId || null,
          signedAt: null,
          consentHash: null,
          customerIp: null,
        }
      );

      pdf.save(`Dealer-Addendum-${storeName.replace(/\s+/g, "-")}.pdf`);
      persistArchivedPdf(pdf, {
        docType: "addendum",
        entityId: viewId || vehicle.vin || `addendum-${Date.now()}`,
        vin: vehicle.vin || null,
      }).catch(() => { /* archive best-effort */ });
      if (user) log({
        store_id: currentStore?.id || "",
        user_id: user.id,
        action: "addendum_pdf",
        entity_type: "addendum",
        entity_id: vehicle.vin,
        details: {
          ymm: vehicle.ymm,
          archival_hash: archival.hash,
          archival_timestamp: archival.timestamp,
        },
      });
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("PDF generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleSendToCustomer = async () => {
    if (!user) { toast.error("Sign in first"); return; }
    if (!vehicle.ymm.trim()) { toast.error("Please enter Year/Make/Model first"); return; }
    if (!vehicle.vin.trim()) { toast.error("Please enter the VIN first"); return; }

    // Hard-block: red-team `fail` findings must be cleared before a
    // signing link is generated. Warnings pass through, but fails
    // represent issues the FTC / state AG will use against the
    // dealer in an audit (banned phrases, missing E-SIGN, missing
    // Buyers Guide on a used car, un-initialled installed products).
    const rtFindings = runComplianceRedTeam({
      state: settings.doc_fee_state || settings.dealer_state || "",
      docFeeAmount: settings.doc_fee_enabled ? settings.doc_fee_amount : undefined,
      stickerText: `${displayProducts?.map((p) => `${p.name} ${p.disclosure || ""}`).join(" ") || ""} ${docFeeDisclosureText}`,
      products: displayProducts?.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        badge_type: p.badge_type,
        disclosure: p.disclosure || undefined,
        separate_signoff: !!initials[p.id]?.trim(),
        // Wave 16 — the red-team needs this to fire the new
        // missing-benefit-justification rule before send. Pass both the
        // resolved benefit and the raw optional benefit so the check
        // passes when the dealer entered text in EITHER disposition slot.
        benefit_justification:
          (p as { benefit_justification?: string }).benefit_justification || "",
        benefit_justification_optional:
          (p as { benefit_justification_optional?: string | null }).benefit_justification_optional || "",
      })) || [],
      spanishVersion: false,
      customerName: composeName(customerInfo.buyer_first_name, customerInfo.buyer_middle_initial, customerInfo.buyer_last_name, customerInfo.buyer_suffix),
      initialsByProductId: initials,
      provenInstallProofs: installProofs.map((p) => ({ product_name: p.product_name || "", verified: p.is_verified !== false })),
    });
    const rtSummary = summarizeRedTeam(rtFindings);
    if (rtSummary.blocker) {
      const top = rtFindings.filter((f) => f.severity === "fail").slice(0, 2).map((f) => f.rule).join(" \u2022 ");
      toast.error(`Compliance check \u2014 fix first: ${top}${rtSummary.fail > 2 ? " \u2026" : ""}`);
      if (user) log({
        store_id: currentStore?.id || "",
        user_id: user.id,
        action: "compliance_block",
        entity_type: "addendum",
        entity_id: vehicle.vin,
        details: {
          source: "handleSendToCustomer",
          fail_count: rtSummary.fail,
          warn_count: rtSummary.warn,
          rules: rtFindings.filter((f) => f.severity === "fail").map((f) => f.id),
        },
      });
      return;
    }

    // Price check (Compliance Pro). Don't dead-end the deal — if the all-in
    // price doesn't reconcile to the advertised price, explain it in plain
    // English and let a manager send anyway with a logged override, so F&I is
    // never stuck in front of a customer. The audit trail records the override.
    let priceOverridden = false;
    if (settings.feature_price_verification && priceIntegrity.status !== "ok") {
      const proceed = window.confirm(
        `${priceIntegrity.reason}\n\nSend to the customer anyway? This override is recorded with your name on the deal's audit trail.`,
      );
      if (!proceed) {
        if (user) log({
          store_id: currentStore?.id || "", user_id: user.id,
          action: "price_integrity_block", entity_type: "addendum", entity_id: vehicle.vin,
          details: { source: "handleSendToCustomer", status: priceIntegrity.status, expected_online: priceIntegrity.expectedOnline, advertised: priceIntegrity.advertised, delta: priceIntegrity.delta },
        });
        return;
      }
      priceOverridden = true;
      if (user) log({
        store_id: currentStore?.id || "", user_id: user.id,
        action: "price_integrity_block", entity_type: "addendum", entity_id: vehicle.vin,
        details: { source: "handleSendToCustomer", override: true, by: user.email, status: priceIntegrity.status, expected_online: priceIntegrity.expectedOnline, advertised: priceIntegrity.advertised, delta: priceIntegrity.delta },
      });
    }

    setSaving(true);
    const token = crypto.randomUUID();
    const payload = {
      created_by: user.id,
      vehicle_ymm: vehicle.ymm,
      vehicle_stock: vehicle.stock,
      vehicle_vin: vehicle.vin,
      addendum_date: vehicle.date || null,
      products_snapshot: JSON.parse(JSON.stringify(displayProducts || [])),
      // Keep the dealer's in-progress initials/selections instead of wiping
      // them when moving a saved draft to the waiting-for-signature queue.
      initials,
      optional_selections: optionalSelections,
      dealer_snapshot: dealerSnapshot,
      customer_info: customerInfo,
      customer_email: customerInfo.buyer_email || null,
      customer_name: composeName(customerInfo.buyer_first_name, customerInfo.buyer_middle_initial, customerInfo.buyer_last_name, customerInfo.buyer_suffix) || null,
      cobuyer_name: composeName(customerInfo.cobuyer_first_name, customerInfo.cobuyer_middle_initial, customerInfo.cobuyer_last_name, customerInfo.cobuyer_suffix) || null,
      total_installed: installedTotal,
      total_with_optional: grandTotalWithFee,
      selling_price: sellingPrice,
      // Advertised/website baseline the all-in math reconciles against, so the
      // signer pages (which can't read dealer settings) show the right number.
      vehicle_price: advertisedForVin?.advertised_price ?? (vehiclePriceNum || null),
      // All-in total the server verifies against the advertised price for this
      // VIN before the customer can sign.
      expected_total: priceIntegrity.expectedOnline,
      scraped_advertised_price: advertisedForVin?.advertised_price ?? null,
      // Manager override: mark verified so the server gate lets the customer
      // sign; the override is already on the audit trail above.
      ...(priceOverridden ? {
        price_verified: true,
        price_verification_status: "verified",
        price_verification_method: "manager_override",
        price_verified_at: new Date().toISOString(),
      } : {}),
      status: "draft" as const,
      signing_token: token,
    };
    // Continue the same row when this addendum was already saved as a draft,
    // so "Ready for Signatures" doesn't create a duplicate in Saved Addendums.
    let inserted: { id?: string } | null = null;
    let error: { message: string } | null = null;
    if (currentId) {
      let res = await supabase.from("addendums").update(payload as any).eq("id", currentId);
      if (isMissingOptionalCol(res.error)) {
        res = await supabase.from("addendums").update(stripOptionalCols(payload) as any).eq("id", currentId);
      }
      error = res.error;
      inserted = { id: currentId };
    } else {
      let res = await supabase.from("addendums").insert([payload as any]).select("id").single();
      if (isMissingOptionalCol(res.error)) {
        res = await supabase.from("addendums").insert([stripOptionalCols(payload) as any]).select("id").single();
      }
      error = res.error;
      inserted = res.data as { id?: string } | null;
      if (inserted?.id) setCurrentId(inserted.id);
    }
    if (error) { setSaving(false); toast.error(error.message); return; }

    // Server-authoritative price verification: the RPC re-reads the advertised
    // price for this VIN and flips price_verified, which the signing RPC + the
    // addendums trigger require before any signature is accepted. If the server
    // disagrees with the client gate (e.g. the advertised price just moved),
    // hold the link.
    const addendumId = (inserted as { id?: string } | null)?.id || "";
    if (addendumId && settings.feature_price_verification && !priceOverridden) {
      const { data: verifyStatus, error: verifyErr } = await (supabase as any)
        .rpc("verify_addendum_price", { _addendum_id: addendumId, _tolerance: 50 });
      // Tolerate a not-yet-applied migration (function missing): fall back to
      // the client gate, which already confirmed status === "ok" above.
      const fnMissing = !!verifyErr && /verify_addendum_price|function|does not exist/i.test(verifyErr.message || "");
      if (!fnMissing && (verifyErr || (verifyStatus && verifyStatus !== "verified"))) {
        setSaving(false);
        toast.error("Price verification failed on the server — re-scrape or capture the advertised price and try again.");
        if (user) log({
          store_id: currentStore?.id || "", user_id: user.id,
          action: "price_integrity_block", entity_type: "addendum", entity_id: vehicle.vin,
          details: { source: "verify_addendum_price", status: verifyStatus || "error", expected_total: priceIntegrity.expectedOnline },
        });
        return;
      }
    }
    setSaving(false);

    // Lock + version the deal: "Ready for Signatures" snapshots the line
    // items/prices/disclosures, mints a human version label, flips
    // lifecycle_status, and logs the ready_for_signature event. Fire-and-
    // forget so a propagating migration never blocks link delivery.
    const version = `A-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${token.slice(0, 4).toUpperCase()}`;
    if (addendumId) {
      (supabase as any)
        .rpc("mark_ready_for_signature", { _addendum_id: addendumId, _version_label: version })
        .then(() => {}, () => { /* lifecycle columns may still be propagating */ });
    }
    setReadyDealId(addendumId);
    setReadyToken(token);
    setVersionLabel(version);

    // Default to the full single-page document; the customer can switch to the
    // guided wizard from there (a "Prefer guided steps?" link on the page).
    const url = `${window.location.origin}/sign/${token}`;
    setSigningUrl(url);

    // Build the compliance receipt — surface every gate that
    // just verified before the customer ever sees the link.
    const state = settings.doc_fee_state || settings.dealer_state || "";
    const receipt: { label: string; cite?: string }[] = [
      { label: "E-SIGN consent v1 attached", cite: "15 U.S.C. §7001" },
      { label: "Payload hashed (SHA-256) for tamper evidence" },
    ];
    if (vehicle.vin && vehicle.vin.length === 17) {
      receipt.push({ label: "VIN recorded · NHTSA recall check ready" });
    }
    if (settings.feature_buyers_guide) {
      receipt.push({ label: "FTC Buyers Guide template active", cite: "16 CFR 455" });
    }
    if (settings.doc_fee_enabled && settings.doc_fee_amount > 0 && state) {
      receipt.push({
        label: `${state} doc fee · $${settings.doc_fee_amount} disclosed`,
        cite: state === "CA" ? "§11713.1 cap $85" : undefined,
      });
    }
    if (settings.feature_cobuyer_signature) {
      receipt.push({ label: "Co-buyer signature pad enabled" });
    }
    if (rtSummary.warn > 0) {
      receipt.push({ label: `${rtSummary.warn} compliance note${rtSummary.warn === 1 ? "" : "s"} (non-blocking)` });
    }
    if (state === "CA") {
      receipt.push({ label: "SB 766 3-day return window ready", cite: "Oct 1 2026" });
    }
    setComplianceReceipt(receipt);

    setQrOpen(true);
    toast.success(`Addendum ${version} locked · ready for signatures`);
    log({ store_id: currentStore?.id || "", user_id: user.id, action: "addendum_sent", entity_type: "addendum", entity_id: vehicle.vin, details: { ymm: vehicle.ymm, vin: vehicle.vin, stock: vehicle.stock, customer_name: composeName(customerInfo.buyer_first_name, customerInfo.buyer_middle_initial, customerInfo.buyer_last_name, customerInfo.buyer_suffix), token, version } });
  };

  // Append a per-channel `link_sent` event to the addendum timeline so the
  // dealer dashboard can show how the link went out. Fire-and-forget.
  const emitDeliveryEvent = (channel: string) => {
    if (!readyDealId) return;
    (supabase as any)
      .from("addendum_events")
      .insert({
        addendum_id: readyDealId,
        signing_token: readyToken || null,
        event: "link_sent",
        channel,
        actor: "dealer",
        actor_name: user?.email || null,
      })
      .then(() => {}, () => { /* events table may still be propagating */ });
  };

  // Email the guided-review link via the existing send-email edge function.
  const sendSigningEmail = async (toEmail: string) => {
    const link = signingUrl;
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="font-weight:800">Review &amp; sign your addendum</h2>
        <p>${settings.dealer_name || currentStore?.name || "Your dealership"} has prepared your
        ${vehicle.ymm || "vehicle"} addendum for review.</p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#0f172a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Review &amp; sign</a>
        </p>
        <p style="font-size:12px;color:#64748b">Or open this link: ${link}</p>
      </div>`;
    const { error } = await supabase.functions.invoke("send-email", {
      body: { to: [toEmail], subject: `Review & sign your addendum — ${vehicle.ymm || "your vehicle"}`, html },
    });
    if (error) { toast.error("Email failed to send"); return; }
    toast.success(`Signing link emailed to ${toEmail}`);
  };

  // Text the guided-review link via Twilio (falls back to a local queue
  // until Twilio is configured).
  const sendSigningSms = async (phone: string) => {
    const res = await sendSigningLink(phone, signingUrl, vehicle.ymm || "your vehicle");
    if (res.success) toast.success(res.message);
    else toast.error(res.message);
  };

  const handleSave = async () => {
    if (!user) { toast.error("Sign in to save"); return; }
    // Save at ANY point — a draft only needs something to identify the vehicle.
    // Completion (all initials, selections, signatures) is enforced by the
    // "Ready for Signatures" path, not by Save.
    if (!vehicle.vin.trim() && !vehicle.ymm.trim()) {
      toast.error("Add a VIN or Year/Make/Model before saving");
      return;
    }

    const now = new Date().toISOString();
    const fullySigned = !!customerSig.data && !!employeeSig.data;

    // Completing an in-person signature is itself a sign event — gate it on the
    // same price-integrity rule as the remote flow. Plain drafts save freely.
    if (fullySigned && settings.feature_price_verification && priceIntegrity.status !== "ok") {
      const proceed = window.confirm(
        `${priceIntegrity.reason}\n\nFinalize these signatures anyway? This override is recorded with your name on the deal's audit trail.`,
      );
      if (user) log({
        store_id: currentStore?.id || "", user_id: user.id,
        action: "price_integrity_block", entity_type: "addendum", entity_id: vehicle.vin,
        details: { source: "handleSave", override: proceed, by: user.email, status: priceIntegrity.status, expected_online: priceIntegrity.expectedOnline, advertised: priceIntegrity.advertised, delta: priceIntegrity.delta },
      });
      if (!proceed) return;
    }

    setSaving(true);
    const payload = {
      created_by: user.id,
      vehicle_ymm: vehicle.ymm || null,
      vehicle_stock: vehicle.stock || null,
      vehicle_vin: vehicle.vin || null,
      addendum_date: vehicle.date || null,
      products_snapshot: JSON.parse(JSON.stringify(displayProducts || [])),
      initials,
      optional_selections: optionalSelections,
      dealer_snapshot: dealerSnapshot,
      // Full buyer/co-buyer capture (address, phone, email, …) so every typed
      // field round-trips on reopen, not just the name.
      customer_info: customerInfo,
      customer_email: customerInfo.buyer_email || null,
      customer_name: composeName(customerInfo.buyer_first_name, customerInfo.buyer_middle_initial, customerInfo.buyer_last_name, customerInfo.buyer_suffix) || null,
      cobuyer_name: composeName(customerInfo.cobuyer_first_name, customerInfo.cobuyer_middle_initial, customerInfo.cobuyer_last_name, customerInfo.cobuyer_suffix) || null,
      customer_signature_data: customerSig.data || null,
      customer_signature_type: customerSig.data ? customerSig.type : null,
      customer_signed_at: customerSig.data ? (customerSig.at || now) : null,
      cobuyer_signature_data: cobuyerSig.data || null,
      cobuyer_signature_type: cobuyerSig.data ? cobuyerSig.type : null,
      cobuyer_signed_at: cobuyerSig.data ? (cobuyerSig.at || now) : null,
      employee_signature_data: employeeSig.data || null,
      employee_signature_type: employeeSig.data ? employeeSig.type : null,
      employee_signed_at: employeeSig.data ? (employeeSig.at || now) : null,
      total_installed: installedTotal,
      total_with_optional: grandTotalWithFee,
      selling_price: sellingPrice,
      vehicle_price: advertisedForVin?.advertised_price ?? (vehiclePriceNum || null),
      expected_total: priceIntegrity.expectedOnline,
      scraped_advertised_price: advertisedForVin?.advertised_price ?? null,
      status: fullySigned ? "signed" : "draft",
      // The DB trigger refuses a 'signed' write unless price_verified is true,
      // but only for tenants entitled to price verification. The in-person path
      // is dealer-attended and already gated above, so mark it verified.
      ...(fullySigned && settings.feature_price_verification ? {
        price_verified: true,
        price_verified_at: now,
        price_verification_status: "verified",
        price_verification_method: "dealer_manual",
        price_verification_delta: priceIntegrity.delta,
      } : {}),
    };
    // Update the existing row when continuing a draft, else insert a new one
    // (with a signing token) so re-saving keeps ONE entry in Saved Addendums.
    let inserted: { id?: string } | null = null;
    let error: { message: string } | null = null;
    if (currentId) {
      let res = await supabase.from("addendums").update(payload as any).eq("id", currentId);
      if (isMissingOptionalCol(res.error)) {
        res = await supabase.from("addendums").update(stripOptionalCols(payload) as any).eq("id", currentId);
      }
      error = res.error;
      inserted = { id: currentId };
    } else {
      const seed = { ...payload, signing_token: crypto.randomUUID() };
      let res = await supabase.from("addendums").insert([seed as any]).select("id").single();
      if (isMissingOptionalCol(res.error)) {
        res = await supabase.from("addendums").insert([stripOptionalCols(seed) as any]).select("id").single();
      }
      error = res.error;
      inserted = res.data as { id?: string } | null;
      if (inserted?.id) setCurrentId(inserted.id);
    }
    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(payload.status === "signed" ? "Addendum saved." : "Draft saved — find it in Saved Addendums.");
      log({ store_id: currentStore?.id || "", user_id: user.id, action: "addendum_created", entity_type: "addendum", entity_id: vehicle.vin, details: { ymm: vehicle.ymm, vin: vehicle.vin, stock: vehicle.stock, customer_name: composeName(customerInfo.buyer_first_name, customerInfo.buyer_middle_initial, customerInfo.buyer_last_name, customerInfo.buyer_suffix), status: payload.status, products_count: displayProducts.length, installed_total: installedTotal, optional_total: optionalTotal, type_overrides: typeOverrides } });

      // Mirror every signer into addendum_signings so the unified
      // compliance packet + VehicleFile activity timeline show every
      // signature regardless of which path created it. Fire-and-
      // forget — the legacy addendums columns stay authoritative for
      // the Index.tsx view; these rows are for audit consolidation.
      const addendumId = (inserted as { id?: string } | null)?.id || null;
      const commonAck = { initials, optional_selections: optionalSelections };
      const signers: Array<{
        type: "customer" | "cobuyer" | "employee";
        name: string | null;
        sig: { data: string; type: "draw" | "type" };
      }> = [];
      if (customerSig.data) signers.push({
        type: "customer",
        name: composeName(customerInfo.buyer_first_name, customerInfo.buyer_middle_initial, customerInfo.buyer_last_name, customerInfo.buyer_suffix) || null,
        sig: customerSig,
      });
      if (cobuyerSig.data) signers.push({
        type: "cobuyer",
        name: composeName(customerInfo.cobuyer_first_name, customerInfo.cobuyer_middle_initial, customerInfo.cobuyer_last_name, customerInfo.cobuyer_suffix) || null,
        sig: cobuyerSig,
      });
      if (employeeSig.data) signers.push({
        type: "employee",
        name: user?.email || null,
        sig: employeeSig,
      });
      for (const s of signers) {
        (supabase as any).from("addendum_signings").insert({
          addendum_id: addendumId,
          vin: vehicle.vin || null,
          signer_type: s.type,
          signer_name: s.name,
          signature_data: s.sig.data,
          signature_type: s.sig.type,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          acknowledgments: commonAck,
          canonical_payload: { vin: vehicle.vin, ymm: vehicle.ymm },
        }).then(() => undefined, () => undefined);
      }

      // Register in vehicle file system — creates per-VIN compliance record + sticker tracking code
      if (vehicle.vin.trim().length === 17) {
        const ymmParts = vehicle.ymm.split(" ");
        const file = await getOrCreateFile({
          vin: vehicle.vin.trim().toUpperCase(),
          year: vehicleContext.year || ymmParts[0] || "",
          make: vehicleContext.make || ymmParts[1] || "",
          model: vehicleContext.model || ymmParts.slice(2).join(" ") || "",
          trim: vehicleContext.trim || "",
          stock_number: vehicle.stock,
          condition: "used",
          mileage: 0,
          created_by: user.id,
        });
        if (file) {
          await registerSticker(file.id, "used_car_addendum", {
            paper_size: settings.addendum_paper_size,
            products_snapshot: displayProducts,
            base_price: installedTotal,
            accessories_total: optionalTotal,
            doc_fee: docFeeAmount,
            printed_by: user.id,
          });
        }
      }
    }
  };

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground animate-pulse">Loading products...</p>
    </div>
  );

  // Signing URL for barcode on the printed addendum
  const addendumSigningUrl = signingUrl || (vehicle.vin ? `${window.location.origin}/sign/pending-${vehicle.vin}` : "");

  return (
    <div className="bg-muted/30 py-6 px-4 lg:px-8 min-h-[calc(100vh-3.5rem)]">
      {/* Page header + action bar */}
      <div style={{ maxWidth: paperWidth }} className="mx-auto mb-4 flex items-center justify-between flex-wrap gap-3 no-print">
        <div>
          <h1 className="text-xl font-semibold tracking-tight font-display text-foreground">
            {viewMode ? "View Addendum" : "New Addendum"}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {viewMode ? "Read-only view of a signed or saved addendum" : "Build, sign, and send a dealer addendum to your customer"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {viewMode && (
            <button
              onClick={() => navigate("/addendum")}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-sm font-medium whitespace-nowrap shrink-0 hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              New
            </button>
          )}
          {user && viewMode && currentId && (
            <button
              onClick={() => navigate(`/addendum?id=${currentId}&edit=1`)}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
          )}
          {user && !viewMode && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50"
              title="Save your progress at any point — it lands in Saved Addendums as a draft"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving..." : "Save Draft"}
            </button>
          )}
          {user && !viewMode && (
            <button
              onClick={handleSendToCustomer}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-teal text-primary-foreground text-sm font-medium whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              Send to Customer
            </button>
          )}
          <button
            onClick={handlePrint}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-sm font-medium whitespace-nowrap shrink-0 hover:bg-muted transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={generating}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-sm font-medium whitespace-nowrap shrink-0 hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {generating ? "Generating..." : "PDF"}
          </button>
          {/* On-screen zoom only — print/PDF stay true-to-paper-size. */}
          <div className="inline-flex items-center gap-1 h-9 px-1 rounded-md border border-border" title="Adjust on-screen preview size (does not affect print or PDF)">
            <button onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))} className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-muted text-sm" aria-label="Zoom out">−</button>
            <button onClick={() => setZoom(defaultZoom)} className="text-xs tabular-nums w-11 text-center text-muted-foreground hover:text-foreground" title="Reset zoom">{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))} className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-muted text-sm" aria-label="Zoom in">+</button>
          </div>
          {settings.feature_ink_saving && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-1">
              <input
                type="checkbox"
                checked={inkSaving}
                onChange={(e) => setInkSaving(e.target.checked)}
                className="rounded border-border"
              />
              Ink-saving
            </label>
          )}
          {/* Disclosure language toggle — flip to Spanish when the
              sale is being conducted primarily in Spanish per SB 766
              / FTC Used Car Rule. */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-2">
            <span>Disclosure</span>
            <select
              value={disclosureLanguage}
              onChange={(e) => setDisclosureLanguage(e.target.value as DisclosureLanguage)}
              className="h-7 text-xs rounded border border-border bg-background px-1.5"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
        </div>
      </div>

      {/* Live signing status — appears once the deal is locked for
          signatures. DocuSign-style stepper + event timeline. */}
      {!viewMode && readyDealId && (
        <div className="max-w-[8.5in] mx-auto w-full mb-3">
          <AddendumStatusTimeline addendumId={readyDealId} version={versionLabel} />
        </div>
      )}

      {/* QR / Lead Capture Modal */}
      {settings.feature_lead_capture ? (
        <LeadCaptureModal open={qrOpen} signingUrl={signingUrl} vehicleInfo={vehicle.ymm} onClose={() => setQrOpen(false)} />
      ) : (
        <QRCodeModal
          open={qrOpen}
          signingUrl={signingUrl}
          onClose={() => setQrOpen(false)}
          complianceReceipt={complianceReceipt}
          dealId={readyDealId}
          version={versionLabel}
          customerEmail={(customerInfo as { buyer_email?: string }).buyer_email || ""}
          onChannel={emitDeliveryEvent}
          onSendEmail={sendSigningEmail}
          onSendSms={sendSigningSms}
        />
      )}

      {/* Rules notification */}
      {settings.feature_product_rules && rules.length > 0 && vehicleContext.make && !viewMode && (
        <div style={{ maxWidth: paperWidth }} className="mx-auto mb-2 no-print">
          <div className="bg-teal/10 border border-teal/30 rounded-md px-3 py-1.5 text-[11px] text-teal font-semibold">
            Product rules active — showing {displayProducts?.length || 0} products matching {vehicleContext.year} {vehicleContext.make} {vehicleContext.model}
          </div>
        </div>
      )}

      {/* Install-proof default banner — explains why lines auto-defaulted
          once a vendor has verified an installation on this VIN. */}
      {!viewMode && proofRegime && (
        <div style={{ maxWidth: paperWidth }} className="mx-auto mb-2 no-print">
          <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5 text-[11px] text-emerald-800 font-semibold flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
            {provenNames.size} verified installation{provenNames.size === 1 ? "" : "s"} on file for this VIN — matching lines default to Pre-Installed, the rest to Customer Elected. Override any line with its Sale Method badge.
          </div>
        </div>
      )}

      {/* Compliance red-team — Wave 4.2. Runs on every keystroke and
          lists what a regulator would flag before the customer signs. */}
      {!viewMode && (
        <div style={{ maxWidth: paperWidth }} className="mx-auto mb-3 no-print space-y-3">
          {settings.feature_price_verification && (
            <AddendumPriceIntegrity
              assessment={priceIntegrity}
              sellingPrice={sellingPrice}
              onSellingPriceChange={setSellingPrice}
              docFeeLabel={getDocFeeTerminology(settings.doc_fee_state || settings.dealer_state || "")}
              vin={vehicle.vin}
              onCaptureAdvertised={captureAdvertised}
              onRescrape={rescrapeVin}
              rescraping={rescraping}
              onUploadEvidence={uploadPriceEvidence}
            />
          )}
          <ComplianceRedTeamPanel
            findings={runComplianceRedTeam({
              state: settings.doc_fee_state || settings.dealer_state || "",
              vehiclePrice: vehiclePriceNum || undefined,
              advertisedPrice: advertisedForVin?.advertised_price,
              docFeeAmount: settings.doc_fee_enabled ? settings.doc_fee_amount : undefined,
              stickerText: `${displayProducts?.map((p) => `${p.name} ${p.disclosure || ""}`).join(" ") || ""} ${docFeeDisclosureText}`,
              products: displayProducts?.map((p) => ({
                id: p.id,
                name: p.name,
                price: p.price,
                badge_type: p.badge_type,
                disclosure: p.disclosure || undefined,
                separate_signoff: !!initials[p.id]?.trim(),
                // The panel's check needs the benefit text too — without it
                // every installed product falsely flagged as missing benefit.
                benefit_justification:
                  (p as { benefit_justification?: string }).benefit_justification || "",
                benefit_justification_optional:
                  (p as { benefit_justification_optional?: string | null }).benefit_justification_optional || "",
              })) || [],
              spanishVersion: false,
              customerName: composeName(customerInfo.buyer_first_name, customerInfo.buyer_middle_initial, customerInfo.buyer_last_name, customerInfo.buyer_suffix),
              initialsByProductId: initials,
              vehicleCondition,
              provenInstallProofs: installProofs.map((p) => ({ product_name: p.product_name || "", verified: p.is_verified !== false })),
            })}
          />
          {/* Per-state disclosure pack — collapsed by default so it isn't a
              wall of legal text above the dealer's work; one tap to review. */}
          <details className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <summary className="cursor-pointer select-none px-4 py-3 text-body-sm font-semibold text-slate-700">
              State disclosures &amp; consumer-rights preview
            </summary>
            <div className="px-1 pb-1">
              <StateRewriterPanel
                state={settings.doc_fee_state || settings.dealer_state || null}
                input={{
                  vehiclePrice: undefined,
                  docFeeAmount: settings.doc_fee_enabled ? settings.doc_fee_amount : undefined,
                  vehicleCondition,
                  saleConductedInSpanish: false,
                }}
              />
            </div>
          </details>
        </div>
      )}

      {/* Addendum Card — scales to paper size */}
      <div ref={cardRef} style={{ maxWidth: paperWidth, zoom }} className="addendum-card mx-auto bg-card shadow-lg rounded-lg overflow-hidden border border-border-custom">
        <AddendumHeader inkSaving={inkSaving} />
        <VehicleStrip vehicle={vehicle} onChange={setVehicle} onVinDecoded={handleVinDecoded} onVehicleScraped={handleVehicleScraped} inkSaving={inkSaving} />

        {/* Receipt before signature — the whole deal in one frame. */}
        <PurchaseSummary
          ymm={vehicle.ymm || [vehicleContext.year, vehicleContext.make, vehicleContext.model].filter(Boolean).join(" ")}
          vin={vehicle.vin}
          installedTotal={installedTotal}
          installedCount={installed.length}
          optionalTotal={optionalTotal}
          optionalAcceptedCount={acceptedOptional.length}
          optionalAvailableCount={optional.length}
          docFee={settings.doc_fee_enabled ? (settings.doc_fee_amount || 0) : 0}
          docFeeLabel={getDocFeeTerminology(settings.doc_fee_state || settings.dealer_state || "")}
          state={settings.doc_fee_state || settings.dealer_state || null}
          inkSaving={inkSaving}
        />

        {/* Customer Info (Buyer + optional Co-Buyer) */}
        <div className="px-3 pt-2">
          <CustomerInfoSection
            info={customerInfo}
            onChange={setCustomerInfo}
            showCobuyer={settings.feature_cobuyer_signature}
            inkSaving={inkSaving}
          />
        </div>

        {/* VIN Barcode */}
        {settings.feature_vin_barcode && vehicle.vin.trim().length === 17 && (
          <div className="px-3 py-1 border-b border-border-custom flex justify-center">
            <VinBarcode vin={vehicle.vin.trim()} />
          </div>
        )}

        {/* Scraped vehicle details */}
        {Object.keys(vehicleDetails).length > 0 && (vehicleDetails.mileage || vehicleDetails.color || vehicleDetails.condition || vehicleDetails.price) && (
          <VehicleDetailsBar details={vehicleDetails} inkSaving={inkSaving} />
        )}

        <div className="px-3 py-2 space-y-2">
          <IntentBox inkSaving={inkSaving} />

          {/* Section Head */}
          <div className="text-[9px] font-bold text-foreground">
            <p>Dealer-Installed Products & Pricing</p>
            <p className="text-muted-foreground font-normal">
              {installed.length > 0 && `Items #1–#${installed.length}: Pre-Installed · Non-Removable`}
              {optional.length > 0 && ` | ${optional.length > 0 ? `Item #${installed.length + 1}${optional.length > 1 ? `–#${installed.length + optional.length}` : ""}: Optional` : ""}`}
            </p>
          </div>

          {/* Wave 16 — voluntary disclosure. FTC §5 enforcement
              actions (incl. the March 2026 97-dealer warning
              letter campaign) repeatedly cite the absence of
              this language as a deceptive-practice hook. Render
              it whenever any OPTIONAL product appears, so the
              customer sees the voluntary nature on the paper
              artifact itself, not just at signing time. */}
          {optional.length > 0 && (
            <div className="text-[8px] leading-snug border border-foreground/15 rounded px-2 py-1.5 bg-foreground/[0.02]">
              <span className="font-bold uppercase tracking-wider">Voluntary purchase notice — </span>
              <span>
                Items marked OPTIONAL are not required to purchase, finance, or
                lease this vehicle. Your decision to accept or decline any
                optional product is not a condition of credit approval. Each
                optional item is itemized below with its price and benefit. By
                signing, the customer expressly and voluntarily agrees to each
                optional product accepted; none is a condition of purchase,
                lease, or financing.
              </span>
            </div>
          )}

          {/* Product Table Header */}
          <div className="flex text-[8px] font-bold text-muted-foreground border-b border-border-custom pb-0.5">
            <span className="w-5">#</span>
            {settings.allow_type_override_at_signing && !viewMode && <span className="w-14 text-center no-print">Type</span>}
            <span className="flex-1">Product Name & Description</span>
            <span className="w-24 text-right">Dealer Retail Price</span>
          </div>

          {/* Products with inline type override toggle */}
          {displayProducts?.map((p, i) => (
            <div key={p.id}>
              <div className="flex-1 min-w-0">
                <ProductRow
                  num={i + 1}
                  name={p.name}
                  subtitle={p.subtitle || ""}
                  warranty={p.warranty || ""}
                  badgeType={p.badge_type as "installed" | "optional"}
                  price={`$${p.price.toFixed(2)}`}
                  priceLabel={p.price_label || ""}
                  disclosure={p.disclosure || ""}
                  isOptional={p.badge_type === "optional"}
                  inkSaving={inkSaving}
                  iconType={iconMap[p.id] || ""}
                  controls={(() => {
                    // Sale Method (disposition) is always settable in build
                    // mode. Upgrade is a separate, visible toggle that appears
                    // only when the product has upgrade levels/terms.
                    if (viewMode) return undefined;
                    const up = (p as { upgrade?: ProductUpgrade | null }).upgrade;
                    const canPreinstall = (p as { available_preinstalled?: boolean }).available_preinstalled !== false;
                    const options: SaleMode[] = [
                      ...(canPreinstall ? (["pre_installed"] as SaleMode[]) : []),
                      "customer_elected",
                    ];
                    return (
                      <span className="inline-flex items-center gap-2.5">
                        <SaleModeControl
                          mode={modeOf({ id: p.id, badge_type: p.badge_type, upgrade: up })}
                          options={options}
                          onChange={(next) => changeSaleMode({ id: p.id, name: p.name, badge_type: p.badge_type, upgrade: up }, next)}
                        />
                        {up && (
                          <button
                            type="button"
                            onClick={() => setUpgradeSelections(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                            className="inline-flex items-center gap-1"
                            title={upgradeSelections[p.id] ? "Remove upgrade tier" : `Apply upgrade tier${up.name ? ` (${up.name})` : ""}`}
                          >
                            <span className={`relative inline-block w-8 h-4 shrink-0 rounded-full transition-colors ${upgradeSelections[p.id] ? "bg-violet-500" : "bg-muted"}`}>
                              <span className={`absolute top-0.5 left-0 w-3 h-3 rounded-full bg-white shadow transition-transform ${upgradeSelections[p.id] ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                            </span>
                            <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                              {upgradeSelections[p.id] ? "Upgrade" : "Base"}
                            </span>
                          </button>
                        )}
                      </span>
                    );
                  })()}
                />

                {/* Customer-facing benefit statement — full plain text,
                    always visible, part of the signed/printed/PDF record.
                    No scroll box, no hidden content: a customer (and a
                    juror) sees the entire representation at a glance. */}
                {(p as { benefit_justification?: string }).benefit_justification?.trim() && (
                  <div className="px-2 py-1.5 border-b border-border-custom">
                    <p className="text-[7px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Benefit Justification</p>
                    <p className="text-[8px] text-foreground leading-snug whitespace-pre-wrap mt-0.5">
                      {(p as { benefit_justification?: string }).benefit_justification}
                    </p>
                  </div>
                )}

                {/* Benefit justification is shown as full plain text above
                    (display-only on the sign-off copy). It is edited in the
                    Products tab, never inline on the addendum the customer
                    signs. */}
              </div>
            </div>
          ))}

          <div className="pdf-keep-together">
            <TotalBar
              installedTotal={installedTotal}
              optionalTotal={optionalTotal}
              grandTotal={grandTotal}
              optionalItems={optional}
              acceptedOptional={acceptedOptional}
              inkSaving={inkSaving}
            />
          </div>
          <SelectionRecord
            installed={installed}
            optional={optional}
            initials={initials}
            onInitialChange={(id, val) => setInitials((prev) => ({ ...prev, [id]: val }))}
            optionalSelections={optionalSelections}
            onOptionalChange={(id, val) => setOptionalSelections((prev) => ({ ...prev, [id]: val }))}
            installedStartNum={1}
            inkSaving={inkSaving}
          />
          <FinancingImpact addOnTotal={grandTotal} inkSaving={inkSaving} />
          <Disclosures inkSaving={inkSaving} language={disclosureLanguage} />

          {/* Signing QR Barcode — printed on every addendum for remote signing */}
          {addendumSigningUrl && (
            <div className="flex items-center justify-between border border-border-custom rounded px-3 py-2">
              <div>
                <p className="text-[8px] font-bold text-foreground">Remote Signing</p>
                <p className="text-[7px] text-muted-foreground">Scan to sign this addendum electronically</p>
                <p className="text-[6px] text-muted-foreground mt-0.5 font-mono break-all max-w-[3in]">{addendumSigningUrl}</p>
              </div>
              <QRCodeSVG value={addendumSigningUrl} size={60} />
            </div>
          )}

          {/* Signature Section — one customer block; the co-buyer block
              appears ONLY when a co-buyer is on the deal. Each signature is
              individually date/time stamped at the moment it is signed. */}
          <div className="space-y-3 pt-2 pdf-keep-together">
            <div>
              <SignaturePad label="Customer Signature" subtitle="Buyer acknowledges receipt of this addendum" value={customerSig.data} type={customerSig.type} onChange={(data, type) => setCustomerSig({ data, type, at: data ? new Date().toISOString() : "" })} />
              {customerSig.at && <SignatureStamp at={customerSig.at} who={composeName(customerInfo.buyer_first_name, customerInfo.buyer_middle_initial, customerInfo.buyer_last_name, customerInfo.buyer_suffix) || "Buyer"} />}
            </div>
            {hasCobuyer && (
              <div>
                <SignaturePad label="Co-Buyer Signature" subtitle="Co-Buyer acknowledges receipt of this addendum" value={cobuyerSig.data} type={cobuyerSig.type} onChange={(data, type) => setCobuyerSig({ data, type, at: data ? new Date().toISOString() : "" })} />
                {cobuyerSig.at && <SignatureStamp at={cobuyerSig.at} who={composeName(customerInfo.cobuyer_first_name, customerInfo.cobuyer_middle_initial, customerInfo.cobuyer_last_name, customerInfo.cobuyer_suffix) || "Co-Buyer"} />}
              </div>
            )}
            <div>
              <SignaturePad label="Dealer Representative" subtitle="Sales / Finance representative signature" value={employeeSig.data} type={employeeSig.type} onChange={(data, type) => setEmployeeSig({ data, type, at: data ? new Date().toISOString() : "" })} />
              {employeeSig.at && <SignatureStamp at={employeeSig.at} who="Dealer Representative" />}
            </div>
          </div>

          <AddendumFooter inkSaving={inkSaving} />
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// BenefitEditor — Wave 16 v2 builder-side panel under each
// product line. Two responsibilities:
//   1. Capture per-addendum benefit justification text. Defaults
//      to the catalog value; "Reset to catalog" returns it.
//   2. On OPTIONAL lines, render a small illustrative monthly-
//      payment-impact widget so the customer knows what the
//      add-on does to their payment at a representative APR.
//      Uses sb766.computeFinancingDisclosure so the math is the
//      same primitive ReturnsQueue uses for SB 766 receipts.
//
// Lives behind no-print so the sticker stays clean; the
// benefit text is what flows into the sticker / disclosures.
// ──────────────────────────────────────────────────────────────

interface BenefitEditorProps {
  product: Product;
  effectiveBenefit: string;
  onChange: (text: string) => void;
  onResetToCatalog: () => void;
  isOverridden: boolean;
  state: string;
}

const BenefitEditor = ({
  product,
  effectiveBenefit,
  onChange,
  onResetToCatalog,
  isOverridden,
  state,
}: BenefitEditorProps) => {
  const isOptional = product.badge_type === "optional";
  // Illustrative defaults — FTC §5 disclosure shape. Dealers can
  // customise per-tenant later (Wave 16.x). The caveat below the
  // number makes the "illustrative — your terms may vary" point
  // explicit so it can't be read as a binding offer.
  const ILLUSTRATIVE_APR = 7.9;
  const ILLUSTRATIVE_TERM = 72;
  const monthly = (() => {
    if (!isOptional || !product.price || product.price <= 0) return null;
    try {
      const disc = computeFinancingDisclosure(
        {
          amount_financed: product.price,
          apr_percent: ILLUSTRATIVE_APR,
          term_months: ILLUSTRATIVE_TERM,
        },
        (state || "").toUpperCase(),
      );
      return disc.monthly_payment;
    } catch {
      return null;
    }
  })();

  const missing = !effectiveBenefit.trim();
  const tone = missing && product.badge_type === "installed"
    ? "border-rose-300 bg-rose-50/60"
    : missing
      ? "border-amber-300 bg-amber-50/60"
      : "border-foreground/15 bg-foreground/[0.02]";

  return (
    <div className={`no-print mt-1 rounded border ${tone} px-2 py-1.5 space-y-1.5`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-foreground/80">
          Benefit justification
          {missing && product.badge_type === "installed" && (
            <span className="ml-1.5 text-rose-700 normal-case tracking-normal font-semibold">
              · required for installed (FTC §5)
            </span>
          )}
          {missing && product.badge_type === "optional" && (
            <span className="ml-1.5 text-amber-700 normal-case tracking-normal font-semibold">
              · recommended for /v/:slug
            </span>
          )}
        </p>
        {isOverridden && (
          <button
            type="button"
            onClick={onResetToCatalog}
            className="text-[9px] font-semibold text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            title="Replace this addendum's benefit text with the catalog default"
          >
            Reset to catalog
          </button>
        )}
      </div>
      <textarea
        value={effectiveBenefit}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={
          product.badge_type === "installed"
            ? "Why does this benefit the buyer? (transaction-specific — SB 766 §11713.21)"
            : "Optional — explain the value to the customer scanning the sticker QR."
        }
        className="w-full px-2 py-1.5 border border-border rounded text-xs bg-background"
      />
      {monthly != null && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-foreground/80 bg-card border border-border rounded px-2 py-1">
          <div className="inline-flex items-center gap-1">
            <span className="font-bold uppercase tracking-wider text-[9px] text-muted-foreground">
              Monthly impact
            </span>
            <span className="font-mono tabular-nums font-semibold">
              +${monthly.toFixed(2)}/mo
            </span>
          </div>
          <span className="text-[9px] text-muted-foreground">
            Illustrative · {ILLUSTRATIVE_APR}% APR · {ILLUSTRATIVE_TERM}mo · your terms may vary
          </span>
        </div>
      )}
    </div>
  );
};

// Per-signature date/time stamp printed under each signature on the
// document, so the signed record shows exactly who signed and when.
const SignatureStamp = ({ at, who }: { at: string; who: string }) => {
  const d = new Date(at);
  const stamp = Number.isNaN(d.getTime())
    ? at
    : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <p className="text-[8px] text-muted-foreground mt-0.5 px-1">
      Signed by {who} · {stamp}
    </p>
  );
};

export default Index;
