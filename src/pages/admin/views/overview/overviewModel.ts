import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import { ADMIN_CATEGORIES, categoryHref, type AdminCategory, type CategoryIcon } from "@/lib/admin/categories";
import { adminTabHref } from "@/lib/admin/sections";
import { derivePublishingMatrix, VEHICLE_CLASS_LABEL, type DescriptionPolicy, type PolicyCell, type PublishingSettingsSlice, type VehicleClass } from "@/lib/admin/publishingPolicy";
import { deriveRoutingReadiness, type RoutingReadiness } from "@/lib/admin/effectivePolicy";
import { routingSliceFrom } from "@/lib/admin/routingDraft";
import { stripTechnicalCode } from "@/lib/admin/attention";
import type { CountValue, HealthVerdict } from "@/lib/admin/health";
import type { AdminIconName } from "@/components/admin/v3/editor";
import { tierRows } from "../customer/routingModel";
import { hubHref } from "../documents/hub/HubOverview";

export const ADMIN_VIEW_ACTIONS = ["listing_viewed", "addendum_viewed", "window_sticker.view"] as const;

export interface SetupItem {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
}

type SetupSettings = Pick<DealerSettings, "dealer_name" | "dealer_logo_url" | "doc_fee_enabled" | "doc_fee_state" | "dealer_phone" | "passport_contact_routing" | "passport_agents" | "new_inventory_url" | "used_inventory_url">;

export function setupItems(s: SetupSettings): SetupItem[] {
  return [
    { key: "name", label: "Dealership name", detail: "The name customers see on documents and the Passport.", done: !!s.dealer_name && s.dealer_name !== "Your Dealership", href: adminTabHref("identity") },
    { key: "logo", label: "Dealership logo", detail: "Used on printed documents and the Passport header.", done: !!s.dealer_logo_url, href: adminTabHref("appearance") },
    { key: "doc_fee", label: "Documentation fee and state", detail: "Needed for a fee-inclusive advertised price.", done: !!s.doc_fee_enabled && !!s.doc_fee_state, href: adminTabHref("price-rules", "doc-fee") },
    { key: "contact", label: "Customer phone", detail: "A store phone or a default routing contact.", done: !!s.dealer_phone || !!s.passport_contact_routing?.dealershipDefaultContact?.salesPhone, href: adminTabHref("hours-contact") },
    { key: "routing", label: "Lead routing people", detail: "At least one salesperson, or the BDC turned on.", done: (s.passport_agents ?? []).length > 0 || !!s.passport_contact_routing?.bdcSettings?.enabled, href: adminTabHref("routing") },
    { key: "inventory_url", label: "Inventory page address", detail: "Where the new or used inventory page lives on your website.", done: !!s.new_inventory_url || !!s.used_inventory_url, href: adminTabHref("websites-feeds") },
  ];
}

export interface SetupProgress {
  done: number;
  total: number;
  percent: number;
  complete: boolean;
}

export function setupProgress(items: readonly SetupItem[]): SetupProgress {
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), complete: total > 0 && done === total };
}

export interface ExceptionRow {
  id: string;
  vehicleKey: string;
  vin: string;
  severity: string;
  type: string;
  title: string;
}

export interface ExceptionStats {
  instances: CountValue;
  vehicles: CountValue;
  rows: ExceptionRow[] | null;
}

export const FAILED_EXCEPTIONS: ExceptionStats = { instances: { kind: "failed" }, vehicles: { kind: "failed" }, rows: null };

export function summarizeExceptions(rows: ExceptionRow[], total: number): ExceptionStats {
  const capped = total > rows.length;
  return {
    instances: { kind: "known", value: total, capped: false },
    vehicles: { kind: "known", value: new Set(rows.map((r) => r.vehicleKey)).size, capped },
    rows,
  };
}

export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

export function severityCounts(rows: readonly ExceptionRow[]): Array<{ severity: string; issues: number; vehicles: number }> {
  return SEVERITY_ORDER.map((severity) => {
    const subset = rows.filter((r) => r.severity === severity);
    return { severity, issues: subset.length, vehicles: new Set(subset.map((r) => r.vehicleKey)).size };
  }).filter((r) => r.issues > 0);
}

export const exceptionsHref = (filters: { status?: string; severity?: string; type?: string } = {}): string => {
  const p = new URLSearchParams({ status: filters.status ?? "active" });
  if (filters.severity) p.set("severity", filters.severity);
  if (filters.type) p.set("type", filters.type);
  return `/admin/exceptions?${p.toString()}`;
};

export type OverviewPanel = "activity" | "exceptions" | "setup" | "policy";
export const OVERVIEW_PANELS: readonly OverviewPanel[] = ["activity", "exceptions", "setup", "policy"];
export const overviewHref = (panel?: OverviewPanel): string => adminTabHref("overview", panel ?? null);
export const parsePanel = (raw: string | null): OverviewPanel | null => (raw && (OVERVIEW_PANELS as readonly string[]).includes(raw) ? (raw as OverviewPanel) : null);

export interface FeedBannerModel {
  tone: "warning" | "danger" | "neutral";
  title: string;
  summary: string;
  lastSuccess: string | null;
}

export function feedBanner(feed: HealthVerdict | null, lastSuccessLabel: string | null): FeedBannerModel | null {
  if (!feed) return null;
  if (feed.state === "healthy" || feed.state === "disabled" || feed.state === "not_applicable") return null;
  const tone = feed.state === "down" ? "danger" : feed.state === "unknown" || feed.state === "not_configured" ? "neutral" : "warning";
  const title = feed.state === "stale" ? "Inventory feed is out of date" : feed.state === "unknown" ? "Inventory feed could not be checked" : feed.state === "not_configured" ? "Inventory feed is not set up" : "Inventory sync needs attention";
  return {
    tone,
    title,
    summary: `${stripTechnicalCode(feed.headline)}. ${feed.inventoryPreserved === true ? "Your current inventory is preserved." : ""}`.replace(/\.\s*\./g, ".").trim(),
    lastSuccess: lastSuccessLabel,
  };
}

export type ConceptKey = "listing_visibility" | "document_publication" | "retail_readiness" | "routing";

export interface PolicyConcept {
  key: ConceptKey;
  title: string;
  value: string;
  detail: string;
  state: "known" | "unknown" | "attention";
  stateLabel: string;
  href: string;
  editLabel: string;
  byClass: Array<{ cls: VehicleClass; label: string; cell: PolicyCell }>;
  routing?: RoutingReadiness;
  tiers?: { ready: number; total: number };
}

const CELL_STATE_LABEL: Record<PolicyCell["state"], string> = { enforced: "Enforced", configured: "Configured", open: "No gate set", unknown: "Unknown" };

function foldClasses(key: keyof Pick<ReturnType<typeof derivePublishingMatrix>[number], "listingVisibility" | "documentPublication" | "retailReadiness">, rows: ReturnType<typeof derivePublishingMatrix>) {
  const byClass = rows.map((r) => ({ cls: r.vehicleClass, label: VEHICLE_CLASS_LABEL[r.vehicleClass], cell: r[key] }));
  const labels = new Set(byClass.map((c) => c.cell.label));
  const uniform = labels.size === 1;
  const first = byClass[0].cell;
  const anyUnknown = byClass.some((c) => c.cell.state === "unknown");
  return {
    byClass,
    value: uniform ? first.label : "Varies by vehicle class",
    detail: uniform ? first.detail : byClass.map((c) => `${c.label}: ${c.cell.label}.`).join(" "),
    state: anyUnknown ? ("unknown" as const) : ("known" as const),
    stateLabel: anyUnknown ? "Unknown" : uniform ? CELL_STATE_LABEL[first.state] : "Differs by class",
  };
}

export interface PolicyInputs {
  settings: PublishingSettingsSlice & Pick<DealerSettings, "passport_contact_routing" | "passport_agents">;
  description: DescriptionPolicy | null;
}

export function policyConcepts({ settings, description }: PolicyInputs): PolicyConcept[] {
  const matrix = derivePublishingMatrix({ settings, description });
  const vis = foldClasses("listingVisibility", matrix);
  const doc = foldClasses("documentPublication", matrix);
  const retail = foldClasses("retailReadiness", matrix);
  const readiness = deriveRoutingReadiness(settings.passport_contact_routing, settings.passport_agents);
  const slice = routingSliceFrom(settings.passport_contact_routing, settings.passport_agents);
  const tiers = tierRows(slice);
  const counted = tiers.filter((t) => t.state !== "not_in_order");
  const ready = counted.filter((t) => t.state === "ready" || t.state === "per_lead").length;
  const effective = adminTabHref("effective-policy");
  return [
    { key: "listing_visibility", title: "Listing visibility", ...vis, href: effective, editLabel: "Open Effective policy" },
    { key: "document_publication", title: "Document publication", ...doc, href: effective, editLabel: "Open Effective policy" },
    { key: "retail_readiness", title: "Retail readiness", ...retail, href: effective, editLabel: "Open Effective policy" },
    {
      key: "routing",
      title: "Customer routing",
      value: readiness.ready ? "Every request has an owner" : "Fallback incomplete",
      detail: readiness.ready ? `${ready} of ${tiers.length} routing steps are ready.${readiness.warnings[0] ? ` ${readiness.warnings[0]}` : ""}` : readiness.blockers[0] ?? "A routing fallback is missing.",
      state: readiness.ready ? "known" : "attention",
      stateLabel: readiness.ready ? "Ready" : "Needs setup",
      href: adminTabHref("routing"),
      editLabel: "Open Routing",
      byClass: [],
      routing: readiness,
      tiers: { ready, total: tiers.length },
    },
  ];
}

export const DOCUMENTS_ATTENTION_HREF = hubHref("readiness", { blocker: "needs_attention" });

const CATEGORY_ICON: Record<CategoryIcon, AdminIconName> = {
  building: "building",
  users: "users",
  tag: "tag",
  smartphone: "phone",
  printer: "printer",
  "list-checks": "checklist",
  database: "database",
  "credit-card": "credit-card",
};

export const categoryIcon = (c: AdminCategory): AdminIconName => CATEGORY_ICON[c.icon];

export const shortcutCategories = (visibleIds?: readonly string[] | null): AdminCategory[] =>
  ADMIN_CATEGORIES.filter((c) => !visibleIds || visibleIds.includes(c.id));

export const shortcutHref = (c: AdminCategory): string => categoryHref(c.id);
