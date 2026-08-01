// ──────────────────────────────────────────────────────────────────────
// Dealer identity resolver — the single authority for which dealership's
// name, address, phone, website, and logo appear on a customer-facing
// document. Every renderer (preview, PDF, PNG, print, passport, signing)
// resolves through here so they can never disagree.
//
// Resolution walks one priority chain, per field, so a location that only
// overrides its phone still inherits the rest:
//   1. the dealership location assigned to the vehicle
//   2. the location the authorized user has selected
//   3. the tenant's default (first active) location
//   4. the tenant's account settings
//
// Nothing here is tenant-specific: callers pass the stores and settings the
// tenant-scoped queries already returned, and the resolver never reaches
// across tenants on its own.
// ──────────────────────────────────────────────────────────────────────

import type { Store } from "@/types/tenant";

export type IdentitySource = "vehicle_location" | "active_location" | "default_location" | "tenant" | "none";

export type IdentityWarningCode =
  | "missing_phone"
  | "missing_logo"
  | "missing_website"
  | "missing_address"
  | "unassigned_vehicle";

export interface IdentityWarning {
  code: IdentityWarningCode;
  message: string;
  /** Where an authorized user fixes it. */
  settingsPath: string;
}

export interface DealerIdentity {
  displayName: string;
  addressLine1: string;
  /** "Hartford, CT 06120" — empty when no city/state/zip is configured. */
  addressLine2: string;
  /** Formatted for display, e.g. "(860) 555-1212". Empty when unknown. */
  phone: string;
  /** What the customer reads, e.g. "www.exampledealer.com". */
  websiteDisplay: string;
  /** Where the link actually goes. Empty when unknown. */
  websiteHref: string;
  logoUrl: string;
  tagline: string;
  accentColor: string;
  locationId: string;
  locationName: string;
  sources: Record<"name" | "address" | "phone" | "website" | "logo", IdentitySource>;
  warnings: IdentityWarning[];
}

// ── Phone ─────────────────────────────────────────────────────────────

// Obvious non-numbers and seeded placeholders never reach a printed sticker.
const PLACEHOLDER_PHONES = new Set(["0000000000", "1111111111", "1234567890", "5555555555"]);

/**
 * Format a US phone for customer display. Returns "" for anything that is not
 * a usable number — the caller omits the line rather than inventing one.
 * Non-US / extension-bearing inputs are returned trimmed rather than mangled.
 */
export function formatDealerPhone(raw?: string | null): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return value;
  if (PLACEHOLDER_PHONES.has(national)) return "";
  if (/^(\d)\1{9}$/.test(national)) return "";
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

// ── Website ───────────────────────────────────────────────────────────

// Path segments that mean "this is a listing/VDP/tracking URL, not the
// dealership's front door". A URL whose first segment matches collapses to
// the bare domain for display.
const INVENTORY_SEGMENTS = new Set([
  "inventory", "inventories", "vehicles", "vehicle", "used", "new", "usedcars", "used-cars",
  "newcars", "new-cars", "vdp", "listing", "listings", "detail", "details", "cars", "car",
  "searchused", "searchnew", "search", "stock", "v", "vin", "preowned", "pre-owned", "certified",
]);

export interface ResolvedWebsite { display: string; href: string }

/**
 * Normalize a dealership URL for the sticker.
 *
 * A sticker must never print a query string, fragment, tracking parameter, or
 * inventory/VDP path. When the tenant has deliberately configured a public
 * landing page (e.g. exampledealer.com/shop) that path is preserved in both
 * the link and the display text — an intentional destination is never
 * rewritten to the root domain.
 */
export function normalizeDealerWebsite(rawUrl?: string | null, opts?: { isLandingPage?: boolean }): ResolvedWebsite {
  const value = String(rawUrl || "").trim();
  if (!value) return { display: "", href: "" };

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { display: "", href: "" };
  }
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(".")) return { display: "", href: "" };

  const segments = parsed.pathname.split("/").filter(Boolean);
  const firstSegment = (segments[0] || "").toLowerCase();
  // An intentional landing page keeps its path — unless that path is itself an
  // inventory/VDP route, which is never a front door.
  const keepPath = !!opts?.isLandingPage && segments.length > 0 && !INVENTORY_SEGMENTS.has(firstSegment);

  const path = keepPath ? `/${segments.join("/")}` : "";
  return {
    display: `${host}${path}`,
    href: `https://${host}${path}`,
  };
}

// ── Identity ──────────────────────────────────────────────────────────

/** The tenant-level fields this resolver reads from dealer_profiles.settings. */
export interface DealerIdentitySettings {
  dealer_name?: string;
  dealer_tagline?: string;
  dealer_logo_url?: string;
  dealer_address?: string;
  dealer_city?: string;
  dealer_state?: string;
  dealer_zip?: string;
  dealer_phone?: string;
  dealer_website_url?: string;
  public_landing_url?: string;
  used_inventory_url?: string;
  new_inventory_url?: string;
  primary_color?: string;
}

/** Optional per-location overrides carried on the stores array. */
export interface DealerIdentityStore extends Partial<Store> {
  website?: string;
  landing_url?: string;
  public_name?: string;
  zip?: string;
}

export interface ResolveIdentityArgs {
  settings: DealerIdentitySettings;
  stores?: DealerIdentityStore[];
  /** Location the vehicle is assigned to (vehicle_listings.store_id). */
  vehicleStoreId?: string | null;
  /** Location the authorized user currently has selected. */
  activeStoreId?: string | null;
  /** Tenant display name, used only when nothing else names the dealership. */
  tenantName?: string | null;
  /** Whether the vehicle record carries a location assignment at all. */
  vehicleAssigned?: boolean;
}

const firstNonEmpty = <T,>(candidates: { value?: T | null; source: IdentitySource }[]): { value: T | null; source: IdentitySource } => {
  for (const c of candidates) {
    if (typeof c.value === "string" ? c.value.trim() : c.value) return { value: c.value as T, source: c.source };
  }
  return { value: null, source: "none" };
};

export function resolveDealerIdentity(args: ResolveIdentityArgs): DealerIdentity {
  const stores = (args.stores || []).filter((s) => s && s.is_active !== false);
  const byId = (id?: string | null) => (id ? stores.find((s) => String(s.id) === String(id) || String(s.slug) === String(id)) : undefined);

  // A vehicle explicitly assigned to a location always wins — the user's most
  // recent session selection must never override it.
  const vehicleStore = byId(args.vehicleStoreId);
  const activeStore = byId(args.activeStoreId);
  const defaultStore = stores[0];

  const chain: { store?: DealerIdentityStore; source: IdentitySource }[] = ([
    { store: vehicleStore, source: "vehicle_location" as const },
    { store: activeStore, source: "active_location" as const },
    { store: defaultStore, source: "default_location" as const },
  ]).filter((c) => !!c.store);

  const pick = <K extends keyof DealerIdentityStore>(key: K, tenantValue?: string | null) =>
    firstNonEmpty<string>([
      ...chain.map((c) => ({ value: c.store?.[key] as string | undefined, source: c.source })),
      { value: tenantValue ?? undefined, source: "tenant" as const },
    ]);

  const name = firstNonEmpty<string>([
    ...chain.flatMap((c) => [
      { value: c.store?.public_name, source: c.source },
      { value: c.store?.name, source: c.source },
    ]),
    { value: args.settings.dealer_name, source: "tenant" as const },
    { value: args.tenantName ?? undefined, source: "tenant" as const },
  ]);
  const address = pick("address", args.settings.dealer_address);
  const city = pick("city", args.settings.dealer_city);
  const state = pick("state", args.settings.dealer_state);
  const zip = pick("zip", args.settings.dealer_zip);
  const phoneRaw = pick("phone", args.settings.dealer_phone);
  const logo = pick("logo_url", args.settings.dealer_logo_url);
  const tagline = pick("tagline", args.settings.dealer_tagline);
  const accent = pick("primary_color", args.settings.primary_color);

  // Website: an explicitly configured landing page outranks a plain site URL
  // at every level. Inventory feed URLs are the last resort and are always
  // collapsed to the bare domain.
  const landing = firstNonEmpty<string>([
    ...chain.map((c) => ({ value: c.store?.landing_url, source: c.source })),
    { value: args.settings.public_landing_url, source: "tenant" as const },
  ]);
  const site = firstNonEmpty<string>([
    ...chain.map((c) => ({ value: c.store?.website, source: c.source })),
    { value: args.settings.dealer_website_url, source: "tenant" as const },
    { value: args.settings.used_inventory_url, source: "tenant" as const },
    { value: args.settings.new_inventory_url, source: "tenant" as const },
  ]);
  const website = landing.value
    ? { resolved: normalizeDealerWebsite(landing.value, { isLandingPage: true }), source: landing.source }
    : { resolved: normalizeDealerWebsite(site.value), source: site.source };

  const cityStateZip = [
    [city.value, state.value].filter(Boolean).join(", "),
    zip.value,
  ].filter(Boolean).join(" ").trim();

  const phone = formatDealerPhone(phoneRaw.value);
  const resolvedStore = chain[0]?.store;

  const warnings: IdentityWarning[] = [];
  if (!phone) warnings.push({ code: "missing_phone", message: "Dealership phone number is missing.", settingsPath: "/admin?tab=branding" });
  if (!logo.value) warnings.push({ code: "missing_logo", message: "No logo is configured for this dealership location.", settingsPath: "/admin?tab=branding" });
  if (!website.resolved.display) warnings.push({ code: "missing_website", message: "Public website has not been configured.", settingsPath: "/admin?tab=branding" });
  if (!address.value) warnings.push({ code: "missing_address", message: "Dealership street address is missing.", settingsPath: "/admin?tab=branding" });
  if (args.vehicleAssigned === false && stores.length > 1) {
    warnings.push({ code: "unassigned_vehicle", message: "This vehicle is not assigned to a dealership location.", settingsPath: "/inventory" });
  }

  return {
    displayName: name.value || "",
    addressLine1: address.value || "",
    addressLine2: cityStateZip,
    phone,
    websiteDisplay: website.resolved.display,
    websiteHref: website.resolved.href,
    logoUrl: logo.value || "",
    tagline: tagline.value || "",
    accentColor: accent.value || "",
    locationId: resolvedStore ? String(resolvedStore.id || "") : "",
    locationName: resolvedStore ? String(resolvedStore.name || "") : "",
    sources: {
      name: name.source,
      address: address.source,
      phone: phoneRaw.source,
      website: website.source,
      logo: logo.source,
    },
    warnings,
  };
}

/** One-line address for renderers that only have room for a single field. */
export const identityAddressLine = (identity: DealerIdentity) =>
  [identity.addressLine1, identity.addressLine2].filter(Boolean).join(", ");

// ── Overflow ──────────────────────────────────────────────────────────

/**
 * The addendum's dealership block is a fixed ~1.55in column on a 4.25–4.5in
 * sticker. Long names and addresses wrap, but there is a floor: below it the
 * text would either shrink past legibility or push into the QR block. We warn
 * rather than truncate, because silently dropping a licensed seller's address
 * is the one failure mode a disclosure document cannot have.
 */
export interface OverflowAssessment {
  overflows: boolean;
  /** Lines that exceed what the block can hold at the minimum readable size. */
  offending: string[];
  message: string;
}

/** Characters that fit on one line of the 1.55in dealer column at 7.2px. */
export const DEALER_BLOCK_MAX_CHARS = 30;
/** Wrapped lines the block holds before it pushes into the layout below it. */
export const DEALER_BLOCK_MAX_LINES = 6;

const wrappedLineCount = (text: string, maxChars = DEALER_BLOCK_MAX_CHARS) =>
  text ? Math.ceil(text.length / maxChars) : 0;

export function assessIdentityOverflow(identity: DealerIdentity): OverflowAssessment {
  const lines = [identity.displayName, identity.addressLine1, identity.addressLine2, identity.phone, identity.websiteDisplay].filter(Boolean);
  const offending = lines.filter((line) => line.split(/\s+/).some((word) => word.length > DEALER_BLOCK_MAX_CHARS));
  const total = lines.reduce((n, line) => n + wrappedLineCount(line), 0);
  const overflows = total > DEALER_BLOCK_MAX_LINES || offending.length > 0;
  return {
    overflows,
    offending,
    message: overflows
      ? "Dealership name or address is too long to print safely on a 4.5 × 11 addendum. Shorten the public display name or address so no contact line is lost."
      : "",
  };
}
