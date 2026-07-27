// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/tenantAuthority.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Bridge between the dealer's configured source authority and the truth
// layer's resolution.
//
// `source_authority_rules` already existed when the truth layer was built:
// a per-tenant, per-field table saying which source wins, backed by the
// Source Authority settings screen and read by marketcheck-sync. The truth
// layer shipped its own hardcoded precedence instead, which meant a
// dealership could configure "MSRP comes from the VIN decoder", and the
// snapshot would quietly ignore them.
//
// This module makes the configured rule authoritative where one exists.
// The built-in ordering in `precedence.ts` stays as the default for the
// fields the settings screen does not cover, and as the fallback for a
// tenant that has never opened it.

import type { SourceKind } from "./precedence.ts";

/** A source as named on the Source Authority settings screen. */
export type ConfiguredSource =
  | "dms_feed"
  | "autolabels_override"
  | "dealer_website"
  | "csv_import"
  | "manual_entry"
  | "vin_decoder_oem"
  | "marketcheck";

export type ConflictBehavior = "warn" | "block_generation" | "ignore";

export interface SourceAuthorityRule {
  field_key: string;
  primary_source: string;
  secondary_source: string | null;
  conflict_behavior: ConflictBehavior;
}

// The two vocabularies describe the same providers from different angles:
// the settings screen names where data ENTERED the dealership, the truth
// layer names how strongly it can be TRUSTED. A configured source can
// therefore cover more than one SourceKind, best first.
const CONFIGURED_TO_KINDS: Record<ConfiguredSource, SourceKind[]> = {
  vin_decoder_oem: ["oem_authorized", "neovin", "vin_decode"],
  marketcheck: ["marketcheck"],
  // Everything a person or the dealership's own systems assert arrives as
  // a dealer confirmation — the truth layer does not distinguish a DMS
  // feed from a manual correction, because both are the dealer speaking.
  dms_feed: ["dealer_confirmed", "other_structured"],
  autolabels_override: ["dealer_confirmed"],
  dealer_website: ["dealer_confirmed", "other_structured"],
  csv_import: ["other_structured", "dealer_confirmed"],
  manual_entry: ["dealer_confirmed"],
};

// Settings-screen field keys mapped onto truth-layer fact keys. Several
// settings fields cover a group of facts, which is why this is one-to-many.
const FIELD_TO_FACTS: Record<string, string[]> = {
  advertised_price: ["advertised_price"],
  sale_price: ["advertised_price"],
  msrp: ["base_msrp", "total_msrp", "destination_charge", "factory_options_total"],
  mileage: ["mileage"],
  stock_number: ["stock_number"],
  condition_new_used: ["condition"],
  exterior_color: ["exterior_color"],
  interior_color: ["interior_color"],
  equipment: ["standard_equipment", "factory_options", "factory_packages"],
  dealer_installed_products: ["dealer_installed_equipment"],
  vehicle_location: [],
  certification_status: [],
  warranty_status: ["warranty_selection"],
  vehicle_description: [],
};

/** Fact key -> the settings field that governs it, if any. */
export const FACT_TO_FIELD: Record<string, string> = Object.entries(FIELD_TO_FACTS)
  .reduce<Record<string, string>>((acc, [field, facts]) => {
    for (const fact of facts) acc[fact] = field;
    return acc;
  }, {});

export const isConfiguredSource = (v: string): v is ConfiguredSource =>
  Object.prototype.hasOwnProperty.call(CONFIGURED_TO_KINDS, v);

/**
 * Source ordering a tenant rule implies, best first.
 *
 * Returns null when the rule cannot constrain this fact — an unmapped
 * field, or a source name the truth layer has no equivalent for. A null
 * means "use the built-in ordering", never "allow anything".
 */
export function orderFromRule(rule: SourceAuthorityRule): SourceKind[] | null {
  if (!isConfiguredSource(rule.primary_source)) return null;
  const order: SourceKind[] = [...CONFIGURED_TO_KINDS[rule.primary_source]];
  if (rule.secondary_source && isConfiguredSource(rule.secondary_source)) {
    for (const kind of CONFIGURED_TO_KINDS[rule.secondary_source]) {
      if (!order.includes(kind)) order.push(kind);
    }
  }
  return order;
}

export interface TenantAuthority {
  /** Preferred source order per fact key, from the tenant's rules. */
  orderByFact: Map<string, SourceKind[]>;
  /** Facts whose configured behaviour escalates a disagreement. */
  blockingFacts: Set<string>;
  /** Facts the tenant has told us not to raise conflicts on. */
  ignoredFacts: Set<string>;
}

export const EMPTY_AUTHORITY: TenantAuthority = {
  orderByFact: new Map(),
  blockingFacts: new Set(),
  ignoredFacts: new Set(),
};

/**
 * Compile a tenant's rows into per-fact resolution guidance.
 *
 * A rule the truth layer cannot express is skipped rather than
 * approximated — silently applying half a dealer's instruction is worse
 * than applying none of it, because it looks like it worked.
 */
export function compileTenantAuthority(rules: SourceAuthorityRule[]): TenantAuthority {
  const orderByFact = new Map<string, SourceKind[]>();
  const blockingFacts = new Set<string>();
  const ignoredFacts = new Set<string>();

  for (const rule of rules) {
    const facts = FIELD_TO_FACTS[rule.field_key];
    if (!facts?.length) continue;
    const order = orderFromRule(rule);
    for (const fact of facts) {
      if (order) orderByFact.set(fact, order);
      if (rule.conflict_behavior === "block_generation") blockingFacts.add(fact);
      if (rule.conflict_behavior === "ignore") ignoredFacts.add(fact);
    }
  }

  return { orderByFact, blockingFacts, ignoredFacts };
}
