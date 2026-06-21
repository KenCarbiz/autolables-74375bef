import { TemplateRenderer, type StickerData, type StickerBranding, type LabelMode } from "@/lib/stickerStudio/templates";
import { STUDIO_TEMPLATES } from "@/lib/stickerStudio/templates";

// Dev-only preview surface: renders the three polished window-sticker hero
// templates side-by-side at exact 8.5x11 sheet proportions with realistic
// dealer + vehicle data, in both white and black label modes where supported.
// Public route so screenshot tooling can hit it without auth.

const DATA: StickerData = {
  vehicleTitle: "2024 INFINITI QX60 LUXE AWD",
  vin: "5N1DL1FS1RC334921",
  stock: "I24082A",
  mileage: "18426",
  msrp: "52995",
  price: "46995",
  installed: [
    { name: "All-Weather Floor Liners", price: 295 },
    { name: "Cargo Package", price: 450 },
    { name: "Premium Window Tint", price: 399 },
    { name: "Wheel Locks", price: 129 },
    { name: "Ceramic Paint Protection", price: 1295 },
  ],
  upgrades: [
    { name: "Tire & Wheel Protection", price: 1295 },
    { name: "Appearance Protection", price: 995 },
    { name: "Key Replacement", price: 499 },
  ],
  benefits: [
    { name: "Vehicle Passport Report" },
    { name: "Multi-Point Inspection" },
    { name: "Market Price Review" },
    { name: "Digital Evidence Packet" },
    { name: "Available Service Records" },
  ],
  qrUrl: "https://autolabels.io/v/sample-qx60",
};

const BRAND: StickerBranding = {
  dealerName: "Harte INFINITI",
  address: "150 Weston Road, Hartford, CT 06120",
  phone: "860-524-1993",
  website: "harteinfiniti.com",
  showLogo: false,
  valueProp: "Lifetime powertrain · loaners · complimentary washes",
  disclaimer:
    "Price includes applicable in-house financing rebates. Sales tax, registration or motor vehicle fees, and an $895 dealer doc fee are additional.",
  accentColor: "#2563EB",
};

const HERO_IDS = ["window-premium", "window-bold", "window-luxury"] as const;

const Sheet = ({ id, mode }: { id: string; mode: LabelMode }) => {
  const t = STUDIO_TEMPLATES.find((x) => x.config.id === id);
  if (!t) return <div className="text-red-600">Missing template {id}</div>;
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="text-xs font-mono text-slate-600">
        {id} · {t.config.name} · {mode} label
      </div>
      <TemplateRenderer template={t} data={DATA} branding={BRAND} options={{ labelMode: mode }} />
    </div>
  );
};

const DevHeroPreview = () => {
  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <h1 className="text-2xl font-bold mb-6">Sticker Studio — Hero Template Preview</h1>
      <p className="text-sm text-slate-700 mb-8">
        Each sheet rendered at exact 8.5×11 with the Harte INFINITI / 2024 QX60 LUXE AWD sample data.
      </p>
      <div className="space-y-12">
        <section>
          <h2 className="text-lg font-semibold mb-4">White label</h2>
          <div className="flex flex-wrap gap-8">
            {HERO_IDS.map((id) => (
              <Sheet key={`w-${id}`} id={id} mode="white" />
            ))}
          </div>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-4">Black label (window-bold + window-luxury support black stock)</h2>
          <div className="flex flex-wrap gap-8">
            {(["window-bold", "window-luxury"] as const).map((id) => (
              <Sheet key={`b-${id}`} id={id} mode="black" />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default DevHeroPreview;
