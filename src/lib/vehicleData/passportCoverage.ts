// ──────────────────────────────────────────────────────────────────────
// Passport Data Coverage — per-VIN answer to "we paid for this data: did we
// receive it, store it, use it and display it correctly?".
//
// Pure: reads a listing row (and optionally its stored NeoVIN snapshot), runs
// the SAME shared pipeline the Passports use (derivePassport → data contract →
// buildNextPassportData) and grades each category. No I/O and no provider
// calls; a category whose endpoint was never called reads "not_requested",
// never "unavailable".
// ──────────────────────────────────────────────────────────────────────

import type { VehicleListing } from "@/hooks/useVehicleListing";
import { derivePassport } from "@/lib/passportV2Data";
import { buildVehiclePassportDataContract } from "@/lib/vehicleData/dataContract";
import { buildNextPassportData } from "@/lib/passport/nextPassportData";
import { deriveVerificationReport } from "@/lib/passport/verificationSummary";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { FIELD_REGISTRY, resolveRow, unmappedFields, type FieldGroup } from "@/lib/vehicleData/fieldRegistry";

export type CoverageStatus = "full" | "partial" | "unavailable" | "held" | "not_requested";

export interface CoverageCategory {
  key: string;
  label: string;
  status: CoverageStatus;
  source: string;
  lastUpdated: string | null;
  detail: string;
  holdReason: string | null;
}

export interface CoverageField {
  group: string;
  path: string;
  provider: string;
  destination: string;
  status: string;
  present: boolean;
  note: string;
}

export interface PassportCoverageReport {
  vin: string;
  categories: CoverageCategory[];
  fields: CoverageField[];
  unknownFields: { group: string; path: string }[];
}

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const has = (v: unknown) => v != null && !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as Bag).length === 0);
const numOf = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[,$\s]/g, "")) : Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
};
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

const PROVIDER: Record<FieldGroup, string> = {
  neovin: "MarketCheck NeoVIN",
  listing: "MarketCheck listing",
  "listing.build": "MarketCheck listing",
  "listing.dealer": "MarketCheck listing",
  "listing.media": "MarketCheck listing",
  mc_attributes: "AutoLabels normalizer",
  build_sheet: "MarketCheck NeoVIN",
  market_meta: "MarketCheck search",
  market_payload: "MarketCheck price",
  history_payload: "MarketCheck history",
  epa_economy: "EPA fueleconomy.gov",
};

export function assessPassportCoverage(listing: VehicleListing, neovinSnapshot?: unknown): PassportCoverageReport {
  const row = listing as unknown as Bag;
  const mc = bag(row.mc_attributes);
  const raw = bag(row.mc_raw);
  const sheetRaw = bag(mc.build_sheet);
  const d = derivePassport(listing);
  const contract = buildVehiclePassportDataContract(listing, d);
  const report = deriveVerificationReport(d, listing);
  const saleCard = buildPassportSaleCard(d, String(row.condition || ""));
  const next = buildNextPassportData({
    d, listing: listing as never, report, saleCard, gallery: [], contract,
  });
  const cats: CoverageCategory[] = [];
  const add = (c: CoverageCategory) => cats.push(c);

  // Inventory source
  const owned = row.owning_store_id != null;
  add({
    key: "inventory", label: "Inventory source",
    status: owned && row.price != null ? "full" : owned ? "partial" : "held",
    source: owned ? "Dealer feed (vAuto / Files.com)" : String(row.source || "MarketCheck listing"),
    lastUpdated: (row.updated_at as string) || null,
    detail: owned ? "Owned by a mapped rooftop" : "No owning rooftop",
    holdReason: owned ? null : "Needs rooftop review: not linked to a dealer store.",
  });

  // MarketCheck listing data
  const listingSeen = (mc.last_seen_at as string) || (raw.last_seen_at as string) || null;
  add({
    key: "marketcheck_listing", label: "MarketCheck listing data",
    status: has(mc.mc_listing_id) || has(raw.id) ? "full" : "not_requested",
    source: "MarketCheck active search", lastUpdated: listingSeen,
    detail: has(mc.mc_listing_id) || has(raw.id) ? "Listing matched" : "No MarketCheck listing on record",
    holdReason: null,
  });

  // NeoVIN
  const decodedAt = (mc.specs_decoded_at as string) || (sheetRaw.decoded_at as string) || null;
  const sheet = contract.buildSheet;
  add({
    key: "neovin", label: "NeoVIN decode",
    status: !has(mc.build_sheet) ? (decodedAt || has(mc.specs_attempted_at) ? "unavailable" : "not_requested")
      : sheet?.generic ? "partial" : "full",
    source: "MarketCheck NeoVIN", lastUpdated: decodedAt,
    detail: !has(mc.build_sheet) ? "No structured decode stored" : sheet?.generic ? "Typical-for-trim fallback" : "VIN-specific decode",
    holdReason: null,
  });

  // Factory build & equipment
  const health = contract.health.status;
  const notVerified = sheet?.notVerified.length ?? 0;
  add({
    key: "equipment", label: "Factory build & equipment",
    status: health === "rich" ? "full" : health === "missing" ? "unavailable" : "partial",
    source: sheet ? "NeoVIN build sheet" : "Dealer feed equipment",
    lastUpdated: decodedAt,
    detail: `${next.equipment.featureCount} features · ${next.equipment.packages.length} packages · ${next.equipment.options.length} options`
      + (notVerified ? ` · ${notVerified} listed but not verified installed` : ""),
    holdReason: null,
  });

  // Pricing & MSRP reconciliation
  const notes: string[] = [];
  const m = sheet?.msrp;
  if (m && m.status !== "reconciled") notes.push(...m.notes);
  const mcPrice = numOf(raw.price);
  const ourPrice = numOf(row.price);
  if (mcPrice != null && ourPrice != null && Math.abs(mcPrice - ourPrice) >= 1) {
    notes.push(`MarketCheck advertised ${money(mcPrice)} vs dealer feed ${money(ourPrice)}; dealer feed is authoritative.`);
  }
  const mcFees = numOf(raw.fees);
  const docFee = numOf(row.doc_fee);
  if (mcFees != null && docFee != null && Math.abs(mcFees - docFee) >= 1) {
    notes.push(`MarketCheck fees ${money(mcFees)} vs configured doc fee ${money(docFee)}; dealer configuration wins.`);
  }
  if (raw.price_includes_fees == null && mcFees != null) notes.push("price_includes_fees not reported; fee basis unknown.");
  add({
    key: "pricing", label: "Pricing & MSRP reconciliation",
    status: !m ? (ourPrice != null ? "partial" : "unavailable") : m.status === "conflict" ? "held" : m.status === "incomplete" ? "partial" : notes.length ? "partial" : "full",
    source: "Dealer feed price · NeoVIN factory pricing · MarketCheck fees",
    lastUpdated: decodedAt,
    detail: m && m.totalMsrp != null ? `Factory total ${money(m.totalMsrp)} (${m.status})` : "No factory MSRP ladder",
    holdReason: m?.status === "conflict" ? m.notes.join(" ") : notes.length ? notes.join(" ") : null,
  });

  // Market value
  const mp = bag(row.market_payload);
  const mm = bag(row.market_meta);
  add({
    key: "market_value", label: "Market value",
    status: d.marketAvg == null ? "unavailable" : d.marketBasisWeak ? "partial" : "full",
    source: String(mp.source || "MarketCheck"), lastUpdated: (mp.checked_at as string) || d.marketCheckedAt,
    detail: d.marketAvg == null ? "No market value" : d.marketBasisWeak ? "Model-wide comps median: no price verdict" : "VIN-level / like-for-like basis",
    holdReason: null,
  });

  // Comparables
  const like = numOf(mm.like_count);
  const similar = numOf(mm.similar_count);
  add({
    key: "comparables", label: "Comparables",
    status: like != null && like >= 3 ? "full" : similar != null && similar > 0 ? "partial" : has(row.market_meta) ? "unavailable" : "not_requested",
    source: "MarketCheck active search", lastUpdated: (mm.checked_at as string) || null,
    detail: `${like ?? 0} like-for-like of ${similar ?? 0} similar within ${numOf(mm.search_radius) ?? "?"} mi`,
    holdReason: null,
  });

  // Price history
  add({
    key: "price_history", label: "Price history",
    status: next.priceHistory.state === "success" ? "full" : next.priceHistory.points.length ? "partial" : "unavailable",
    source: "vehicle_value_history (AutoLabels snapshots)", lastUpdated: next.priceHistory.points.at(-1)?.date ?? null,
    detail: `${next.priceHistory.points.length} dated price point(s)`,
    holdReason: null,
  });

  // Vehicle history
  const hp = bag(row.history_payload);
  const reportBacked = d.accidentCount != null || d.titleStatus !== "unknown";
  add({
    key: "vehicle_history", label: "Vehicle history",
    status: reportBacked ? "full" : hp.available === true ? "partial" : has(row.history_payload) ? "unavailable" : "not_requested",
    source: reportBacked ? "Vehicle history signals (CARFAX indicator / NMVTIS)" : "MarketCheck listing history",
    lastUpdated: (hp.checked_at as string) || null,
    detail: reportBacked ? "Title/accident evidence on record" : "Listing history only: not a title or ownership record",
    holdReason: null,
  });

  // Recalls
  add({
    key: "recalls", label: "Recalls",
    status: d.recall.vin.clearClaimAllowed || (d.recall.vin.openCount ?? 0) > 0 ? "full"
      : d.recall.model != null || d.recall.riskSignalled ? "partial"
      : d.recall.vin.attemptedAt ? "unavailable" : "not_requested",
    source: d.recall.vin.source || "NHTSA", lastUpdated: d.recall.vin.checkedAt ?? d.recall.vin.attemptedAt,
    detail: d.recall.vin.clearClaimAllowed || (d.recall.vin.openCount ?? 0) > 0 ? d.recall.vin.label
      : d.recall.model != null || d.recall.riskSignalled ? "Model-level recall data only; no VIN-level answer" : d.recall.vin.label,
    holdReason: null,
  });

  // EPA
  const epa = bag(row.epa_economy);
  add({
    key: "epa", label: "EPA fuel economy",
    status: d.epa ? "full" : has(row.epa_economy) ? "held" : "not_requested",
    source: "EPA fueleconomy.gov", lastUpdated: (epa.checkedAt as string) || null,
    detail: d.epa ? `${d.epa.combined ?? "?"} combined ${d.epa.unit ?? "MPG"}` : has(row.epa_economy) ? "Stored record conflicts with this vehicle's decode" : "Not matched",
    holdReason: !d.epa && has(row.epa_economy) ? "EPA record withheld: powertrain/drive/engine conflict." : null,
  });

  // OEM incentives
  add({
    key: "incentives", label: "OEM incentives",
    status: d.offers.length ? "partial" : "not_requested",
    source: "MarketCheck OEM incentives", lastUpdated: null,
    detail: d.offers.length ? `${d.offers.length} offer(s); eligibility not verified per VIN` : "Endpoint not authorized or called (needs a separately costed approval)",
    holdReason: null,
  });

  // Customer projection + V2 rendering
  const v2Sections = ["price", "verification", "market", "equipment", "factoryMsrp", "fuel", "recalls", "priceHistory", "specifications", "warranty", "timeline"] as const;
  const ok = v2Sections.filter((k) => (next[k] as { state: string }).state === "success");
  add({
    key: "v2_rendering", label: "Passport V2 rendering",
    status: ok.length === v2Sections.length ? "full" : ok.length ? "partial" : "unavailable",
    source: "buildNextPassportData", lastUpdated: null,
    detail: `${ok.length}/${v2Sections.length} data sections populated`,
    holdReason: null,
  });

  // Field-level crosswalk
  const groups: [FieldGroup, unknown][] = [
    ["neovin", neovinSnapshot], ["listing", row.mc_raw], ["listing.build", raw.build], ["listing.dealer", raw.dealer],
    ["listing.media", raw.media], ["mc_attributes", row.mc_attributes], ["build_sheet", mc.build_sheet],
    ["market_meta", row.market_meta], ["market_payload", row.market_payload], ["history_payload", row.history_payload],
    ["epa_economy", row.epa_economy],
  ];
  const fields: CoverageField[] = [];
  const unknownFields: { group: string; path: string }[] = [];
  for (const [g, obj] of groups) {
    const o = bag(obj);
    const supplied = obj != null && Object.keys(o).length > 0;
    for (const f of FIELD_REGISTRY.filter((x) => x.group === g && !x.path.includes("[]"))) {
      fields.push({ group: g, path: f.path, provider: PROVIDER[g], destination: f.destination, status: f.status, present: supplied && f.path in o, note: f.note });
    }
    for (const k of unmappedFields(g, obj)) unknownFields.push({ group: g, path: k });
    if (g === "mc_attributes") {
      for (const k of Object.keys(o)) {
        if (fields.some((x) => x.group === g && x.path === k)) continue;
        const row2 = resolveRow(g, k);
        if (row2) fields.push({ group: g, path: k, provider: PROVIDER[g], destination: row2.destination, status: row2.status, present: true, note: row2.note });
      }
    }
  }

  return { vin: String(row.vin || ""), categories: cats, fields, unknownFields };
}
