// The used-vehicle window sticker, as content and as a publish decision.
//
// This is the `window` document family (families.ts →
// used_vehicle_window_sticker, legacy document_type "window"). It is the
// dealership's own equipment-and-information summary for a used or CPO
// vehicle. It is NOT a government form and carries no required verbatim
// wording of its own: the FTC Buyers Guide (16 CFR 455) is the required
// used-vehicle disclosure and is a separate document with its own human
// gate. Nothing here may restate, replace, or paraphrase that Guide.
//
// Two rules the family declares as prohibited are enforced here rather than
// left to the renderer:
//   * no manufacturer branding that implies an OEM-issued document — this
//     sticker never carries factory logos or Monroney framing; the OEM
//     reproduction is its own family (factory_sticker),
//   * no fabricated factory option pricing — equipment is carried as NAMES
//     ONLY. A used vehicle's original option prices are not knowable from
//     the record, and a priced option line on a dealer sticker reads as a
//     manufacturer price.
//
// Pure and dependency-free so the edge renderer and the app share one
// definition; mirrored into supabase/functions/_shared/factorySticker/lib/
// by `bun run sync:edge-sticker`.

import { classifyCondition, type VehicleConditionClass } from "./families.ts";

/** Bumped when the content or the publish bar changes; travels in the snapshot. */
export const USED_WINDOW_STICKER_CONTENT_VERSION = "2026-09-08.1";

/** Names only, and a bounded list: the sheet is one page of 8.5x11 paper. */
export const MAX_EQUIPMENT_LINES = 42;

export interface UsedStickerVehicleInput {
  vin: string;
  condition: string | null | undefined;
  year: string | number | null | undefined;
  make: string | null | undefined;
  model: string | null | undefined;
  trim?: string | null;
  stockNumber?: string | null;
  mileage?: number | null;
  /** vehicle_listings.price — the advertised price, carried verbatim. */
  price?: number | null;
  exteriorColor?: string | null;
  interiorColor?: string | null;
  engine?: string | null;
  transmission?: string | null;
  drivetrain?: string | null;
  fuelType?: string | null;
  cityMpg?: number | null;
  highwayMpg?: number | null;
  /** Equipment names already extracted from the build sheet / feed. */
  equipment?: string[] | null;
}

export interface UsedStickerDealerInput {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  /** Dealer-configured doc/conveyance fee, disclosed — never added into the price here. */
  docFeeAmount?: number | null;
  docFeeEnabled?: boolean | null;
  docFeeLabel?: string | null;
}

export interface UsedStickerInput {
  vehicle: UsedStickerVehicleInput;
  dealer: UsedStickerDealerInput;
  /** Canonical /v/<slug> passport URL; the QR payload. */
  passportUrl?: string | null;
  /** True when a manager has rejected this document — automation must not override it. */
  humanRejected?: boolean;
  generatedAt?: string;
}

export interface StickerSpecRow {
  label: string;
  value: string;
}

export interface UsedVehicleWindowStickerContent {
  contentVersion: string;
  conditionClass: VehicleConditionClass;
  /** Header line shown to the shopper; never a manufacturer wordmark. */
  title: string;
  subtitle: string | null;
  vin: string;
  stockNumber: string | null;
  mileageText: string | null;
  priceLabel: string;
  priceText: string | null;
  docFeeNote: string | null;
  specs: StickerSpecRow[];
  equipment: string[];
  equipmentTruncated: number;
  disclosures: string[];
  dealerLines: string[];
  qrPayload: string | null;
  barcodePayload: string;
  generatedAt: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export const isCompleteVin = (vin: string): boolean => VIN_RE.test(vin.toUpperCase().trim());

/**
 * The FTC Buyers Guide's own precedence clause, referenced rather than
 * reproduced. 16 CFR 455.2 puts that clause on the Guide; repeating it here
 * verbatim would make this sheet look like the Guide, which the family
 * explicitly prohibits. Pointing at it is what a supplemental sheet may do.
 */
export const BUYERS_GUIDE_POINTER =
  "The FTC Buyers Guide posted on this vehicle is the official warranty disclosure. "
  + "Information on that form overrides any contrary statement on this sheet or in the contract of sale.";

export const EQUIPMENT_DISCLOSURE =
  "Equipment is listed by name from the vehicle build record. It is provided for information only "
  + "and is not a manufacturer document or a statement of original factory option pricing.";

export const PRICE_DISCLOSURE =
  "Price excludes tax, title, registration and any state or local fees.";

function dedupeNames(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const name = text(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const nameList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x : text((x as Record<string, unknown> | null)?.name)))
    .map((s) => text(s))
    .filter(Boolean);

/**
 * Equipment names out of the saved NeoVIN record, in the same precedence the
 * factory-sticker normalizer uses: the structured build sheet first
 * (key_features / standard / packages / options), then the flat feed lists.
 * Prices on those records are read and DISCARDED on purpose — see the
 * prohibited list at the top of this file.
 */
export function extractUsedStickerEquipment(
  mcAttributes: Record<string, unknown> | null | undefined,
  listingFeatures?: unknown,
): string[] {
  const mc = mcAttributes ?? {};
  const sheet = (mc.build_sheet && typeof mc.build_sheet === "object" ? mc.build_sheet : null) as
    | Record<string, unknown>
    | null;
  const out: string[] = [];
  if (sheet) {
    for (const src of [sheet.key_features, sheet.standard]) {
      if (src && typeof src === "object" && !Array.isArray(src)) {
        for (const items of Object.values(src as Record<string, unknown>)) out.push(...nameList(items));
      }
    }
    out.push(...nameList(sheet.packages));
    out.push(...nameList(sheet.options));
  }
  out.push(...nameList(mc.features));
  out.push(...nameList(mc.options));
  if (!out.length) out.push(...nameList(listingFeatures));
  return dedupeNames(out);
}

function buildTitle(v: UsedStickerVehicleInput): { title: string; subtitle: string | null } {
  const year = text(v.year);
  const make = text(v.make);
  const model = text(v.model);
  const trim = text(v.trim);
  const title = [year, make, model].filter(Boolean).join(" ");
  return { title, subtitle: trim || null };
}

export function buildUsedVehicleWindowSticker(input: UsedStickerInput): UsedVehicleWindowStickerContent {
  const v = input.vehicle;
  const d = input.dealer;
  const vin = text(v.vin).toUpperCase();
  const conditionClass = classifyCondition(v.condition);
  const { title, subtitle } = buildTitle(v);

  const mileage = finite(v.mileage);
  const price = finite(v.price);

  const specs: StickerSpecRow[] = [];
  const pushSpec = (label: string, value: string) => {
    if (value) specs.push({ label, value });
  };
  pushSpec("Engine", text(v.engine));
  pushSpec("Transmission", text(v.transmission));
  pushSpec("Drivetrain", text(v.drivetrain));
  pushSpec("Fuel", text(v.fuelType));
  pushSpec("Exterior", text(v.exteriorColor));
  pushSpec("Interior", text(v.interiorColor));
  const city = finite(v.cityMpg);
  const hwy = finite(v.highwayMpg);
  if (city !== null && hwy !== null) pushSpec("EPA est. MPG", `${Math.round(city)} city / ${Math.round(hwy)} hwy`);

  const allEquipment = dedupeNames(Array.isArray(v.equipment) ? v.equipment : []);
  const equipment = allEquipment.slice(0, MAX_EQUIPMENT_LINES);

  const docFeeAmount = finite(d.docFeeAmount);
  const docFeeNote = d.docFeeEnabled && docFeeAmount !== null && docFeeAmount > 0
    ? `A ${text(d.docFeeLabel) || "dealer conveyance/documentation fee"} of ${money(docFeeAmount)} applies.`
    : null;

  const disclosures = [BUYERS_GUIDE_POINTER, EQUIPMENT_DISCLOSURE];
  if (price !== null && price > 0) disclosures.push(PRICE_DISCLOSURE);

  const dealerLines = [
    text(d.name),
    text(d.address),
    [text(d.city), [text(d.state), text(d.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    text(d.phone),
  ].filter(Boolean);

  return {
    contentVersion: USED_WINDOW_STICKER_CONTENT_VERSION,
    conditionClass,
    title,
    subtitle,
    vin,
    stockNumber: text(v.stockNumber) || null,
    mileageText: mileage !== null && mileage >= 0 ? `${Math.round(mileage).toLocaleString("en-US")} miles` : null,
    priceLabel: "Advertised Price",
    priceText: price !== null && price > 0 ? money(price) : null,
    docFeeNote,
    specs,
    equipment,
    equipmentTruncated: Math.max(0, allEquipment.length - equipment.length),
    disclosures,
    dealerLines,
    qrPayload: text(input.passportUrl) || null,
    barcodePayload: vin,
    generatedAt: input.generatedAt || new Date().toISOString(),
  };
}

export type UsedStickerHoldCode =
  | "NOT_A_USED_VEHICLE"
  | "INCOMPLETE_VIN"
  | "IDENTITY_UNRESOLVED"
  | "NO_ADVERTISED_PRICE"
  | "NO_ODOMETER"
  | "NO_DEALER_IDENTITY"
  | "HUMAN_REJECTED";

export interface UsedStickerPublishDecision {
  publish: boolean;
  holds: UsedStickerHoldCode[];
  /** One dealer-actionable sentence per hold, in the same order. */
  reasons: string[];
}

const HOLD_REASONS: Record<UsedStickerHoldCode, string> = {
  NOT_A_USED_VEHICLE:
    "This sheet is the used-vehicle family; a new vehicle's window sticker is the OEM Monroney reproduction.",
  INCOMPLETE_VIN: "The VIN is not a complete 17-character VIN, so the sheet cannot identify the vehicle.",
  IDENTITY_UNRESOLVED: "Year, make and model are not all resolved on the record.",
  NO_ADVERTISED_PRICE: "No advertised price is on the record; a price sheet with no price is not publishable.",
  NO_ODOMETER: "No odometer reading is on the record. Mileage is a material representation on a used vehicle.",
  NO_DEALER_IDENTITY: "The dealership name is not configured, so the sheet cannot say who is selling the vehicle.",
  HUMAN_REJECTED: "A manager rejected this document. Automation does not re-publish a rejected document.",
};

/**
 * May this sheet go to the customer passport without a human click?
 *
 * The bar is deliberately not "is anything imperfect". This document carries
 * no legally required wording, restates no warranty representation, and shows
 * the dealer's own already-advertised price — so review adds nothing a
 * customer benefits from. What review DOES protect against is a sheet that
 * asserts something it cannot support: a vehicle it cannot identify, a price
 * it does not have, or an odometer it never read. Those hold, with a reason,
 * and everything else publishes.
 *
 * Deliberately NOT a hold: thin equipment, missing specs, no QR. A sparse
 * sheet is a true sheet.
 */
export function evaluateUsedStickerAutoPublish(
  content: UsedVehicleWindowStickerContent,
  input?: { humanRejected?: boolean },
): UsedStickerPublishDecision {
  const holds: UsedStickerHoldCode[] = [];
  if (input?.humanRejected) holds.push("HUMAN_REJECTED");
  if (content.conditionClass !== "used" && content.conditionClass !== "cpo") holds.push("NOT_A_USED_VEHICLE");
  if (!isCompleteVin(content.vin)) holds.push("INCOMPLETE_VIN");
  if (!content.title || content.title.split(/\s+/).filter(Boolean).length < 3) holds.push("IDENTITY_UNRESOLVED");
  if (!content.priceText) holds.push("NO_ADVERTISED_PRICE");
  if (!content.mileageText) holds.push("NO_ODOMETER");
  if (!content.dealerLines.length) holds.push("NO_DEALER_IDENTITY");
  return {
    publish: holds.length === 0,
    holds,
    reasons: holds.map((h) => HOLD_REASONS[h]),
  };
}
