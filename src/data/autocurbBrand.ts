// ──────────────────────────────────────────────────────────────
// AutoLabels.io — Brand Identity Constants
//
// Single source of truth for AutoLabels brand system. Used by
// TenantContext (as default), BrandGuide page, About page,
// and anywhere the AutoLabels brand surfaces directly.
// ──────────────────────────────────────────────────────────────

export const AUTOCURB_BRAND = {
  name: "AutoLabels.io",
  tagline: "Clear. Compliant. Consistent.",
  shortTagline: "The dealer label platform.",
  description:
    "Clear, compliant, consistent labels for every vehicle on the lot. Scan a VIN, build a sticker, capture a lead, sign a deal.",

  // Brand positioning
  positioning: "The modern dealer's label & compliance platform.",
  mission:
    "Give every dealership — from a single rooftop to a 50-store group — the tools to label, comply, and close.",
  vision:
    "A world where every vehicle label is digital-first, compliant, and revenue-ready.",

  // Principles
  principles: [
    {
      number: "01",
      title: "The label is data",
      body: "Every vehicle, every scan, every interaction feeds the system.",
    },
    {
      number: "02",
      title: "Compliance is a feature",
      body: "FTC §5, state AG audits, electronic signatures — handled out of the box.",
    },
    {
      number: "03",
      title: "Power under the hood, simplicity up front",
      body: "The employee UI should never be in the way.",
    },
  ],

  // Taglines (ranked)
  taglines: {
    primary: "Clear. Compliant. Consistent.",
    secondary: [
      "Every label. Every vehicle. Every deal.",
      "Labels that sell. Compliance that sticks.",
      "Turn your lot into a lead machine.",
      "From label to close.",
      "The sticker is the start.",
    ],
  },

  // Brand voice
  voice: {
    attributes: [
      { name: "Direct", desc: "No fluff, no fake urgency." },
      { name: "Confident", desc: "Speaks to pros, not beginners." },
      { name: "Smart but not show-offy", desc: "Intelligence shows in the product." },
      { name: "A little sharp", desc: "Enough attitude to stand out." },
      { name: "Customer-respectful", desc: "Dealers talk about customers, not against them." },
    ],
    wordsWeUse: ["lot", "label", "deal", "move", "signal", "pipeline", "capture", "close", "stick", "scan"],
    wordsWeAvoid: [
      "synergy",
      "solutions",
      "empower",
      "revolutionize",
      "disrupt",
      "game-changing",
      "next-gen",
    ],
  },

  // Color system (hex + HSL)
  colors: {
    core: [
      { name: "Label Navy", hex: "#0B2041", hsl: "217 71% 15%", use: "Primary — headers, CTAs, dark surfaces" },
      { name: "Signal Blue", hex: "#1E90FF", hsl: "210 100% 56%", use: "Accent — the dollar-tag blue, links, buttons" },
      { name: "Sticker Cyan", hex: "#3BB4FF", hsl: "203 100% 62%", use: "Highlights, gradient stops, hover" },
      { name: "Asphalt", hex: "#111827", hsl: "220 39% 11%", use: "Dark mode background" },
      { name: "Concrete", hex: "#F6F8FB", hsl: "214 30% 97%", use: "Light page background" },
      { name: "Cloud", hex: "#FFFFFF", hsl: "0 0% 100%", use: "Cards, modals" },
    ],
    accents: [
      { name: "Brake Red", hex: "#DC2626", hsl: "0 74% 50%", use: "Urgency, destructive, hot leads" },
      { name: "Amber Turn", hex: "#F59E0B", hsl: "38 92% 50%", use: "Premium badge, warnings" },
      { name: "Finish Green", hex: "#10B981", hsl: "160 84% 39%", use: "Success, signed, closed" },
      { name: "Purple Plate", hex: "#8B5CF6", hsl: "258 90% 66%", use: "AI features, scrape, assistive" },
      { name: "Highway Orange", hex: "#EA580C", hsl: "20 91% 48%", use: "Revenue/pipeline gradients" },
    ],
    gradients: {
      tagBlue: "linear-gradient(135deg, #3BB4FF 0%, #1E90FF 55%, #0066CC 100%)",
      primaryCta: "linear-gradient(135deg, #0B2041 0%, #1E90FF 100%)",
      pipelineValue: "linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)",
      aiFeature: "linear-gradient(135deg, #1E90FF 0%, #8B5CF6 100%)",
      success: "linear-gradient(135deg, #1E90FF 0%, #10B981 100%)",
    },
  },

  // Typography
  typography: {
    display: { name: "Inter", weights: "700, 800", tracking: "-0.02em" },
    body: { name: "Inter", weights: "400, 500, 600" },
    mono: { name: "JetBrains Mono", weights: "400, 500" },
    scale: [
      { label: "Display", size: "48px", lineHeight: "1.1" },
      { label: "H1", size: "32px", lineHeight: "1.2" },
      { label: "H2", size: "24px", lineHeight: "1.3" },
      { label: "H3", size: "20px", lineHeight: "1.4" },
      { label: "Body lg", size: "16px", lineHeight: "1.5" },
      { label: "Body", size: "14px", lineHeight: "1.5" },
      { label: "Caption", size: "12px", lineHeight: "1.4" },
      { label: "Micro", size: "11px", lineHeight: "1.4" },
    ],
  },

  // Naming conventions
  naming: [
    { surface: "Dashboard overview", name: "Lot" },
    { surface: "Addendum builder", name: "Sticker" },
    { surface: "Customer signing page", name: "Curbside" },
    { surface: "Admin panel", name: "Office" },
    { surface: "Analytics", name: "Pipeline" },
    { surface: "Audit log", name: "Paper Trail" },
  ],

  // Feature verbs
  verbs: [
    { verb: "Decode", body: "VIN → factory build sheet in 800ms" },
    { verb: "Stick", body: "Build a compliant addendum in under a minute" },
    { verb: "Sign", body: "QR scan → mobile signature → audit log in one tap" },
    { verb: "Close", body: "Every scan becomes a lead in the CRM" },
  ],

  // Sample copy
  sampleCopy: {
    hero: "Clear. Compliant. Consistent.",
    subhero: "The dealer label platform that powers every sticker, addendum, and signature.",
    emailSignature: "AutoLabels.io — clear, compliant, consistent.",
    good: [
      "Build a sticker. Print it. Stick it. Get a lead. Close a deal.",
      "Your F&I menu shouldn't take longer than a test drive.",
      "The addendum shouldn't be the slowest part of your sale.",
    ],
    bad: [
      "Empower your dealership with our revolutionary AI-driven customer engagement platform.",
      "Leverage cutting-edge automation to optimize your F&I workflow.",
      "Unlock incredible savings with our next-generation dealer solutions.",
    ],
  },

  // Social / contact
  contact: {
    website: "https://autolabels.io",
    email: "hello@autolabels.io",
  },
} as const;

// Canonical tenant preset used when the app runs on autolabels.io directly
export const AUTOCURB_TENANT_DEFAULT = {
  id: "autolabels",
  name: "AutoLabels.io",
  slug: "autolabels",
  logo_url: "/logo-mark.svg",
  primary_color: "#0B2041",
  secondary_color: "#1E90FF",
  is_active: true,
};
