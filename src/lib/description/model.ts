// Display model for Description Intelligence. Pure presentation metadata —
// every operational decision (validation, eligibility, publication) is made
// and stored server-side; the UI only renders what the server recorded.

export type DescriptionStatus =
  | "UNINITIALIZED" | "QUEUED" | "BUILDING_FACTS" | "GENERATING" | "VALIDATING"
  | "REVIEW_REQUIRED" | "READY" | "PUBLISHING" | "PARTIALLY_PUBLISHED" | "PUBLISHED"
  | "STALE" | "FAILED_RETRYABLE" | "FAILED_BLOCKED" | "ARCHIVED";

export type Tone = "slate" | "blue" | "amber" | "red" | "emerald" | "violet";

export const STATUS_META: Record<DescriptionStatus, { label: string; tone: Tone; help: string }> = {
  UNINITIALIZED:       { label: "Not started",    tone: "slate",   help: "No description case has been created yet." },
  QUEUED:              { label: "Queued",         tone: "blue",    help: "Waiting for the generator." },
  BUILDING_FACTS:      { label: "Building facts", tone: "blue",    help: "Assembling the trusted fact snapshot." },
  GENERATING:          { label: "Generating",     tone: "blue",    help: "Writing the canonical master description." },
  VALIDATING:          { label: "Validating",     tone: "blue",    help: "Checking every factual claim." },
  REVIEW_REQUIRED:     { label: "Review required",tone: "amber",   help: "A manager must review before publication." },
  READY:               { label: "Ready",          tone: "emerald", help: "Validated and eligible for internal publication." },
  PUBLISHING:          { label: "Publishing",     tone: "blue",    help: "Publication in progress." },
  PARTIALLY_PUBLISHED: { label: "Partially published", tone: "amber", help: "Some destinations succeeded; others did not." },
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

// Mirrors supabase/functions/_shared/description-core.ts CHANNELS. Display only.
export const CHANNEL_META: ChannelMeta[] = [
  { key: "vehicle_passport", label: "Vehicle Passport",     characterLimit: 2400, deliveryMode: "internal_projection", connectorStatus: "available" },
  { key: "dealer_website",   label: "Dealer Website",       characterLimit: 2400, deliveryMode: "export_only",         connectorStatus: "export_only" },
  { key: "autotrader",       label: "AutoTrader",           characterLimit: 1500, deliveryMode: "export_only",         connectorStatus: "export_only" },
  { key: "cars_com",         label: "Cars.com",             characterLimit: 1500, deliveryMode: "connector",           connectorStatus: "not_configured" },
  { key: "cargurus",         label: "CarGurus",             characterLimit: 1200, deliveryMode: "export_only",         connectorStatus: "export_only" },
  { key: "facebook",         label: "Facebook Marketplace", characterLimit: 900,  deliveryMode: "export_only",         connectorStatus: "export_only" },
  { key: "google_seo",       label: "Google Vehicle Ads",   characterLimit: 900,  deliveryMode: "export_only",         connectorStatus: "export_only" },
];

export const channelMeta = (k: string) => CHANNEL_META.find((c) => c.key === k);

// Connector truth: only an internal projection can ever read as "Ready" to
// publish. Everything else is honestly labeled until a real connector exists.
export const connectorLabel = (c: ChannelMeta | undefined): { label: string; tone: Tone } => {
  if (!c) return { label: "Unknown", tone: "slate" };
  if (c.deliveryMode === "internal_projection") return { label: "Ready", tone: "emerald" };
  if (c.connectorStatus === "not_configured") return { label: "Not configured", tone: "slate" };
  return { label: "Export only", tone: "amber" };
};

export const ELIGIBILITY_META: Record<string, { label: string; tone: Tone }> = {
  eligible:        { label: "Eligible",        tone: "emerald" },
  blocked:         { label: "Blocked",         tone: "red" },
  review_required: { label: "Review required", tone: "amber" },
  unknown:         { label: "Not evaluated",   tone: "slate" },
};

export const EXCEPTION_LABELS: Record<string, string> = {
  EQUIPMENT_CONFLICT: "Equipment conflict",
  CPO_STATUS_CONFLICT: "CPO status conflict",
  VALIDATION_FAILED: "Validation failed",
  REVIEW_REQUIRED: "Review required",
  GENERATION_FAILED: "Generation failed",
  GENERATION_BLOCKED: "Generation blocked",
  CHANNEL_GENERATION_FAILED: "Channel generation failed",
  CHANNEL_LENGTH_EXCEEDED: "Channel length exceeded",
  MANUAL_CONTENT_STALE: "Locked copy may be stale",
  INTERNAL_PUBLICATION_FAILED: "Publication failed",
  REQUIRED_DATA_MISSING: "Missing required data",
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
  dealer_entered: { label: "Dealer stated", tone: "blue" },
  feed_provided:  { label: "Feed",          tone: "blue" },
  calculated:     { label: "Calculated",    tone: "amber" },
  inferred:       { label: "Inferred",      tone: "amber" },
  disputed:       { label: "Disputed",      tone: "red" },
  pending:        { label: "Pending",       tone: "slate" },
};

export const LIFECYCLE_STEPS = ["Data verified", "Master generated", "Channels generated", "Validation passed", "Published"] as const;

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
