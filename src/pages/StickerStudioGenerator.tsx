import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerDocumentRules } from "@/lib/documentRules";
import { useProducts } from "@/hooks/useProducts";
import { applicablePrograms, programMode, termLabel, emptyProgram, toStickerValueProp, PROGRAM_DISPLAY_STYLES, PROGRAM_IMAGE_SCALES, type DealerProgram, type ProgramDisplayStyle, type ProgramImageScale } from "@/lib/dealerPrograms";
import { uploadPhoto } from "@/lib/storage";
import { cleanEquipmentList } from "@/lib/passportV2Data";
import { curatePrintEquipment } from "@/lib/equipmentPanel";
import { useUsageLimits } from "@/lib/entitlements/useUsageLimits";
import { useAssetReadiness } from "@/lib/stickerStudio/useAssetReadiness";
import { transitionDocument } from "@/lib/stickerStudio/documentWorkflow";
import { ensureQrCode } from "@/lib/stickerStudio/qrTracking";
import { useLatestAddendum } from "@/lib/stickerStudio/useLatestAddendum";
import { mapProductsToStickerItems } from "@/lib/stickerStudio/addendumMapping";
import { validateStickerPacketMatch, type PacketContext } from "@/lib/stickerStudio/validateStickerPacketMatch";
import StickerPacketReviewPanel from "@/components/sticker/StickerPacketReviewPanel";
import { FileCheck2, QrCode as QrIcon, AlertTriangle, Search } from "lucide-react";
import { useVehiclePrefill } from "@/lib/vehiclePrefill";
import { getStudioTemplate, TemplateRenderer, type StickerData, type StickerLineItem, type StickerRenderOptions, type LabelMode } from "@/lib/stickerStudio/templates";
import { resolvePriceLabel } from "@/lib/priceModel";
import { useStickerCatalog } from "@/lib/stickerStudio/useStickerCatalog";
import { useDealerPrintSettings } from "@/lib/stickerStudio/useDealerPrintSettings";
import { useTemplateCustomization } from "@/lib/stickerStudio/useTemplateCustomization";
import { applyCustomization } from "@/lib/stickerStudio/customization";
import { brandingFromIdentity } from "@/pages/StickerStudio";
import { resolveDealerIdentity } from "@/lib/dealerIdentity";
import { saveStickerToVehicle, publishToPassport, saveAddendumState, syncAddendumProductBadges, syncGetReadyInstalls, type AddendumItemInput } from "@/lib/stickerStudio/api";
import { ArrowLeft, Printer, Download, GripVertical, Image as ImageIcon, MoreVertical, Plus, Trash2, Save, Globe, Sun, Moon, CheckCircle2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useVehicleEquipment } from "@/lib/equipment/useVehicleEquipment";
import { proofBadge, type CustomerStatus } from "@/lib/equipment/status";
import { assessIdentityOverflow } from "@/lib/dealerIdentity";
import { toast } from "sonner";

const ACCENTS = ["#2563EB", "#0B2041", "#7c5c1e", "#0f766e", "#9333ea", "#b91c1c"];
const blankItem = (): StickerLineItem => ({ name: "", price: "", note: "" });

// The three customer-facing equipment statuses. A row's status IS its section,
// so the dropdown names the outcome instead of an arrow implying a direction.
type EquipmentStatusKey = "installed" | "upgrades" | "benefits";
const STATUS_KEYS: EquipmentStatusKey[] = ["installed", "upgrades", "benefits"];
const STATUS_LABEL: Record<EquipmentStatusKey, string> = {
  installed: "Pre-Installed",
  upgrades: "Optional",
  benefits: "Included Benefit",
};
const SECTION_LABEL: Record<EquipmentStatusKey, string> = {
  installed: "Pre-Installed Equipment",
  upgrades: "Optional Upgrades",
  benefits: "Included Benefits",
};
// Bridge between the studio's section keys and the shared equipment record's
// customer_status values.
const STATUS_TO_RECORD: Record<EquipmentStatusKey, CustomerStatus> = {
  installed: "pre_installed",
  upgrades: "optional",
  benefits: "included_benefit",
};
const RECORD_TO_STATUS: Record<CustomerStatus, EquipmentStatusKey> = {
  pre_installed: "installed",
  optional: "upgrades",
  included_benefit: "benefits",
};
const BADGE_TONE = {
  verified: "border-emerald-200 bg-emerald-50 text-emerald-700",
  awaiting: "border-amber-200 bg-amber-50 text-amber-700",
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  none: "border-border bg-muted/50 text-muted-foreground",
} as const;

const StickerStudioGenerator = () => {
  const { templateId = "" } = useParams();
  const navigate = useNavigate();
  const { byId } = useStickerCatalog();
  const baseTemplate = byId(templateId) || getStudioTemplate(templateId);
  const { settings, updateSettings, loading: settingsLoading } = useDealerSettings();
  const { tenant, stores, currentStore } = useTenant();
  const { user } = useAuth();
  const rules = useDealerDocumentRules();
  const quota = useUsageLimits();
  const { customization, save: saveCustomization } = useTemplateCustomization(templateId);
  // Vehicle data (prefilled from ?vehicleId, then editable).
  const [data, setData] = useState<StickerData>({
    vehicleTitle: "", vin: "", stock: "", mileage: "", msrp: "", price: "",
    installed: [blankItem()], upgrades: [blankItem()], benefits: [blankItem()], notes: "", qrUrl: "",
  });
  const prefill = useVehiclePrefill((v) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setData((prev) => ({
      ...prev,
      vehicleTitle: `${v.ymm}${v.trim ? ` ${v.trim}` : ""}`.trim() || prev.vehicleTitle,
      vin: v.vin || prev.vin,
      stock: v.stock || prev.stock,
      mileage: v.mileage || prev.mileage,
      msrp: v.msrp || prev.msrp,
      price: v.price || prev.price,
      specs: [v.engine, v.drivetrain, v.transmission,
        (v.mpgCity && v.mpgHwy) ? `${v.mpgCity}/${v.mpgHwy} MPG` : v.mpgCity ? `${v.mpgCity} MPG` : v.fuelType,
      ].filter(Boolean).join(" · ") || prev.specs,
      qrUrl: v.slug ? `${origin}/v/${v.slug}` : v.vin ? `${origin}/v/${v.vin}` : prev.qrUrl,
    }));
  });

  // Apply order: built-in base -> DB config (already in baseTemplate) -> dealer
  // customization. Vehicle data + UI toggles layer on below.
  // Which dealership is speaking: the location the vehicle belongs to wins over
  // whatever the user last had selected, so a group's locations never bleed
  // into one another's paperwork.
  const identity = useMemo(
    () => resolveDealerIdentity({
      settings,
      tenantName: tenant?.name,
      stores,
      vehicleStoreId: prefill.vehicle?.storeId,
      activeStoreId: currentStore?.id,
      vehicleAssigned: !prefill.active ? undefined : !!prefill.vehicle?.storeId,
    }),
    [settings, tenant?.name, stores, prefill.active, prefill.vehicle?.storeId, currentStore?.id],
  );
  const overflow = useMemo(() => assessIdentityOverflow(identity), [identity]);
  const applied = useMemo(
    () => (baseTemplate ? applyCustomization(baseTemplate, brandingFromIdentity(identity, settings, customization.logoEnabled), customization) : null),
    [baseTemplate, customization, identity, settings],
  );
  const template = applied?.template ?? baseTemplate;
  const sheetRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [zoomPreset, setZoomPreset] = useState<"fit" | "50" | "75" | "100">("fit");

  // Output options (label stock + total roll-ups), frozen into the saved snapshot.
  const { calibration } = useDealerPrintSettings();
  const [labelMode, setLabelMode] = useState<LabelMode>("white");
  const [totalMsrpMode, setTotalMsrpMode] = useState(false);
  const [showAddendumTotal, setShowAddendumTotal] = useState(true);
  // Seed label mode from the dealer's template customization, else the saved
  // print default, once.
  const seededMode = useRef(false);
  useEffect(() => {
    if (seededMode.current) return;
    const m = applied?.options.labelMode || calibration.labelMode;
    if (m) { setLabelMode(m); seededMode.current = true; }
  }, [applied?.options.labelMode, calibration]);
  const options: StickerRenderOptions = useMemo(
    () => ({ labelMode, totalMsrpMode, showAddendumTotal, sectionLabels: applied?.options.sectionLabels }),
    [labelMode, totalMsrpMode, showAddendumTotal, applied?.options.sectionLabels],
  );
  const [savedDoc, setSavedDoc] = useState<{ version?: number; status?: string } | null>(null);

  // Branding (seeded from dealer settings + template customization, editable here).
  const seed = useMemo(() => applied?.branding ?? brandingFromIdentity(identity, settings, customization.logoEnabled), [applied?.branding, identity, settings, customization.logoEnabled]);
  const [branding, setBranding] = useState(seed);
  useEffect(() => { setBranding(seed); }, [seed]);


  // Seed line items from real data once both sources have settled: the
  // tenant's active product catalog fills installed / optional / benefit
  // lines with their signing-flow pricing semantics, and (window templates
  // only) the vehicle file's factory equipment fills any remaining installed
  // capacity, value-ranked. Never overwrites lines the dealer has typed.
  const { data: products } = useProducts();
  const seededItems = useRef(false);
  useEffect(() => {
    if (seededItems.current || !template) return;
    if (prefill.active && prefill.loading) return;
    if (products === undefined || settingsLoading) return;
    seededItems.current = true;
    const cfgNow = template.config;
    // Seed straight from the catalog WITH each product's default price —
    // installed equipment value must always be visible and feed the adjusted
    // total. Supabase numeric columns arrive as strings, so coerce instead of
    // typeof-checking (that check is why prices used to seed as blank).
    // (mapProductsToStickerItems keeps its stricter signed-packet semantics
    // for "Load packet items".)
    const priceNum = (p: { price: number }) => {
      const n = typeof p.price === "number" ? p.price : parseFloat(String(p.price ?? ""));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const m = {
      installed: products.filter((p) => p.badge_type === "installed" && priceNum(p) > 0)
        .map((p) => ({ name: p.name, price: String(priceNum(p)), note: p.subtitle || "" })),
      upgrades: products.filter((p) => p.badge_type === "optional" && priceNum(p) > 0)
        .map((p) => ({ name: p.name, price: String(priceNum(p)), note: p.subtitle || "" })),
      benefits: products.filter((p) => priceNum(p) <= 0)
        .map((p) => ({ name: p.name })),
    };
    const v = prefill.vehicle;
    const factory = cfgNow.type === "window" && v && (v.options.length || v.features.length)
      ? curatePrintEquipment(cleanEquipmentList([...v.options, ...v.features]), cfgNow.maxItems.installed).shown
      : [];
    // Included-with-sale items (dealer warranty, loaner cars, …) fill the
    // benefits section alongside no-charge products.
    const suppressedIds = new Set(
      (Array.isArray(v?.raw?.suppressed_programs) ? (v!.raw.suppressed_programs as unknown[]) : []).map(String),
    );
    const programs = applicablePrograms(settings.dealer_programs, v?.condition || "", "sticker")
      .filter((p) => !suppressedIds.has(p.id));
    const programName = (p: (typeof programs)[number]) => {
      const t = termLabel(p);
      return t ? `${p.title.trim()} — ${t}` : p.title.trim();
    };
    const includedProgs = programs.filter((p) => programMode(p) === "included");
    // "Available" programs (e.g. an optional dealer CPO upgrade) belong in the
    // Available Upgrades band — offered, priced if configured, never in total.
    const availableProgs = programs.filter((p) => programMode(p) === "available");
    setData((prev) => {
      const blank = (arr: StickerLineItem[]) => arr.every((i) => !i.name.trim());
      const installedSeed = [...m.installed, ...factory.map((n) => ({ name: n }))]
        .slice(0, cfgNow.maxItems.installed);
      const benefitNames = new Set(m.benefits.map((b) => b.name.toLowerCase()));
      const benefitsSeed = [
        ...m.benefits,
        ...includedProgs.filter((p) => !benefitNames.has(p.title.trim().toLowerCase())).map((p) => ({ name: programName(p) })),
      ].slice(0, cfgNow.maxItems.benefits);
      const upgradeNames = new Set(m.upgrades.map((u) => u.name.toLowerCase()));
      const upgradesSeed = [
        ...m.upgrades,
        ...availableProgs.filter((p) => !upgradeNames.has(p.title.trim().toLowerCase()))
          .map((p) => ({ name: programName(p), price: p.price && p.price > 0 ? String(p.price) : "" })),
      ].slice(0, cfgNow.maxItems.upgrades);
      return {
        ...prev,
        installed: blank(prev.installed) && installedSeed.length ? installedSeed : prev.installed,
        upgrades: blank(prev.upgrades) && upgradesSeed.length ? upgradesSeed : prev.upgrades,
        benefits: blank(prev.benefits) && benefitsSeed.length ? benefitsSeed : prev.benefits,
      };
    });
  }, [template, products, prefill.active, prefill.loading, prefill.vehicle, settingsLoading, settings.dealer_programs]);

  // Seed dealer default benefits + addendum wording from the template
  // customization once, only into an untouched (blank) field.
  const seededDefaults = useRef(false);
  useEffect(() => {
    if (seededDefaults.current || !customization) return;
    const hasBenefits = customization.defaultBenefits.length > 0;
    const hasWording = !!customization.defaultAddendumWording;
    if (!hasBenefits && !hasWording) return;
    setData((prev) => {
      const benefitsBlank = prev.benefits.every((b) => !b.name.trim());
      return {
        ...prev,
        benefits: hasBenefits && benefitsBlank ? customization.defaultBenefits.map((n) => ({ name: n })) : prev.benefits,
        notes: hasWording && !prev.notes ? customization.defaultAddendumWording : prev.notes,
      };
    });
    seededDefaults.current = true;
  }, [customization]);

  // Point the sticker QR at the trackable /q/:token redirect (falls back to the
  // direct passport URL if QR tracking isn't available). Honors the dealer rule.
  // Latest signing packet for this vehicle — source for "load packet data" and
  // the sticker-vs-packet review (addendum templates only).
  const { addendum } = useLatestAddendum(prefill.vehicle?.vin || data.vin);

  const qrEnsured = useRef(false);
  const stickerType = template?.config.type;
  useEffect(() => {
    if (qrEnsured.current || !rules.trackQrScans || !stickerType) return;
    const v = prefill.vehicle;
    if (!v?.id || !tenant?.id) return;
    qrEnsured.current = true;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const destination = v.slug ? `${origin}/v/${v.slug}` : v.vin ? `${origin}/v/${v.vin}` : "";
    if (!destination) return;
    (async () => {
      const tracked = await ensureQrCode({ tenantId: tenant.id, vehicleId: v.id, stickerType, destinationUrl: destination });
      if (tracked) setData((prev) => ({ ...prev, qrUrl: tracked }));
    })();
  }, [prefill.vehicle, tenant?.id, rules.trackQrScans, stickerType]);

  // Asset readiness (logo resolution + QR availability) for the warning row.
  // Must stay above the `!template` return: called below it, the missing-template
  // render would run one hook fewer than the normal one (React #310).
  const assets = useAssetReadiness({
    logoUrl: branding.logoUrl,
    logoEnabled: !!template?.config.supportsLogo && branding.showLogo,
    qrUrl: data.qrUrl,
    qrSupported: !!template?.config.supportsQr,
    qrRequired: !!template?.config.styleTags.includes("Compliance"),
  });

  if (!template) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">Template not found.</p>
        <button onClick={() => navigate("/sticker-studio")} className="mt-3 text-sm font-semibold text-blue-600">Back to Sticker Studio</button>
      </div>
    );
  }
  const cfg = template.config;
  const setField = (k: keyof StickerData, val: string) => setData((d) => ({ ...d, [k]: val }));

  // Addendum ↔ signing-packet integration (addendum templates only).
  const isAddendum = cfg.type === "addendum";
  const loadPacketData = () => {
    if (!addendum) return;
    const m = mapProductsToStickerItems(addendum.products);
    setData((d) => ({
      ...d,
      installed: m.installed.length ? m.installed : d.installed,
      upgrades: m.upgrades.length ? m.upgrades : d.upgrades,
      benefits: m.benefits.length ? m.benefits : d.benefits,
    }));
    toast.success("Loaded items from the signing packet");
  };
  // Live consistency check vs the latest packet (used to gate publish).
  const packetCtx: PacketContext | null = isAddendum && addendum ? {
    vin: prefill.vehicle?.vin || data.vin,
    stock: data.stock,
    vehicleTitle: data.vehicleTitle,
    products: addendum.products,
    hasDisclaimer: !!branding.disclaimer,
    qrRequired: cfg.styleTags.includes("Compliance"),
    hasQr: !!(cfg.supportsQr && data.qrUrl),
    signed: !!addendum.signedAt,
    signedAfterGenerated: false,
  } : null;
  const matchBlocked = !!packetCtx && rules.blockPacketOnMismatchFail &&
    validateStickerPacketMatch(data, packetCtx).status === "blocked";

  const setItem = (key: "installed" | "upgrades" | "benefits", i: number, patch: Partial<StickerLineItem>) =>
    setData((d) => ({ ...d, [key]: d[key].map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  const addItem = (key: "installed" | "upgrades" | "benefits") =>
    setData((d) => (d[key].length >= cfg.maxItems[key] ? d : { ...d, [key]: [...d[key], blankItem()] }));
  const removeItem = (key: "installed" | "upgrades" | "benefits", i: number) =>
    setData((d) => ({ ...d, [key]: d[key].filter((_, idx) => idx !== i) }));
  // ── Equipment status ─────────────────────────────────────────────────
  // An equipment status change is operational data, not document formatting:
  // it re-prices what the customer signs and changes the work get-ready owes.
  // It persists on change — "Save to vehicle" generates the document, it is
  // never the thing that makes the vehicle record true.
  const persistEquipment = async (next: StickerData) => {
    if (cfg.type !== "addendum" || !prefill.vehicle?.id || !tenant?.id) return;
    const items: AddendumItemInput[] = [
      ...next.installed.filter((i) => i.name.trim()).map((i) => ({ itemType: "installed" as const, name: i.name, price: i.price, note: i.note })),
      ...next.benefits.filter((i) => i.name.trim()).map((i) => ({ itemType: "benefit" as const, name: i.name, price: i.price, note: i.note })),
      ...next.upgrades.filter((i) => i.name.trim()).map((i) => ({ itemType: "available_upgrade" as const, name: i.name, price: i.price, note: i.note, isSelected: totalMsrpMode })),
    ];
    const scope = {
      tenantId: tenant.id,
      vin: next.vin,
      installedNames: next.installed.map((i) => i.name).filter((n) => n.trim()),
      optionalNames: next.upgrades.map((i) => i.name).filter((n) => n.trim()),
    };
    await Promise.all([
      saveAddendumState({ tenantId: tenant.id, vehicleId: prefill.vehicle.id, baseMsrp: next.msrp, items }),
      syncAddendumProductBadges(scope),
      syncGetReadyInstalls(scope),
    ]);
  };

  // The shared per-vehicle equipment record, keyed by stable uuid. Rows in this
  // editor are matched to it so a status change writes the authoritative record
  // every other module reads, instead of a private array.
  const equipment = useVehicleEquipment(prefill.vehicle?.id, tenant?.id, data.msrp || data.price);
  // Identity first, name only as the initial binding for a row the record has
  // not adopted yet — so renaming an item can never detach it.
  const equipmentRecordFor = (item: StickerLineItem | string) => {
    const row = typeof item === "string" ? { name: item, equipmentId: undefined } : item;
    if (row.equipmentId) return equipment.items.find((e) => e.id === row.equipmentId);
    const name = row.name?.trim().toLowerCase();
    return name ? equipment.items.find((e) => e.name.trim().toLowerCase() === name) : undefined;
  };

  // The authoritative record can change without this page doing anything — the
  // 96-hour proof sweep demotes an unproven item, a late proof restores it. Pull
  // those decisions into the editor so the preview and totals stay truthful.
  useEffect(() => {
    if (!equipment.items.length) return;
    setData((d) => {
      let changed = false;
      const next = { ...d };
      const findRow = (record: (typeof equipment.items)[number]) => {
        for (const key of STATUS_KEYS) {
          const byId = next[key].findIndex((it) => it.equipmentId === record.id);
          if (byId >= 0) return { key, idx: byId };
        }
        for (const key of STATUS_KEYS) {
          // Only adopt an un-linked row by name; a row already bound to another
          // record must never be stolen by a same-named one.
          const byName = next[key].findIndex(
            (it) => !it.equipmentId && it.name.trim().toLowerCase() === record.name.trim().toLowerCase(),
          );
          if (byName >= 0) return { key, idx: byName };
        }
        return null;
      };

      for (const record of equipment.items) {
        const found = findRow(record);
        if (!found) continue;
        const target = RECORD_TO_STATUS[record.customerStatus];
        const row = next[found.key][found.idx];
        if (row.equipmentId !== record.id) {
          next[found.key] = next[found.key].map((it, i) => (i === found.idx ? { ...it, equipmentId: record.id } : it));
          changed = true;
        }
        if (found.key !== target) {
          const moved = { ...next[found.key][found.idx], equipmentId: record.id };
          next[found.key] = next[found.key].filter((_, i) => i !== found.idx);
          next[target] = [...next[target], moved];
          changed = true;
        }
      }
      return changed ? next : d;
    });
  }, [equipment.items]);

  // Accessory catalog search. Adding from the catalog carries the dealership's
  // own price and lands in the same equipment record a typed row does.
  const [catalogQuery, setCatalogQuery] = useState("");
  const defaultAddSection: EquipmentStatusKey = cfg.sections.includes("installed") ? "installed" : "upgrades";
  const catalogMatches = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const taken = new Set(STATUS_KEYS.flatMap((k) => data[k].map((it) => it.name.trim().toLowerCase())));
    return (products || [])
      .filter((p) => p.name?.toLowerCase().includes(q) && !taken.has(p.name.trim().toLowerCase()))
      .slice(0, 8);
  }, [catalogQuery, products, data]);

  const addFromCatalog = (product: { name: string; price?: number | string; badge_type?: string }) => {
    const section: EquipmentStatusKey =
      product.badge_type === "installed" ? "installed" : product.badge_type === "optional" ? "upgrades" : defaultAddSection;
    const price = Number(String(product.price ?? "").replace(/[^0-9.]/g, ""));
    setData((d) => {
      if (d[section].filter((it) => it.name.trim()).length >= cfg.maxItems[section]) {
        toast.error(`${SECTION_LABEL[section]} is full (${cfg.maxItems[section]} max)`);
        return d;
      }
      const row = { name: product.name, price: price > 0 ? String(price) : "", note: "" };
      return { ...d, [section]: [...d[section].filter((it) => it.name.trim()), row] };
    });
    setCatalogQuery("");
    toast.success(`${product.name} added to ${SECTION_LABEL[section]}`);
  };

  // ── Value propositions ───────────────────────────────────────────────
  // The dealership's programs ARE its value-proposition library
  // (settings.dealer_programs), so this edits that record rather than starting
  // a second one. showOnSticker is the placement toggle it already had.
  const stickerPrograms = useMemo(
    () => (settings.dealer_programs || []).filter((p) => p.enabled && p.showOnSticker),
    [settings.dealer_programs],
  );
  const [selectedVpId, setSelectedVpId] = useState<string>("");
  const selectedVp = stickerPrograms.find((p) => p.id === selectedVpId) || stickerPrograms[0];
  const [uploadingVp, setUploadingVp] = useState(false);
  // Every image any program has ever used, so the dealer picks from one library.
  const vpImageLibrary = useMemo(
    () => Array.from(new Set((settings.dealer_programs || []).map((p) => p.imageUrl).filter(Boolean) as string[])),
    [settings.dealer_programs],
  );

  const saveProgram = (id: string, patch: Partial<DealerProgram>) => {
    const next = (settings.dealer_programs || []).map((p) => (p.id === id ? { ...p, ...patch } : p));
    updateSettings({ dealer_programs: next });
  };

  const addValueProposition = () => {
    const program = { ...emptyProgram(), title: "New value proposition", showOnSticker: true };
    updateSettings({ dealer_programs: [...(settings.dealer_programs || []), program] });
    setSelectedVpId(program.id);
  };

  const uploadVpImage = async (file: File) => {
    if (!selectedVp) return;
    setUploadingVp(true);
    try {
      const up = await uploadPhoto("dealer-logos", file, { tenantId: tenant?.id });
      if (up?.url) saveProgram(selectedVp.id, { imageUrl: up.url });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally { setUploadingVp(false); }
  };

  // Selected propositions flow into the render data, so preview, PDF, PNG,
  // print, and the signing addendum all show the same claims and disclosures.
  useEffect(() => {
    const next = stickerPrograms.map(toStickerValueProp);
    setData((d) => (JSON.stringify(d.valueProps || []) === JSON.stringify(next) ? d : { ...d, valueProps: next }));
  }, [stickerPrograms]);

  // Pointer reordering. Dropping a row onto another section is a status change,
  // so the drop routes through changeStatus and picks up the same persistence,
  // sync, and undo a dropdown change does.
  const [dragRow, setDragRow] = useState<{ key: EquipmentStatusKey; index: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const handleDrop = (key: EquipmentStatusKey, index: number) => {
    const from = dragRow;
    setDragRow(null);
    setDropTarget(null);
    if (!from) return;
    if (from.key !== key) { changeStatus(from.key, key, from.index); return; }
    if (from.index === index) return;
    setData((d) => {
      const list = [...d[key]];
      const [moved] = list.splice(from.index, 1);
      list.splice(index, 0, moved);
      return { ...d, [key]: list };
    });
    const record = equipmentRecordFor(data[key][from.index]);
    if (record) void equipment.reorder(record.id, index > from.index ? 1 : -1);
  };

  const nameInputFocus = (key: EquipmentStatusKey, i: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-equipment-name="${key}-${i}"]`);
    el?.focus();
    el?.select();
  };

  const promptInstaller = async (itemId: string, current: string) => {
    const name = window.prompt("Assign installer", current);
    if (name === null) return;
    await equipment.assignInstaller(itemId, name.trim());
    toast.success(name.trim() ? `Installer set to ${name.trim()}` : "Installer cleared");
  };

  const moveRow = (key: EquipmentStatusKey, i: number, direction: -1 | 1) => {
    const target = i + direction;
    setData((d) => {
      const list = [...d[key]];
      if (target < 0 || target >= list.length) return d;
      [list[i], list[target]] = [list[target], list[i]];
      return { ...d, [key]: list };
    });
    const record = equipmentRecordFor(data[key][i]);
    if (record) void equipment.reorder(record.id, direction);
  };

  const changeStatus = (from: EquipmentStatusKey, to: EquipmentStatusKey, i: number) => {
    if (from === to) return;
    const item = data[from][i];
    if (!item?.name.trim()) {
      // Reclassifying a blank row is just a re-type; move it without the noise.
      setData((d) => ({ ...d, [from]: d[from].filter((_, idx) => idx !== i), [to]: [...d[to], item || blankItem()] }));
      return;
    }
    if (data[to].filter((it) => it.name.trim()).length >= cfg.maxItems[to]) {
      toast.error(`${STATUS_LABEL[to]} is full (${cfg.maxItems[to]} max)`);
      return;
    }
    const previous = data;
    const next: StickerData = {
      ...data,
      [from]: data[from].filter((_, idx) => idx !== i),
      [to]: [...data[to].filter((it) => it.name.trim()), item],
    };
    setData(next);

    // Authoritative write first when the row is backed by the shared record —
    // that is what carries the proof deadline, the audit entry, and every other
    // module. The snapshot sync keeps pre-migration databases correct too.
    const record = equipmentRecordFor(item);
    const apply = async (target: EquipmentStatusKey, snapshot: StickerData) => {
      if (record) await equipment.setStatus(record.id, STATUS_TO_RECORD[target]);
      await persistEquipment(snapshot);
    };
    void apply(to, next);

    toast.success(`${item.name} changed to ${STATUS_LABEL[to]} everywhere`, {
      action: {
        label: "Undo",
        onClick: () => { setData(previous); void apply(from, previous); },
      },
    });
  };

  // ── Output ───────────────────────────────────────────────────────────
  const capture = async () => {
    const node = sheetRef.current;
    if (!node) return null;
    const { default: html2canvas } = await import("html2canvas-pro");
    const prev = node.style.transform;
    node.style.transform = "scale(1)"; // capture at true paper size
    const canvas = await html2canvas(node, {
      scale: 2, useCORS: true,
      onclone: (await import("@/lib/html2canvasInputs")).replaceInputsForCanvas as never,
    } as never);
    node.style.transform = prev;
    return canvas;
  };

  // Vector print-to-PDF: hand the resolved template + data to the chrome-free
  // /print route in a new tab, where the browser renders the real template at
  // true paper size and its native print dialog saves a pixel-perfect PDF.
  const handlePrint = () => {
    try {
      const key = `sticker-print-${crypto.randomUUID()}`;
      localStorage.setItem(key, JSON.stringify({ config: cfg, data, branding, options, calibration }));
      const w = window.open(`/print/sticker/${cfg.id}?h=${key}`, "_blank", "noopener");
      if (!w) toast.error("Allow pop-ups to open the print view");
    } catch { toast.error("Couldn't open print view"); }
  };

  const handlePdf = async () => {
    setGenerating(true);
    try {
      const canvas = await capture();
      if (!canvas) return;
      const { default: jsPDF } = await import("jspdf");
      const img = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF({ unit: "in", format: [cfg.widthIn, cfg.heightIn], orientation: "portrait" });
      pdf.addImage(img, "JPEG", 0, 0, cfg.widthIn, cfg.heightIn);
      pdf.save(`${cfg.id}-${data.stock || data.vin || "sticker"}.pdf`);
    } catch { toast.error("PDF failed"); } finally { setGenerating(false); }
  };

  const handlePng = async () => {
    setGenerating(true);
    try {
      const canvas = await capture();
      if (!canvas) return;
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${cfg.id}-${data.stock || data.vin || "sticker"}.png`;
      a.click();
    } catch { toast.error("PNG failed"); } finally { setGenerating(false); }
  };

  const handleSave = async () => {
    // Quota: hard-block over the monthly cap; warn (but allow) past the soft cap.
    const qState = quota.state("stickers_generated");
    if (qState === "blocked") {
      toast.error("Monthly sticker limit reached for your plan. Contact support to upgrade.");
      return;
    }
    if (qState === "over_soft" || qState === "near") {
      toast.warning("You're near your monthly sticker limit for this plan.");
    }
    setGenerating(true);
    try {
      const r = await saveStickerToVehicle({
        tenantId: tenant?.id, vehicleId: prefill.vehicle?.id, vin: data.vin,
        templateId: cfg.id, docType: cfg.type, labelMode, qrUrl: data.qrUrl,
        snapshot: { config: cfg, data, branding, options },
      });
      if (r.ok) {
        // Dealer rule: auto-submit a freshly generated doc for manager approval.
        if (rules.autoSubmitForApproval && r.documentId) {
          await transitionDocument({
            doc: { id: r.documentId, tenant_id: tenant?.id || null, vehicle_id: prefill.vehicle?.id || null, template_id: cfg.id, document_type: cfg.type, document_status: "draft", version: r.version || 1 },
            action: "submit", actorId: user?.id,
          });
          setSavedDoc({ version: r.version, status: "pending_approval" });
        } else if (r.version) setSavedDoc({ version: r.version, status: "draft" });
        toast.success(r.version ? `Saved to vehicle file (v${r.version})` : "Saved to vehicle file");
        // Persist structured addendum state alongside, when this is an addendum.
        if (cfg.type === "addendum" && prefill.vehicle?.id) {
          const items: AddendumItemInput[] = [
            ...data.installed.filter((i) => i.name.trim()).map((i) => ({ itemType: "installed" as const, name: i.name, price: i.price, note: i.note })),
            ...data.benefits.filter((i) => i.name.trim()).map((i) => ({ itemType: "benefit" as const, name: i.name, price: i.price, note: i.note })),
            ...data.upgrades.filter((i) => i.name.trim()).map((i) => ({ itemType: "available_upgrade" as const, name: i.name, price: i.price, note: i.note, isSelected: totalMsrpMode })),
          ];
          await saveAddendumState({ tenantId: tenant?.id, vehicleId: prefill.vehicle.id, baseMsrp: data.msrp, items });
          // Carry the installed/available split downstream: the addendum the
          // customer signs, and the get-ready install work. Best-effort — a
          // failure here must never lose the save the dealer just made.
          const lineSync = {
            tenantId: tenant?.id,
            vin: data.vin,
            installedNames: data.installed.map((i) => i.name).filter((n) => n.trim()),
            optionalNames: data.upgrades.map((i) => i.name).filter((n) => n.trim()),
          };
          const [badges, getReady] = await Promise.all([
            syncAddendumProductBadges(lineSync),
            syncGetReadyInstalls(lineSync),
          ]);
          const touched = [badges.documentId ? "customer addendum" : null, getReady.documentId ? "get-ready" : null].filter(Boolean);
          if (touched.length) toast.success(`Updated ${touched.join(" and ")} from the line items`);
        }
      } else toast.error(r.error === "no_vehicle" ? "Open this from a vehicle to save it to the file" : "Couldn't save");
    } finally { setGenerating(false); }
  };

  const handlePublish = async () => {
    if (matchBlocked) { toast.error("Resolve the blocking sticker/packet findings before publishing"); return; }
    const r = await publishToPassport(prefill.vehicle?.id, tenant?.id);
    if (r.ok) {
      setSavedDoc((d) => ({ ...(d || {}), status: "published" }));
      toast.success(r.url ? "Published to Vehicle Passport" : "Published");
    } else toast.error(r.error === "no_vehicle" ? "Open this from a vehicle to publish" : "Couldn't publish");
  };

  const input = "w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm outline-none focus:border-primary";
  const label = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
  const fitScale = cfg.type === "addendum" ? 0.9 : 0.62;
  const previewScale = zoomPreset === "fit" ? fitScale : Number(zoomPreset) / 100;

  const renderItemEditor = (keyName: EquipmentStatusKey) => (
    <div key={keyName}>
      {/* The three sections stay visible as groups inside the one table, so a
          row's status and where it sits always agree. */}
      <div className="flex items-center justify-between border-t border-border px-1 pt-2 pb-1 first:border-t-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {SECTION_LABEL[keyName]} <span className="text-muted-foreground/60">({data[keyName].filter((it) => it.name.trim()).length}/{cfg.maxItems[keyName]})</span>
        </span>
        <button onClick={() => addItem(keyName)} disabled={data[keyName].length >= cfg.maxItems[keyName]} className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 disabled:opacity-40"><Plus className="w-3 h-3" /> Add</button>
      </div>
      {data[keyName].map((it, i) => {
        const record = equipmentRecordFor(it);
        const badge = proofBadge(
          record ?? { customerStatus: STATUS_TO_RECORD[keyName], workflowStatus: "not_applicable", proofDueAt: null },
          settings.dealer_timezone,
        );
        return (
          <div
            key={i}
            draggable
            onDragStart={() => setDragRow({ key: keyName, index: i })}
            onDragOver={(e) => { e.preventDefault(); setDropTarget(`${keyName}-${i}`); }}
            onDragLeave={() => setDropTarget((t) => (t === `${keyName}-${i}` ? null : t))}
            onDrop={(e) => { e.preventDefault(); handleDrop(keyName, i); }}
            onDragEnd={() => { setDragRow(null); setDropTarget(null); }}
            className={`grid grid-cols-[14px_minmax(0,1fr)_72px_124px_112px_32px] items-center gap-1.5 rounded-md py-0.5 transition-all duration-200 ${dropTarget === `${keyName}-${i}` ? "ring-2 ring-blue-400" : ""} ${dragRow?.key === keyName && dragRow.index === i ? "opacity-40" : ""}`}
          >
            <span aria-hidden className="text-muted-foreground/50 cursor-grab active:cursor-grabbing"><GripVertical className="w-3.5 h-3.5" /></span>
            <input data-equipment-name={`${keyName}-${i}`} value={it.name} onChange={(e) => setItem(keyName, i, { name: e.target.value })} placeholder="Item name" className={`${input} min-w-0`} />
            <input value={it.price} onChange={(e) => setItem(keyName, i, { price: e.target.value })} placeholder="$" className={`${input} min-w-0`} inputMode="decimal" />
            {/* The status names the outcome, so nobody has to guess what an
                arrow does to pricing, get-ready, or the signing addendum. */}
            <select
              value={keyName}
              onChange={(e) => changeStatus(keyName, e.target.value as EquipmentStatusKey, i)}
              aria-label={`Status for ${it.name || "new item"}`}
              className={`${input} min-w-0 cursor-pointer`}
            >
              {STATUS_KEYS.map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
            </select>
            {/* Internal proof state. Never rendered on a customer document. */}
            <span
              className={`inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${BADGE_TONE[badge.tone]}`}
              title={badge.label}
            >
              {badge.tone === "verified" && <CheckCircle2 className="w-3 h-3 shrink-0" />}
              {(badge.tone === "awaiting" || badge.tone === "overdue") && <AlertTriangle className="w-3 h-3 shrink-0" />}
              <span className="truncate">{badge.label}</span>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label={`Actions for ${it.name || "new item"}`} className="h-9 w-9 flex-shrink-0 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"><MoreVertical className="w-3.5 h-3.5" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => nameInputFocus(keyName, i)}>Edit details</DropdownMenuItem>
                <DropdownMenuItem disabled={!record} onSelect={() => record && promptInstaller(record.id, record.installerName || "")}>
                  Assign installer{record?.installerName ? ` · ${record.installerName}` : ""}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!prefill.vehicle?.vin} onSelect={() => navigate(`/vehicle-file/${prefill.vehicle?.id || ""}`)}>
                  View installation proof
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!record} onSelect={() => record && equipment.duplicate(record.id)}>Duplicate</DropdownMenuItem>
                <DropdownMenuItem disabled={i === 0} onSelect={() => moveRow(keyName, i, -1)}>Move up</DropdownMenuItem>
                <DropdownMenuItem disabled={i === data[keyName].length - 1} onSelect={() => moveRow(keyName, i, 1)}>Move down</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => removeItem(keyName, i)} className="text-rose-600 focus:text-rose-600">
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Remove item
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="p-4 lg:p-6 max-w-[1500px] mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => navigate("/sticker-studio")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Sticker Studio</button>
          <h1 className="text-xl font-semibold tracking-tight font-display text-foreground inline-flex items-center gap-2">
            {cfg.name}
            {savedDoc && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${savedDoc.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                <CheckCircle2 className="w-3 h-3" /> {savedDoc.status === "published" ? "Published" : `Saved v${savedDoc.version}`}
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">{cfg.size} · {cfg.type === "window" ? "Window sticker" : "Addendum sticker"}</p>
        </div>
        <div className="flex gap-2 no-print flex-wrap">
          <button onClick={handlePrint} title="Open a print-perfect, vector PDF in a new tab" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted"><Printer className="w-3.5 h-3.5" /> Print / PDF</button>
          <button onClick={handlePng} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"><ImageIcon className="w-3.5 h-3.5" /> PNG</button>
          <button onClick={handlePdf} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"><Download className="w-3.5 h-3.5" /> {generating ? "Generating…" : "PDF"}</button>
          <button onClick={handleSave} disabled={generating} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="w-3.5 h-3.5" /> Save to vehicle</button>
          <button onClick={handlePublish} disabled={matchBlocked} title={matchBlocked ? "Blocked by sticker/packet review" : undefined} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"><Globe className="w-3.5 h-3.5" /> Publish passport</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Config panel */}
        <div className="lg:col-span-2 space-y-4 no-print">
          <CfgCard title="Vehicle">
            <div className="space-y-2">
              <div><label className={label}>Vehicle title</label><input value={data.vehicleTitle} onChange={(e) => setField("vehicleTitle", e.target.value)} placeholder="2027 INFINITI QX60 LUXE" className={input} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={label}>VIN</label><input value={data.vin} onChange={(e) => setField("vin", e.target.value.toUpperCase())} className={`${input} font-mono`} /></div>
                <div><label className={label}>Stock #</label><input value={data.stock} onChange={(e) => setField("stock", e.target.value)} className={input} /></div>
                <div><label className={label}>Mileage</label><input value={data.mileage} onChange={(e) => setField("mileage", e.target.value)} className={input} /></div>
                <div><label className={label}>{cfg.type === "addendum" ? "Base MSRP" : "MSRP"}</label><input value={data.msrp} onChange={(e) => setField("msrp", e.target.value)} className={input} /></div>
                {cfg.type === "window" && <div className="col-span-2"><label className={label}>Price</label><input value={data.price} onChange={(e) => setField("price", e.target.value)} className={input} /></div>}
              </div>
            </div>
          </CfgCard>

          {isAddendum && addendum && (
            <CfgCard title="Addendum packet">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground capitalize">{addendum.signedAt ? "Signed" : addendum.status || "Draft"}</span>
                    {" · "}{addendum.products.length} product{addendum.products.length === 1 ? "" : "s"}
                    {addendum.customerName ? ` · ${addendum.customerName}` : ""}
                  </div>
                  <button onClick={loadPacketData} className="h-8 px-2.5 rounded-md bg-blue-600 text-white text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-blue-700"><FileCheck2 className="w-3.5 h-3.5" /> Load packet items</button>
                </div>
                {addendum.signedAt && <p className="text-[10px] text-amber-700">This packet is signed. Material changes require a new addendum version and customer re-review.</p>}
              </div>
            </CfgCard>
          )}

          {packetCtx && <StickerPacketReviewPanel sticker={data} ctx={packetCtx} />}

          <CfgCard title="Equipment & Accessories">
            <div className="space-y-2">
              {/* Add from the dealership's own product catalog, or type a
                  one-off line. Both land in the same equipment record. */}
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder="Search accessory catalog…"
                    className={`${input} !pl-8`}
                  />
                  {catalogMatches.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg max-h-56 overflow-auto">
                      {catalogMatches.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => addFromCatalog(p)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span className="truncate">{p.name}</span>
                          <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                            {Number(p.price) > 0 ? `$${Number(p.price).toLocaleString()}` : "—"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => addItem(defaultAddSection)}
                  className="h-9 shrink-0 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Add equipment
                </button>
              </div>

              <div>
                <div>
                  <div className="grid grid-cols-[14px_minmax(0,1fr)_72px_124px_112px_32px] gap-1.5 px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span /><span>Item</span><span>Price</span><span>Status</span><span>Installation proof</span><span />
                  </div>
                  {STATUS_KEYS.filter((k) => cfg.sections.includes(k)).map(renderItemEditor)}
                </div>
              </div>

              {/* Says out loud what a status change already does, so nobody has
                  to wonder whether the rest of the workflow heard about it. */}
              <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-[11px] font-semibold text-blue-800">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Synced with Get Ready, Vehicle Passport &amp; Signing Addendum
              </div>
            </div>
          </CfgCard>

          <CfgCard title="Value Propositions">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {stickerPrograms.length ? `${stickerPrograms.length} on this addendum` : "None on this addendum yet"}
                </span>
                <button onClick={addValueProposition} className="h-8 shrink-0 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700">
                  <Plus className="w-3.5 h-3.5" /> Add value proposition
                </button>
              </div>

              {stickerPrograms.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {stickerPrograms.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedVpId(p.id)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${p.id === selectedVp?.id ? "border-blue-300 bg-blue-50 text-blue-800" : "border-border text-muted-foreground hover:bg-muted"}`}
                    >{p.title || "Untitled"}</button>
                  ))}
                </div>
              )}

              {selectedVp ? (
                <div className="rounded-lg border border-border p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground truncate">{selectedVp.title || "Untitled"}</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">Selected</span>
                  </div>

                  <div>
                    <label className={label}>Image library</label>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {vpImageLibrary.map((url) => (
                        <button
                          key={url}
                          onClick={() => saveProgram(selectedVp.id, { imageUrl: url })}
                          className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 bg-white ${selectedVp.imageUrl === url ? "border-blue-500" : "border-border hover:border-blue-300"}`}
                        >
                          <img src={url} alt="" className="h-full w-full object-contain p-1" />
                          {selectedVp.imageUrl === url && <CheckCircle2 className="absolute left-1 top-1 h-3.5 w-3.5 text-blue-600" />}
                        </button>
                      ))}
                      <label className="flex h-14 w-20 shrink-0 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border text-[10px] font-semibold text-muted-foreground hover:border-blue-300">
                        <Plus className="h-3.5 w-3.5" />
                        {uploadingVp ? "Uploading…" : "Upload"}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadVpImage(f); e.target.value = ""; }} />
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className={label}>Display style</label>
                      <div className="mt-1 inline-flex rounded-lg border border-border bg-card p-0.5">
                        {PROGRAM_DISPLAY_STYLES.map((sty) => (
                          <button
                            key={sty.id}
                            onClick={() => saveProgram(selectedVp.id, { displayStyle: sty.id as ProgramDisplayStyle })}
                            className={`px-3 h-8 rounded-md text-xs font-semibold ${(selectedVp.displayStyle || "image_text") === sty.id ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                          >{sty.label}</button>
                        ))}
                      </div>
                    </div>
                    {/* Size applies whether or not the text is shown, so a logo
                        can stand on its own at any scale. */}
                    <div>
                      <label className={label}>Logo size</label>
                      <div className="mt-1 inline-flex rounded-lg border border-border bg-card p-0.5">
                        {PROGRAM_IMAGE_SCALES.map((sc) => (
                          <button
                            key={sc.id}
                            onClick={() => saveProgram(selectedVp.id, { imageScale: sc.id as ProgramImageScale })}
                            disabled={!selectedVp.imageUrl}
                            className={`px-3 h-8 rounded-md text-xs font-bold disabled:opacity-40 ${(selectedVp.imageScale || "sm") === sc.id ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}
                          >{sc.label}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className={label}>Headline</label>
                      <input value={selectedVp.title} onChange={(e) => saveProgram(selectedVp.id, { title: e.target.value })} className={input} />
                    </div>
                    <div>
                      <label className={label}>Supporting line</label>
                      <input value={selectedVp.supportingLine ?? selectedVp.offer} onChange={(e) => saveProgram(selectedVp.id, { supportingLine: e.target.value })} className={input} />
                    </div>
                  </div>

                  <div>
                    <label className={label}>Disclosure</label>
                    <textarea
                      value={selectedVp.disclosure}
                      onChange={(e) => saveProgram(selectedVp.id, { disclosure: e.target.value })}
                      rows={2}
                      placeholder="Terms, conditions, and exclusions printed under the totals."
                      className="w-full px-2.5 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-primary resize-y"
                    />
                    <label className="mt-1.5 flex items-center gap-2 text-xs text-foreground">
                      <input type="checkbox" checked={selectedVp.showAskForDetails !== false} onChange={(e) => saveProgram(selectedVp.id, { showAskForDetails: e.target.checked })} />
                      Show "Ask for details"
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Saved to dealer library · Available on all addendum templates
                    </span>
                    <button
                      onClick={() => saveProgram(selectedVp.id, { showOnSticker: false })}
                      className="text-[11px] font-semibold text-rose-600 hover:underline"
                    >Remove from addendum</button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Your dealer programs become value propositions here. Add one, or enable "show on sticker" for an existing program in Admin → Programs.
                </p>
              )}
            </div>
          </CfgCard>

          <CfgCard title="Branding">
            <div className="space-y-2.5">
              {/* Resolved dealership block — what will actually print. Shown so a
                  user can see WHICH location's identity this document carries. */}
              <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Dealership{identity.locationName ? ` · ${identity.locationName}` : ""}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{identity.displayName || "Not configured"}</p>
                {identity.addressLine1 && <p className="text-[11px] text-muted-foreground">{identity.addressLine1}</p>}
                {identity.addressLine2 && <p className="text-[11px] text-muted-foreground">{identity.addressLine2}</p>}
                {identity.phone && <p className="text-[11px] text-muted-foreground">{identity.phone}</p>}
                {identity.websiteDisplay && <p className="text-[11px] text-muted-foreground">{identity.websiteDisplay}</p>}
              </div>
              {overflow.overflows && (
                <p className="text-[10px] text-amber-700 inline-flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {overflow.message}
                </p>
              )}
              {identity.warnings.length > 0 && (
                <div className="space-y-1">
                  {identity.warnings.map((w) => (
                    <p key={w.code} className="text-[10px] text-amber-700 inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" /> {w.message}
                      <button onClick={() => navigate(w.settingsPath)} className="font-bold underline">
                        {w.code === "missing_logo" ? "Upload logo" : w.code === "unassigned_vehicle" ? "Assign location" : "Open settings"}
                      </button>
                    </p>
                  ))}
                </div>
              )}
              {cfg.supportsLogo && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={branding.showLogo}
                    onChange={(e) => {
                      const showLogo = e.target.checked;
                      setBranding((b) => ({ ...b, showLogo }));
                      // Persist through the template customization the renderer
                      // already reads, so the choice survives reload and applies
                      // to every generated output — not just this preview.
                      saveCustomization({ ...customization, logoEnabled: showLogo });
                    }}
                  /> Show dealer logo
                </label>
              )}
              {/* Asset readiness — warns before print on a missing/low-res logo or a required-but-missing QR. */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {cfg.supportsLogo && branding.showLogo && (
                  <span className={`inline-flex items-center gap-1 ${assets.logo === "ready" ? "text-emerald-600" : assets.logo === "low_res" ? "text-amber-600" : "text-muted-foreground"}`}>
                    <ImageIcon className="w-3 h-3" /> Logo: {assets.logo === "ready" ? "ready" : assets.logo === "low_res" ? `low-res (${assets.logoWidth}px)` : "fallback to name"}
                  </span>
                )}
                {cfg.supportsQr && (
                  <span className={`inline-flex items-center gap-1 ${assets.qr === "ready" ? "text-emerald-600" : assets.qrBlocking ? "text-rose-600" : "text-muted-foreground"}`}>
                    <QrIcon className="w-3 h-3" /> QR: {assets.qr === "ready" ? "ready" : assets.qrBlocking ? "required — missing" : "open this from a vehicle"}
                  </span>
                )}
              </div>
              {assets.qrBlocking && (
                <p className="text-[10px] text-rose-600 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> This compliance template requires a QR destination. Open it from a vehicle so the passport URL is set.</p>
              )}
              <div><label className={label}>Value proposition</label><input value={branding.valueProp} onChange={(e) => setBranding((b) => ({ ...b, valueProp: e.target.value }))} placeholder="Lifetime powertrain · Free maintenance" className={input} /></div>
              <div><label className={label}>Disclaimer</label><textarea value={branding.disclaimer} onChange={(e) => setBranding((b) => ({ ...b, disclaimer: e.target.value }))} rows={2} className="w-full px-2.5 py-2 rounded-md border border-border bg-background text-sm outline-none focus:border-primary resize-y" /></div>
              {cfg.supportsAccent && (
                <div>
                  <label className={label}>Accent color</label>
                  <div className="flex gap-1.5 mt-1">
                    {ACCENTS.map((c) => (
                      <button key={c} onClick={() => setBranding((b) => ({ ...b, accentColor: c }))} className={`w-7 h-7 rounded-full border-2 ${branding.accentColor === c ? "border-foreground" : "border-transparent"}`} style={{ backgroundColor: c }} aria-label={c} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CfgCard>

          <CfgCard title="Output options">
            <div className="space-y-3">
              <div>
                <label className={label}>Label stock</label>
                <div className="mt-1 inline-flex rounded-md border border-border bg-card p-0.5">
                  <button onClick={() => setLabelMode("white")} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded text-xs font-semibold ${labelMode === "white" ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}><Sun className="w-3.5 h-3.5" /> White label</button>
                  <button onClick={() => setLabelMode("black")} className={`inline-flex items-center gap-1 px-2.5 h-8 rounded text-xs font-semibold ${labelMode === "black" ? "bg-slate-900 text-white" : "text-muted-foreground hover:text-foreground"}`}><Moon className="w-3.5 h-3.5" /> Black label</button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={totalMsrpMode} onChange={(e) => setTotalMsrpMode(e.target.checked)} /> Show true Total MSRP roll-up</label>
              {cfg.type === "addendum" && (
                <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={showAddendumTotal} onChange={(e) => setShowAddendumTotal(e.target.checked)} /> Show addendum totals block</label>
              )}
              {(calibration.xOffsetIn !== 0 || calibration.yOffsetIn !== 0 || calibration.scalePct !== 100) && (
                <p className="text-[11px] text-muted-foreground">Print calibration active: offset {calibration.xOffsetIn}in / {calibration.yOffsetIn}in · scale {calibration.scalePct}%. Adjust in Print settings.</p>
              )}
            </div>
          </CfgCard>
        </div>

        {/* Live preview */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-2 no-print">
            <p className="text-[11px] font-semibold uppercase tracking-label text-muted-foreground">Live preview — {cfg.size}</p>
            <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
              {(["fit", "50", "75", "100"] as const).map((z) => (
                <button key={z} onClick={() => setZoomPreset(z)} className={`px-2 h-7 rounded text-[11px] font-semibold transition-colors ${zoomPreset === z ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  {z === "fit" ? "Fit" : `${z}%`}
                </button>
              ))}
            </div>
          </div>
          <div className={`flex justify-center rounded-2xl border border-border p-4 overflow-auto ${labelMode === "black" ? "bg-slate-800" : "bg-slate-100"}`}>
            <TemplateRenderer template={template} data={{ ...data, priceLabel: data.priceLabel || resolvePriceLabel(settings.price_label, tenant?.name || settings.dealer_name, (prefill.vehicle?.raw?.website_price_term as string) || null) }} branding={branding} scale={previewScale} capture={sheetRef} options={options} />
          </div>
        </div>
      </div>
    </div>
  );
};

const CfgCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <h3 className="text-sm font-bold text-foreground mb-3">{title}</h3>
    {children}
  </div>
);

export default StickerStudioGenerator;
