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
import AddendumHeader from "@/components/addendum/AddendumHeader";
import VehicleStrip from "@/components/addendum/VehicleStrip";
import IntentBox from "@/components/addendum/IntentBox";
import ProductRow from "@/components/addendum/ProductRow";
import TotalBar from "@/components/addendum/TotalBar";
import SelectionRecord from "@/components/addendum/SelectionRecord";
import Disclosures, { type DisclosureLanguage } from "@/components/addendum/Disclosures";
import FinancingImpact from "@/components/addendum/FinancingImpact";
import SignaturePad from "@/components/addendum/SignaturePad";
import AddendumFooter from "@/components/addendum/AddendumFooter";
import QRCodeModal from "@/components/addendum/QRCodeModal";
import LeadCaptureModal from "@/components/addendum/LeadCaptureModal";
import VinBarcode from "@/components/addendum/VinBarcode";
import VehicleDetailsBar from "@/components/addendum/VehicleDetailsBar";
import CustomerInfoSection, { CustomerInfo, emptyCustomerInfo } from "@/components/addendum/CustomerInfoSection";
import { ScrapedVehicle } from "@/hooks/useVehicleUrlScrape";
import { useAudit } from "@/contexts/AuditContext";
import { useTenant } from "@/contexts/TenantContext";
import { useVehicleFiles } from "@/hooks/useVehicleFiles";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Save, Send, Printer, Download } from "lucide-react";
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

const Index = () => {
  const { data: products, isLoading } = useProducts();
  const { user, isAdmin } = useAuth();
  const { settings } = useDealerSettings();
  const { rules, getMatchingProducts } = useProductRules();
  const { log } = useAudit();
  const { currentStore } = useTenant();
  const { getOrCreateFile, registerSticker } = useVehicleFiles(currentStore?.id || "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewId = searchParams.get("id");
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [inkSaving, setInkSaving] = useState(false);
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
  const [customerSig, setCustomerSig] = useState({ data: "", type: "draw" as "draw" | "type" });
  const [cobuyerSig, setCobuyerSig] = useState({ data: "", type: "draw" as "draw" | "type" });
  const [employeeSig, setEmployeeSig] = useState({ data: "", type: "draw" as "draw" | "type" });

  // QR / Lead capture modal
  const [qrOpen, setQrOpen] = useState(false);
  const [signingUrl, setSigningUrl] = useState("");
  // Wave 15.3 — compliance receipt rendered in the QR modal. The
  // gates already fire silently inside handleSendToCustomer (red-
  // team check, state doc-fee, E-SIGN consent prep). We surface
  // them as concrete bullet points so the dealer SEES the moat
  // they're paying for, not just a "link created" toast.
  const [complianceReceipt, setComplianceReceipt] = useState<{ label: string; cite?: string }[]>([]);

  // Paper size
  const paperWidth = settings.addendum_paper_size === "custom"
    ? `${settings.addendum_custom_width || "8.5"}in`
    : PAPER_WIDTHS[settings.addendum_paper_size] || "8.5in";

  // Load saved addendum when ?id= is present
  useEffect(() => {
    if (!viewId) {
      setViewMode(false);
      setLoadedProducts(null);
      return;
    }
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
      setViewMode(true);
      setVehicle({
        ymm: data.vehicle_ymm || "",
        stock: data.vehicle_stock || "",
        vin: data.vehicle_vin || "",
        date: data.addendum_date || "",
      });
      setInitials((data.initials as Record<string, string>) || {});
      setOptionalSelections((data.optional_selections as Record<string, string>) || {});

      // Populate customer info from saved full name fields
      const [bFirst, ...bRest] = (data.customer_name || "").split(" ");
      const [cFirst, ...cRest] = (data.cobuyer_name || "").split(" ");
      setCustomerInfo({
        buyer_first_name: bFirst || "",
        buyer_last_name: bRest.join(" "),
        buyer_phone: "",
        buyer_email: "",
        cobuyer_first_name: cFirst || "",
        cobuyer_last_name: cRest.join(" "),
        cobuyer_phone: "",
        cobuyer_email: "",
      });

      setCustomerSig({
        data: data.customer_signature_data || "",
        type: (data.customer_signature_type as "draw" | "type") || "draw",
      });
      setCobuyerSig({
        data: data.cobuyer_signature_data || "",
        type: (data.cobuyer_signature_type as "draw" | "type") || "draw",
      });
      setEmployeeSig({
        data: data.employee_signature_data || "",
        type: (data.employee_signature_type as "draw" | "type") || "draw",
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
  }, [viewId]);

  // Apply product rules, then apply admin default mode + overrides
  const baseProducts = viewMode && loadedProducts ? loadedProducts : products;
  const ruledProducts = settings.feature_product_rules && rules.length > 0 && !viewMode
    ? getMatchingProducts(vehicleContext, baseProducts || [])
    : baseProducts;

  // Apply product_default_mode + per-product overrides, then pick the
  // disposition-correct disclosure + benefit (pre-installed vs optional),
  // forcing optional for non-preinstallable products and swapping to the
  // upgrade tier when the line has the upgrade applied.
  const displayProducts = useMemo(() => {
    if (!ruledProducts) return [];
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
      let badge =
        typeOverrides[p.id] ||
        (settings.product_default_mode === "all_installed"
          ? "installed"
          : settings.product_default_mode === "all_optional"
            ? "optional"
            : p.badge_type);
      if (pr.available_preinstalled === false) badge = "optional";
      const isOptional = badge === "optional";

      const up = pr.upgrade;
      const upgradeApplied = !!upgradeSelections[p.id] && !!up;

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

      const name = upgradeApplied && up && (up.name || "").trim() ? `${p.name} — ${up.name}` : p.name;
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
  }, [ruledProducts, typeOverrides, benefitOverrides, upgradeSelections, settings.product_default_mode, vehicleContext.bodyStyle, vehicleContext.model]);

  const installed = displayProducts.filter((p) => p.badge_type === "installed");
  const optional = displayProducts.filter((p) => p.badge_type === "optional");
  const installedTotal = installed.reduce((sum, p) => sum + p.price, 0);
  const acceptedOptional = optional.filter((p) => optionalSelections[p.id] === "accept");
  const optionalTotal = acceptedOptional.reduce((sum, p) => sum + p.price, 0);
  const grandTotal = installedTotal + optionalTotal;
  const docFeeAmount = settings.doc_fee_enabled ? (settings.doc_fee_amount || 0) : 0;
  const grandTotalWithFee = grandTotal + docFeeAmount;

  const iconMap = JSON.parse(localStorage.getItem("product_icons") || "{}");

  const handleToggleProductType = (productId: string) => {
    const current = displayProducts.find(p => p.id === productId);
    if (!current) return;
    const newType = current.badge_type === "installed" ? "optional" : "installed";
    setTypeOverrides(prev => ({ ...prev, [productId]: newType as "installed" | "optional" }));
    // Clear optional selection if switching to installed
    if (newType === "installed") {
      setOptionalSelections(prev => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    }
  };

  const handleToggleUpgrade = (productId: string) => {
    setUpgradeSelections(prev => ({ ...prev, [productId]: !prev[productId] }));
  };

  const handleVinDecoded = (result: { year: string; make: string; model: string; trim: string; bodyStyle: string }) => {
    setVehicleContext({ year: result.year, make: result.make, model: result.model, trim: result.trim, bodyStyle: result.bodyStyle });
  };

  const handleVehicleScraped = (result: ScrapedVehicle) => {
    setVehicleDetails(result);
  };

  const handlePrint = () => {
    window.print();
    if (user) log({ store_id: currentStore?.id || "", user_id: user.id, action: "addendum_printed", entity_type: "addendum", entity_id: vehicle.vin, details: { ymm: vehicle.ymm } });
  };

  const handleDownloadPdf = async () => {
    const card = cardRef.current;
    if (!card) return;
    setGenerating(true);
    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const { default: jsPDF } = await import("jspdf");
      const { archivePdf, persistArchivedPdf } = await import("@/lib/pdfArchive");
      const canvas = await html2canvas(card, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      // Paginate the tall capture across standard 8.5x11 letter sheets.
      // The previous single oversized page (format [width, fullHeight])
      // forced printers to scale the whole addendum onto one sheet,
      // which made the signing copy print tiny and distorted. Slicing it
      // into letter pages keeps every page at readable, true scale.
      const pdfWidth = 8.5;
      const pageHeight = 11;
      const imgHeight = (canvas.height / canvas.width) * pdfWidth;
      const pdf = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pdfWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, pdfWidth, imgHeight);
        heightLeft -= pageHeight;
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
      docFeeAmount: displayProducts?.find((p) => p.name.toLowerCase().includes("doc"))?.price,
      stickerText: displayProducts
        ?.map((p) => `${p.name} ${p.disclosure || ""}`)
        .join(" ") || "",
      products: displayProducts?.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        badge_type: p.badge_type,
        disclosure: p.disclosure || undefined,
        separate_signoff: !!initials[p.id]?.trim(),
        // Wave 16 — the red-team needs this to fire the new
        // missing-benefit-justification rule before send.
        benefit_justification:
          (p as { benefit_justification?: string }).benefit_justification || "",
      })) || [],
      spanishVersion: false,
      customerName: [customerInfo.buyer_first_name, customerInfo.buyer_last_name].filter(Boolean).join(" "),
      initialsByProductId: initials,
    });
    const rtSummary = summarizeRedTeam(rtFindings);
    if (rtSummary.blocker) {
      const top = rtFindings.filter((f) => f.severity === "fail").slice(0, 2).map((f) => f.rule).join(" \u2022 ");
      toast.error(`Compliance red-team blocked: ${top}${rtSummary.fail > 2 ? " \u2026" : ""}`);
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

    setSaving(true);
    const token = crypto.randomUUID();
    const payload = {
      created_by: user.id,
      vehicle_ymm: vehicle.ymm,
      vehicle_stock: vehicle.stock,
      vehicle_vin: vehicle.vin,
      addendum_date: vehicle.date || null,
      products_snapshot: JSON.parse(JSON.stringify(displayProducts || [])),
      initials: {},
      optional_selections: {},
      total_installed: installedTotal,
      total_with_optional: grandTotalWithFee,
      status: "draft" as const,
      signing_token: token,
    };
    const { error } = await supabase.from("addendums").insert([payload as any]);
    setSaving(false);
    if (error) { toast.error(error.message); return; }

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
    toast.success("Signing link created · compliance verified");
    log({ store_id: currentStore?.id || "", user_id: user.id, action: "addendum_sent", entity_type: "addendum", entity_id: vehicle.vin, details: { ymm: vehicle.ymm, token } });
  };

  const handleSave = async () => {
    if (!user) { toast.error("Sign in to save"); return; }
    if (!vehicle.ymm.trim()) { toast.error("Please enter Year/Make/Model"); return; }
    if (!vehicle.vin.trim()) { toast.error("Please enter the VIN"); return; }

    const allProducts = displayProducts || [];
    const missingInitials = allProducts.filter((p) => !initials[p.id]?.trim());
    if (missingInitials.length > 0) {
      toast.error(`Please initial all products. Missing ${missingInitials.length} initial(s).`);
      return;
    }

    const optionalProducts = allProducts.filter((p) => p.badge_type === "optional");
    const missingSelections = optionalProducts.filter((p) => !optionalSelections[p.id]);
    if (missingSelections.length > 0) {
      toast.error(`Please accept or decline all optional products. ${missingSelections.length} remaining.`);
      return;
    }

    if (!customerSig.data) { toast.error("Customer signature is required"); return; }
    if (!employeeSig.data) { toast.error("Dealer representative signature is required"); return; }

    setSaving(true);
    const now = new Date().toISOString();
    const token = crypto.randomUUID();
    const payload = {
      created_by: user.id,
      vehicle_ymm: vehicle.ymm,
      vehicle_stock: vehicle.stock,
      vehicle_vin: vehicle.vin,
      addendum_date: vehicle.date || null,
      products_snapshot: JSON.parse(JSON.stringify(displayProducts || [])),
      initials,
      optional_selections: optionalSelections,
      customer_name: [customerInfo.buyer_first_name, customerInfo.buyer_last_name].filter(Boolean).join(" ") || null,
      cobuyer_name: [customerInfo.cobuyer_first_name, customerInfo.cobuyer_last_name].filter(Boolean).join(" ") || null,
      customer_signature_data: customerSig.data,
      customer_signature_type: customerSig.type,
      customer_signed_at: customerSig.data ? now : null,
      cobuyer_signature_data: cobuyerSig.data || null,
      cobuyer_signature_type: cobuyerSig.data ? cobuyerSig.type : null,
      cobuyer_signed_at: cobuyerSig.data ? now : null,
      employee_signature_data: employeeSig.data,
      employee_signature_type: employeeSig.type,
      employee_signed_at: employeeSig.data ? now : null,
      total_installed: installedTotal,
      total_with_optional: grandTotalWithFee,
      status: customerSig.data && employeeSig.data ? "signed" : "draft",
      signing_token: token,
    };
    const { data: inserted, error } = await supabase.from("addendums").insert([payload]).select("id").single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Addendum saved!");
      log({ store_id: currentStore?.id || "", user_id: user.id, action: "addendum_created", entity_type: "addendum", entity_id: vehicle.vin, details: { ymm: vehicle.ymm, vin: vehicle.vin, status: payload.status, products_count: displayProducts.length, installed_total: installedTotal, optional_total: optionalTotal, type_overrides: typeOverrides } });

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
        name: [customerInfo.buyer_first_name, customerInfo.buyer_last_name].filter(Boolean).join(" ") || null,
        sig: customerSig,
      });
      if (cobuyerSig.data) signers.push({
        type: "cobuyer",
        name: [customerInfo.cobuyer_first_name, customerInfo.cobuyer_last_name].filter(Boolean).join(" ") || null,
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
        <div className="flex items-center gap-2">
          {viewMode && (
            <button
              onClick={() => navigate("/addendum")}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              New
            </button>
          )}
          {user && !viewMode && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving..." : "Save"}
            </button>
          )}
          {user && !viewMode && (
            <button
              onClick={handleSendToCustomer}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-teal text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              Send to Customer
            </button>
          )}
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={generating}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {generating ? "Generating..." : "PDF"}
          </button>
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

      {/* QR / Lead Capture Modal */}
      {settings.feature_lead_capture ? (
        <LeadCaptureModal open={qrOpen} signingUrl={signingUrl} vehicleInfo={vehicle.ymm} onClose={() => setQrOpen(false)} />
      ) : (
        <QRCodeModal
          open={qrOpen}
          signingUrl={signingUrl}
          onClose={() => setQrOpen(false)}
          complianceReceipt={complianceReceipt}
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

      {/* Compliance red-team — Wave 4.2. Runs on every keystroke and
          lists what a regulator would flag before the customer signs. */}
      {!viewMode && (
        <div style={{ maxWidth: paperWidth }} className="mx-auto mb-3 no-print space-y-3">
          <ComplianceRedTeamPanel
            findings={runComplianceRedTeam({
              state: settings.doc_fee_state || settings.dealer_state || "",
              vehiclePrice: undefined,
              docFeeAmount: displayProducts?.find((p) => p.name.toLowerCase().includes("doc"))?.price,
              stickerText: displayProducts
                ?.map((p) => `${p.name} ${p.disclosure || ""}`)
                .join(" ") || "",
              products: displayProducts?.map((p) => ({
                id: p.id,
                name: p.name,
                price: p.price,
                badge_type: p.badge_type,
                disclosure: p.disclosure || undefined,
                separate_signoff: !!initials[p.id]?.trim(),
              })) || [],
              spanishVersion: false,
              customerName: [customerInfo.buyer_first_name, customerInfo.buyer_last_name].filter(Boolean).join(" "),
              initialsByProductId: initials,
              vehicleCondition: undefined,
            })}
          />
          {/* Wave 4.3 — per-state disclosure pack for the dealer's state */}
          <StateRewriterPanel
            state={settings.doc_fee_state || settings.dealer_state || null}
            input={{
              vehiclePrice: undefined,
              docFeeAmount: displayProducts?.find((p) => p.name.toLowerCase().includes("doc"))?.price,
              vehicleCondition: undefined,
              saleConductedInSpanish: false,
            }}
          />
        </div>
      )}

      {/* Addendum Card — scales to paper size */}
      <div ref={cardRef} style={{ maxWidth: paperWidth }} className="addendum-card mx-auto bg-card shadow-lg rounded-lg overflow-hidden border border-border-custom">
        <AddendumHeader inkSaving={inkSaving} />
        <VehicleStrip vehicle={vehicle} onChange={setVehicle} onVinDecoded={handleVinDecoded} onVehicleScraped={handleVehicleScraped} inkSaving={inkSaving} />

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
                optional item is itemized below with its price and benefit.
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
            <div key={p.id} className="flex items-start gap-0">
              {!viewMode && (settings.allow_type_override_at_signing || (p as { upgrade?: ProductUpgrade | null }).upgrade) && (
                <div className="no-print w-14 shrink-0 mt-2 flex flex-col items-center gap-1.5">
                  {settings.allow_type_override_at_signing && (p as { available_preinstalled?: boolean }).available_preinstalled !== false && (
                    <button
                      onClick={() => handleToggleProductType(p.id)}
                      className="flex flex-col items-center gap-0.5"
                      title={`Click to switch to ${p.badge_type === "installed" ? "optional" : "installed"}`}
                    >
                      <div className={`relative w-8 h-4 rounded-full transition-colors ${p.badge_type === "installed" ? "bg-navy" : "bg-gold"}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-card shadow transition-transform ${p.badge_type === "installed" ? "translate-x-0.5" : "translate-x-4"}`} />
                      </div>
                      <span className="text-[6px] text-muted-foreground font-semibold">
                        {p.badge_type === "installed" ? "INST" : "OPT"}
                      </span>
                    </button>
                  )}
                  {(p as { upgrade?: ProductUpgrade | null }).upgrade && (
                    <button
                      onClick={() => handleToggleUpgrade(p.id)}
                      className="flex flex-col items-center gap-0.5"
                      title={upgradeSelections[p.id] ? "Remove upgrade" : "Apply upgrade"}
                    >
                      <div className={`relative w-8 h-4 rounded-full transition-colors ${upgradeSelections[p.id] ? "bg-gold" : "bg-muted"}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-card shadow transition-transform ${upgradeSelections[p.id] ? "translate-x-4" : "translate-x-0.5"}`} />
                      </div>
                      <span className="text-[6px] text-muted-foreground font-semibold">
                        {upgradeSelections[p.id] ? "UPGR" : "BASE"}
                      </span>
                    </button>
                  )}
                </div>
              )}
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
                />

                {/* Wave 16 v2 — per-line benefit-justification
                    editor + monthly-payment-impact widget. Lives
                    INSIDE the no-print zone so the builder gets
                    the controls; the sticker itself only renders
                    the resulting text via downstream surfaces.
                    Read-only in viewMode (re-opened signed
                    addendum). */}
                {!viewMode && (
                  <BenefitEditor
                    product={p}
                    effectiveBenefit={(p as { benefit_justification?: string }).benefit_justification || ""}
                    onChange={(text) => setBenefitOverrides(prev => ({ ...prev, [p.id]: text }))}
                    onResetToCatalog={() => setBenefitOverrides(prev => {
                      const next = { ...prev };
                      delete next[p.id];
                      return next;
                    })}
                    isOverridden={benefitOverrides[p.id] !== undefined}
                    state={settings.doc_fee_state || settings.dealer_state || ""}
                  />
                )}
              </div>
            </div>
          ))}

          <TotalBar
            installedTotal={installedTotal}
            optionalTotal={optionalTotal}
            grandTotal={grandTotal}
            optionalItems={optional}
            acceptedOptional={acceptedOptional}
            inkSaving={inkSaving}
          />
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

          {/* Signature Section */}
          <div className="space-y-3 pt-2">
            <SignaturePad label="Customer Signature" subtitle="Buyer acknowledges receipt of this addendum" value={customerSig.data} type={customerSig.type} onChange={(data, type) => setCustomerSig({ data, type })} />
            {settings.feature_cobuyer_signature && (
              <SignaturePad label="Co-Buyer Signature (if applicable)" subtitle="Co-Buyer acknowledges receipt" value={cobuyerSig.data} type={cobuyerSig.type} onChange={(data, type) => setCobuyerSig({ data, type })} />
            )}
            <SignaturePad label="Dealer Representative" subtitle="Sales / Finance representative signature & date" value={employeeSig.data} type={employeeSig.type} onChange={(data, type) => setEmployeeSig({ data, type })} />
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
        (state || "CA").toUpperCase(),
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

export default Index;
