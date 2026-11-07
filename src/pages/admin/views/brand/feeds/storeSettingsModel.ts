import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import type { AdminIconName } from "@/components/admin/v3/editor";
import { adminTabHref } from "@/lib/admin/sections";

// The switch-heavy Store settings, grouped by intent. Every control of the pre-redesign Store Settings tab
// (Admin.tsx, tab "settings") appears here once, with the same stored key and the same default rule.

export const STORE_BOOL_KEYS = [
  "allow_type_override_at_signing", "getready_drives_addendum",
  "view_notify_enabled", "price_drop_watch_enabled", "price_drop_emails_enabled", "thirdparty_auto_notify",
  "feature_vin_decode", "feature_vin_barcode", "feature_product_icons", "feature_product_rules", "feature_buyers_guide",
  "feature_spanish_buyers_guide", "feature_multilang_buyers_guide", "feature_lead_capture", "feature_cobuyer_signature",
  "feature_ink_saving", "feature_url_scrape", "feature_custom_branding", "feature_inventory", "feature_invoicing",
  "feature_warranty", "feature_analytics", "feature_sms", "feature_blackbook",
] as const;

export const STORE_TEXT_KEYS = ["view_notify_email", "detail_email", "detail_default_instructions", "service_email", "service_default_instructions"] as const;

export const STORE_CHOICE_KEYS = ["product_default_mode", "ingest_recon_dispatch", "ingest_detail_dispatch"] as const;

export type StoreBoolKey = (typeof STORE_BOOL_KEYS)[number];
export type StoreTextKey = (typeof STORE_TEXT_KEYS)[number];
export type StoreChoiceKey = (typeof STORE_CHOICE_KEYS)[number];

export type StoreDraft = { [K in StoreBoolKey]: boolean } & { [K in StoreTextKey]: string } & {
  product_default_mode: DealerSettings["product_default_mode"];
  ingest_recon_dispatch: DealerSettings["ingest_recon_dispatch"];
  ingest_detail_dispatch: DealerSettings["ingest_detail_dispatch"];
};

export const STORE_KEYS = [...STORE_BOOL_KEYS, ...STORE_TEXT_KEYS, ...STORE_CHOICE_KEYS] as const;

// The legacy tab read these three with `!== false` (on unless explicitly off) and getready_drives_addendum with
// `=== true`; everything else with `!!`. Reading them the same way keeps every switch's meaning unchanged.
const ON_UNLESS_OFF = new Set<string>(["price_drop_watch_enabled", "price_drop_emails_enabled", "thirdparty_auto_notify"]);

export function readStore(s: DealerSettings): StoreDraft {
  const out: Record<string, unknown> = {};
  for (const k of STORE_BOOL_KEYS) out[k] = ON_UNLESS_OFF.has(k) ? s[k] !== false : !!s[k];
  for (const k of STORE_TEXT_KEYS) out[k] = s[k] ?? "";
  for (const k of STORE_CHOICE_KEYS) out[k] = s[k];
  return out as StoreDraft;
}

export const storePatch = (changed: Partial<StoreDraft>) => changed as unknown as Partial<DealerSettings>;

export const HIDDEN_KEYS = ["feature_payroll", "feature_ai_descriptions"] as const;

export type Item =
  | { kind: "switch"; key: StoreBoolKey; label: string; description: string; beta?: boolean; requires?: StoreBoolKey; requiresText?: string }
  | { kind: "choice"; key: StoreChoiceKey; label: string; description?: string; options: { value: string; label: string; detail?: string }[] }
  | { kind: "text"; key: StoreTextKey; label: string; placeholder: string; multiline?: boolean; emails?: number | "any"; help?: string; when?: StoreBoolKey }
  | { kind: "linked"; label: string; description: string; href: string; linkLabel: string; read: (s: DealerSettings) => boolean; on: string; off: string }
  | { kind: "installers" }
  | { kind: "status"; label: string; read: (s: DealerSettings) => boolean };

export interface Group {
  id: string;
  title: string;
  icon: AdminIconName;
  blurb: string;
  items: Item[];
}

export const GROUPS: Group[] = [
  {
    id: "products", title: "Products on the addendum", icon: "package",
    blurb: "How products appear by default and what staff can change while signing.",
    items: [
      { kind: "choice", key: "product_default_mode", label: "Product default mode", description: "How products appear on every addendum by default. Staff can override per product at signing if that is allowed below.", options: [
        { value: "selective", label: "Selective", detail: "Each product keeps its own setting" },
        { value: "all_installed", label: "All as installed", detail: "Every product shows as installed" },
        { value: "all_optional", label: "All as optional", detail: "Every product shows as optional" },
      ] },
      { kind: "switch", key: "allow_type_override_at_signing", label: "Allow type override at signing", description: "Staff can switch a product between installed and optional live with the customer." },
      { kind: "switch", key: "getready_drives_addendum", label: "Get-Ready drives the addendum", description: "When a Get-Ready install is signed off with a photo, mark that product Installed and move the rest to optional. Leave off if your advertised price already includes every add-on." },
      { kind: "switch", key: "feature_product_rules", label: "Product rules", description: "Auto-assign products based on vehicle year, make, model and trim." },
      { kind: "switch", key: "feature_product_icons", label: "Product icons", description: "Show category icons next to products on the addendum." },
    ],
  },
  {
    id: "signing", title: "Signing and printing", icon: "file-signature",
    blurb: "What the signing screen collects and how the printout looks.",
    items: [
      { kind: "switch", key: "feature_cobuyer_signature", label: "Co-buyer signature", description: "Show a co-buyer signature pad on the addendum." },
      { kind: "switch", key: "feature_lead_capture", label: "Lead capture", description: "Capture customer name, phone and email when sending QR signing links." },
      { kind: "switch", key: "feature_vin_barcode", label: "VIN barcode", description: "Show a scannable VIN barcode on the addendum." },
      { kind: "switch", key: "feature_ink_saving", label: "Ink-saving mode", description: "Show the ink-saving toggle for lighter print output." },
      { kind: "switch", key: "feature_sms", label: "SMS delivery", beta: true, description: "Send signing links by text message. Contact support to enable for your store." },
    ],
  },
  {
    id: "buyers-guide", title: "Buyers Guide", icon: "book",
    blurb: "Whether the FTC Buyers Guide is offered, and in which languages.",
    items: [
      { kind: "switch", key: "feature_buyers_guide", label: "Buyers Guide", description: "Generate FTC-aligned Buyers Guides (As-Is, Implied or Warranty)." },
      { kind: "switch", key: "feature_spanish_buyers_guide", label: "Spanish Buyers Guide", requires: "feature_buyers_guide", requiresText: "Turn on Buyers Guide first.", description: "Enable the Spanish option (FTC-canonical translation per 16 CFR Part 455)." },
      { kind: "switch", key: "feature_multilang_buyers_guide", label: "Multilingual Buyers Guide", requires: "feature_buyers_guide", requiresText: "Turn on Buyers Guide first.", description: "Enable Vietnamese, Korean and Chinese options. Dealer-courtesy translations for the California market: check each language reads correctly for your customers before enabling." },
    ],
  },
  {
    id: "engagement", title: "Shopper engagement", icon: "bell",
    blurb: "Alerts when a shopper opens a packet, and price-drop watching.",
    items: [
      { kind: "switch", key: "view_notify_enabled", label: "Email me when a packet is viewed", description: "One alert per shopper visit, deduped per session, so refreshes and scrapers do not bury you." },
      { kind: "text", key: "view_notify_email", label: "Alert recipients", placeholder: "Add the email addresses that should get alerts", multiline: true, emails: "any", when: "view_notify_enabled", help: "Separate addresses with commas or new lines." },
      { kind: "switch", key: "price_drop_watch_enabled", label: "Let shoppers watch for price drops", description: "Shows the notify-me-on-price-drop opt-in to shoppers." },
      { kind: "switch", key: "price_drop_emails_enabled", label: "Send price-drop re-engagement emails", description: "When the advertised price falls, watchers get one email per drop with the new price and a link back to the packet." },
    ],
  },
  {
    id: "feed-automation", title: "Feed automation on intake", icon: "refresh",
    blurb: "What fires automatically when a vehicle is ingested overnight, and what waits for a person.",
    items: [
      { kind: "linked", label: "Auto-publish customer passport on intake", description: "No prep gate at intake: the passport goes live immediately, and recon, K-208 and installs happen afterward.", href: adminTabHref("effective-policy"), linkLabel: "Change in Publishing policy", read: (s) => s.ingest_auto_publish !== false, on: "On: passports publish as vehicles arrive", off: "Off: a person publishes each vehicle" },
      { kind: "choice", key: "ingest_recon_dispatch", label: "Recon estimate", options: [{ value: "manual", label: "Manager sends it" }, { value: "auto", label: "Auto-send on ingest" }] },
      { kind: "choice", key: "ingest_detail_dispatch", label: "Detail get-ready", options: [{ value: "manual", label: "Send manually" }, { value: "auto", label: "Auto-send on ingest" }] },
      { kind: "text", key: "detail_email", label: "Detail shop emails", placeholder: "Comma separated, up to 3", emails: 3 },
      { kind: "text", key: "detail_default_instructions", label: "Standing instructions for the detail shop", placeholder: "Optional", multiline: true },
      { kind: "text", key: "service_email", label: "Service department emails (K-208 work order)", placeholder: "Comma separated, up to 3", emails: 3, help: "When set, accepting an addendum also sends the service department its own work order, scoped to the safety inspection and never the detail sheet." },
      { kind: "text", key: "service_default_instructions", label: "Standing instructions for the service department", placeholder: "Optional", multiline: true },
      { kind: "switch", key: "thirdparty_auto_notify", label: "Auto-notify third-party installers on preinstall", description: "Emails each active installer the per-vehicle install link when a vehicle is ingested." },
      { kind: "installers" },
    ],
  },
  {
    id: "data", title: "Data sources and import", icon: "database",
    blurb: "Where vehicle data comes from when a record is started.",
    items: [
      { kind: "switch", key: "feature_vin_decode", label: "VIN decode", description: "Auto-populate vehicle info from a VIN using the NHTSA database." },
      { kind: "switch", key: "feature_url_scrape", label: "Website URL import", description: "Paste a vehicle listing URL from your website to auto-fill VIN, stock number, mileage, color and price." },
      { kind: "switch", key: "feature_inventory", label: "Inventory management", description: "Import and manage vehicle inventory by CSV or manual entry." },
      { kind: "switch", key: "feature_blackbook", label: "Black Book data", beta: true, description: "Pull factory equipment and live market data from Black Book. Contact support to enable for your store." },
    ],
  },
  {
    id: "plan", title: "Plan features", icon: "credit-card",
    blurb: "Optional parts of the product your plan includes.",
    items: [
      { kind: "switch", key: "feature_custom_branding", label: "Custom branding", description: "Use your own dealer logo and branding on addendums." },
      { kind: "switch", key: "feature_invoicing", label: "Installer invoicing", description: "Create and manage invoices for product installations with RO and PO numbers." },
      { kind: "switch", key: "feature_warranty", label: "Warranty tracking", description: "Track product warranty registrations and expirations." },
      { kind: "switch", key: "feature_analytics", label: "Analytics dashboard", description: "View addendum stats, product acceptance rates and revenue metrics." },
    ],
  },
  {
    id: "integrations", title: "Integration status", icon: "plug",
    blurb: "Optional services behind scraping, messaging and AI. Read only: contact AutoLabels support to turn these on.",
    items: [
      { kind: "status", label: "AI descriptions (Claude)", read: (s) => !!s.feature_ai_descriptions },
      { kind: "status", label: "Email distribution", read: (s) => !!s.feature_sms },
      { kind: "status", label: "SMS (Signal House)", read: (s) => !!s.feature_sms },
      { kind: "status", label: "OEM build sheet (DataOne)", read: () => false },
      { kind: "status", label: "Black Book market data", read: (s) => !!s.feature_blackbook },
      { kind: "status", label: "Zebra CloudPrint", read: () => false },
      { kind: "status", label: "Photo background removal", read: () => false },
    ],
  },
];

export const CHOICE_LABEL = (item: Extract<Item, { kind: "choice" }>, value: unknown) => item.options.find((o) => o.value === value)?.label ?? String(value ?? "Not set");

export interface GroupSummary { on: number; total: number; lines: string[] }

export function summarize(group: Group, draft: StoreDraft, settings: DealerSettings): GroupSummary {
  let on = 0;
  let total = 0;
  const lines: string[] = [];
  for (const it of group.items) {
    if (it.kind === "switch") { total++; if (draft[it.key]) on++; }
    else if (it.kind === "linked") { total++; if (it.read(settings)) on++; lines.push(it.read(settings) ? "Auto-publish on" : "Auto-publish off"); }
    else if (it.kind === "status") { total++; if (it.read(settings)) on++; }
    else if (it.kind === "choice") lines.push(`${it.label}: ${CHOICE_LABEL(it, draft[it.key])}`);
  }
  return { on, total, lines };
}

const emailOk = (v: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v);

export function emailProblem(raw: string, limit: number | "any"): string | null {
  const parts = String(raw ?? "").split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const bad = parts.find((p) => !emailOk(p));
  if (bad) return `"${bad}" is not an email address.`;
  if (limit !== "any" && parts.length > limit) return `Use at most ${limit} addresses.`;
  return null;
}

export function validateStore(d: StoreDraft): Partial<Record<StoreTextKey, string>> {
  const out: Partial<Record<StoreTextKey, string>> = {};
  for (const g of GROUPS) for (const it of g.items) {
    if (it.kind === "text" && it.emails) {
      const p = emailProblem(d[it.key], it.emails);
      if (p) out[it.key] = p;
    }
  }
  return out;
}

export const STORE_LABELS: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.items.flatMap((it) => ("key" in it && it.key ? [[it.key, it.label]] : []))),
);
