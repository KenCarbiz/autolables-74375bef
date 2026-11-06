import { ADMIN_CHILD_ROUTES, adminTabHref, canSeeTab, resolveAdminTab, type AdminVisibilityContext } from "./sections";

// Administration V3: the one route-driven source of truth for the eight
// settings categories, their grouped rows, breadcrumbs and search aliases.
//
// The child editors themselves are unchanged: every row points at an existing
// `?tab=` view (sections.ts) or an existing child route (childRoutes.tsx), so
// no setting changes owner, key or permission by being re-homed here. A row is
// shown only when the viewer may open the tab it names (or, for a child route,
// the tab that gates it), so the directory and its search never widen access.
//
// Every one of the 123 handoff catalog ids (SCREEN-CATALOG.json) is accounted
// for exactly once in CATALOG_DISPOSITIONS below; the coverage test fails if
// one is missing or duplicated.

export type AdminCategoryId =
  | "brand"
  | "people"
  | "pricing"
  | "customer"
  | "documents"
  | "workflow"
  | "inventory"
  | "billing";

export type CategoryIcon = "building" | "users" | "tag" | "smartphone" | "printer" | "list-checks" | "database" | "credit-card";

export interface SettingRow {
  /** Stable key, unique across categories. */
  key: string;
  title: string;
  description: string;
  /** Existing `?tab=` id this row opens (canonical editor). */
  tab?: string;
  /** Optional `&panel=` anchor inside that tab. */
  panel?: string;
  /** Existing child route or other rail destination (used instead of `tab`). */
  href?: string;
  /** Tab whose visibility rule gates an `href` row. */
  gateTab?: string;
  /** Older names and synonyms the settings search also matches. */
  aliases?: string[];
  /** The row opens a destination outside Administration (another rail area or service). */
  external?: boolean;
  /** Platform administrators only. */
  platformOnly?: boolean;
}

export interface SettingGroup {
  title: string;
  description?: string;
  rows: SettingRow[];
}

export interface AdminCategory {
  id: AdminCategoryId;
  label: string;
  description: string;
  icon: CategoryIcon;
  groups: SettingGroup[];
}

export const ADMIN_CATEGORIES: readonly AdminCategory[] = [
  {
    id: "brand",
    label: "Dealership & Brand",
    description: "Store details, contacts, hours and appearance.",
    icon: "building",
    groups: [
      {
        title: "Store identity",
        rows: [
          { key: "identity", title: "Store profile", description: "Display name, legal name, address and phone.", tab: "identity", aliases: ["branding", "dealership name", "address", "store details"] },
          { key: "store-identity", title: "Store identity records", description: "Source Dealer IDs, rooftops and how stores are matched.", href: ADMIN_CHILD_ROUTES.storeIdentity, gateTab: "identity", aliases: ["dealer id", "rooftop"] },
          { key: "hours-contact", title: "Contacts & business hours", description: "Public contact details and opening hours customers see.", tab: "hours-contact", aliases: ["phone", "email", "hours", "contacts", "holiday hours"] },
        ],
      },
      {
        title: "Brand",
        rows: [
          { key: "appearance", title: "Brand & appearance", description: "Logo, colors and how documents and pages look.", tab: "appearance", aliases: ["logo", "colors", "theme"] },
          { key: "why-buy", title: "Why buy here", description: "Reasons to buy shown on the Vehicle Passport.", tab: "why-buy", aliases: ["passport trust", "trust", "why buy from"] },
        ],
      },
      {
        title: "Legacy store settings",
        description: "Older settings that have not moved to a dedicated editor yet.",
        rows: [
          { key: "store-settings", title: "Store settings", description: "Remaining store-wide switches, unchanged.", tab: "store-settings", aliases: ["settings", "store settings", "feature flags", "product default mode", "election policy"] },
        ],
      },
    ],
  },
  {
    id: "people",
    label: "People & Access",
    description: "Employees, invitations, roles and permissions.",
    icon: "users",
    groups: [
      {
        title: "Team",
        rows: [
          { key: "team", title: "Team", description: "Employees, their roles and store access.", tab: "team", aliases: ["employees", "users", "staff"] },
          { key: "invitations", title: "Invitations", description: "Invite a teammate and manage pending invitations.", tab: "invitations", aliases: ["invite", "pending invitations"] },
        ],
      },
      {
        title: "Access",
        rows: [
          { key: "roles", title: "Roles & permissions", description: "What each role can see and change.", tab: "roles", aliases: ["role catalog", "role policy", "effective permissions"] },
          { key: "permission-verification", title: "Permission verification", description: "Check effective permissions against server rules.", href: ADMIN_CHILD_ROUTES.permissionVerification, gateTab: "roles" },
          { key: "access-activity", title: "Access activity", description: "Sign-ins and access changes.", tab: "access-activity", aliases: ["audit", "sign-in history"] },
        ],
      },
    ],
  },
  {
    id: "pricing",
    label: "Pricing & Products",
    description: "Doc fee, products, eligibility and warranties.",
    icon: "tag",
    groups: [
      {
        title: "Price display",
        rows: [
          { key: "price-rules", title: "Price display & doc fee", description: "Customer total, price basis and fee presentation.", tab: "price-rules", aliases: ["price rules", "doc fee", "incentives", "price basis"] },
          { key: "price-integrity", title: "Price integrity", description: "Compare advertised prices with the website.", href: ADMIN_CHILD_ROUTES.pricingIntegrity, gateTab: "price-rules", aliases: ["price discrepancy", "price audit"] },
        ],
      },
      {
        title: "Products & eligibility",
        rows: [
          { key: "products", title: "Products & packages", description: "Prices, disclosures, benefits and default election.", tab: "products", aliases: ["add-ons", "addendum products"] },
          { key: "applicability", title: "Which vehicles qualify", description: "Rules that decide which vehicles get each product.", tab: "applicability", aliases: ["applicability", "product rules", "eligibility"] },
        ],
      },
      {
        title: "Benefits, warranties & incentives",
        rows: [
          { key: "benefits", title: "Included benefits & dealer programs", description: "Dealer benefits included with vehicles.", tab: "benefits", aliases: ["programs", "dealer programs"] },
          { key: "warranty-programs", title: "Factory warranty & CPO programs", description: "Brand warranty terms and certified programs.", tab: "warranty-programs", aliases: ["factory warranty", "cpo", "certified pre-owned"] },
          { key: "incentive-programs", title: "OEM incentives", description: "Which manufacturer incentives customers can see.", tab: "incentive-programs", aliases: ["rebates", "incentives"] },
          { key: "warranty-records", title: "Vehicle warranty records", description: "Per-vehicle warranty records.", tab: "warranty-records", aliases: ["warranty"] },
        ],
      },
    ],
  },
  {
    id: "customer",
    label: "Customer Experience",
    description: "Vehicle Passport, shopper actions and lead routing.",
    icon: "smartphone",
    groups: [
      {
        title: "Vehicle Passport",
        rows: [
          { key: "passport-modules", title: "Vehicle Passport sections", description: "Which sections customers see.", tab: "passport-modules", aliases: ["passport modules", "passport ctas", "modules"] },
          { key: "calls-to-action", title: "Shopper buttons", description: "Buttons and actions on the customer page.", tab: "calls-to-action", aliases: ["ctas", "calls to action", "sticky buttons"] },
          { key: "payment-estimator", title: "Payment estimator", description: "Availability, rates and disclosures.", href: ADMIN_CHILD_ROUTES.paymentEstimator, gateTab: "passport-modules", aliases: ["payments", "apr", "finance"] },
        ],
      },
      {
        title: "Lead routing",
        rows: [
          { key: "routing", title: "Lead routing", description: "Who receives each customer request, and when.", tab: "routing", aliases: ["contact routing", "passport routing", "rotation", "after hours"] },
          { key: "contact-routing", title: "Routing roster", description: "Recipients and their order.", href: ADMIN_CHILD_ROUTES.contactRouting, gateTab: "routing", aliases: ["roster"] },
          { key: "escalation", title: "Response & escalation", description: "What happens when a lead is not answered.", href: ADMIN_CHILD_ROUTES.escalation, gateTab: "routing", aliases: ["escalation", "response time"] },
        ],
      },
      {
        title: "Vehicle descriptions",
        rows: [
          { key: "description-voice", title: "Vehicle descriptions", description: "Voice, claims, restrictions and channel formats.", href: "/admin/description-voice", gateTab: "destinations", aliases: ["description engine", "description voice", "claims", "channel formats", "drivesignal"] },
        ],
      },
      {
        title: "Previews",
        rows: [
          { key: "customer-previews", title: "Customer experience preview", description: "See the customer page with your settings.", tab: "customer-previews", aliases: ["preview", "scenarios"] },
        ],
      },
    ],
  },
  {
    id: "documents",
    label: "Documents & Printing",
    description: "Templates, forms, paper sizes and printers.",
    icon: "printer",
    groups: [
      {
        title: "Documents",
        rows: [
          { key: "document-defaults", title: "Document defaults", description: "Which templates each document uses by default.", tab: "document-defaults", aliases: ["defaults", "packet defaults", "signing presentation"] },
          { key: "templates", title: "Template library", description: "Approved templates, versions and Buyers Guide languages.", tab: "templates", aliases: ["labels", "templates", "buyers guide", "versions"] },
        ],
      },
      {
        title: "Printing",
        rows: [
          { key: "print-calibration", title: "Printers & paper", description: "Printer profiles, paper sizes and calibration.", tab: "print-calibration", aliases: ["print settings", "printer", "paper", "calibration"] },
          { key: "print-calibration-test", title: "Printer calibration", description: "Print a test sheet and adjust offsets.", href: ADMIN_CHILD_ROUTES.printCalibration, gateTab: "print-calibration", aliases: ["test sheet"] },
        ],
      },
    ],
  },
  {
    id: "workflow",
    label: "Workflow & Approvals",
    description: "Intake, publishing, inspections and sign-off rules.",
    icon: "list-checks",
    groups: [
      {
        title: "Publishing",
        rows: [
          { key: "effective-policy", title: "Publishing milestones", description: "Listing visibility, document release and retail readiness.", tab: "effective-policy", aliases: ["effective policy", "auto-publish", "intake", "publishing"] },
          { key: "destinations", title: "Description automation & destinations", description: "Where descriptions publish and when.", tab: "destinations", aliases: ["merchandising seo", "destinations", "description automation"] },
        ],
      },
      {
        title: "Approvals",
        rows: [
          { key: "approvals", title: "Approvals & signing requirements", description: "Who approves documents before they release.", tab: "approvals", aliases: ["approvals", "signing requirements"] },
          { key: "approval-rules", title: "Document approval rules", description: "Stale and superseded documents, re-review rules.", tab: "approval-rules", aliases: ["document rules", "stale documents"] },
        ],
      },
      {
        title: "Service & recon",
        rows: [
          { key: "inspection-signers", title: "Inspection signer access", description: "Which people may sign safety inspections (K-208).", href: "/service/settings", gateTab: "service-policy", external: true, aliases: ["k208", "signer", "inspection signer", "licensee"] },
          { key: "service-policy", title: "Service, recon & installers", description: "Inspections, proof, recon limits, work orders, installers and title requests.", tab: "service-policy", aliases: ["getready", "get ready", "recon", "inspection", "installers", "work orders", "title", "mco"] },
        ],
      },
      {
        title: "History",
        rows: [
          { key: "change-history", title: "Policy & settings history", description: "Who changed a setting, and when.", tab: "change-history", aliases: ["change history", "audit", "settings history"] },
        ],
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory & Integrations",
    description: "Feeds, sister stores, providers and data quality.",
    icon: "database",
    groups: [
      {
        title: "Stores & feeds",
        rows: [
          { key: "inventory-network", title: "Store network & sharing", description: "Primary and sister stores, and what they share.", href: "/admin/integrations/inventory-network", gateTab: "inventory-feed", aliases: ["sister stores", "sharing", "store network", "duplicates"] },
          { key: "inventory-feed", title: "Store feed settings", description: "Feed status, schedule, retirement and history.", tab: "inventory-feed", aliases: ["inventory", "feed", "import history", "retirement"] },
          { key: "files-com", title: "Feed connection", description: "File binding, Dealer ID, field mapping and validation.", href: "/admin/integrations/files-com", gateTab: "inventory-feed", aliases: ["files.com", "mapping", "quarantine", "dealer id"] },
          { key: "store-inventory", title: "Shared inventory preview", description: "What each store sees from the network.", href: ADMIN_CHILD_ROUTES.storeInventory, gateTab: "inventory-feed" },
          { key: "legacy-assignments", title: "Legacy inventory adoption", description: "Older vehicles not yet assigned to a store.", href: ADMIN_CHILD_ROUTES.legacyAssignments, gateTab: "inventory-feed", aliases: ["legacy"] },
          { key: "websites-feeds", title: "Websites & marketplace sources", description: "Dealer website and marketplace links.", tab: "websites-feeds", aliases: ["website", "marketplace", "price extraction"] },
        ],
      },
      {
        title: "Providers",
        rows: [
          { key: "providers", title: "Providers, caps & budgets", description: "Provider health, enrichment policy, usage and budgets.", tab: "providers", aliases: ["marketcheck", "usage", "budgets", "caps", "enrichment"] },
        ],
      },
      {
        title: "Quality & operations",
        rows: [
          { key: "data-quality", title: "Data quality", description: "Missing or conflicting vehicle data.", tab: "data-quality", aliases: ["quality", "exceptions"] },
          { key: "jobs", title: "Jobs & pipelines", description: "Background jobs and their recent runs.", tab: "jobs", aliases: ["pipelines", "jobs", "queue"] },
          { key: "connections", title: "Connections & delivery", description: "Connected services and delivery health.", href: ADMIN_CHILD_ROUTES.connections, gateTab: "providers", aliases: ["webhooks", "delivery", "connections"] },
          { key: "activity", title: "Integration activity", description: "Recent integration events.", tab: "activity", aliases: ["audit", "activity"] },
          { key: "vehicle-files", title: "Vehicle files", description: "Vehicle file storage and records.", tab: "vehicle-files", aliases: ["files"] },
          { key: "worker-setup", title: "Feed worker setup", description: "Import worker schedule status.", href: ADMIN_CHILD_ROUTES.workerSetup, gateTab: "inventory-feed", platformOnly: true },
          { key: "inventory-sync", title: "Advanced network controls", description: "Restricted inventory sync controls.", href: "/admin/inventory-sync", platformOnly: true, aliases: ["inventory sync", "command center"] },
        ],
      },
    ],
  },
  {
    id: "billing",
    label: "Billing & Plan",
    description: "Subscription, entitlements and billing access.",
    icon: "credit-card",
    groups: [
      {
        title: "Plan",
        rows: [
          { key: "plan-features", title: "Plan, usage & features", description: "What your plan includes and what is turned on.", tab: "plan-features", aliases: ["features", "entitlements", "plan usage"] },
          { key: "manage-subscription", title: "Manage subscription", description: "Billing is handled by your Autocurb account.", href: ADMIN_CHILD_ROUTES.connections, gateTab: "plan-features", external: true, aliases: ["billing", "subscription", "payment method"] },
        ],
      },
    ],
  },
];

/** Every tab that is not reached from a category row: the shared Overview checklist and tabs moved out of Administration. */
export const TABS_OUTSIDE_CATEGORIES: Readonly<Record<string, string>> = {
  overview: "Setup checklist, opened from the Administration home",
  invoices: "Installer invoices live in Get Ready at /invoices (not subscription billing)",
};

export const findCategory = (id: string | null | undefined): AdminCategory | null =>
  ADMIN_CATEGORIES.find((c) => c.id === id) ?? null;

export const rowHref = (row: SettingRow): string => (row.tab ? adminTabHref(row.tab, row.panel) : (row.href as string));

export const canSeeRow = (row: SettingRow, ctx: AdminVisibilityContext): boolean => {
  if (row.platformOnly && !ctx.isAdmin) return false;
  const gate = row.tab ?? row.gateTab;
  if (!gate) return ctx.isAdmin;
  const resolved = resolveAdminTab(gate);
  return resolved ? canSeeTab(resolved.tab, ctx) : false;
};

export const visibleGroups = (category: AdminCategory, ctx: AdminVisibilityContext): SettingGroup[] =>
  category.groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => canSeeRow(r, ctx)) }))
    .filter((g) => g.rows.length > 0);

export const visibleCategories = (ctx: AdminVisibilityContext): AdminCategory[] =>
  ADMIN_CATEGORIES.filter((c) => visibleGroups(c, ctx).length > 0);

export interface RowLocation {
  category: AdminCategory;
  group: SettingGroup;
  row: SettingRow;
}

const allRows = (): RowLocation[] =>
  ADMIN_CATEGORIES.flatMap((category) => category.groups.flatMap((group) => group.rows.map((row) => ({ category, group, row }))));

/** The category row that owns a `?tab=` id (canonical id or legacy alias). */
export function locateTab(tabId: string | null | undefined): RowLocation | null {
  const resolved = resolveAdminTab(tabId);
  if (!resolved) return null;
  return allRows().find((l) => l.row.tab === resolved.tab.id) ?? null;
}

/** The category row that owns a child route path (exact or `:param` prefix match). */
export function locatePath(pathname: string): RowLocation | null {
  return allRows().find((l) => l.row.href && !l.row.tab && pathname === l.row.href.split("?")[0]) ?? null;
}

export const categoryHref = (id: AdminCategoryId): string => `/admin?category=${id}`;

export interface AdminCrumb {
  label: string;
  href?: string;
}

/** Breadcrumb for a settings page: Administration / Category / Setting. */
export function crumbsFor(loc: RowLocation | null, fallbackTitle?: string): AdminCrumb[] {
  const crumbs: AdminCrumb[] = [{ label: "Administration", href: "/admin" }];
  if (loc) {
    crumbs.push({ label: loc.category.label, href: categoryHref(loc.category.id) });
    crumbs.push({ label: loc.row.title });
  } else if (fallbackTitle) {
    crumbs.push({ label: fallbackTitle });
  }
  return crumbs;
}

// ---------------------------------------------------------------- search

export interface SettingSearchHit {
  category: AdminCategory;
  row: SettingRow;
  href: string;
  /** The alias or older name that matched, when it was not the title. */
  matchedAlias?: string;
  score: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();

/**
 * Search setting titles, descriptions, group titles and older names. Results
 * are filtered by what the viewer may open and link to the exact setting.
 * Only static labels are indexed: no setting values, secrets or records.
 */
export function searchSettings(query: string, ctx: AdminVisibilityContext, limit = 12): SettingSearchHit[] {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(" ").filter(Boolean);
  const hits: SettingSearchHit[] = [];
  for (const { category, group, row } of allRows()) {
    if (!canSeeRow(row, ctx)) continue;
    const title = norm(row.title);
    const aliases = (row.aliases ?? []).map(norm);
    const hay = [title, norm(row.description), norm(group.title), norm(category.label), ...aliases].join(" | ");
    if (!terms.every((t) => hay.includes(t))) continue;
    let score = 1;
    if (title.startsWith(q)) score = 5;
    else if (title.includes(q)) score = 4;
    let matchedAlias: string | undefined;
    const alias = (row.aliases ?? []).find((a) => norm(a).includes(q));
    if (alias && score < 4) {
      score = 3;
      matchedAlias = alias;
    }
    hits.push({ category, row, href: rowHref(row), matchedAlias, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title)).slice(0, limit);
}

// ------------------------------------------------- catalog coverage register

export type CatalogDisposition =
  | "implemented" // new V3 surface built in this change
  | "reused" // an existing editor/child route, re-homed under its category
  | "in-editor" // a dialog or detail state inside the reused editor
  | "shared-component" // a reusable state component
  | "external" // lives in another rail destination or service
  | "platform-only"
  | "verify"; // V item: see ADMIN-VERIFICATION-REGISTER.md

export interface CatalogEntry {
  id: string;
  title: string;
  disposition: CatalogDisposition;
  /** Row key in ADMIN_CATEGORIES, or a component/route for non-row entries. */
  target: string;
  note?: string;
}

const c = (id: string, title: string, disposition: CatalogDisposition, target: string, note?: string): CatalogEntry => ({ id, title, disposition, target, note });

export const CATALOG_DISPOSITIONS: readonly CatalogEntry[] = [
  c("A01", "Find a setting", "implemented", "AdminDirectory search (searchSettings)"),
  c("A02", "Complete store setup", "reused", "overview", "Setup checklist (?tab=overview), linked from the directory attention line"),
  c("A03", "Settings change history", "reused", "change-history"),
  c("A04", "Settings change detail", "in-editor", "change-history"),
  c("D01", "Store profile", "reused", "identity"),
  c("D02", "Contacts", "reused", "hours-contact"),
  c("D03", "Business hours", "reused", "hours-contact"),
  c("D04", "Holiday hours", "verify", "hours-contact", "Unavailable: no holiday/exception persistence; needs schema + routing resolver change"),
  c("D05", "Brand & appearance", "reused", "appearance"),
  c("D06", "Upload dealership logo", "in-editor", "appearance"),
  c("D07", "Why buy here", "reused", "why-buy"),
  c("P01", "Team", "reused", "team"),
  c("P02", "Employee details", "reused", "/admin/people/:memberId"),
  c("P03", "Invite a teammate", "in-editor", "invitations"),
  c("P04", "Pending invitations", "reused", "invitations"),
  c("P05", "Role catalog", "reused", "roles"),
  c("P06", "Role policy", "reused", "roles"),
  c("P07", "Access activity", "reused", "access-activity"),
  c("P08", "Review access change", "in-editor", "/admin/people/:memberId"),
  c("R01", "Price display & doc fee", "reused", "price-rules", "Fee changes go through /admin/pricing/fee-review"),
  c("R02", "Products & packages", "reused", "products"),
  c("R03", "Product details", "in-editor", "products"),
  c("R04", "Which vehicles qualify", "reused", "applicability"),
  c("R05", "Preview product eligibility", "reused", "/admin/products/:productId/applicability"),
  c("R06", "Included benefits & dealer programs", "reused", "benefits"),
  c("R07", "Dealer benefit details", "in-editor", "benefits"),
  c("R08", "Factory warranty brands", "reused", "warranty-programs"),
  c("R09", "Factory warranty terms", "in-editor", "warranty-programs"),
  c("R10", "CPO programs", "reused", "warranty-programs"),
  c("R11", "CPO program details", "verify", "warranty-programs", "Partial: editor saves cpo_programs; no source/actor/date evidence fields"),
  c("R12", "OEM incentives", "reused", "incentive-programs"),
  c("R13", "Product default & election policy", "in-editor", "store-settings", "Product Default Mode is still edited only in legacy Store settings; overlaps per-product badge_type (traceability §5). Move to Products is a follow-up"),
  c("X01", "Vehicle Passport sections", "reused", "passport-modules", "Passport layout is locked; visibility settings only"),
  c("X02", "Shopper buttons", "reused", "calls-to-action"),
  c("X03", "Edit shopper button", "in-editor", "calls-to-action"),
  c("X04", "Lead routing", "reused", "routing"),
  c("X05", "Routing roster", "reused", "contact-routing"),
  c("X06", "Sales rotation", "in-editor", "routing"),
  c("X07", "Response & escalation", "reused", "escalation"),
  c("X08", "Routing hours & after-hours", "in-editor", "routing"),
  c("X09", "Shopper engagement", "in-editor", "routing"),
  c("X10", "Email preview", "verify", "routing", "Unavailable: no stored message templates or render-only preview"),
  c("X11", "Vehicle descriptions", "reused", "description-voice"),
  c("X12", "Description voice & identity", "in-editor", "description-voice"),
  c("X13", "Description claims & restrictions", "in-editor", "description-voice"),
  c("X14", "Description channel formats", "in-editor", "description-voice"),
  c("X15", "Customer preview scenarios", "reused", "customer-previews"),
  c("X16", "Customer experience preview", "reused", "/admin/customer-experience/preview"),
  c("X17", "Payment estimator availability", "verify", "payment-estimator", "Existing estimator editor; assumptions/data ownership in the verification register"),
  c("T01", "Document defaults", "reused", "document-defaults"),
  c("T02", "Template library", "reused", "templates", "Authoring stays in Merchandising; OEM templates (PR #55) untouched"),
  c("T03", "Template preview", "in-editor", "templates"),
  c("T04", "Buyers Guide & form languages", "in-editor", "templates"),
  c("T05", "Signing presentation", "in-editor", "document-defaults"),
  c("T06", "Printer profiles & paper", "reused", "print-calibration"),
  c("T07", "Printer calibration", "reused", "print-calibration-test"),
  c("T08", "Calibration test sheet", "in-editor", "print-calibration-test"),
  c("T09", "Template versions", "in-editor", "templates"),
  c("T10", "Manufacturer documents", "external", "/factory-sticker (Merchandising: OEM Window Sticker Studio)"),
  c("W01", "Publishing milestones", "reused", "effective-policy"),
  c("W02", "Description automation & destinations", "reused", "destinations"),
  c("W03", "Document approval rules", "reused", "approval-rules"),
  c("W04", "Edit approval rule", "in-editor", "approval-rules"),
  c("W05", "Stale & superseded documents", "in-editor", "approval-rules"),
  c("W06", "Customer signing requirements", "reused", "approvals"),
  c("W07", "Inspection signer access", "external", "inspection-signers", "Per-user grants (k208_authorized_users) are edited at /service/settings and enforced server-side by k208_signer_allowed; see ADMIN-VERIFICATION-REGISTER"),
  c("W08", "Work proof requirements", "in-editor", "service-policy"),
  c("W09", "Recon approval limits", "in-editor", "service-policy"),
  c("W10", "Internal service catalog", "in-editor", "service-policy"),
  c("W11", "Internal service details", "in-editor", "service-policy"),
  c("W12", "Intake automation", "in-editor", "effective-policy", "Auto-publish on intake has its one editor in Publishing"),
  c("W13", "Work-order recipients & instructions", "in-editor", "service-policy"),
  c("W14", "Installers & vendor defaults", "in-editor", "service-policy", "Installer invoices stay in Get Ready (/invoices)"),
  c("W15", "Installer details", "in-editor", "service-policy"),
  c("W16", "Title & MCO requests", "in-editor", "service-policy"),
  c("W17", "Policy history", "reused", "change-history"),
  c("I01", "Store network", "reused", "inventory-network"),
  c("I02", "Store feed settings", "reused", "inventory-feed"),
  c("I03", "Add a store", "platform-only", "inventory-network", "Store creation is a platform operation"),
  c("I04", "Feed connection", "reused", "files-com"),
  c("I05", "File binding & Dealer ID", "in-editor", "files-com"),
  c("I06", "Feed field mapping", "in-editor", "files-com"),
  c("I07", "File validation & quarantine", "in-editor", "files-com"),
  c("I08", "Feed schedule & freshness", "verify", "inventory-feed", "Worker schedule needs owner approval (PR #59); enrichment cadence separate"),
  c("I09", "Sister-store sharing", "reused", "inventory-network"),
  c("I10", "Edit sharing rule", "in-editor", "inventory-network"),
  c("I11", "Shared inventory preview", "reused", "store-inventory"),
  c("I12", "Provider health", "reused", "providers"),
  c("I13", "Provider details", "reused", "/admin/integrations/providers/:providerId"),
  c("I14", "Store enrichment policy", "in-editor", "providers"),
  c("I15", "Provider caps & cadence", "in-editor", "providers"),
  c("I16", "Provider product catalog", "in-editor", "providers"),
  c("I17", "Usage & budgets", "in-editor", "providers"),
  c("I18", "Review provider refresh", "in-editor", "providers", "No paid call is made by opening or previewing"),
  c("I19", "Import history", "in-editor", "inventory-feed"),
  c("I20", "Import run detail", "reused", "/admin/integrations/runs/:runId"),
  c("I21", "Feed exception detail", "external", "/admin/exceptions"),
  c("I22", "Duplicate handling", "in-editor", "inventory-network"),
  c("I23", "Retirement policy", "in-editor", "inventory-feed"),
  c("I24", "Data quality", "reused", "data-quality"),
  c("I25", "Websites & marketplace sources", "reused", "websites-feeds"),
  c("I26", "Test price extraction", "in-editor", "websites-feeds"),
  c("I27", "Jobs & pipelines", "verify", "jobs", "Job families and owners in the verification register"),
  c("I28", "Webhook & delivery health", "verify", "connections"),
  c("I29", "Delivery detail", "in-editor", "connections"),
  c("I30", "Advanced network controls", "platform-only", "inventory-sync"),
  c("I31", "Legacy inventory adoption", "reused", "legacy-assignments"),
  c("I32", "Provider gate verification", "platform-only", "/platform-admin"),
  c("B01", "Plan & entitlements", "reused", "plan-features"),
  c("B02", "Plan usage", "in-editor", "plan-features"),
  c("B03", "Feature availability", "in-editor", "plan-features"),
  c("B04", "Manage subscription", "external", "manage-subscription", "Autocurb billing owner; no native billing"),
  c("S01", "Review changes", "shared-component", "components/admin/v2/ReviewDialog"),
  c("S02", "Saved successfully", "shared-component", "toast after server confirmation"),
  c("S03", "Save failed", "shared-component", "editor error state; draft kept"),
  c("S04", "Another admin changed this setting", "shared-component", "lib/admin/reviewApply conflict"),
  c("S05", "Unsaved changes", "shared-component", "editor leave guard"),
  c("S06", "Access restricted", "shared-component", "AdminV2 access-restricted state"),
  c("S07", "Nothing configured yet", "shared-component", "primitives EmptyState"),
  c("S08", "Unable to load settings", "shared-component", "primitives EmptyState (error)"),
  c("S09", "Feature unavailable", "shared-component", "featureKey gating"),
  c("S10", "Archive or disable", "shared-component", "editor confirm dialogs"),
  c("S11", "Review store scope", "shared-component", "ReviewDialog scope line"),
];
