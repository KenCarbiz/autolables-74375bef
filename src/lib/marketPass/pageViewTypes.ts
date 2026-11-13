// Standalone contract for the MarketPass page view. No imports, so AutoFilm can
// copy this file verbatim. Every value is already formatted where the locked
// customer Passport formats it; a consumer renders these fields and never
// derives a price, a status or a count from anything else.

export const MARKETPASS_PAGE_CONTRACT_VERSION = "marketpass-page-1.0.0" as const;

export interface PvMoney {
  amount: number;
  display: string;
}

export type PvTone = "positive" | "caution" | "neutral";

export interface PvHeader {
  brand: "AutoLabels";
  dealerName: string;
  dealerLogoUrl: string | null;
  dealerAddress: string | null;
  actions: ("save" | "share")[];
}

export interface PvVerifiedTile {
  status: string;
  label: string;
  count: number;
}

export interface PvVerifiedAttention {
  key: string;
  label: string;
  line: string;
  tone: "red" | "amber" | "gray";
  actionLabel: "Review" | "Details";
}

export interface PvVerifiedPassed {
  key: string;
  label: string;
  dealerAttested: boolean;
}

export interface PvVerifiedCard {
  title: string;
  scopeLine: string;
  badge: string | null;
  allVerified: boolean;
  tiles: PvVerifiedTile[];
  attention: PvVerifiedAttention[];
  passed: PvVerifiedPassed[];
  reportLinkLabel: string;
}

export interface PvHero {
  gallery: {
    images: string[];
    count: number;
    hasVideo: boolean;
    archivedPhotoNote: string | null;
  };
  identity: {
    conditionLabel: "New" | "Used" | "Certified Pre-Owned";
    title: string;
    vin: string | null;
    mileage: number | null;
    mileageDisplay: string | null;
    trustBadgesDesktop: string[];
    trustBadgesMobile: string[];
  };
  verifiedCard: PvVerifiedCard | null;
}

export interface PvPriceLine {
  key: string;
  role: "anchor" | "discount";
  label: string;
  mobileLabel: string;
  amount: number;
  display: string;
}

export type PvPrice =
  | {
    mode: "breakdown";
    heading: "Today's Sale Price";
    mobileHeading: "Current Price";
    total: PvMoney;
    lines: PvPriceLine[];
    vehicleSellingPrice: PvMoney;
    fee: { label: string; amount: number; display: string } | null;
    totalAdvertisedPrice: PvMoney;
    youSave: PvMoney | null;
    reconciles: boolean;
  }
  | { mode: "headline"; heading: "Today's Sale Price"; mobileHeading: "Current Price"; total: PvMoney | null }
  | { mode: "last_advertised"; label: string; amount: PvMoney | null; note: string };

export interface PvPayment {
  state: "off" | "unavailable" | "available";
  unavailableMessage: string | null;
  monthly: PvMoney | null;
  assumptions: string | null;
  chargesSummary: string | null;
  disclaimer: string | null;
  isCustomized: false;
}

export interface PvAction {
  key: "test_drive" | "reserve" | "value_trade" | "build_payment" | "ask_question" | "documents" | "save" | "share" | "watch_price";
  label: string;
  group: "primary" | "secondary" | "tool" | "utility";
}

export interface PvActionCenter {
  heading: "Customer Action Center";
  price: PvPrice;
  payment: PvPayment;
  taxNote: string | null;
  actions: PvAction[];
  watchPrice: { offered: boolean; formEnabled: boolean };
  dealerCard: { name: string; address: string | null; phone: string | null; availabilityNote: string; meetLabel: string } | null;
  privacyNote: string;
  nextSteps: { key: "reserve" | "test_drive" | "contact" | "print"; label: string }[];
}

export interface PvVerification {
  heading: "Verified Vehicle Data";
  allVerified: boolean;
  totalChecks: number;
  verifiedChecks: number;
  summaryLine: string;
  checks: { key: string; name: string; status: string; statusLabel: string }[];
  footnote: string;
}

export interface PvMarketIntelligence {
  unavailable: boolean;
  unavailableMessage: string | null;
  pricePosition: { fraction: number; percent: number; label: string; lowLabel: string; highLabel: string } | null;
  sample: { label: string; count: number | null; caption: string } | null;
  vsMarket: { display: string; caption: string; tone: PvTone } | null;
  estimatedMarketValue: { display: string; caption: string } | null;
  retrievedLabel: string | null;
  daysListed: { value: number | null; caption: string } | null;
}

export interface PvWarrantyBar {
  key: "bumper_to_bumper" | "powertrain";
  label: string;
  percent: number;
  text: string | null;
}

export interface PvWarranty {
  card: { title: "Warranty"; head: string; sub: string };
  heading: string;
  expired: boolean;
  summary: string | null;
  bars: PvWarrantyBar[];
  coverageRows: { key: string; label: string; sub: string; term: string }[];
  dealerCoverage: {
    title: string; coverage: string; termYears: number | null; termMiles: number | null;
    lifetime: boolean; mode: "included" | "available"; offer: string; disclosure: string;
  }[];
}

export interface PvEquipment {
  card: { title: "Features & Equipment"; head: string; sub: string };
  items: string[];
  count: number;
  availableAccessories: string[];
}

export interface PvHistory {
  card: { title: "History & Ownership"; head: string; sub: string };
  ownerCount: number | null;
  timeline: { when: string; title: string; detail: string }[];
}

export interface PvSpecs {
  card: { title: "Specifications"; head: string; sub: string };
  rows: { label: string; value: string }[];
}

export interface PvStrengths {
  heading: "Vehicle Strengths";
  mobileHeading: "Why This Vehicle Checks Out";
  items: string[];
  reportLinkLabel: "Open Full Buying Report";
}

export interface PvSeriesPoint {
  at: string;
  value: number;
}

export interface PvMarketComparison {
  mode: "trend" | "static" | "unavailable";
  unavailableMessage: string | null;
  thisVehicle: PvMoney | null;
  marketValueLabel: string | null;
  marketValue: PvMoney | null;
  diffText: string | null;
  diffTone: PvTone | null;
  diffPercent: number | null;
  listingSeries: PvSeriesPoint[];
  marketSeries: PvSeriesPoint[];
  hasMarketSeries: boolean;
  periodLabel: string | null;
  chartSummary: string | null;
  staticPosition: { fraction: number; percent: number; label: string } | null;
  staticPositionNote: string | null;
  sampleLine: string | null;
  retrievedLine: string | null;
  limitation: string | null;
}

export interface PvSimilarVehicle {
  ref: string;
  title: string;
  trim: string | null;
  miles: number | null;
  distanceMiles: number | null;
  detailLine: string;
  price: PvMoney;
  priceDelta: number;
  priceDeltaLabel: string;
  matchLabel: string;
  image: string | null;
}

export interface PvSimilarVehicles {
  count: number;
  items: PvSimilarVehicle[];
  emptyHeadline: string | null;
  emptyBody: string | null;
}

export interface PvFuelEconomy {
  heading: string;
  available: boolean;
  note: string;
  source: string | null;
  checkedAt: string | null;
  annualFuelCost: { label: string; amount: PvMoney } | null;
  combinedMpg: number | null;
  cityMpg: number | null;
  highwayMpg: number | null;
  rangeMiles: number | null;
  fuelType: string | null;
}

export interface PvWhyBuy {
  heading: string;
  dealerName: string;
  servingSinceYear: number | null;
  yearsInBusiness: number | null;
  storefrontImageUrl: string | null;
  benefits: string[];
  benefitsDesktop: string[];
  reviewRating: number | null;
  reviewCount: number | null;
  certifications: { name: string; caption: string }[];
  ctaLabel: string;
  ctaLabelDesktop: string;
}

export interface PvConfirmBeforePurchase {
  rows: { title: string; detail: string }[];
  historyReport: { url: string; label: string; providedBy: string | null } | null;
}

export interface PvAbout {
  highlights: { key: string; label: string; sub: string | null }[];
}

export interface PvOverview {
  text: string;
  fullText: string;
  truncated: boolean;
}

export interface PvPhotos {
  heading: "Photos";
  images: string[];
  total: number;
}

export interface PvDocumentLink {
  key: string;
  title: string;
  source: string;
  scope: "VIN-specific" | "Model-level";
  availability: "Available now" | "External source" | "Not yet available";
  url: string;
  external: boolean;
  why: string;
}

export interface PvDocuments {
  windowSticker: {
    title: string;
    description: string;
    verifiedLabel: string;
    format: "PDF";
    updatedAt: string | null;
    updatedDisplay: string | null;
    pdfUrl: string;
    thumbnailUrl: string | null;
    ctaLabel: "View Window Sticker";
  } | null;
  links: PvDocumentLink[];
}

export interface PvAvailability {
  disposition: string;
  purchasable: boolean;
  label: string;
  message: string;
  priceLabel: string;
  asOf: string | null;
  asOfDisplay: string | null;
}

export interface PvStickyRail {
  mobileOnly: true;
  items: { key: string; label: string; primary: boolean }[];
}

export interface PvFooter {
  helpLine: string | null;
  dealerPhone: string | null;
  offeredBy: string | null;
  links: { label: string; path: string }[];
}

export interface MarketPassPageView {
  contractVersion: typeof MARKETPASS_PAGE_CONTRACT_VERSION;
  audience: "public";
  vin: string;
  slug: string;
  generatedAt: string;
  sourceUpdatedAt: string | null;
  header: PvHeader | null;
  hero: PvHero | null;
  actionCenter: PvActionCenter | null;
  verification: PvVerification | null;
  marketIntelligence: PvMarketIntelligence | null;
  warranty: PvWarranty | null;
  equipment: PvEquipment | null;
  history: PvHistory | null;
  specs: PvSpecs | null;
  strengths: PvStrengths | null;
  marketComparison: PvMarketComparison | null;
  similarVehicles: PvSimilarVehicles | null;
  fuelEconomy: PvFuelEconomy | null;
  whyBuy: PvWhyBuy | null;
  confirmBeforePurchase: PvConfirmBeforePurchase | null;
  about: PvAbout | null;
  overview: PvOverview | null;
  photos: PvPhotos | null;
  documents: PvDocuments | null;
  availability: PvAvailability | null;
  stickyRail: PvStickyRail | null;
  footer: PvFooter | null;
}
