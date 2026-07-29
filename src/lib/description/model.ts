// Display model for Description Intelligence. Pure presentation metadata —
// every operational decision (validation, eligibility, publication) is made
// and stored server-side; the UI only renders what the server recorded.

export type DescriptionStatus =
  | "UNINITIALIZED" | "QUEUED" | "BUILDING_FACTS" | "GENERATING" | "VALIDATING"
  | "REVIEW_REQUIRED" | "READY" | "PUBLISHING" | "PARTIALLY_PUBLISHED" | "PUBLISHED"
  | "STALE" | "FAILED_RETRYABLE" | "FAILED_BLOCKED" | "ARCHIVED";

export type Tone = "slate" | "blue" | "amber" | "red" | "emerald" | "violet";

export const STATUS_META: Record<DescriptionStatus, { label: string; tone: Tone; help: string }> = {
  UNINITIALIZED:       { label: "Not Started",    tone: "slate",   help: "No description case has been created yet." },
  QUEUED:              { label: "Queued",         tone: "blue",    help: "Waiting for the generator." },
  BUILDING_FACTS:      { label: "Building Facts", tone: "blue",    help: "Assembling the trusted fact snapshot." },
  GENERATING:          { label: "Generating",     tone: "blue",    help: "Writing the canonical master description." },
  VALIDATING:          { label: "Validating",     tone: "blue",    help: "Checking every factual claim." },
  REVIEW_REQUIRED:     { label: "Review Required",tone: "amber",   help: "A manager must review before publication." },
  READY:               { label: "Ready",          tone: "emerald", help: "Validated and eligible for internal publication." },
  PUBLISHING:          { label: "Publishing",     tone: "blue",    help: "Publication in progress." },
  PARTIALLY_PUBLISHED: { label: "Partially Published", tone: "amber", help: "Published internally; one or more exports are still outstanding." },
  PUBLISHED:           { label: "Published",      tone: "emerald", help: "Published internally to the shopper listing." },
  STALE:               { label: "Stale",          tone: "amber",   help: "Vehicle data changed after this copy was written." },
  FAILED_RETRYABLE:    { label: "Failed",         tone: "red",     help: "Generation failed and can be retried." },
  FAILED_BLOCKED:      { label: "Blocked",        tone: "red",     help: "Blocked by validation — cannot publish." },
  ARCHIVED:            { label: "Archived",       tone: "slate",   help: "Vehicle sold or removed; history retained." },
};

export const TONE_CLASS: Record<Tone, string> = {
  slate:   "bg-slate-100 text-slate-700 border-slate-200",
  blue:    "bg-blue-50 text-blue-700 border-blue-200",
  amber:   "bg-amber-50 text-amber-800 border-amber-200",
  red:     "bg-red-50 text-red-700 border-red-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  violet:  "bg-violet-50 text-violet-700 border-violet-200",
};

export interface ChannelMeta {
  key: string;
  label: string;
  characterLimit: number;
  deliveryMode: "internal_projection" | "export_only" | "connector";
  connectorStatus: "available" | "not_configured" | "export_only";
}

// Mirrors supabase/functions/_shared/description-channel-policy.ts. DISPLAY
// ONLY — the character limit shown next to a saved variant always comes from
// the row the server wrote, never from this table, because a stored version
// keeps the policy it was generated under even after the registry moves on.
export const CHANNEL_META: ChannelMeta[] = [
  { key: "dealer_website",   label: "Dealer Website",       characterLimit: 2400, deliveryMode: "export_only",         connectorStatus: "export_only" },
  { key: "vehicle_passport", label: "Vehicle Passport",     characterLimit: 2400, deliveryMode: "internal_projection", connectorStatus: "available" },
  { key: "autotrader",       label: "AutoTrader",           characterLimit: 1500, deliveryMode: "export_only",         connectorStatus: "export_only" },
  { key: "cars_com",         label: "Cars.com",             characterLimit: 1500, deliveryMode: "connector",           connectorStatus: "not_configured" },
  { key: "cargurus",         label: "CarGurus",             characterLimit: 1200, deliveryMode: "export_only",         connectorStatus: "export_only" },
  { key: "facebook",         label: "Facebook Marketplace", characterLimit: 900,  deliveryMode: "export_only",         connectorStatus: "export_only" },
  { key: "google_seo",       label: "Google SEO",           characterLimit: 900,  deliveryMode: "export_only",         connectorStatus: "export_only" },
  { key: "vauto",            label: "vAuto",                characterLimit: 1500, deliveryMode: "export_only",         connectorStatus: "export_only" },
];

/**
 * The writing-preset cards, in display order.
 *
 * `key` is the durable identity and matches the server channel key. The
 * Facebook card is keyed `facebook`, not `facebook_marketplace`: that key is
 * already carried by stored channel versions, delivery rows and audit history,
 * and renaming it would orphan every one of them. The display label carries
 * the full product name instead.
 */
export interface ChannelCardMeta {
  key: string;
  name: string;
  helper: string;
  /** vAuto is an inventory workflow, not a consumer marketplace. */
  providerType: "marketplace" | "search" | "owned_site" | "inventory_workflow";
}

export const CHANNEL_CARDS: ChannelCardMeta[] = [
  { key: "autotrader",     name: "AutoTrader",           helper: "Optimized for AutoTrader",    providerType: "marketplace" },
  { key: "cars_com",       name: "Cars.com",             helper: "Optimized for Cars.com",      providerType: "marketplace" },
  { key: "cargurus",       name: "CarGurus",             helper: "Optimized for CarGurus",      providerType: "marketplace" },
  { key: "facebook",       name: "Facebook Marketplace", helper: "Optimized for Facebook",      providerType: "marketplace" },
  { key: "dealer_website", name: "Dealer Website",       helper: "Optimized for your website",  providerType: "owned_site" },
  { key: "google_seo",     name: "Google SEO",           helper: "Optimized for Google",        providerType: "search" },
  { key: "vauto",          name: "vAuto",                helper: "Optimized for vAuto workflow", providerType: "inventory_workflow" },
];

export const channelMeta = (k: string) => CHANNEL_META.find((c) => c.key === k);

// Connector truth: only an internal projection can ever read as "Ready" to
// publish. Everything else is honestly labeled until a real connector exists.
export const connectorLabel = (c: ChannelMeta | undefined): { label: string; tone: Tone } => {
  if (!c) return { label: "Unknown", tone: "slate" };
  if (c.deliveryMode === "internal_projection") return { label: "Ready", tone: "emerald" };
  if (c.connectorStatus === "not_configured") return { label: "Not Configured", tone: "slate" };
  return { label: "Export Only", tone: "amber" };
};

export const ELIGIBILITY_META: Record<string, { label: string; tone: Tone }> = {
  eligible:        { label: "Eligible",         tone: "emerald" },
  blocked:         { label: "Blocked",         tone: "red" },
  review_required: { label: "Review Required", tone: "amber" },
  unknown:         { label: "Not Evaluated",   tone: "slate" },
};

export const EXCEPTION_LABELS: Record<string, string> = {
  EQUIPMENT_CONFLICT: "Equipment Source Conflict",
  CPO_STATUS_CONFLICT: "CPO Status Conflict",
  VALIDATION_FAILED: "Validation Failed",
  REVIEW_REQUIRED: "Review Required",
  GENERATION_FAILED: "Generation Failed",
  GENERATION_BLOCKED: "Generation Blocked",
  CHANNEL_GENERATION_FAILED: "Channel Generation Failed",
  CHANNEL_LENGTH_EXCEEDED: "Channel Length Exceeded",
  MANUAL_CONTENT_STALE: "Locked Copy May Be Stale",
  INTERNAL_PUBLICATION_FAILED: "Publication Failed",
  REQUIRED_DATA_MISSING: "Missing Required Data",
};

export const factConfidenceLabel = (n: number | null | undefined): { label: string; tone: Tone } => {
  if (n == null) return { label: "Unknown", tone: "slate" };
  if (n >= 80) return { label: `High (${n}%)`, tone: "emerald" };
  if (n >= 50) return { label: `Medium (${n}%)`, tone: "amber" };
  return { label: `Low (${n}%)`, tone: "red" };
};

// Fact status → how the customer-facing claim may be treated. Market data is
// deliberately "calculated", never "verified".
export const FACT_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  verified:       { label: "Verified",      tone: "emerald" },
  dealer_entered: { label: "Dealer Stated", tone: "blue" },
  feed_provided:  { label: "Feed",          tone: "blue" },
  calculated:     { label: "Calculated",    tone: "amber" },
  inferred:       { label: "Inferred",      tone: "amber" },
  disputed:       { label: "Disputed",      tone: "red" },
  pending:        { label: "Pending",       tone: "slate" },
};

export const LIFECYCLE_STEPS = ["Data Verified", "Master Generated", "Channels Generated", "Validation Passed", "Published"] as const;

export function lifecycleIndex(status: DescriptionStatus): number {
  switch (status) {
    case "UNINITIALIZED": case "QUEUED": return -1;
    case "BUILDING_FACTS": return 0;
    case "GENERATING": return 1;
    case "VALIDATING": return 2;
    case "REVIEW_REQUIRED": case "READY": case "FAILED_BLOCKED": return 3;
    case "PUBLISHING": case "PARTIALLY_PUBLISHED": case "PUBLISHED": return 4;
    default: return -1;
  }
}

// ── Fleet sweep state ────────────────────────────────────────────────
// Which band the Description Operations header shows.
//
// The green "all clear" band used to fire whenever every active vehicle had
// a description CASE ROW, and printed the fleet size as a "processed" count.
// A store with 136 initialized-but-never-generated vehicles therefore read
// "136 processed · none need attention" while holding zero descriptions.
// Having a row is not having a description.

export type SweepState = "uninitialized" | "queued" | "working";

export interface SweepCounts {
  activeInventory: number;
  missing: number;
  /** Cases with a row but no outcome yet. */
  pending: number;
  /** Cases that actually finished. */
  settled: number;
}

export function sweepState(s: SweepCounts): SweepState {
  if (s.missing > 0) return "uninitialized";
  // Nothing has finished and something is waiting: queued, not clear.
  if (s.settled === 0 && s.pending > 0) return "queued";
  return "working";
}
