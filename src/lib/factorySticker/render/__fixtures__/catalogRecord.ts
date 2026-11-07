// Loader shared by the catalog-template fixtures: a read-only extract of one
// saved vehicle_listings row (or a labeled synthetic record) stored beside this
// file, rebuilt into the listing shape the sticker normalizer reads.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForSticker } from "../../../../../supabase/functions/factory-sticker-orchestrate/normalize.ts";
import type { FactoryStickerRenderData } from "../contract.ts";
import { canonicalPassportUrl } from "../../reproduction.ts";

interface CatalogRecord {
  vin: string;
  slug: string;
  ymm: string;
  trim: string;
  condition: string;
  body_type: string;
  build_sheet: Record<string, unknown>;
  epa_economy: Record<string, unknown> | null;
  mc_extra: Record<string, unknown>;
}

export type CatalogListing = Record<string, unknown> & { vin: string; slug: string };

export function recordListing(file: string): CatalogListing {
  const r = JSON.parse(readFileSync(join(__dirname, file), "utf8")) as CatalogRecord;
  return {
    vin: r.vin, slug: r.slug, ymm: r.ymm, trim: r.trim, condition: r.condition,
    mc_attributes: { body_type: r.body_type, build_sheet: r.build_sheet, ...r.mc_extra },
    epa_economy: r.epa_economy,
  };
}

export function recordRenderData(listing: CatalogListing): FactoryStickerRenderData {
  return normalizeForSticker(listing, {}, canonicalPassportUrl(listing.slug), "Factory Window Sticker").data;
}

export const NO_DEALER = { name: null, address: null, city: null, state: null, zip: null, phone: null } as const;
