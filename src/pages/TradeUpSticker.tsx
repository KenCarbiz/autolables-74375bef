import { useState, useRef, useMemo } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useVinDecode } from "@/hooks/useVinDecode";
import { useAudit } from "@/contexts/AuditContext";
import { useAuth } from "@/contexts/AuthContext";
import { useVehiclePrefill, VehicleContextHeader } from "@/lib/vehiclePrefill";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  Sparkles,
  Car,
  Printer,
  Download,
  Palette,
  Settings2,
  Image as ImageIcon,
  Link2,
  Check,
  X,
} from "lucide-react";
import {
  STICKER_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TemplateCategory,
  getTemplatesByCategory,
  StickerTemplate,
} from "@/data/stickerTemplates";

type Theme = "red" | "blue" | "green" | "navy" | "gold";

const THEMES: Record<Theme, { gradient: string; text: string; cta: string; ctaSubhead: string }> = {
  red:   { gradient: "from-red-600 to-red-800",           text: "text-white",     cta: "bg-yellow-400 text-red-900",      ctaSubhead: "text-yellow-300" },
  blue:  { gradient: "from-blue-600 to-blue-900",         text: "text-white",     cta: "bg-orange-400 text-blue-900",     ctaSubhead: "text-orange-300" },
  green: { gradient: "from-emerald-600 to-emerald-900",   text: "text-white",     cta: "bg-yellow-300 text-emerald-900",  ctaSubhead: "text-yellow-200" },
  navy:  { gradient: "from-slate-800 to-slate-950",       text: "text-white",     cta: "bg-amber-400 text-slate-900",     ctaSubhead: "text-amber-300" },
  gold:  { gradient: "from-amber-500 to-amber-700",       text: "text-slate-900", cta: "bg-slate-900 text-amber-400",     ctaSubhead: "text-slate-900" },
};

const TradeUpSticker = () => {
  const { currentStore, tenant, isEmbedded, sendToParent } = useTenant() as ReturnType<typeof useTenant> & { sendToParent?: (t: string, p?: unknown) => void };
  const { settings } = useDealerSettings();
  const { decode, decoding } = useVinDecode();
  const { log } = useAudit();
  const { user } = useAuth();
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);

  // State
  const [vehicleType, setVehicleType] = useState<"new" | "used">("used");
  const [vehicle, setVehicle] = useState({ year: "", make: "", model: "", trim: "", vin: "", stock: "", mileage: "", price: "" });

  // Prefill from a vehicle file (?vehicleId=…) so the dealer never re-keys
  // the YMM / VIN / mileage / price for the trade-up hook.
  const prefill = useVehiclePrefill((v) => {
    setVehicle((prev) => ({
      ...prev,
      year: v.year || prev.year,
      make: v.make || prev.make,
      model: v.model || prev.model,
      trim: v.trim || prev.trim,
      vin: v.vin || prev.vin,
      stock: v.stock || prev.stock,
      mileage: v.mileage || prev.mileage,
      price: v.price || prev.price,
    }));
    if (v.condition === "new") setVehicleType("new");
    else if (v.condition === "used" || v.condition === "cpo") setVehicleType("used");
  });
  const [headline, setHeadline] = useState("WHAT'S YOUR CAR WORTH?");
  const [subhead, setSubhead] = useState("TRADE UP TODAY");
  const [offerText, setOfferText] = useState("Get an instant trade-in value and upgrade to a newer vehicle.");
  const [callText, setCallText] = useState("Scan to get your trade-in value in 60 seconds");
  const [theme, setTheme] = useState<Theme>("red");
  const [customQrUrl, setCustomQrUrl] = useState("");
  const [logoSource, setLogoSource] = useState<"store" | "tenant" | "custom" | "none">("store");
  const [customLogoUrl, setCustomLogoUrl] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("pro-instant-value");
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>("serious");

  const themeCfg = THEMES[theme];
  const dealerName = currentStore?.name || settings.dealer_name || tenant?.name || "Your Dealership";
  const phone = currentStore?.phone || "";

  // Logo selection
  const displayLogo = useMemo(() => {
    if (logoSource === "custom") return customLogoUrl;
    if (logoSource === "tenant") return tenant?.logo_url || "";
    if (logoSource === "store") return currentStore?.logo_url || settings.dealer_logo_url || tenant?.logo_url || "";
    return "";
  }, [logoSource, customLogoUrl, tenant, currentStore, settings]);

  // QR URL — prefers custom, falls back to HarteCash customer flow
  // Embedded mode: builds URL that leads into HarteCash lead capture with VIN + store + source
  const qrUrl = useMemo(() => {
    if (customQrUrl.trim()) return customQrUrl;

    const params = new URLSearchParams();
    if (vehicle.vin) params.set("vin", vehicle.vin);
    if (vehicle.stock) params.set("stock", vehicle.stock);
    if (currentStore?.id) params.set("store", currentStore.id);
    params.set("source", "trade_up_sticker");
    params.set("campaign", selectedTemplateId);

    // If embedded inside HarteCash, point at the parent's trade-in flow
    if (isEmbedded && tenant?.slug) {
      return `https://${tenant.slug}.app/trade-in?${params.toString()}`;
    }

    // Otherwise use the addon's own QR landing (lead capture still fires)
    return `${window.location.origin}/trade-in?${params.toString()}`;
  }, [customQrUrl, vehicle.vin, vehicle.stock, currentStore, isEmbedded, tenant, selectedTemplateId]);

  const handleApplyTemplate = (template: StickerTemplate) => {
    setSelectedTemplateId(template.id);
    setHeadline(template.headline);
    setSubhead(template.subhead);
    setOfferText(template.offerText);
    setCallText(template.callText);
    if (template.recommendedTheme) setTheme(template.recommendedTheme);
    toast.success(`Loaded "${template.name}" template`);
  };

  const handleVinDecode = async () => {
    if (!vehicle.vin.trim()) return;
    const result = await decode(vehicle.vin);
    if (result) {
      setVehicle({ ...vehicle, year: result.year, make: result.make, model: result.model, trim: result.trim });
      toast.success("VIN decoded");
    }
  };

  const handlePrint = () => {
    window.print();
    if (user) log({ store_id: currentStore?.id || "", user_id: user.id, action: "addendum_printed", entity_type: "trade_up_sticker", entity_id: vehicle.vin || "sticker", details: { theme, type: vehicleType, template: selectedTemplateId } });
    if (isEmbedded && sendToParent) {
      sendToParent("sticker_printed", { vin: vehicle.vin, stock: vehicle.stock, template: selectedTemplateId });
    }
  };

  const handleDownloadPdf = async () => {
    const card = cardRef.current;
    if (!card) return;
    setGenerating(true);
    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const { default: jsPDF } = await import("jspdf");
      const canvas = await html2canvas(card, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdfWidth = 8.5;
      const pdfHeight = (canvas.height / canvas.width) * pdfWidth;
      const pdf = new jsPDF({ unit: "in", format: [pdfWidth, pdfHeight], orientation: "portrait" });
      pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Trade-Up-${vehicle.vin || vehicle.stock || "draft"}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("PDF generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const categoryTemplates = getTemplatesByCategory(activeCategory);

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight font-display text-foreground">
            Trade-Up Sticker
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Hook customers with a promotional sticker. QR scan drops them into your {isEmbedded ? tenant?.name || "HarteCash" : "lead capture"} customer flow.
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
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
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {generating ? "Generating..." : "Download PDF"}
          </button>
        </div>
      </div>

      <VehicleContextHeader state={prefill} />

      {/* Template library */}
      <div className="bg-card rounded-xl border border-border shadow-premium overflow-hidden no-print">
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-foreground">Hook Templates</h3>
            <span className="text-xs text-muted-foreground">· {STICKER_TEMPLATES.length} pre-built hooks across 6 categories</span>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-5 py-3 border-b border-border overflow-x-auto">
          {TEMPLATE_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeCategory === cat.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Template grid */}
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {categoryTemplates.map(template => {
            const isSelected = selectedTemplateId === template.id;
            const cfg = THEMES[template.recommendedTheme || "red"];
            return (
              <button
                key={template.id}
                onClick={() => handleApplyTemplate(template)}
                className={`relative text-left rounded-lg overflow-hidden border-2 transition-all group ${
                  isSelected ? "border-primary shadow-premium-md" : "border-border hover:border-border/60"
                }`}
              >
                {/* Template preview */}
                <div className={`bg-gradient-to-br ${cfg.gradient} ${cfg.text} p-4 min-h-[100px] relative`}>
                  <p className="text-[11px] font-black leading-tight tracking-tight">{template.headline}</p>
                  <p className={`text-[13px] font-black leading-tight tracking-tight mt-0.5 ${cfg.ctaSubhead}`}>
                    {template.subhead}
                  </p>
                </div>
                <div className="px-3 py-2 bg-card flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground truncate">{template.name}</span>
                  {isSelected && (
                    <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <Check className="w-2.5 h-2.5 text-primary-foreground" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Split: config + preview */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Left: config panel */}
        <div className="lg:col-span-2 space-y-4 no-print">
          {/* Vehicle Type */}
          <ConfigCard icon={Car} title="Vehicle Type">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setVehicleType("new")}
                className={`h-10 rounded-md text-sm font-medium border-2 transition-all ${
                  vehicleType === "new" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
                }`}
              >
                New Vehicle
              </button>
              <button
                onClick={() => setVehicleType("used")}
                className={`h-10 rounded-md text-sm font-medium border-2 transition-all ${
                  vehicleType === "used" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
                }`}
              >
                Used Vehicle
              </button>
            </div>
          </ConfigCard>

          {/* Vehicle info */}
          <ConfigCard icon={Car} title="Vehicle Info">
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={vehicle.vin}
                  onChange={(e) => setVehicle({ ...vehicle, vin: e.target.value.toUpperCase() })}
                  placeholder="VIN (17 chars)"
                  className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
                />
                <button
                  onClick={handleVinDecode}
                  disabled={decoding || vehicle.vin.length !== 17}
                  className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 hover:opacity-90"
                >
                  {decoding ? "..." : "Decode"}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <input value={vehicle.year} onChange={(e) => setVehicle({ ...vehicle, year: e.target.value })} placeholder="Year" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.make} onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })} placeholder="Make" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none col-span-1" />
                <input value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} placeholder="Model" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none col-span-1" />
                <input value={vehicle.trim} onChange={(e) => setVehicle({ ...vehicle, trim: e.target.value })} placeholder="Trim" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none col-span-1" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input value={vehicle.stock} onChange={(e) => setVehicle({ ...vehicle, stock: e.target.value })} placeholder="Stock #" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.mileage} onChange={(e) => setVehicle({ ...vehicle, mileage: e.target.value })} placeholder="Mileage" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
                <input value={vehicle.price} onChange={(e) => setVehicle({ ...vehicle, price: e.target.value })} placeholder="Price" className="h-9 px-3 rounded-md border border-border bg-background text-sm outline-none" />
              </div>
            </div>
          </ConfigCard>

          {/* Messaging */}
          <ConfigCard icon={Settings2} title="Messaging">
            <div className="space-y-2">
              <Field label="Headline" value={headline} onChange={(v) => setHeadline(v.toUpperCase())} />
              <Field label="Subheading" value={subhead} onChange={(v) => setSubhead(v.toUpperCase())} />
              <Field label="Offer Text" value={offerText} onChange={setOfferText} />
              <Field label="Call To Action" value={callText} onChange={setCallText} />
            </div>
          </ConfigCard>

          {/* Logo */}
          <ConfigCard icon={ImageIcon} title="Dealer Logo">
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <LogoOption
                  active={logoSource === "store"}
                  onClick={() => setLogoSource("store")}
                  label="Store Logo"
                  hasLogo={!!(currentStore?.logo_url || settings.dealer_logo_url)}
                />
                <LogoOption
                  active={logoSource === "tenant"}
                  onClick={() => setLogoSource("tenant")}
                  label="Tenant Logo"
                  hasLogo={!!tenant?.logo_url}
                />
                <LogoOption
                  active={logoSource === "custom"}
                  onClick={() => setLogoSource("custom")}
                  label="Custom URL"
                  hasLogo={!!customLogoUrl}
                />
                <LogoOption
                  active={logoSource === "none"}
                  onClick={() => setLogoSource("none")}
                  label="No Logo"
                  hasLogo={false}
                />
              </div>
              {logoSource === "custom" && (
                <input
                  value={customLogoUrl}
                  onChange={(e) => setCustomLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              )}
              {displayLogo && logoSource !== "none" && (
                <div className="p-2 bg-muted rounded-md flex items-center justify-center">
                  <img src={displayLogo} alt="Logo preview" className="h-10 object-contain" />
                </div>
              )}
            </div>
          </ConfigCard>

          {/* QR URL */}
          <ConfigCard icon={Link2} title="Customer Flow URL">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                QR scan drops customers into your {isEmbedded ? `${tenant?.name || "parent app"} lead flow` : "trade-in lead capture"} with vehicle + store context.
              </p>
              <input
                value={customQrUrl}
                onChange={(e) => setCustomQrUrl(e.target.value)}
                placeholder={qrUrl}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-xs outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <p className="text-[10px] text-muted-foreground break-all">
                <strong>Resolves to:</strong> {qrUrl}
              </p>
            </div>
          </ConfigCard>

          {/* Theme */}
          <ConfigCard icon={Palette} title="Color Theme">
            <div className="grid grid-cols-5 gap-2">
              {(Object.keys(THEMES) as Theme[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`h-10 rounded-md bg-gradient-to-br ${THEMES[t].gradient} border-2 transition-all ${
                    theme === t ? "border-primary scale-105" : "border-transparent hover:border-border"
                  }`}
                  title={t}
                />
              ))}
            </div>
          </ConfigCard>
        </div>

        {/* Right: live sticker preview */}
        <div className="lg:col-span-3">
          <div className="sticky top-20">
            <p className="text-[11px] font-semibold uppercase tracking-label text-muted-foreground mb-2 no-print">
              Live Preview
            </p>
            <div
              ref={cardRef}
              className={`rounded-xl overflow-hidden shadow-premium-lg bg-gradient-to-br ${themeCfg.gradient} ${themeCfg.text} relative mx-auto`}
              style={{ aspectRatio: "8.5 / 11", maxWidth: "600px" }}
            >
              {/* Background decoration */}
              <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/5 -mr-20 -mt-20" />
              <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-white/5 -ml-28 -mb-28" />

              <div className="relative h-full flex flex-col p-10">
                {/* Top: type badge + dealer branding */}
                <div className="flex items-start justify-between">
                  <span className="bg-white/10 backdrop-blur-sm text-xs font-bold uppercase tracking-label px-3 py-1.5 rounded">
                    {vehicleType === "new" ? "New Arrival" : "Pre-Owned"}
                  </span>
                  <div className="text-right flex items-center gap-3">
                    {displayLogo && logoSource !== "none" && (
                      <div className="bg-white rounded p-1.5">
                        <img src={displayLogo} alt={dealerName} className="h-8 object-contain" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold">{dealerName}</p>
                      {phone && <p className="text-xs opacity-80">{phone}</p>}
                    </div>
                  </div>
                </div>

                {/* Headline */}
                <div className="flex-1 flex flex-col justify-center text-center mt-4">
                  <p className="text-4xl font-black leading-none tracking-tight font-display drop-shadow-sm">
                    {headline}
                  </p>
                  <div className="my-5 flex items-center justify-center gap-2">
                    <div className="h-[2px] w-12 bg-current opacity-40" />
                    <span className="text-[10px] uppercase tracking-label opacity-60">↓</span>
                    <div className="h-[2px] w-12 bg-current opacity-40" />
                  </div>
                  <p className={`text-5xl font-black leading-none tracking-tight font-display ${themeCfg.ctaSubhead} drop-shadow-md`}>
                    {subhead}
                  </p>
                  <p className="text-sm mt-5 opacity-90 max-w-xs mx-auto leading-relaxed">
                    {offerText}
                  </p>
                </div>

                {/* Vehicle chip */}
                {(vehicle.year || vehicle.make || vehicle.model) && (
                  <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 my-4 text-center">
                    <p className="text-xs uppercase tracking-wider opacity-70 mb-1">You're sitting in</p>
                    <p className="text-lg font-bold">
                      {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}
                    </p>
                    <div className="flex items-center justify-center gap-4 mt-1 text-xs opacity-80">
                      {vehicle.stock && <span>Stock: {vehicle.stock}</span>}
                      {vehicle.mileage && <span>{parseInt(vehicle.mileage).toLocaleString()} mi</span>}
                      {vehicle.price && <span>${parseInt(vehicle.price).toLocaleString()}</span>}
                    </div>
                  </div>
                )}

                {/* CTA with QR code */}
                <div className="bg-white rounded-lg p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Scan to get your
                    </p>
                    <p className="text-xl font-black tracking-tight text-slate-900">
                      Instant Trade Value
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {callText}
                    </p>
                  </div>
                  <div className="bg-white p-1 rounded">
                    <QRCodeSVG value={qrUrl} size={88} level="M" />
                  </div>
                </div>

                {/* Footer */}
                <div className="mt-4 pt-3 border-t border-white/20 flex items-center justify-between text-[10px] opacity-70">
                  <span className="truncate max-w-[50%]">{qrUrl.replace(/^https?:\/\//, "").split("?")[0]}</span>
                  <span>Limited Time Offer</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ConfigCard = ({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Car;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="bg-card rounded-xl border border-border shadow-premium p-4">
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    </div>
    {children}
  </div>
);

const Field = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div>
    <label className="text-xs font-semibold text-muted-foreground mb-1 block">{label}</label>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
    />
  </div>
);

const LogoOption = ({
  active,
  onClick,
  label,
  hasLogo,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hasLogo: boolean;
}) => (
  <button
    onClick={onClick}
    className={`h-10 px-3 rounded-md text-xs font-medium border-2 transition-all flex items-center justify-between ${
      active ? "border-primary bg-primary/5 text-primary" : "border-border bg-card hover:bg-muted text-foreground"
    }`}
  >
    <span>{label}</span>
    {hasLogo ? (
      <Check className="w-3 h-3 text-emerald-600" />
    ) : (
      <X className="w-3 h-3 text-muted-foreground" />
    )}
  </button>
);

export default TradeUpSticker;
