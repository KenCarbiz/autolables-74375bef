// ──────────────────────────────────────────────────────────────
// Shared shapes for the employee Vehicle File (/vehicle-file/:id).
//
// The five tabs read the same vehicle_listings row and the same single
// readiness model, so no two panels can disagree about what is missing.
// ──────────────────────────────────────────────────────────────

import type { TitleVerification } from "@/hooks/useVehicleListing";
import { deriveRecallView } from "@/lib/vehicleTruth/recallView";

export type TabId = "overview" | "documents" | "getready" | "customer" | "compliance";

export const VALID_TABS: TabId[] = ["overview", "documents", "getready", "customer", "compliance"];

// Deep links from Inventory, Print Queue, Ready Board, the Command Palette and
// the Deal Flow panel still point at the pre-consolidation tab names. They keep
// working by resolving to the tab that now owns that work.
export const LEGACY_TAB_ALIAS: Record<string, TabId> = {
  deal: "documents",
  labels: "documents",
  addendum: "documents",
  scan: "documents",
  prep: "getready",
  sign: "compliance",
  evidence: "compliance",
};

export const resolveTab = (raw: string | null): TabId => {
  if (!raw) return "overview";
  if ((VALID_TABS as string[]).includes(raw)) return raw as TabId;
  return LEGACY_TAB_ALIAS[raw] ?? "overview";
};

export interface PersonInfo {
  first_name?: string; middle_initial?: string; last_name?: string; suffix?: string;
  address?: string; city?: string; state?: string; zip?: string;
  phone?: string; email?: string;
}
export interface CustomerInfoBag { buyer?: PersonInfo; cobuyer?: PersonInfo }

export interface ServiceRecord { date: string; mileage: string; type: string; notes: string }

export interface WarrantyInfo {
  factory_months?: number; factory_miles?: number;
  powertrain_months?: number; powertrain_miles?: number;
  in_service_date?: string; notes?: string;
}

export interface AvailableAccessory { name: string; price: string; note: string }

export interface RecallItem {
  title?: string; summary?: string; description?: string; consequence?: string;
  component?: string; reportDate?: string; remedy?: string; status?: string;
  nhtsaCampaignNumber?: string;
}

export interface VehicleRow {
  id: string;
  tenant_id: string | null;
  vin: string;
  slug: string;
  source_url: string | null;
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: "new" | "used" | "cpo" | null;
  price: number | null;
  website_sale_price: number | null;
  advertised_price_before_doc: number | null;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  view_count: number;
  sticker_snapshot: Record<string, unknown>;
  dealer_snapshot: Record<string, unknown>;
  documents: Array<{ name: string; url: string; type: string }>;
  videos: Array<{ id: string; url: string; caption?: string }>;
  prep_status: { all_accessories_installed?: boolean; foreman_signed_at?: string } | null;
  recall_check: Record<string, unknown> | null;
  title_verification: TitleVerification | null;
  vehicle_file_id: string | null;
  service_records: ServiceRecord[] | null;
  warranty_info: WarrantyInfo | null;
  available_accessories: AvailableAccessory[] | null;
  hero_image_url: string | null;
  photos: string[] | null;
  mc_attributes: Record<string, unknown> | null;
  packet_modules: Record<string, boolean> | null;
  suppressed_programs: string[] | null;
  recall_status: string | null;
  recall_checked_at: string | null;
  open_recall_count: number | null;
  recall_payload: { recalls?: RecallItem[]; campaigns?: Record<string, unknown>[] } | null;
  market_value: number | null;
  market_position: string | null;
  market_payload: { listingPrice?: number | null; low?: number | null; high?: number | null; belowMarket?: number } | null;
  enriched_at: string | null;
  market_checked_at: string | null;
  passport_version: "inherit" | "current" | "v3" | "experiment" | null;
  stock_number?: string | null;
  created_at: string;
  updated_at: string;
}

// The recall detail list is written under two shapes: `recalls` (marketcheck-
// recalls / NHTSA fallback) and `campaigns` (vehicle-enrich). Read either, and
// map the campaign field names so the card never shows a blank list.
export const normalizeRecalls = (
  p: { recalls?: RecallItem[]; campaigns?: Record<string, unknown>[] } | null,
): RecallItem[] => {
  if (Array.isArray(p?.recalls) && p!.recalls!.length) return p!.recalls!;
  const c = p?.campaigns;
  if (Array.isArray(c)) return c.map((r) => ({
    title: String(r.title ?? r.summary ?? r.component ?? "Recall"),
    summary: r.summary != null ? String(r.summary) : undefined,
    consequence: r.consequence != null ? String(r.consequence) : undefined,
    component: r.component != null ? String(r.component) : undefined,
    reportDate: (r.reportDate ?? r.report_date) != null ? String(r.reportDate ?? r.report_date) : undefined,
    remedy: r.remedy != null ? String(r.remedy) : undefined,
    nhtsaCampaignNumber: (r.nhtsaCampaignNumber ?? r.campaign ?? r.campaignId) != null
      ? String(r.nhtsaCampaignNumber ?? r.campaign ?? r.campaignId)
      : undefined,
  }));
  return [];
};

export interface ReadyCheck { ok: boolean; label: string; when: string | null; blocks?: boolean }

export interface RecallReviewState { task: { completed_at: string | null } | null; blocking: boolean }

// Single readiness model used by the hero, the Overview status card and the
// Compliance tab, so the three never disagree. `blocks` marks a check that
// gates publishing to the shopper portal.
export const buildChecks = (v: VehicleRow, recall?: RecallReviewState): ReadyCheck[] => {
  const checks: ReadyCheck[] = [
    { ok: true, label: "Vehicle created", when: v.created_at },
    { ok: !!v.ymm, label: "VIN decoded", when: v.ymm ? v.updated_at : null },
    { ok: v.status === "published", label: "Published to shopper portal", when: v.published_at, blocks: true },
    { ok: deriveRecallView(v).vin.checkComplete, label: "Recall verified for this VIN", when: v.recall_checked_at },
    { ok: !!v.prep_status?.foreman_signed_at, label: "Prep & install signed off", when: v.prep_status?.foreman_signed_at || null },
    { ok: (v.documents?.length || 0) > 0, label: "Documents attached", when: null },
    { ok: (v.service_records?.length || 0) > 0, label: "Service history", when: null },
    { ok: !!v.warranty_info && Object.keys(v.warranty_info).length > 0, label: "Remaining warranty", when: null },
    { ok: (v.available_accessories?.length || 0) > 0, label: "Available accessories", when: null },
  ];
  // An open recall raises a required Service task that blocks publish until the
  // service department records an outcome. Inserted right after "Recall checked".
  if (recall?.task) {
    checks.splice(4, 0, {
      ok: !recall.blocking,
      label: "Open Recall Review Required",
      when: recall.task.completed_at,
      blocks: recall.blocking,
    });
  }
  return checks;
};

export const readinessSummary = (v: VehicleRow, recall?: RecallReviewState) => {
  const checks = buildChecks(v, recall);
  const done = checks.filter((c) => c.ok).length;
  const remaining = checks.filter((c) => !c.ok);
  return { checks, done, remaining, blockers: remaining.filter((c) => c.blocks) };
};

export type ReadinessSummary = ReturnType<typeof readinessSummary>;

// Retail readiness is always stated in words. A bare percentage tells nobody
// what to do next, so the label names the count of things that actually block.
export const readinessLabel = (s: ReadinessSummary): { label: string; ready: boolean } => {
  if (s.blockers.length > 0) {
    return { label: `NOT READY - ${s.blockers.length} BLOCKER${s.blockers.length === 1 ? "" : "S"}`, ready: false };
  }
  if (s.remaining.length > 0) {
    return { label: `READY - ${s.remaining.length} OPEN ITEM${s.remaining.length === 1 ? "" : "S"}`, ready: true };
  }
  return { label: "READY", ready: true };
};
