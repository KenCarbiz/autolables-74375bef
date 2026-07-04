import { TAB_CAPS, type AdminTab } from "@/lib/permissions/adminTabAccess";
import type { DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";

// Command-palette index of every admin surface: tabs, inline settings cards,
// and panel components. `panel` matches a stable id anchor on the target card
// so selecting an entry lands scrolled to the exact control. Tabs that now
// redirect (analytics/funnel/leads/queue) still resolve via Admin's redirects.

export interface SettingEntry {
  label: string;
  keywords: string[];
  tab: AdminTab;
  panel?: string;
  caps: DealerCapability[];
}

const e = (label: string, tab: AdminTab, keywords: string[], panel?: string): SettingEntry => ({
  label,
  keywords,
  tab,
  panel,
  caps: TAB_CAPS[tab],
});

const toggle = (label: string, keywords: string[] = []): SettingEntry =>
  e(label, "settings", ["feature toggle", "enable", "disable", ...keywords], "feature-toggles");

export const ADMIN_SETTINGS_INDEX: SettingEntry[] = [
  // Tabs
  e("Admin Home", "home", ["control center", "setup checklist", "quick actions"]),
  e("Products", "products", ["add-ons", "accessories", "product catalog", "template library"]),
  e("Product Rules", "rules", ["auto assign", "year make model rules"]),
  e("Store Settings", "settings", ["optional features", "store configuration"]),
  e("Branding", "branding", ["logo", "brand color", "dealership details", "address", "dealer license", "dms provider", "inventory feed urls"]),
  e("Label Templates", "labels", ["sticker templates", "label defaults", "sticker studio"]),
  e("Included with Sale & Warranties", "programs", ["dealer programs", "perks", "loaner", "free car washes", "lifetime warranty", "dealer warranty", "dealer cpo", "dealer certified pre-owned", "warranty", "lifetime powertrain"]),
  e("Factory Warranty & CPO", "factory-warranty", ["oem warranty", "cpo", "certified pre-owned", "remaining coverage"]),
  e("Passport Buttons", "passport-ctas", ["sticky buttons", "cta", "call to action", "shopper buttons"]),
  e("Passport Publishing", "passport-ctas", ["auto publish", "auto-publish", "passport publishing", "go live", "publish on intake"], "passport-publishing"),
  e("Customer Packet Defaults", "passport-ctas", ["packet", "modules", "curation", "ipacket", "hide module", "passport modules", "customer packet", "carfax", "autocheck", "history report links"], "packet-defaults"),
  e("Why Buy From Us", "passport-trust", ["trust badges", "dealership story", "reviews", "value props"]),
  e("Lead Routing", "passport-routing", ["contact routing", "who gets leads", "text routing", "passport contact"]),
  e("Analytics", "analytics", ["reports", "metrics", "addendum stats", "compliance events"]),
  e("Leads", "leads", ["captured leads", "customers", "crm", "lead export csv"]),
  e("Deal Signings", "funnel", ["signing funnel", "open signings", "out for sign", "esign status"]),
  e("Print Queue", "queue", ["vin queue", "scanned vehicles", "lot scan", "work queue"]),
  e("Printer Calibration", "print-settings", ["printer offset", "margins", "zebra", "print alignment", "test label"]),
  e("Approval & Review Rules", "document-rules", ["document rules", "approval workflow", "manager review", "red team"]),
  e("Pricing & Incentives", "incentives", ["rebates", "incentives", "pricing controls"]),
  e("Plan & Billing", "features", ["subscription", "plan tier", "billing", "entitlement", "enabled features"]),
  e("Get-Ready Setup", "getready", ["service catalog", "recon services", "get ready config", "emissions", "key cut"]),
  e("Invoices", "invoices", ["installer invoices", "ro number", "get ready billing", "mark paid", "accessory install invoice"]),
  e("Warranty Records", "warranty", ["warranty tracking", "registrations", "expirations"]),
  e("Vehicle Files", "files", ["compliance file", "tracking codes", "stickers by vin", "feed health"]),
  e("Audit Log", "audit", ["audit trail", "compliance log", "chain verification", "export csv"]),
  e("Team", "team", ["members", "roles", "permissions", "invite", "job roles"]),

  // Store Settings inline cards
  e("Addendum Paper Size", "settings", ["paper size", "letter", "legal", "half sheet", "monroney", "strip"], "paper-size"),
  e("Product Default Mode", "settings", ["all installed", "all optional", "selective", "type override at signing"], "product-default-mode"),
  e("Title Clerk Emails & Reminders", "settings", ["title", "mco", "office clerk", "title upload", "reminders", "round robin"], "title-clerk"),
  e("Packet View Notifications", "settings", ["packet viewed", "email me", "shopper opened", "view alerts"], "shopper-engagement"),
  e("Price-Drop Watch", "settings", ["price drop", "watchers", "re-engagement emails"], "shopper-engagement"),
  e("Recon Auto-Approve Threshold", "settings", ["recon approval", "auto approve", "estimate threshold", "used-car manager email"], "recon-approval"),
  e("Feed Automation", "settings", ["nightly ingest", "overnight feed", "automation", "auto send"], "feed-automation"),
  e("Auto-Publish Passport on Intake", "settings", ["auto publish", "publish on ingest", "passport live"], "feed-automation"),
  e("Require K-208 Before Finalizing", "settings", ["k208", "k-208", "safety inspection", "connecticut", "sign-off authority"], "feed-automation"),
  e("Require Install Verification", "settings", ["install proof", "install verification", "photo signature gate"], "feed-automation"),
  e("Detail Dispatch", "settings", ["detail shop", "detail email", "get ready dispatch", "recon dispatch"], "feed-automation"),
  e("Installer Notifications", "settings", ["third party installers", "auto notify", "preinstall"], "feed-automation"),
  e("Integration Status", "settings", ["integrations", "twilio", "sms", "resend", "sendgrid", "anthropic", "black book", "zebra", "dataone", "removebg"], "integrations"),

  // Pricing controls (Pricing & Incentives tab)
  e("Doc Fee", "incentives", ["doc fee", "documentation fee", "dealer fee", "conveyance fee", "state fee cap"], "doc-fee"),
  e("Customer Price Display", "incentives", ["advertised price", "website sale price", "passport price", "before doc fee"], "price-display"),
  e("Market Comparison Pricing", "incentives", ["comps", "comparables", "comp strategy", "value building", "lower priced comps"], "comp-strategy"),
  e("Today's Price Wording", "incentives", ["todays price", "payment estimate", "custom copy", "otd", "out the door", "payment calculator"], "todays-price"),
  e("Price Audit", "incentives", ["price audit", "advertised price history", "price changes"], "price-audit"),
  e("Price Integrity", "incentives", ["price integrity", "price mismatch", "reconciliation"], "price-integrity"),
  e("Add-On Elections", "incentives", ["addon elections", "accepted add-ons", "customer elections"], "addon-elections"),

  // Feature toggles (Store Settings tab)
  toggle("VIN Decode", ["nhtsa", "auto populate"]),
  toggle("VIN Barcode", ["scannable barcode"]),
  toggle("Product Icons", ["category icons"]),
  toggle("Product Rules Toggle", ["rules based products"]),
  toggle("Buyers Guide", ["ftc", "as-is", "16 cfr 455"]),
  toggle("Spanish Buyers Guide", ["spanish", "bilingual"]),
  toggle("Multilang Buyers Guide", ["vietnamese", "korean", "chinese", "california"]),
  toggle("Lead Capture", ["capture name phone email", "qr signing"]),
  toggle("Co-Buyer Signature", ["cobuyer", "second signature"]),
  toggle("Ink-Saving Mode", ["lighter print", "ink"]),
  toggle("Website URL Import", ["url scrape", "paste listing url"]),
  toggle("Custom Branding", ["dealer logo on addendums"]),
  toggle("Inventory Management", ["csv import", "manual entry"]),
  toggle("Installer Invoicing", ["invoices", "installations"]),
  toggle("Warranty Tracking", ["warranty registrations"]),
  toggle("Analytics Dashboard", ["acceptance rates", "revenue metrics"]),
  toggle("SMS Delivery", ["text message", "twilio"]),
  toggle("Black Book Data", ["factory equipment", "market data"]),
];

export const settingEntryHref = (entry: SettingEntry): string =>
  `/admin?tab=${entry.tab}${entry.panel ? `&panel=${entry.panel}` : ""}`;
