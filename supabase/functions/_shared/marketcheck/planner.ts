// Enrichment planner for the MarketCheck pilot (owner change orders
// 2026-10-31). Pure: given the fields a store requires, the account's product
// catalog, what is already held, and the rights recorded for this account, it
// decides per field whether to recalculate, reuse, request fresh data, use a
// verified free refresh, or stop, and picks the cheapest set of products that
// covers the fresh fields. Deterministic: no LLM, no tool selection.

export type Cadence = "static" | "freshness_or_input_change" | "freshness" | "monthly_dataset" | "derived";
export type Right = "permitted" | "limited" | "prohibited" | "unknown";

export interface CatalogProduct {
  productKey: string;
  label: string;
  bundledFields: string[];
  rateUsd: number | null;
  rateStatus: "verified" | "list_price_estimate" | "placeholder" | "unknown";
  quotaUnits: number;
  repeatChargePolicy: "charged" | "free_within_window" | "discounted" | "unknown";
  repeatChargeUsd: number | null;
  repeatWindowDays: number | null;
  repeatConsumesQuota: "yes" | "no" | "unknown";
  retentionPolicy: Right;
  retentionDays: number | null;
  crossStoreReuse: "permitted" | "prohibited" | "unknown";
  customerDisplay: "permitted" | "prohibited" | "unknown";
  updateCadence: Exclude<Cadence, "derived">;
  freshnessDays: number | null;
  verifiedAt: string | null;
  enabled: boolean;
}

export interface HeldResult {
  productKey: string;
  fields: string[];
  fetchedAt: string;
  storeId: string;
  /** Hash of the inputs that drive the answer (mileage, ZIP, trim). */
  inputsHash: string | null;
  /** True when this was a paid request (start of a repeat window). */
  paid: boolean;
}

export interface PlanInput {
  requiredFields: string[];
  approvedProducts: string[];
  catalog: CatalogProduct[];
  held: HeldResult[];
  storeId: string;
  inputsHash: string | null;
  now: Date;
  /** Customer-facing use needs display rights; internal use does not. */
  use: "customer_display" | "internal";
  /** Fields computed locally from other fields. */
  derivations?: Record<string, string[]>;
  fieldCadence?: Record<string, Cadence>;
}

export type FieldAction = "recalculate" | "reuse" | "fresh" | "free_refresh" | "blocked";

export interface FieldPlan {
  field: string;
  action: FieldAction;
  productKey?: string;
  why: string;
  /** Rights still unverified for this use; shown for review, never assumed. */
  review?: string[];
}

export interface PlannedCall {
  productKey: string;
  fields: string[];
  extraFields: string[];
  estimatedUsd: number | null;
  priceBasis: CatalogProduct["rateStatus"];
  quotaUnits: number;
  freeRefresh: boolean;
}

export interface Plan {
  fields: FieldPlan[];
  calls: PlannedCall[];
  totalQuotaUnits: number;
  /** Null when any planned call has no price. */
  totalUsd: number | null;
  explanations: string[];
}

export const DEFAULT_DERIVATIONS: Record<string, string[]> = {
  warranty_remaining: ["factory_warranty_spec"],
};

const DAY = 86_400_000;

function stillFresh(p: CatalogProduct, h: HeldResult, input: PlanInput): boolean {
  const age = input.now.getTime() - new Date(h.fetchedAt).getTime();
  switch (p.updateCadence) {
    case "static":
      return true;
    case "freshness_or_input_change":
      return h.inputsHash === input.inputsHash && p.freshnessDays != null && age < p.freshnessDays * DAY;
    case "freshness":
      return p.freshnessDays != null && age < p.freshnessDays * DAY;
    case "monthly_dataset": {
      // Regenerated monthly by the provider: reuse within the same UTC month.
      const f = new Date(h.fetchedAt);
      return f.getUTCFullYear() === input.now.getUTCFullYear() && f.getUTCMonth() === input.now.getUTCMonth();
    }
  }
}

/** Whether a held answer may be used here, and what still needs review. */
function reuseRights(p: CatalogProduct, h: HeldResult, input: PlanInput): { ok: boolean; review: string[]; why?: string } {
  const review: string[] = [];
  if (p.retentionPolicy === "prohibited") return { ok: false, review, why: "retention is prohibited for this product" };
  if (p.retentionPolicy === "limited" && p.retentionDays != null && input.now.getTime() - new Date(h.fetchedAt).getTime() > p.retentionDays * DAY) {
    return { ok: false, review, why: "held beyond the permitted retention" };
  }
  if (p.retentionPolicy === "unknown") review.push("retention");
  if (h.storeId !== input.storeId) {
    if (p.crossStoreReuse !== "permitted") return { ok: false, review, why: p.crossStoreReuse === "prohibited" ? "cross-store reuse is prohibited" : "cross-store reuse is not verified" };
  }
  if (input.use === "customer_display" && p.customerDisplay !== "permitted") {
    if (p.customerDisplay === "prohibited") return { ok: false, review, why: "customer display is prohibited" };
    review.push("customer_display");
  }
  return { ok: true, review };
}

const costOf = (p: CatalogProduct) => p.rateUsd;

/** Cheapest set of products covering `fields`: fewest quota units, then lowest known price, then fewest unpriced. */
export function cheapestCover(fields: string[], candidates: CatalogProduct[]): CatalogProduct[] | null {
  if (fields.length === 0) return [];
  const useful = candidates.filter((p) => p.bundledFields.some((f) => fields.includes(f)));
  if (useful.length > 16) throw new Error("too_many_candidate_products");
  let best: { set: CatalogProduct[]; units: number; usd: number; unpriced: number } | null = null;
  for (let mask = 1; mask < 1 << useful.length; mask++) {
    const set = useful.filter((_, i) => mask & (1 << i));
    const covered = new Set(set.flatMap((p) => p.bundledFields));
    if (!fields.every((f) => covered.has(f))) continue;
    const units = set.reduce((n, p) => n + p.quotaUnits, 0);
    const unpriced = set.filter((p) => costOf(p) == null).length;
    const usd = set.reduce((n, p) => n + (costOf(p) ?? 0), 0);
    const better = !best || units < best.units || (units === best.units && (unpriced < best.unpriced || (unpriced === best.unpriced && usd < best.usd - 1e-9)));
    if (better) best = { set, units, usd, unpriced };
  }
  return best?.set ?? null;
}

export function planEnrichment(input: PlanInput): Plan {
  const derivations = { ...DEFAULT_DERIVATIONS, ...(input.derivations ?? {}) };
  const catalog = new Map(input.catalog.map((p) => [p.productKey, p]));
  const approved = input.catalog.filter((p) => p.enabled && input.approvedProducts.includes(p.productKey));
  const fieldPlans = new Map<string, FieldPlan>();
  const need = new Set<string>();

  // Derived fields are recalculated; their inputs become requirements.
  const wanted = new Set<string>();
  for (const f of input.requiredFields) {
    if (derivations[f]) {
      fieldPlans.set(f, { field: f, action: "recalculate", why: `calculated from ${derivations[f].join(", ")}; never requested` });
      derivations[f].forEach((d) => wanted.add(d));
    } else wanted.add(f);
  }

  for (const f of wanted) {
    let reused: FieldPlan | null = null;
    let lastDenied: string | undefined;
    for (const h of input.held.filter((x) => x.fields.includes(f)).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))) {
      const p = catalog.get(h.productKey);
      if (!p) continue;
      const rights = reuseRights(p, h, input);
      if (!rights.ok) { lastDenied = rights.why; continue; }
      if (!stillFresh(p, h, input)) { lastDenied = "held answer is stale or its inputs changed"; continue; }
      reused = { field: f, action: "reuse", productKey: p.productKey, why: `reusing ${p.label} from ${h.fetchedAt.slice(0, 10)}`, review: rights.review.length ? rights.review : undefined };
      break;
    }
    if (reused) fieldPlans.set(f, reused);
    else {
      need.add(f);
      if (lastDenied) fieldPlans.set(f, { field: f, action: "fresh", why: lastDenied });
    }
  }

  const needList = [...need];
  const uncoverable = needList.filter((f) => !approved.some((p) => p.bundledFields.includes(f)));
  for (const f of uncoverable) fieldPlans.set(f, { field: f, action: "blocked", why: "no approved product supplies this field" });
  const cover = cheapestCover(needList.filter((f) => !uncoverable.includes(f)), approved) ?? [];

  const calls: PlannedCall[] = [];
  const explanations: string[] = [];
  const claimed = new Set<string>();
  for (const p of cover) {
    const fields = p.bundledFields.filter((f) => need.has(f) && !claimed.has(f));
    fields.forEach((f) => claimed.add(f));
    const lastPaid = input.held.filter((h) => h.productKey === p.productKey && h.paid).map((h) => new Date(h.fetchedAt).getTime()).sort((a, b) => b - a)[0];
    const free = p.repeatChargePolicy === "free_within_window" && p.verifiedAt != null && p.repeatWindowDays != null &&
      lastPaid != null && input.now.getTime() - lastPaid < p.repeatWindowDays * DAY;
    const extra = p.bundledFields.filter((f) => !need.has(f));
    calls.push({
      productKey: p.productKey, fields, extraFields: extra,
      estimatedUsd: free ? (p.repeatChargeUsd ?? 0) : p.rateUsd,
      priceBasis: p.rateStatus,
      // A free repeat still counts against quota unless verified otherwise.
      quotaUnits: free && p.repeatConsumesQuota === "no" ? 0 : p.quotaUnits,
      freeRefresh: free,
    });
    for (const f of fields) {
      const prior = fieldPlans.get(f);
      fieldPlans.set(f, { field: f, action: free ? "free_refresh" : "fresh", productKey: p.productKey,
        why: (free ? `verified free repeat of ${p.label}` : `requested with ${p.label}`) + (prior?.why ? ` (${prior.why})` : "") });
    }
    if (extra.length) explanations.push(`${p.label} also returns ${extra.join(", ")} in the same request; turning those off does not change the price.`);
    if (p.rateStatus !== "verified") explanations.push(`${p.label}: price is ${p.rateStatus.replace(/_/g, " ")}, not verified for this account.`);
    if (p.repeatChargePolicy === "unknown") explanations.push(`${p.label}: repeat billing is unknown, so every repeat is treated as charged.`);
  }

  // What turning each requested field off would save.
  for (const f of needList.filter((x) => !uncoverable.includes(x))) {
    const without = cheapestCover(needList.filter((x) => x !== f && !uncoverable.includes(x)), approved) ?? [];
    const units = (s: CatalogProduct[]) => s.reduce((n, p) => n + p.quotaUnits, 0);
    if (units(without) === units(cover) && Math.abs(without.reduce((n, p) => n + (p.rateUsd ?? 0), 0) - cover.reduce((n, p) => n + (p.rateUsd ?? 0), 0)) < 1e-9) {
      explanations.push(`Disabling ${f} saves nothing: the same request is still needed for other fields.`);
    }
  }

  const totalQuotaUnits = calls.reduce((n, c) => n + c.quotaUnits, 0);
  const totalUsd = calls.some((c) => c.estimatedUsd == null) ? null : Math.round(calls.reduce((n, c) => n + (c.estimatedUsd ?? 0), 0) * 10000) / 10000;
  const order = [...input.requiredFields, ...[...wanted].filter((f) => !input.requiredFields.includes(f))];
  return { fields: order.map((f) => fieldPlans.get(f)!).filter(Boolean), calls, totalQuotaUnits, totalUsd, explanations };
}
