import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Product } from "@/hooks/useProducts";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { knownCount, type CountValue } from "@/lib/admin/health";
import type { ApplyResult } from "@/lib/admin/reviewApply";
import { buildFeeImpact, type FeeDraft, type FeeImpact, type FeeImpactRow } from "@/lib/admin/pricing/feePolicy";
import { assessConsistency, type ConsistencyAssessment, type ConsistencyListing, type WebsiteObservation } from "@/lib/admin/pricing/priceConsistency";
import type { SampleVehicle } from "@/lib/admin/pricing/productApplicability";
import type { PriceDisplayMode } from "@/lib/priceModel";

// Reads and the two writers Pricing & Products may call. Every function here
// is tenant-scoped, bounded, and answers a failed read with a thrown error so
// a view renders Unknown rather than zero. The shared server contracts are
// called by name; when a contract is not installed yet (Postgres 42883 or the
// PostgREST schema-cache miss) the caller gets the honest fallback described
// alongside it, never a fabricated result.

type Db = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
const db = (): Db => supabase as unknown as Db;

export const tenantIdOf = (tenant: { id?: string | null } | null | undefined): string | null =>
  tenant?.id && tenant.id !== "house" ? tenant.id : null;

export interface DbError {
  code?: string | null;
  message?: string | null;
}

export const isMissingFunction = (error: DbError | null | undefined): boolean => {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return /could not find the function|function .* does not exist/i.test(error.message ?? "");
};

export const PENDING_MIGRATION_COPY = "The dedicated server routine for this step is not installed yet (pending migration).";

export const FALLBACK_APPLY_WARNING =
  "Until the dedicated routine is installed, applying uses the existing recalculation, which also updates archived vehicles and refreshes each recalculated vehicle's verification stamp.";

export type FeeScope = "active" | "all";

export const feeReviewHref = (draft: FeeDraft, scope: FeeScope): string =>
  `${ADMIN_CHILD_ROUTES.feeReview}?enabled=${draft.enabled ? "1" : "0"}&amount=${encodeURIComponent(String(draft.amount))}&state=${encodeURIComponent(draft.stateCode)}&scope=${scope}`;

export function parseFeeReviewParams(params: URLSearchParams, fallback: FeeDraft): { draft: FeeDraft; scope: FeeScope; provided: boolean } {
  const provided = params.has("amount") || params.has("enabled") || params.has("state");
  if (!provided) return { draft: fallback, scope: params.get("scope") === "all" ? "all" : "active", provided };
  const amount = Number(params.get("amount"));
  return {
    draft: {
      enabled: params.has("enabled") ? params.get("enabled") === "1" : fallback.enabled,
      amount: Number.isFinite(amount) ? amount : fallback.amount,
      stateCode: (params.get("state") ?? fallback.stateCode).toUpperCase(),
    },
    scope: params.get("scope") === "all" ? "all" : "active",
    provided,
  };
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

interface ListingRow {
  id: string;
  vin: string;
  year: string | number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  condition: string | null;
  mileage: number | null;
  price: number | string | null;
  advertised_price_before_doc: number | string | null;
  doc_fee: number | string | null;
  website_sale_price: number | string | null;
  price_parse_status: string | null;
  price_last_verified_at: string | null;
  archived_at: string | null;
  hero_image_url: string | null;
  vehicle_file_id: string | null;
  stock: string | null;
}

const LISTING_COLUMNS =
  "id, vin, year, make, model, trim, condition, mileage, price, advertised_price_before_doc, doc_fee, website_sale_price, price_parse_status, price_last_verified_at, archived_at, hero_image_url, vehicle_file_id, stock:mc_attributes->>stock_no";

const FEE_COLUMNS = "vin, year, make, model, trim, archived_at, advertised_price_before_doc, doc_fee, website_sale_price, price_parse_status, stock:mc_attributes->>stock_no";

export const FEE_ROW_LIMIT = 1000;
export const CONSISTENCY_LIMIT = 200;

const toFeeRow = (r: ListingRow): FeeImpactRow => ({
  vin: r.vin,
  year: r.year,
  make: r.make,
  model: r.model,
  trim: r.trim,
  stock: r.stock ?? null,
  archived: !!r.archived_at,
  advertised_price_before_doc: num(r.advertised_price_before_doc),
  doc_fee: num(r.doc_fee),
  website_sale_price: num(r.website_sale_price),
  price_parse_status: r.price_parse_status,
});

const toConsistencyListing = (r: ListingRow): ConsistencyListing => ({
  id: r.id,
  vin: r.vin,
  year: r.year,
  make: r.make,
  model: r.model,
  trim: r.trim,
  stock: r.stock ?? null,
  condition: r.condition,
  heroImageUrl: r.hero_image_url,
  price: num(r.price),
  advertisedBeforeDoc: num(r.advertised_price_before_doc),
  docFee: num(r.doc_fee),
  websiteSalePrice: num(r.website_sale_price),
  parseStatus: r.price_parse_status,
  verifiedAt: r.price_last_verified_at,
  vehicleFileId: r.vehicle_file_id,
});

const readError = (error: DbError | null | undefined, fallback: string): Error => new Error(error?.message || fallback);

export async function loadFeeImpactRows(tenantId: string): Promise<{ rows: FeeImpactRow[]; truncated: boolean }> {
  const { data, error } = await db().from("vehicle_listings").select(FEE_COLUMNS).eq("tenant_id", tenantId).order("vin").limit(FEE_ROW_LIMIT);
  if (error) throw readError(error, "Could not read inventory.");
  const rows = ((data ?? []) as ListingRow[]).map(toFeeRow);
  return { rows, truncated: rows.length >= FEE_ROW_LIMIT };
}

export interface FeePreviewResult {
  impact: FeeImpact;
  /** server: the shared preview contract answered; client: computed here from inventory rows. */
  source: "server" | "client";
  version: string | number | null;
  truncated: boolean;
  notes: string[];
}

interface ServerPreview {
  version?: number | string | null;
  computed_at?: string;
  eligible?: number | null;
  unchanged?: number | null;
  excluded_archived?: number | null;
  samples?: Array<{ vin_suffix: string; selling_price: number; fee_before: number; fee_after: number; total_before: number | null; total_after: number }>;
  warnings?: string[];
}

const impactFromServer = (p: ServerPreview, includeArchived: boolean): FeeImpact => ({
  eligible: p.eligible ?? 0,
  unchanged: p.unchanged ?? 0,
  excludedArchived: p.excluded_archived ?? 0,
  includedArchived: 0,
  noPrice: 0,
  parserWarnings: 0,
  samples: (p.samples ?? []).map((s) => ({
    vinSuffix: s.vin_suffix,
    vehicle: `VIN ending ${s.vin_suffix}`,
    stock: null,
    sellingPrice: Number(s.selling_price),
    feeBefore: Number(s.fee_before),
    feeAfter: Number(s.fee_after),
    totalBefore: s.total_before == null ? null : Number(s.total_before),
    totalAfter: Number(s.total_after),
  })),
  warnings: p.warnings ?? [],
  exclusions: includeArchived ? [] : ["Archived records are excluded and require a separate authorized action."],
});

export async function loadFeePreview(tenantId: string, draft: FeeDraft, includeArchived: boolean): Promise<FeePreviewResult> {
  const { data, error } = await db().rpc("admin_doc_fee_change_preview", {
    p_tenant_id: tenantId,
    p_enabled: draft.enabled,
    p_amount: draft.amount,
    p_include_archived: includeArchived,
  });
  if (!error && data && typeof data === "object") {
    const p = data as ServerPreview;
    return { impact: impactFromServer(p, includeArchived), source: "server", version: p.version ?? null, truncated: false, notes: [] };
  }
  if (error && !isMissingFunction(error)) throw readError(error, "The change preview could not be computed.");
  const { rows, truncated } = await loadFeeImpactRows(tenantId);
  const impact = buildFeeImpact(rows, draft, { includeArchived });
  const notes = [
    `${PENDING_MIGRATION_COPY} Counts were computed in the browser from inventory rows${truncated ? ` (first ${FEE_ROW_LIMIT.toLocaleString()} vehicles only)` : ""}.`,
    FALLBACK_APPLY_WARNING,
  ];
  return { impact, source: "client", version: null, truncated, notes };
}

export interface PolicyVersion {
  version: string | number | null;
  /** server: admin_policy_version; fallback: the profile's last update stamp; unknown: neither could be read. */
  source: "server" | "fallback" | "unknown";
}

export async function loadPolicyVersion(tenantId: string): Promise<PolicyVersion> {
  const { data, error } = await db().rpc("admin_policy_version", { p_tenant_id: tenantId });
  if (!error && data != null) {
    const n = Number(data);
    return { version: Number.isFinite(n) ? n : String(data), source: "server" };
  }
  if (error && !isMissingFunction(error)) return { version: null, source: "unknown" };
  const res = await db().from("dealer_profiles").select("updated_at").eq("tenant_id", tenantId).maybeSingle();
  if (res.error) return { version: null, source: "unknown" };
  const stamp = (res.data as { updated_at?: string | null } | null)?.updated_at ?? null;
  return { version: stamp, source: stamp ? "fallback" : "unknown" };
}

export interface ApplyFeeArgs {
  tenantId: string;
  draft: FeeDraft;
  expectedVersion: string | number | null;
  idempotencyKey: string;
  includeArchived: boolean;
  updateSettings: (patch: { doc_fee_enabled: boolean; doc_fee_amount: number; doc_fee_state: string }) => Promise<boolean>;
}

export type ApplyFeeOutcome =
  | { kind: "result"; path: "server" | "fallback"; result: ApplyResult }
  | { kind: "conflict"; path: "server" | "fallback" };

const fallbackAppliedCopy = (affected: number | null): string =>
  `${affected == null ? "Applied" : `${affected.toLocaleString()} ${affected === 1 ? "vehicle" : "vehicles"} updated`} through the existing recalculation routine. This path also touched archived vehicles and refreshed each recalculated vehicle's verification stamp; the dedicated routine that preserves both is pending migration.`;

export async function applyFeeChange(a: ApplyFeeArgs): Promise<ApplyFeeOutcome> {
  const { data, error } = await db().rpc("admin_doc_fee_change_apply", {
    p_tenant_id: a.tenantId,
    p_enabled: a.draft.enabled,
    p_amount: a.draft.amount,
    p_expected_version: a.expectedVersion,
    p_idempotency_key: a.idempotencyKey,
    p_include_archived: a.includeArchived,
  });
  if (!error && data && typeof data === "object") {
    const r = data as { status?: string; affected?: number | null; audit_id?: string | null; message?: string | null };
    const affected = r.affected == null ? null : Number(r.affected);
    const auditEventId = r.audit_id ?? null;
    switch (r.status) {
      case "conflict":
        return { kind: "conflict", path: "server" };
      case "duplicate":
        return { kind: "result", path: "server", result: { status: "applied", affected, message: "This change had already been applied under the same review key; nothing was changed again.", auditEventId } };
      case "applied":
        return { kind: "result", path: "server", result: { status: "applied", affected, message: `${affected == null ? "Vehicles were" : `${affected.toLocaleString()} ${affected === 1 ? "vehicle was" : "vehicles were"}`} updated. Verification dates and mismatch flags were preserved.`, auditEventId } };
      case "partial":
        return { kind: "result", path: "server", result: { status: "partial", affected, message: r.message || "Some vehicles were updated and some were not. Review the inventory before relying on the new fee.", auditEventId } };
      default:
        return { kind: "result", path: "server", result: { status: "failed", affected: null, message: r.message || "The server did not apply the change.", auditEventId } };
    }
  }
  if (error && !isMissingFunction(error)) {
    return { kind: "result", path: "server", result: { status: "failed", affected: null, message: error.message || "The change could not be applied." } };
  }
  if (a.expectedVersion != null) {
    const current = await loadPolicyVersion(a.tenantId);
    if (current.version !== a.expectedVersion) return { kind: "conflict", path: "fallback" };
  }
  const saved = await a.updateSettings({ doc_fee_enabled: a.draft.enabled, doc_fee_amount: a.draft.amount, doc_fee_state: a.draft.stateCode });
  if (!saved) {
    return { kind: "result", path: "fallback", result: { status: "failed", affected: null, message: "The fee policy could not be saved, so no vehicle was recalculated." } };
  }
  const recalc = await db().rpc("recalc_tenant_doc_fee", { p_tenant_id: a.tenantId });
  if (recalc.error) {
    return { kind: "result", path: "fallback", result: { status: "partial", affected: null, message: `The fee policy was saved but the recalculation failed (${recalc.error.message || "unknown error"}). Stored vehicle prices still carry the previous fee.` } };
  }
  const affected = num(recalc.data);
  return { kind: "result", path: "fallback", result: { status: "applied", affected, message: fallbackAppliedCopy(affected) } };
}

const countOf = async (q: PromiseLike<{ count: number | null; error: unknown }>): Promise<CountValue> => {
  try {
    const { count, error } = await q;
    if (error || count === null || count === undefined) return { kind: "failed" };
    return knownCount(count);
  } catch {
    return { kind: "failed" };
  }
};

export interface ListingCounts {
  /** Active vehicles with an advertised price: the rows a fee change can touch. */
  eligible: CountValue;
  archived: CountValue;
}

export async function loadListingCounts(tenantId: string): Promise<ListingCounts> {
  const [eligible, archived] = await Promise.all([
    countOf(db().from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null).not("advertised_price_before_doc", "is", null)),
    countOf(db().from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).not("archived_at", "is", null)),
  ]);
  return { eligible, archived };
}

export async function loadConsistency(tenantId: string, configuredFee: number, mode: PriceDisplayMode): Promise<{ rows: ConsistencyAssessment[]; truncated: boolean }> {
  const listings = await db().from("vehicle_listings").select(LISTING_COLUMNS).eq("tenant_id", tenantId).is("archived_at", null).not("price", "is", null).order("vin").limit(CONSISTENCY_LIMIT);
  if (listings.error) throw readError(listings.error, "Could not read inventory.");
  const rows = (listings.data ?? []) as ListingRow[];
  const observations = new Map<string, WebsiteObservation>();
  if (rows.length) {
    const vins = rows.map((r) => r.vin.toUpperCase());
    const obs = await db()
      .from("advertised_prices")
      .select("vin, advertised_price, source_channel, source_url, captured_at")
      .eq("tenant_id", tenantId)
      .eq("source_channel", "website")
      .gt("advertised_price", 0)
      .in("vin", vins)
      .order("captured_at", { ascending: false })
      .limit(2000);
    if (obs.error) throw readError(obs.error, "Could not read website observations.");
    for (const o of (obs.data ?? []) as Array<{ vin: string; advertised_price: number | string; source_channel: string; source_url: string | null; captured_at: string }>) {
      const key = o.vin.toUpperCase();
      if (observations.has(key)) continue;
      observations.set(key, { price: Number(o.advertised_price), capturedAt: o.captured_at, sourceUrl: o.source_url || null, channel: o.source_channel });
    }
  }
  return {
    rows: rows.map((r) => assessConsistency(toConsistencyListing(r), observations.get(r.vin.toUpperCase()) ?? null, configuredFee, mode)),
    truncated: rows.length >= CONSISTENCY_LIMIT,
  };
}

export async function loadWebsitePriceTerm(tenantId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("vehicle_listings")
    .select("website_price_term")
    .eq("tenant_id", tenantId)
    .not("website_price_term", "is", null)
    .order("price_last_verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return ((data as { website_price_term?: string | null } | null)?.website_price_term as string) || null;
}

export type AdminProduct = Product & { tenant_id?: string | null };

export async function loadAdminProducts(): Promise<AdminProduct[]> {
  const { data, error } = await db().from("products").select("*").order("sort_order");
  if (error) throw readError(error, "Could not read products.");
  return (data ?? []) as AdminProduct[];
}

export async function loadProduct(productId: string): Promise<AdminProduct | null> {
  const { data, error } = await db().from("products").select("*").eq("id", productId).maybeSingle();
  if (error) throw readError(error, "Could not read the product.");
  return (data as AdminProduct | null) ?? null;
}

export async function loadSampleVehicles(tenantId: string, limit: number): Promise<SampleVehicle[]> {
  const { data, error } = await db()
    .from("vehicle_listings")
    .select("vin, year, make, model, trim, condition, mileage")
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .order("vin")
    .limit(limit);
  if (error) throw readError(error, "Could not read inventory.");
  return ((data ?? []) as Array<Pick<ListingRow, "vin" | "year" | "make" | "model" | "trim" | "condition" | "mileage">>).map((r) => ({
    vin: r.vin,
    year: r.year,
    make: r.make,
    model: r.model,
    trim: r.trim,
    condition: r.condition,
    mileage: num(r.mileage),
  }));
}

/** Verified install proofs per VIN for one product, or null when the read failed. */
export async function loadInstallProofCounts(tenantId: string, productId: string, vins: string[]): Promise<Record<string, number> | null> {
  if (vins.length === 0) return {};
  const { data, error } = await db()
    .from("install_proofs")
    .select("vehicle_vin")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .eq("is_verified", true)
    .in("vehicle_vin", vins);
  if (error) return null;
  const out: Record<string, number> = {};
  for (const v of vins) out[v.toUpperCase()] = 0;
  for (const row of (data ?? []) as Array<{ vehicle_vin: string }>) {
    const key = row.vehicle_vin.toUpperCase();
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

const KEY = "admin-v2";

export const useListingCounts = (tenantId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: [KEY, "pricing", "listing-counts", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: () => loadListingCounts(tenantId as string),
    staleTime: 30_000,
  });

export const useConsistency = (tenantId: string | null, configuredFee: number, mode: PriceDisplayMode, enabled: boolean) =>
  useQuery({
    queryKey: [KEY, "pricing", "consistency", tenantId, configuredFee, mode],
    enabled: enabled && !!tenantId,
    queryFn: () => loadConsistency(tenantId as string, configuredFee, mode),
    staleTime: 30_000,
  });

export const useWebsitePriceTerm = (tenantId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: [KEY, "pricing", "website-term", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: () => loadWebsitePriceTerm(tenantId as string),
    staleTime: 5 * 60_000,
  });

export const useFeePreview = (args: { tenantId: string | null; draft: FeeDraft | null; includeArchived: boolean; enabled: boolean }) =>
  useQuery({
    queryKey: [KEY, "pricing", "fee-preview", args.tenantId, args.draft?.enabled, args.draft?.amount, args.draft?.stateCode, args.includeArchived],
    enabled: args.enabled && !!args.tenantId && !!args.draft,
    queryFn: () => loadFeePreview(args.tenantId as string, args.draft as FeeDraft, args.includeArchived),
    staleTime: 0,
    gcTime: 0,
  });

export const usePolicyVersion = (tenantId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: [KEY, "pricing", "policy-version", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: () => loadPolicyVersion(tenantId as string),
    staleTime: 0,
  });

export const ADMIN_PRODUCTS_KEY = [KEY, "products"] as const;

export const useAdminProducts = (enabled: boolean) =>
  useQuery({
    queryKey: ADMIN_PRODUCTS_KEY,
    enabled,
    queryFn: loadAdminProducts,
    staleTime: 15_000,
  });

export const useProduct = (productId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: [KEY, "product", productId],
    enabled: enabled && !!productId,
    queryFn: () => loadProduct(productId as string),
    staleTime: 15_000,
  });

export const useSampleVehicles = (tenantId: string | null, limit: number, enabled: boolean) =>
  useQuery({
    queryKey: [KEY, "pricing", "sample-vehicles", tenantId, limit],
    enabled: enabled && !!tenantId,
    queryFn: () => loadSampleVehicles(tenantId as string, limit),
    staleTime: 60_000,
  });

export const useInstallProofCounts = (tenantId: string | null, productId: string | null, vins: string[], enabled: boolean) =>
  useQuery({
    queryKey: [KEY, "pricing", "install-proofs", tenantId, productId, vins.join(",")],
    enabled: enabled && !!tenantId && !!productId,
    queryFn: () => loadInstallProofCounts(tenantId as string, productId as string, vins),
    staleTime: 30_000,
  });
