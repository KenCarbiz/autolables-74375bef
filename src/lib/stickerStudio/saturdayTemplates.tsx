import SaturdayHeroWindow from "@/components/saturday/SaturdayHeroWindow";
import SaturdayClassicWindow from "@/components/saturday/SaturdayClassicWindow";
import SaturdayPremiumAddendum from "@/components/saturday/SaturdayPremiumAddendum";
import MidnightPremiumAddendum from "@/components/saturday/MidnightPremiumAddendum";
import EclipsePremiumAddendum from "@/components/saturday/EclipsePremiumAddendum";
import OnyxPremiumAddendum from "@/components/saturday/OnyxPremiumAddendum";
import type { SaturdaySticker } from "@/components/saturday/types";
import type {
  StickerBranding,
  StickerData,
  StickerLineItem,
  StickerTemplateConfig,
  StudioTemplate,
  TemplateRenderProps,
} from "./templates";

type SaturdayStickerData = StickerData & {
  vehicleImageUrl?: string;
  exteriorColor?: string;
  interiorColor?: string;
  engine?: string;
  drivetrain?: string;
  transmission?: string;
  fuelEconomyCity?: string;
  fuelEconomyHighway?: string;
  fuelType?: string;
  doorsSeats?: string;
  topFeatures?: string[];
  historySignals?: string[];
  vehicleScore?: string;
  vehicleScoreLabel?: string;
  dealerTrustScore?: string;
  dealerReviewCount?: string;
  marketPrice?: string;
  marketStatus?: string;
  marketDelta?: string;
  estimatedPayment?: string;
  journeyEvents?: string[];
};

type SaturdayAddendumData = SaturdaySticker & {
  installed?: { name: string; price: string }[];
  upgrades?: { name: string; price: string }[];
};

const saturdayWindowConfig = (over: Partial<StickerTemplateConfig>): StickerTemplateConfig => ({
  id: "",
  name: "",
  type: "window",
  size: "8.5x11",
  widthIn: 8.5,
  heightIn: 11,
  styleTags: ["Modern", "Readability"],
  supportsLogo: true,
  supportsQr: true,
  supportsAccent: true,
  defaultAccent: "#2563EB",
  sections: ["specs", "totals", "installed", "benefits", "upgrades", "notes", "qr"],
  maxItems: { installed: 12, upgrades: 6, benefits: 6 },
  requiredFields: ["vehicleTitle", "vin", "stock"],
  optionalFields: [
    "vehicleImageUrl",
    "exteriorColor",
    "interiorColor",
    "engine",
    "drivetrain",
    "transmission",
    "fuelEconomyCity",
    "fuelEconomyHighway",
    "fuelType",
    "doorsSeats",
    "topFeatures",
    "historySignals",
    "vehicleScore",
    "vehicleScoreLabel",
    "dealerTrustScore",
    "dealerReviewCount",
    "marketPrice",
    "marketStatus",
    "marketDelta",
    "estimatedPayment",
    "journeyEvents",
    "notes",
  ],
  marginsIn: 0,
  blackLabelReady: false,
  ...over,
});

const saturdayAddendumConfig = (over: Partial<StickerTemplateConfig>): StickerTemplateConfig => ({
  id: "",
  name: "",
  type: "addendum",
  size: "4.5x11",
  widthIn: 4.5,
  heightIn: 11,
  styleTags: ["Modern", "Readability"],
  supportsLogo: true,
  supportsQr: true,
  supportsAccent: true,
  defaultAccent: "#2563EB",
  sections: ["installed", "upgrades", "benefits", "totals", "qr"],
  maxItems: { installed: 12, upgrades: 6, benefits: 6 },
  requiredFields: ["vehicleTitle", "vin", "stock"],
  optionalFields: ["vehicleImageUrl", "marketPrice", "marketStatus", "marketDelta", "estimatedPayment", "notes"],
  marginsIn: 0,
  blackLabelReady: false,
  ...over,
});

const asMoney = (value?: string) => {
  if (!value) return "Call for Price";
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString()}` : value;
};

const numeric = (value?: string, fallback = 0) => {
  const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const names = (items: StickerLineItem[]) => items.map((item) => item.name).filter(Boolean);
const priced = (items: StickerLineItem[]) =>
  items
    .filter((item) => item.name.trim())
    .map((item) => ({ name: item.name, price: item.price || "0" }));

function toSaturdaySticker(data: StickerData, branding: StickerBranding): SaturdaySticker {
  const extended = data as SaturdayStickerData;
  const topFeatures = extended.topFeatures?.length ? extended.topFeatures : names(data.installed);
  const benefits = names(data.benefits);
  const price = asMoney(data.price || data.msrp);
  const marketAverage = extended.marketPrice || data.msrp;

  return {
    dealer: {
      name: branding.dealerName,
      address: branding.address,
      phone: branding.phone,
      website: branding.website,
      slogan: branding.valueProp,
      pricingLabel: extended.marketStatus || "Best Price",
      valueProps: benefits,
      reviewSources: extended.dealerTrustScore || extended.dealerReviewCount ? [{
        type: "google",
        label: "Verified Reviews",
        rating: numeric(extended.dealerTrustScore, 4.9),
        reviewCount: numeric(extended.dealerReviewCount, 0),
        manuallyEntered: true,
      }] : undefined,
      theme: {
        primaryColor: branding.secondaryColor || "#071f3f",
        secondaryColor: branding.accentColor,
        accentColor: branding.accentColor,
        softColor: "#eff6ff",
        borderColor: "#dbe4f0",
      },
    },
    vehicle: {
      title: data.vehicleTitle || "Vehicle Details Pending",
      vin: data.vin || "VIN Pending",
      stock: data.stock || "Stock Pending",
      price,
      msrp: data.msrp,
      mileage: data.mileage,
      condition: "used",
      priceLabel: extended.marketStatus || "Best Price",
      imageUrl: extended.vehicleImageUrl,
    },
    specs: [
      { label: "Mileage", value: data.mileage || "" },
      { label: "Drivetrain", value: extended.drivetrain || "" },
      { label: "Engine", value: extended.engine || "" },
      { label: "Trans", value: extended.transmission || "" },
      { label: "Exterior Color", value: extended.exteriorColor || "" },
      { label: "Interior Color", value: extended.interiorColor || "" },
      { label: "Fuel Type", value: extended.fuelType || "" },
      { label: "Doors / Seats", value: extended.doorsSeats || "" },
    ].filter((spec) => spec.value),
    highlights: topFeatures,
    fuel: {
      city: numeric(extended.fuelEconomyCity, 0),
      highway: numeric(extended.fuelEconomyHighway, 0),
      combined: 0,
    },
    benefits,
    qrUrl: data.qrUrl || "https://autolabels.io",
    disclaimer: branding.disclaimer || data.notes || "Information deemed reliable but not guaranteed. See dealer for complete details.",
    market: marketAverage || extended.marketDelta || extended.marketStatus ? {
      status: extended.marketStatus,
      marketAverage,
      delta: extended.marketDelta,
      sourceLabel: "AutoLabels market intelligence",
    } : undefined,
  };
}

function SaturdayHeroRenderer(props: TemplateRenderProps) {
  return <SaturdayHeroWindow data={toSaturdaySticker(props.data, props.branding)} />;
}

function SaturdayClassicRenderer(props: TemplateRenderProps) {
  return <SaturdayClassicWindow data={toSaturdaySticker(props.data, props.branding)} />;
}

function makeAddendumRenderer(Component: React.ComponentType<{ data: SaturdayAddendumData }>) {
  return function AddendumRenderer(props: TemplateRenderProps) {
    const sticker = toSaturdaySticker(props.data, props.branding) as SaturdayAddendumData;
    sticker.installed = priced(props.data.installed);
    sticker.upgrades = priced(props.data.upgrades);
    return <Component data={sticker} />;
  };
}

const SaturdayPremiumAddendumRenderer = makeAddendumRenderer(SaturdayPremiumAddendum);
const MidnightPremiumAddendumRenderer = makeAddendumRenderer(MidnightPremiumAddendum);
const EclipsePremiumAddendumRenderer = makeAddendumRenderer(EclipsePremiumAddendum);
const OnyxPremiumAddendumRenderer = makeAddendumRenderer(OnyxPremiumAddendum);

const SATURDAY_RENDERERS: Record<string, (props: TemplateRenderProps) => JSX.Element> = {
  "window-saturday-hero": SaturdayHeroRenderer,
  "window-saturday-classic": SaturdayClassicRenderer,
  "addendum-saturday-premium": SaturdayPremiumAddendumRenderer,
  "addendum-saturday-midnight": MidnightPremiumAddendumRenderer,
  "addendum-saturday-eclipse": EclipsePremiumAddendumRenderer,
  "addendum-saturday-onyx": OnyxPremiumAddendumRenderer,
};

const SATURDAY_CONFIGS: Record<string, StickerTemplateConfig> = {
  "window-saturday-hero": saturdayWindowConfig({
    id: "window-saturday-hero",
    name: "Saturday Hero Window",
    styleTags: ["Modern", "Readability", "Passport"],
    useCase: "Large-photo Saturday-style dealer window sticker with QR vehicle passport and bold price band",
  }),
  "window-saturday-classic": saturdayWindowConfig({
    id: "window-saturday-classic",
    name: "Saturday Classic Window",
    styleTags: ["Classic", "Readability", "CPO"],
    defaultAccent: "#07376f",
    useCase: "Blue-outline Honda-style Saturday sticker with highlights, equipment, fuel economy, price, and QR",
  }),
  "addendum-saturday-premium": saturdayAddendumConfig({
    id: "addendum-saturday-premium",
    name: "Saturday Premium Addendum",
    styleTags: ["Modern", "Readability", "Compliance"],
    useCase: "4.25x11 premium branded addendum with passport QR, equipment, benefits, and upgrades",
    complianceNote: "Summarizes dealer-installed equipment and optional upgrades; full disclosure packet remains in the QR passport.",
  }),
  "addendum-saturday-midnight": saturdayAddendumConfig({
    id: "addendum-saturday-midnight",
    name: "Midnight Premium Addendum",
    styleTags: ["Modern", "Readability", "Compliance"],
    useCase: "4.25x11 premium branded addendum variant — independently editable Midnight layout.",
    complianceNote: "Summarizes dealer-installed equipment and optional upgrades; full disclosure packet remains in the QR passport.",
  }),
  "addendum-saturday-eclipse": saturdayAddendumConfig({
    id: "addendum-saturday-eclipse",
    name: "Eclipse Premium Addendum",
    styleTags: ["Modern", "Readability", "Compliance"],
    useCase: "4.25x11 premium branded addendum variant — independently editable Eclipse layout.",
    complianceNote: "Summarizes dealer-installed equipment and optional upgrades; full disclosure packet remains in the QR passport.",
  }),
  "addendum-saturday-onyx": saturdayAddendumConfig({
    id: "addendum-saturday-onyx",
    name: "Onyx Premium Addendum",
    styleTags: ["Modern", "Readability", "Compliance"],
    useCase: "4.25x11 premium branded addendum variant — independently editable Onyx layout.",
    complianceNote: "Summarizes dealer-installed equipment and optional upgrades; full disclosure packet remains in the QR passport.",
  }),
};

export const STUDIO_SATURDAY_TEMPLATES: StudioTemplate[] = Object.keys(SATURDAY_CONFIGS).map((id) => ({
  config: SATURDAY_CONFIGS[id],
  Render: SATURDAY_RENDERERS[id],
}));

export const isSaturdayTemplateId = (id?: string) => !!id && id in SATURDAY_CONFIGS;

export function saturdayTemplateFromConfig(config: StickerTemplateConfig): StudioTemplate | undefined {
  if (!isSaturdayTemplateId(config.id)) return undefined;
  const base = SATURDAY_CONFIGS[config.id];
  return {
    config: {
      ...base,
      ...config,
      maxItems: { ...base.maxItems, ...config.maxItems },
      optionalFields: Array.from(new Set([...(base.optionalFields || []), ...(config.optionalFields || [])])),
    },
    Render: SATURDAY_RENDERERS[config.id],
  };
}
