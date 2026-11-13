// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/tenantAuthority.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { SourceKind } from "./precedence.ts";
export type ConfiguredSource = "dms_feed" | "autolabels_override" | "dealer_website" | "csv_import" | "manual_entry" | "vin_decoder_oem" | "marketcheck";
export type ConflictBehavior = "warn" | "block_generation" | "ignore";
export interface SourceAuthorityRule {
    field_key: string;
    primary_source: string;
    secondary_source: string | null;
    conflict_behavior: ConflictBehavior;
}
const CONFIGURED_TO_KINDS: Record<ConfiguredSource, SourceKind[]> = {
    vin_decoder_oem: ["oem_authorized", "neovin", "vin_decode"],
    marketcheck: ["marketcheck"],
    dms_feed: ["dealer_confirmed", "other_structured"],
    autolabels_override: ["dealer_confirmed"],
    dealer_website: ["dealer_confirmed", "other_structured"],
    csv_import: ["other_structured", "dealer_confirmed"],
    manual_entry: ["dealer_confirmed"],
};
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
export const FACT_TO_FIELD: Record<string, string> = Object.entries(FIELD_TO_FACTS)
    .reduce<Record<string, string>>((acc, [field, facts]) => {
    for (const fact of facts)
        acc[fact] = field;
    return acc;
}, {});
export const isConfiguredSource = (v: string): v is ConfiguredSource => Object.prototype.hasOwnProperty.call(CONFIGURED_TO_KINDS, v);
export function orderFromRule(rule: SourceAuthorityRule): SourceKind[] | null {
    if (!isConfiguredSource(rule.primary_source))
        return null;
    const order: SourceKind[] = [...CONFIGURED_TO_KINDS[rule.primary_source]];
    if (rule.secondary_source && isConfiguredSource(rule.secondary_source)) {
        for (const kind of CONFIGURED_TO_KINDS[rule.secondary_source]) {
            if (!order.includes(kind))
                order.push(kind);
        }
    }
    return order;
}
export interface TenantAuthority {
    orderByFact: Map<string, SourceKind[]>;
    blockingFacts: Set<string>;
    ignoredFacts: Set<string>;
}
export const EMPTY_AUTHORITY: TenantAuthority = {
    orderByFact: new Map(),
    blockingFacts: new Set(),
    ignoredFacts: new Set(),
};
export function compileTenantAuthority(rules: SourceAuthorityRule[]): TenantAuthority {
    const orderByFact = new Map<string, SourceKind[]>();
    const blockingFacts = new Set<string>();
    const ignoredFacts = new Set<string>();
    for (const rule of rules) {
        const facts = FIELD_TO_FACTS[rule.field_key];
        if (!facts?.length)
            continue;
        const order = orderFromRule(rule);
        for (const fact of facts) {
            if (order)
                orderByFact.set(fact, order);
            if (rule.conflict_behavior === "block_generation")
                blockingFacts.add(fact);
            if (rule.conflict_behavior === "ignore")
                ignoredFacts.add(fact);
        }
    }
    return { orderByFact, blockingFacts, ignoredFacts };
}
