// ── Configuration-driven verification finding registry ──────────────────────
// A single, self-aware map from a canonical ReportCheck to its customer-facing
// PRESENTATION: the subject icon, the contextual dealer-CTA label, and a sort
// priority. The finding TYPE (the subject) picks the icon; the check STATUS
// (owned by the canonical model) drives color everywhere the icon is rendered.
// Severity/priority only orders the list — it never invents a status.
//
// This is intentionally exhaustive on the type union so new data conditions
// (salvage title, odometer rollback, theft record, …) light up automatically as
// the data layer begins emitting them. Anything the resolver cannot classify
// falls back to `unknown`, which logs once so the gap is visible — the UI never
// fabricates a finding, icon, or certainty for data it does not have.

import type { ReportCheck, VerificationStatus } from "./verificationSummary";
import {
  FileText, FileWarning, ShieldAlert, ShieldCheck, CarFront,
  Landmark, Factory, Store, FileSearch,
  GitCompareArrows, Clock, History, ClipboardCheck, FileQuestion,
  CircleDollarSign, Wrench, ListChecks, Database,
} from "lucide-react";
import {
  VinCardIcon, OwnerVehicleIcon, OdometerGaugeIcon, MarketVehicleIcon,
  WarrantyShieldIcon, HistoryMinusIcon,
} from "./verificationIcons";

export type VerificationFindingType =
  | "vin_identity" | "vin_mismatch"
  | "title_brand" | "salvage_title" | "rebuilt_title" | "flood_title" | "lemon_title" | "junk_title"
  | "theft_record" | "lien_record"
  | "ownership_history" | "owner_count" | "commercial_use" | "rental_use" | "fleet_use" | "personal_use"
  | "odometer" | "odometer_conflict" | "odometer_rollback"
  | "accident_history" | "damage_history" | "structural_damage" | "frame_damage" | "airbag_deployment" | "total_loss"
  | "recall" | "recall_remedy"
  | "market_comparison" | "market_outlier" | "price_above_market" | "price_below_market"
  | "factory_warranty" | "cpo_warranty" | "warranty_expired" | "warranty_conflict"
  | "service_history" | "maintenance_gap"
  | "equipment_match" | "equipment_mismatch" | "specification_match" | "specification_mismatch"
  | "emissions" | "inspection"
  | "source_pending" | "source_unavailable" | "source_conflict" | "stale_data"
  | "dealer_provided" | "government_source" | "oem_source" | "history_source" | "market_source"
  | "unknown";

export interface FindingDescriptor {
  findingType: VerificationFindingType;
  // Subject icon (one Lucide rounded-line family). Rendered at 22–24px; color is
  // applied by the caller from the check status, never baked in here.
  Icon: React.ElementType;
  // Short subject noun for a contextual CTA, e.g. "Recall" → "Ask About Recall".
  contextLabel: string;
  // Topic passed to the existing contact route so the lead is attributed to the
  // right subject. Uses the same topic vocabulary the desktop report already sends.
  contactTopic: "warranty" | "history" | "other";
  // Lower = more severe; only orders actionable findings, never sets severity.
  priority: number;
}

const REGISTRY: Record<VerificationFindingType, Omit<FindingDescriptor, "findingType">> = {
  // Identity
  vin_identity:  { Icon: VinCardIcon, contextLabel: "This Vehicle", contactTopic: "other",   priority: 40 },
  vin_mismatch:  { Icon: VinCardIcon, contextLabel: "the VIN",      contactTopic: "history", priority: 4 },
  // Title & brand
  title_brand:   { Icon: FileText,    contextLabel: "Title",   contactTopic: "history", priority: 9 },
  salvage_title: { Icon: FileWarning, contextLabel: "Title",   contactTopic: "history", priority: 3 },
  rebuilt_title: { Icon: FileWarning, contextLabel: "Title",   contactTopic: "history", priority: 3 },
  flood_title:   { Icon: FileWarning, contextLabel: "Title",   contactTopic: "history", priority: 3 },
  lemon_title:   { Icon: FileWarning, contextLabel: "Title",   contactTopic: "history", priority: 3 },
  junk_title:    { Icon: FileWarning, contextLabel: "Title",   contactTopic: "history", priority: 3 },
  theft_record:  { Icon: ShieldAlert, contextLabel: "Title",   contactTopic: "history", priority: 1 },
  lien_record:   { Icon: CircleDollarSign, contextLabel: "Title", contactTopic: "history", priority: 9 },
  // Ownership & use
  ownership_history: { Icon: OwnerVehicleIcon, contextLabel: "Ownership", contactTopic: "history", priority: 40 },
  owner_count:       { Icon: OwnerVehicleIcon, contextLabel: "Ownership", contactTopic: "history", priority: 40 },
  commercial_use:    { Icon: OwnerVehicleIcon, contextLabel: "Ownership", contactTopic: "history", priority: 30 },
  rental_use:        { Icon: OwnerVehicleIcon, contextLabel: "Ownership", contactTopic: "history", priority: 30 },
  fleet_use:         { Icon: OwnerVehicleIcon, contextLabel: "Ownership", contactTopic: "history", priority: 30 },
  personal_use:      { Icon: OwnerVehicleIcon, contextLabel: "Ownership", contactTopic: "history", priority: 40 },
  // Odometer
  odometer:          { Icon: OdometerGaugeIcon, contextLabel: "Mileage", contactTopic: "history", priority: 40 },
  odometer_conflict: { Icon: OdometerGaugeIcon, contextLabel: "Mileage", contactTopic: "history", priority: 5 },
  odometer_rollback: { Icon: OdometerGaugeIcon, contextLabel: "Mileage", contactTopic: "history", priority: 5 },
  // Accident & damage
  accident_history:  { Icon: CarFront, contextLabel: "Damage", contactTopic: "history", priority: 10 },
  damage_history:    { Icon: CarFront, contextLabel: "Damage", contactTopic: "history", priority: 10 },
  structural_damage: { Icon: CarFront, contextLabel: "Damage", contactTopic: "history", priority: 6 },
  frame_damage:      { Icon: CarFront, contextLabel: "Damage", contactTopic: "history", priority: 6 },
  airbag_deployment: { Icon: CarFront, contextLabel: "Damage", contactTopic: "history", priority: 7 },
  total_loss:        { Icon: FileWarning, contextLabel: "Damage", contactTopic: "history", priority: 2 },
  // Recalls
  recall:        { Icon: ShieldAlert, contextLabel: "Recall", contactTopic: "warranty", priority: 8 },
  recall_remedy: { Icon: ShieldCheck, contextLabel: "Recall", contactTopic: "warranty", priority: 8 },
  // Market
  market_comparison:  { Icon: MarketVehicleIcon, contextLabel: "Pricing", contactTopic: "other", priority: 40 },
  market_outlier:     { Icon: MarketVehicleIcon, contextLabel: "Pricing", contactTopic: "other", priority: 13 },
  price_above_market: { Icon: MarketVehicleIcon, contextLabel: "Pricing", contactTopic: "other", priority: 13 },
  price_below_market: { Icon: MarketVehicleIcon, contextLabel: "Pricing", contactTopic: "other", priority: 40 },
  // Warranty
  factory_warranty:  { Icon: WarrantyShieldIcon, contextLabel: "Warranty", contactTopic: "warranty", priority: 40 },
  cpo_warranty:      { Icon: WarrantyShieldIcon, contextLabel: "Warranty", contactTopic: "warranty", priority: 40 },
  warranty_expired:  { Icon: WarrantyShieldIcon, contextLabel: "Warranty", contactTopic: "warranty", priority: 30 },
  warranty_conflict: { Icon: WarrantyShieldIcon, contextLabel: "Warranty", contactTopic: "warranty", priority: 12 },
  // Service
  service_history: { Icon: ClipboardCheck, contextLabel: "Service", contactTopic: "history", priority: 40 },
  maintenance_gap: { Icon: Wrench,         contextLabel: "Service", contactTopic: "history", priority: 14 },
  // Equipment & specs
  equipment_match:        { Icon: ListChecks, contextLabel: "Equipment", contactTopic: "other", priority: 40 },
  equipment_mismatch:     { Icon: ListChecks, contextLabel: "Equipment", contactTopic: "other", priority: 11 },
  specification_match:    { Icon: ListChecks, contextLabel: "Specs",     contactTopic: "other", priority: 40 },
  specification_mismatch: { Icon: ListChecks, contextLabel: "Specs",     contactTopic: "other", priority: 11 },
  // Emissions & inspection
  emissions:  { Icon: FileSearch, contextLabel: "Emissions",  contactTopic: "other", priority: 40 },
  inspection: { Icon: FileSearch, contextLabel: "Inspection", contactTopic: "other", priority: 40 },
  // Source / system conditions
  source_pending:     { Icon: Clock,             contextLabel: "This Report", contactTopic: "other", priority: 50 },
  source_unavailable: { Icon: HistoryMinusIcon,  contextLabel: "This Report", contactTopic: "other", priority: 50 },
  source_conflict:    { Icon: GitCompareArrows,  contextLabel: "This Report", contactTopic: "other", priority: 5 },
  stale_data:         { Icon: History,           contextLabel: "This Report", contactTopic: "other", priority: 40 },
  // Source provenance
  dealer_provided:  { Icon: Store,    contextLabel: "This Report", contactTopic: "other", priority: 60 },
  government_source:{ Icon: Landmark, contextLabel: "This Report", contactTopic: "other", priority: 60 },
  oem_source:       { Icon: Factory,  contextLabel: "This Report", contactTopic: "other", priority: 60 },
  history_source:   { Icon: FileSearch, contextLabel: "This Report", contactTopic: "other", priority: 60 },
  market_source:    { Icon: Database, contextLabel: "This Report", contactTopic: "other", priority: 60 },
  // Fallback
  unknown: { Icon: FileQuestion, contextLabel: "This Report", contactTopic: "other", priority: 99 },
};

const warned = new Set<string>();
const warnUnknown = (key: string) => {
  if (warned.has(key) || typeof console === "undefined") return;
  warned.add(key);
  console.warn(`[verificationFindings] no finding mapping for "${key}" — falling back to "unknown"`);
};

// Classify a canonical check into its finding type. The canonical model owns the
// status; this only refines the SUBJECT (e.g. an odometer that conflicts across
// sources is an odometer_conflict, still with its canonical status). Unmapped
// keys resolve to `unknown` and are logged.
export function findingTypeForCheck(check: ReportCheck): VerificationFindingType {
  const branded = check.evidence.find((e) => e.label === "Title status")?.value?.toLowerCase() ?? "";
  switch (check.key) {
    case "vin":       return check.status === "needs_attention" ? "vin_mismatch" : "vin_identity";
    case "history":   return "accident_history";
    case "ownership": return "ownership_history";
    case "odometer":  return check.status === "needs_confirmation" || check.status === "needs_attention" ? "odometer_conflict" : "odometer";
    case "title":
      if (branded.includes("salvage")) return "salvage_title";
      if (branded.includes("flood")) return "flood_title";
      if (branded.includes("rebuilt")) return "rebuilt_title";
      if (branded.includes("lemon")) return "lemon_title";
      return "title_brand";
    case "recall":    return check.status === "verified" ? "recall_remedy" : "recall";
    case "market":    return "market_comparison";
    case "warranty":  return check.status === "needs_confirmation" ? "warranty_conflict" : "factory_warranty";
    default:
      warnUnknown(check.key);
      return "unknown";
  }
}

export function resolveFinding(check: ReportCheck): FindingDescriptor {
  const type = findingTypeForCheck(check);
  return { findingType: type, ...REGISTRY[type] };
}

// Subject icon for a completed / actionable row (color applied by the caller).
export function subjectIcon(check: ReportCheck): React.ElementType {
  return REGISTRY[findingTypeForCheck(check)].Icon;
}

// Icon for an INCOMPLETE row, where the meaningful signal is the status, not the
// subject: pending → clock, unavailable → history-document-with-minus glyph.
export function incompleteIcon(status: VerificationStatus): React.ElementType {
  return status === "pending" ? Clock : HistoryMinusIcon;
}

// The single actionable finding that should drive the sticky CTA + its ordering.
// Actionable = needs_attention or needs_confirmation; ties broken by priority.
export function rankActionable(checks: ReportCheck[]): ReportCheck[] {
  return checks
    .filter((c) => c.status === "needs_attention" || c.status === "needs_confirmation")
    .sort((a, b) => resolveFinding(a).priority - resolveFinding(b).priority);
}
