import SaturdayHeroWindow from "@/components/saturday/SaturdayHeroWindow";
import SaturdayClassicWindow from "@/components/saturday/SaturdayClassicWindow";
import SaturdayPremiumAddendum from "@/components/saturday/SaturdayPremiumAddendum";
import { buildSaturdayStickerData } from "@/components/saturday/wiring";

// Dev-only preview surface for the three Saturday templates.
// No backend writes, no signing, no billing — pure render.
// This preview now flows through the same tenant-safe adapter we will use for dealer-selectable templates.

const DATA = buildSaturdayStickerData({
  dealer: {
    name: "Harte INFINITI",
    address: "150 Weston Road, Hartford, CT 06120",
    phone: "860-524-1993",
    website: "harteinfiniti.com",
    slogan: "Luxury. Transparency. Confidence.",
    labelSettings: {
      priceLabel: "Best Price",
      certificationLabel: "Dealer Certified Pre-Owned",
      valueProps: [
        "Vehicle Passport",
        "Multi-Point Inspection",
        "Market Price Review",
        "Digital Evidence Packet",
        "Service Records",
      ],
      reviewSource: {
        type: "google",
        label: "Google Reviews",
        rating: 4.9,
        reviewCount: 1250,
        manuallyEntered: false,
        allowAutomatedFetch: true,
      },
      certificationTiers: [
        {
          id: "base-powertrain",
          label: "Dealer Certified",
          headline: "3 Month / 3,000 Mile Powertrain Coverage",
          months: 3,
          miles: 3000,
          isDefault: true,
          disclosure: "Dealer certification coverage varies by vehicle. See dealer for details.",
        },
        {
          id: "finance-upgrade",
          label: "Finance Upgrade",
          headline: "10 Year / 100,000 Mile Powertrain Coverage",
          months: 120,
          miles: 100000,
          requiresFinancing: true,
          disclosure: "Upgrade may require dealer-arranged financing and lender approval.",
        },
      ],
    },
  },
  vehicle: {
    title: "2024 INFINITI QX60 LUXE AWD",
    year: 2024,
    make: "INFINITI",
    model: "QX60",
    trim: "LUXE AWD",
    vin: "5N1DL1FS1RC334921",
    stock: "I24082A",
    mileage: 18426,
    pricing: {
      websitePrice: 46995,
      msrp: 52995,
    },
    specs: {
      drivetrain: "AWD",
      engine: "3.5L V6",
      transmission: "9-Speed Auto",
      exteriorColor: "Graphite Shadow",
      interiorColor: "Graphite Leather",
    },
    features: [
      "Heated leather seats",
      "Panoramic moonroof",
      "Adaptive cruise control",
      "Lane-keep assist",
      "ProPILOT Assist",
      "Apple CarPlay / Android Auto",
      "Around-view monitor",
      "Power liftgate",
    ],
    fuel: { city: 21, highway: 26, combined: 23 },
    certificationTierId: "finance-upgrade",
    // Production will pass the dealer inventory photo URL here.
    // The dev preview intentionally uses the premium SVG fallback so it never renders a broken remote image block.
  },
  market: {
    marketAverage: 48235,
    delta: -1240,
    radius: "50 miles",
    comparableCount: 27,
    recentSoldAverage: 47870,
    blackBookRetail: 49100,
    blackBookTrade: 40700,
    sourceLabel: "MarketCheck / Black Book",
  },
  qrUrl: "autolabels.io/v/sample-qx60",
  disclaimer:
    "Price includes applicable in-house financing rebates. Sales tax, registration or motor vehicle fees, and an $895 dealer doc fee are additional. See dealer for complete details.",
});

const ADDENDUM_DATA = {
  ...DATA,
  installed: [
    { name: "All-Weather Floor Liners", price: "295" },
    { name: "Cargo Package", price: "450" },
    { name: "Premium Window Tint", price: "399" },
    { name: "Wheel Locks", price: "129" },
    { name: "Ceramic Paint Protection", price: "1295" },
  ],
  upgrades: [
    { name: "Tire & Wheel Protection", price: "1295" },
    { name: "Appearance Protection", price: "995" },
    { name: "Key Replacement", price: "499" },
  ],
};

const Frame: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <div className="flex flex-col items-start gap-2">
    <div className="font-mono text-xs text-slate-600">{label}</div>
    {children}
  </div>
);

const DevSaturdayPreview = () => {
  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <h1 className="text-2xl font-bold text-slate-900">Saturday Templates — Preview</h1>
      <p className="mt-1 text-sm text-slate-700">
        Three fresh Saturday-series layouts rendered through the tenant-safe dealer + vehicle + market adapter.
      </p>

      <div className="mt-8 flex flex-wrap gap-10">
        <Frame label="saturday-hero-window · 8.5×11">
          <SaturdayHeroWindow data={DATA} />
        </Frame>

        <Frame label="saturday-classic-window · 8.5×11">
          <SaturdayClassicWindow data={DATA} />
        </Frame>

        <Frame label="saturday-premium-addendum · 4.5×11">
          <SaturdayPremiumAddendum data={ADDENDUM_DATA} />
        </Frame>
      </div>
    </div>
  );
};

export default DevSaturdayPreview;
