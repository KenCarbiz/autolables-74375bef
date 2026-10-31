import { supabase } from "@/integrations/supabase/client";

export type Presence = "present" | "missing" | "retirement_review" | "retired" | "transferred";
export type SubscriptionStatus = "subscribed" | "unsubscribed" | "suspended";
export type EnrichmentMode = "feed_only" | "enrichment" | "paused";
export type Channel = "connect_card" | "customer_room";

export interface DealerGroup { id: string; tenant_id: string; name: string; legal_name: string | null; created_at: string; updated_at: string }

export interface DealerStore {
  id: string; group_id: string; tenant_id: string;
  display_name: string; legal_name: string | null;
  street: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null; website: string | null;
  status: "active" | "inactive";
  subscription_status: SubscriptionStatus;
  is_primary_inventory_store: boolean;
  inventory_feed_enabled: boolean;
  feed_import_paused: boolean;
  inventory_sharing_enabled: boolean;
  customer_browser_enabled: boolean;
  listing_sync_enabled: boolean;
  feed_price_updates_listing: boolean;
  adopt_legacy_matches: boolean;
  retirement_automation_enabled: boolean;
  missing_snapshot_threshold: number;
  max_invalid_rows: number;
  provider_ids: Record<string, unknown>;
  created_at: string; updated_at: string;
}

export interface InventoryStoreState {
  store_id: string; last_applied_snapshot_id: string | null; last_applied_source_mtime: string | null; last_applied_sha256: string | null;
  last_applied_at: string | null; last_run_id: string | null; last_failure_at: string | null; last_failure_reason: string | null; updated_at: string;
}

export interface InventorySourceMapping {
  id: string; provider: "vauto"; source_dealer_id: string; group_id: string; store_id: string;
  status: "pending" | "approved" | "revoked" | "rejected";
  observed_identity: Partial<SourceIdentity> | null; evidence: MappingEvidence | null;
  identity_acknowledged: boolean; note: string | null;
  proposed_at: string; approved_at: string | null; revoked_at: string | null; created_at: string; updated_at: string;
}

export interface MappingEvidence {
  verdict?: string; computed_by?: string; run_id?: string; path?: string; content_sha256?: string | null; remote_mtime?: string | null;
  store_updated_at?: string; counts?: Partial<PartitionCounts>; comparison?: MappingComparison; fields?: Record<string, string>;
}

export interface StoreInventoryRow {
  id: string; store_id: string; group_id: string; vin: string; stock_number: string | null;
  condition: "new" | "used" | "cpo"; certified: boolean;
  year: number | null; make: string | null; model: string | null; trim: string | null; mileage: number | null;
  feed_price: number | null; feed_price_status: "known" | "unknown" | "zero";
  presence: Presence; missing_snapshots: number; first_seen_at: string; last_seen_at: string;
  enrichment_status: "not_requested" | "queued" | "fresh" | "stale" | "blocked" | "failed";
}

export interface InventoryVinConflict {
  id: string; group_id: string; vin: string; kind: "other_store" | "legacy_listing" | "other_store_listing" | "archived_listing" | "reconciled_listing_unresolved";
  claiming_store_id: string; existing_store_id: string | null; existing_inventory_id: string | null; existing_listing_id: string | null;
  snapshot_id: string | null; status: "open" | "transferred" | "adopted" | "dismissed";
  first_seen_at: string; last_seen_at: string; resolved_at: string | null; note: string | null;
}

export interface InventoryFeedControls { id: 1; ingestion_paused: boolean; emergency_stop: boolean; reconcile_enabled: boolean; reason: string | null; updated_at: string }

export type JobStatus = "queued" | "running" | "succeeded" | "partial" | "skipped" | "failed" | "dead" | "cancelled";
export interface InventoryFeedJob {
  id: string; provider: string; path: string; kind: "import"; trigger: "webhook" | "reconcile" | "manual" | "retry";
  status: JobStatus; attempts: number; max_attempts: number; next_attempt_at: string; run_id: string | null;
  last_error: string | null; result: unknown; created_at: string; started_at: string | null; finished_at: string | null;
}

export type SnapshotStatus = "staged" | "applied" | "quarantined" | "rejected" | "superseded" | "failed";
export interface InventoryStoreSnapshot {
  id: string; run_id: string | null; job_id: string | null; path: string; source_dealer_id: string;
  store_id: string | null; group_id: string | null; mapping_id: string | null; clean: boolean;
  status: SnapshotStatus; reason: string | null;
  row_count: number; valid_count: number; invalid_count: number; duplicate_count: number; price_missing_count: number; photo_missing_count: number;
  created_at: string; applied_at: string | null;
}

export interface InventorySharingRule {
  id: string; group_id: string; source_store_id: string; destination_store_id: string; status: "active" | "revoked";
  connect_card: boolean; customer_room: boolean; include_new: boolean; include_used: boolean; include_certified: boolean;
  priority: number; show_prices: boolean; show_details: boolean;
  effective_from: string; effective_until: string | null; note: string | null; created_at: string; updated_at: string;
}

export const ENRICHMENT_PRODUCTS = [
  "basic_vin_decode", "neovin", "vin_history", "price_prediction", "inventory_search",
  "market_days_supply", "recent_inventory", "sales_stats", "auto_recalls", "cached_images",
] as const;
export type EnrichmentProduct = (typeof ENRICHMENT_PRODUCTS)[number];

export interface StoreEnrichmentPolicy {
  store_id: string; mode: EnrichmentMode; budget_blocked: boolean;
  credential_ref: "MARKETCHECK_API_KEY" | null; mc_rooftop_id: string | null; mc_rooftop_verified_at: string | null;
  allowed_products: string[];
  refresh_cadence_hours: number | null; freshness_hours: number | null;
  backfill_limit: number; per_run_limit: number; daily_request_limit: number; monthly_request_cap: number; monthly_usd_cap: number | null;
  warn_pct: number; hard_stop_pct: number; manual_refresh_allowed: boolean; enrich_shared_inventory: boolean; updated_at: string;
}

export interface StoreProviderUsage {
  id: number; at: string; store_id: string | null; group_id: string | null; provider: string; product: string; reason: string; caller: string;
  vin: string | null; outcome: "admitted" | "denied"; deny_reason: string | null; estimated_cost_usd: number | null; actual_cost_usd: number | null;
  cost_basis: "estimate" | "actual" | "unpriced";
}

export interface InventoryNetworkAudit {
  id: number; at: string; actor: string | null; group_id: string | null; store_id: string | null; entity: string; entity_id: string | null; action: string;
}

export interface FeedFile {
  id: string; path: string; status: string; quarantine_reason: string | null; remote_size: number | null; remote_mtime: string | null;
  latest_event_at: string | null; discovered_at: string | null; last_run_id: string | null; last_content_sha256?: string | null;
}
export interface FeedBinding { id: string; path: string; tenant_id: string | null; status: "pending" | "approved" | "disabled"; approved_at: string | null }
export interface FeedEvent { id: string; action: string; path: string; received_at: string }

export interface SourceIdentity { dealerId: string; dealerName: string; address: string; city: string; postal: string; region: string }
export type FieldVerdict = "match" | "mismatch" | "unknown";
export type Verdict = "match" | "mismatch" | "incomplete";
export interface IdentityComparison { verdict: Verdict; fields: { name: FieldVerdict; address: FieldVerdict; city: FieldVerdict; postal: FieldVerdict; region: FieldVerdict } }
export interface RowIssue { row: number; vin?: string; code: string; detail?: string }
export type PartitionOutcome = "ready" | "unmapped" | "mapping_pending" | "conflict" | "rejected";
export interface PartitionCounts { rows: number; valid: number; invalid: number; duplicateIdentical: number; duplicateConflicts: number; priceMissing: number; priceZero: number; photoMissing: number; new?: number; used?: number; cpo?: number }
export interface PartitionReportItem {
  sourceDealerId: string; identity: SourceIdentity; identityVariants: number;
  mapping: { id: string; status: "pending" | "approved"; storeId: string; storeName: string } | null;
  comparison: IdentityComparison | null;
  outcome: PartitionOutcome; reasons: string[]; counts: PartitionCounts; errors: RowIssue[]; warnings: RowIssue[];
  inventoryDiff: { compared: boolean; additions: number; updates: number; unchanged: number; absenceCandidates: number; shrinkGuard?: { held: boolean; live: number; absent: number; allowed: number } } | null;
}
export interface PartitionDryRunReport {
  kind: "partition_dry_run"; outcome: "passed" | "rejected"; rejectReasons: string[];
  headers: { missing: string[]; extra: string[] }; identities: number;
  partitions: PartitionReportItem[]; inventoryWrites: 0; providerCalls: 0;
}
export interface FeedRun {
  id: string; path: string; kind: "dry_run" | "import"; status: string; failure_reason: string | null;
  started_at: string; finished_at: string | null; affected_store_ids: string[]; job_id: string | null; report: PartitionDryRunReport | Record<string, unknown> | null;
  content_sha256?: string | null; remote_mtime?: string | null;
}

export interface StoreOverview {
  store: DealerStore;
  state: InventoryStoreState | null;
  policy: StoreEnrichmentPolicy | null;
  counts: { present: number; missing: number; retirement_review: number; retired: number; price_unknown: number; no_photos: number };
  mappings: Array<{ id: string; source_dealer_id: string; status: "pending" | "approved"; approved_at: string | null }>;
  open_conflicts: number;
  last_snapshot: { id: string; status: SnapshotStatus; reason: string | null; created_at: string; run_id: string | null } | null;
  sharing_out: number;
  sharing_in: number;
}
export interface InvOverview {
  group: DealerGroup | null;
  controls: InventoryFeedControls | null;
  stores: StoreOverview[];
  exceptions: { open_conflicts: number; retirement_review: number; quarantined_partitions_7d: number; failed_jobs: number; pending_mappings: number };
}

export interface InvUsage {
  today: { admitted: number; denied: number };
  month: { admitted: number; denied: number; estimated_usd: number; actual_usd: number | null; unpriced_calls: number };
  by_product: Array<{ product: string; reason: string; outcome: "admitted" | "denied"; deny_reason: string | null; calls: number; estimated_usd: number }>;
  queued_requests: number;
}
export interface PreviewAgent { id: string; name: string; title: string | null; status: string | null }
export interface PreviewContext { agents: PreviewAgent[] }

export interface GroupInventoryStoreRef { id: string; name: string; city: string | null; state: string | null }
export interface GroupInventoryVehicle {
  id: string; rank: number; inventory_group: "home" | "additional"; owning_store: GroupInventoryStoreRef;
  vin: string; stock_number: string | null; condition: "new" | "used" | "cpo"; certified: boolean;
  year: number | null; make: string | null; model: string | null; trim: string | null; mileage: number | null;
  exterior_color: string | null; interior_color: string | null;
  price: number | null; price_status: "hidden" | "known" | "unknown" | "zero";
  photo: string | null; photo_count: number; enrichment_status: string;
}
export type GroupInventoryData =
  | { enabled: false; reason: string }
  | { enabled: true; home_store: GroupInventoryStoreRef; additional_sources: Array<GroupInventoryStoreRef & { priority: number }>; total: number; vehicles: GroupInventoryVehicle[] };

export interface StoreDraft {
  id?: string; group_id?: string; expected_updated_at?: string;
  display_name?: string; legal_name?: string; street?: string; city?: string; state?: string; zip?: string; phone?: string; website?: string;
  status?: "active" | "inactive"; subscription_status?: SubscriptionStatus;
  is_primary_inventory_store?: boolean; inventory_feed_enabled?: boolean; feed_import_paused?: boolean; inventory_sharing_enabled?: boolean;
  customer_browser_enabled?: boolean; listing_sync_enabled?: boolean; feed_price_updates_listing?: boolean; adopt_legacy_matches?: boolean;
  retirement_automation_enabled?: boolean; missing_snapshot_threshold?: number; max_invalid_rows?: number;
}
export interface SharingRuleDraft {
  id?: string; source_store_id?: string; destination_store_id?: string;
  connect_card: boolean; customer_room: boolean; include_new: boolean; include_used: boolean; include_certified: boolean;
  priority: number; show_prices: boolean; show_details: boolean;
}
export interface EnrichmentPolicyDraft {
  store_id: string; mode: EnrichmentMode; budget_blocked: boolean; credential_ref: string; mc_rooftop_id: string; mc_rooftop_verified: boolean;
  allowed_products: string[]; refresh_cadence_hours: number | null; freshness_hours: number | null;
  backfill_limit: number; per_run_limit: number; daily_request_limit: number; monthly_request_cap: number; monthly_usd_cap: number | null;
  warn_pct: number; hard_stop_pct: number; manual_refresh_allowed: boolean; enrich_shared_inventory: boolean;
}

export interface PartitionDryRunResult { runId: string; status: string; report: PartitionDryRunReport }
export interface ImportPartitionResult {
  sourceDealerId: string; storeId: string | null; snapshotId: string | null;
  status: "applied" | "quarantined" | "rejected" | "superseded" | "failed"; reason: string | null; apply: Record<string, unknown> | null;
}
export interface ImportNowResult { jobId: string; status: string; result: { partitions: ImportPartitionResult[] } | null }

const RULES: Array<[RegExp, string]> = [
  [/preview_hash_mismatch/, "That preview changed. Reload it and review the exact version you want to approve."],
  [/preview_not_eligible/, "This set needs a person's decision outside automatic reconciliation, so it cannot be approved here."],
  [/preview_not_pending/, "This preview was already approved, applied or invalidated."],
  [/idempotency_key_reused/, "That request key belongs to another action. Reload and try again."],
  [/undo_plan_changed/, "The records changed while you were reviewing. Reload the recovery plan."],
  [/dedupe_detection_disabled/, "Duplicate detection is switched off."],
  [/listing_reconciled_archived/, "This listing was archived as a duplicate. Use the reviewed recovery flow to reopen it."],
  [/inventory_dedupe_auto_needs_limits/, "Automatic reconciliation needs owner-approved limits first."],
  [/batch_previews_must_be_approved/, "Every set in a batch must have an approved, current preview."],
  [/platform_admin_required|permission denied|row-level security|42501/i, "Only platform administrators can do this. Sign in with a platform administrator account."],
  [/could not find the function|schema cache|function public\.\S+ does not exist|relation "?\S+"? does not exist|42883|42P01/i, "The inventory network database update has not been applied to this project yet."],
  [/identity_not_confirmed/, "The address matches but the dealer name differs. Tick the name acknowledgement to approve."],
  [/identity_mismatch/, "The street, city, state or ZIP in the file does not match this store. A mismatch can never be approved. Fix the store identity or map a different store."],
  [/identity_incomplete/, "A field is missing on the file or the store, so the identity cannot be confirmed. Complete the store identity and review again."],
  [/store_identity_changed_since_review/, "The store identity was edited after this proposal was reviewed. Reject it and propose again."],
  [/file_changed_since_review/, "The feed file changed after this proposal was reviewed. Run a new dry run and propose again."],
  [/proposal_predates_server_review/, "This proposal was made before server-checked review. Reject it and propose again from a dry run."],
  [/dry_run_required/, "Run a partition dry run first. A mapping is only proposed from a stored dry run."],
  [/dry_run_not_found/, "That dry run no longer exists. Run a new dry run."],
  [/not_a_partition_dry_run/, "That run is not a partition dry run. Run a dry run from Feed mapping."],
  [/dry_run_not_passed/, "That dry run did not pass, so it cannot support a mapping. Fix the feed and run it again."],
  [/test_file_cannot_be_mapped/, "Test files are never mapped to a store."],
  [/dealer_not_in_dry_run/, "That DealerId is not in this dry run. Run a new dry run."],
  [/partition_identity_inconsistent/, "This DealerId appears with more than one dealer identity in the file. Ask the feed provider to fix it before mapping."],
  [/file_admitted_to_another_group/, "This file is bound to a different dealer group. Map it to a store in that group, or change the file binding first."],
  [/mapping_already_open/, "This DealerId already has a pending or approved mapping. Reject or revoke it first."],
  [/store_changed_since_loaded/, "This store was changed by someone else after you opened it. Reload it, re-apply your edits and save again."],
  [/sharing_across_groups_forbidden/, "Stores can only share inventory with other stores in the same dealer group."],
  [/sharing_rule_not_active/, "That sharing rule was already revoked or changed. Reload the page."],
  [/sharing_rule_direction_immutable|sharing_rule_revoked/, "A revoked rule cannot be reopened. Create a new rule instead."],
  [/reason_required/, "Enter a reason of at least three characters."],
  [/store_not_found/, "That store no longer exists. Reload the page."],
  [/store_group_not_found/, "The dealer group for this store was not found."],
  [/store_group_change_forbidden/, "A store cannot move to a different dealer group."],
  [/mapping_store_outside_group/, "A source dealer can only be mapped to a store in the same dealer group."],
  [/mapping_identity_immutable|mapping_closed/, "That mapping is closed. Propose a new mapping instead."],
  [/mapping_not_found/, "That mapping no longer exists. Reload the page."],
  [/mapping_not_pending/, "That mapping has already been decided. Reload the page."],
  [/mapping_not_approved/, "Only an approved mapping can be revoked."],
  [/inventory_source_mappings_live/, "That source dealer ID already has a pending or approved mapping. Reject or revoke it first."],
  [/dealer_stores_one_primary/, "Another store in this group is already the primary inventory store. Unset it there first."],
  [/dealer_stores_group_name/, "A store with that name already exists in this group."],
  [/dealer_stores_state_check/, "State must be a two-letter code such as CT."],
  [/dealer_stores_zip_check/, "ZIP must be five digits, or ZIP+4 such as 06475-1234."],
  [/dealer_stores_display_name_check/, "The store name must be between 2 and 120 characters."],
  [/missing_snapshot_threshold/, "The missing snapshot threshold must be between 2 and 30."],
  [/max_invalid_rows/, "Max invalid rows must be between 0 and 100."],
  [/dealer_stores_check/, "Customer browser and listing sync are only available to subscribed stores."],
  [/inventory_sharing_rules_active/, "An active sharing rule already exists for this pair of stores."],
  [/inventory_sharing_rules_priority_check/, "Priority must be between 1 and 1000."],
  [/store_enrichment_policies_check|store_enrichment_policies_mode/, "Enrichment needs a credential, a verified MarketCheck rooftop, at least one product, and daily and monthly request caps above zero."],
  [/warn_pct|hard_stop_pct/, "Warning percent must be between 1 and 100 and cannot exceed the hard-stop percent."],
  [/allowed_products/, "One of the selected MarketCheck products is not approved for stores."],
  [/credential_ref/, "Only the MARKETCHECK_API_KEY credential can be selected."],
  [/mc_rooftop_id/, "The MarketCheck rooftop ID may only contain letters, numbers and . _ : -."],
  [/conflict_not_open/, "That conflict was already resolved. Reload the page."],
  [/bad_conflict_action/, "That action does not apply to this kind of conflict."],
  [/not_in_retirement_review/, "That vehicle is no longer waiting for retirement review."],
  [/job_not_retryable/, "Only failed, dead or cancelled jobs can be retried."],
  [/bad_channel/, "Choose Connect Card or Customer room."],
  [/FILESCOM_API_KEY_missing/, "The Files.com read-only API key is not saved yet."],
  [/binding_already_approved_disable_first/, "This file already has an approved mapping. Disable it before proposing another."],
  [/proposal_changed_concurrently/, "The proposal changed while you were approving it. Reload and review it again."],
  [/file_not_discovered/, "Discover files first, then try again."],
  [/already_validating/, "A check is already running for this file. Wait for it to finish."],
  [/emergency_stop/, "Emergency stop is on. Release it from the Overview before importing."],
  [/ingestion_paused/, "Ingestion is paused. Resume it from the Overview before importing."],
  [/binding_not_approved/, "Approve the file mapping before importing."],
  [/no_pending_binding|binding_not_pending/, "Propose a mapping for this file first."],
  [/paid_enrichment_requires_verified_catalog/, "Paid enrichment timing stays off until every enabled MarketCheck product has a verified rate, a known repeat policy and a known retention right. Verify the Provider catalog first."],
  [/filescom_imports_never_trigger_enrichment/, "Files.com inventory imports never start paid MarketCheck lookups, so enrichment timing must stay off for this integration."],
  [/evidence_required/, "Add at least 10 characters of evidence before marking a product verified."],
  [/contract_evidence_required/, "Add at least 10 characters of contract evidence before marking a feed as contracted."],
  [/resolution_required/, "Enter a resolution of at least three characters."],
  [/account_not_found/, "That provider account was not found."],
  [/product_not_found/, "That catalog product was not found."],
  [/tool_not_found/, "That AI tool was not found."],
  [/unknown_required_field/, "One of the required fields is not a known provider field."],
  [/provider_accounts_check/, "The protected reserve must be lower than the monthly call quota."],
  [/provider_product_catalog_check/, "A verified rate needs a rate, evidence and verification. A free repeat also needs a repeat window."],
  [/bulk_feed_contracts_check/, "A feed can only be contracted with evidence, and only enabled when contracted and storage rights are known."],
  [/integration_timing_check/, "A scheduled mode needs its schedule, and a delivery schedule needs a time zone."],
  [/violates check constraint/i, "One of the values is outside the allowed range or combination. Review the form and try again."],
  [/duplicate key|already exists/i, "That record already exists."],
  [/violates foreign key/i, "That record is still referenced elsewhere and cannot be changed this way."],
  [/invalid input syntax/i, "One of the values has the wrong format."],
];

export function friendlyMessage(raw: string): string {
  const bulk = /bulk_requires_verified_catalog:?\s*(.*)/.exec(raw);
  if (bulk) {
    const names = bulk[1].trim();
    return `Bulk, backfill and scheduled refresh stay off until every approved product has a verified rate, a known repeat policy and a known retention right${names ? ` (still unverified: ${names})` : ""}. Verify them in the Provider catalog.`;
  }
  for (const [re, text] of RULES) if (re.test(raw)) return text;
  if (/^[a-z][a-z0-9_]{2,60}$/.test(raw)) return `${raw.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}.`;
  return "Something went wrong. Try again, and check Runs and exceptions if it keeps happening.";
}

export class FriendlyError extends Error {}

export function explainError(e: unknown): string {
  if (e instanceof FriendlyError) return e.message;
  return friendlyMessage(e instanceof Error ? e.message : typeof e === "string" ? e : "");
}

interface RawResult { data: unknown; error: { message: string } | null }
interface Query extends PromiseLike<RawResult> {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
}
const db = supabase as unknown as {
  from: (table: string) => Query;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RawResult>;
};

async function rows<T>(q: Query): Promise<T[]> {
  const r = await q;
  if (r.error) throw new FriendlyError(friendlyMessage(r.error.message));
  return (r.data ?? []) as T[];
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await db.rpc(fn, args);
  if (r.error) throw new FriendlyError(friendlyMessage(r.error.message));
  return r.data as T;
}

export const listGroups = () => rows<DealerGroup>(db.from("dealer_groups").select("*").order("name"));
export const listStores = (groupId: string) => rows<DealerStore>(db.from("dealer_stores").select("*").eq("group_id", groupId).order("display_name"));
export const listStoreState = () => rows<InventoryStoreState>(db.from("inventory_store_state").select("*"));
export const listSourceMappings = (groupId: string) => rows<InventorySourceMapping>(db.from("inventory_source_mappings").select("*").eq("group_id", groupId).order("created_at", { ascending: false }).limit(200));
export const listStoreInventory = (storeId: string, presence: Presence) =>
  rows<StoreInventoryRow>(db.from("store_inventory").select("id,store_id,group_id,vin,stock_number,condition,certified,year,make,model,trim,mileage,feed_price,feed_price_status,presence,missing_snapshots,first_seen_at,last_seen_at,enrichment_status").eq("store_id", storeId).eq("presence", presence).order("last_seen_at", { ascending: false }).limit(200));
export const listRetirementReview = (groupId: string) =>
  rows<StoreInventoryRow>(db.from("store_inventory").select("id,store_id,group_id,vin,stock_number,condition,certified,year,make,model,trim,mileage,feed_price,feed_price_status,presence,missing_snapshots,first_seen_at,last_seen_at,enrichment_status").eq("group_id", groupId).eq("presence", "retirement_review").order("last_seen_at", { ascending: false }).limit(200));
export const listConflicts = (groupId: string) => rows<InventoryVinConflict>(db.from("inventory_vin_conflicts").select("*").eq("group_id", groupId).eq("status", "open").order("first_seen_at", { ascending: false }).limit(200));
export const listFeedControls = () => rows<InventoryFeedControls>(db.from("inventory_feed_controls").select("*"));
export const listFeedJobs = (limit = 100) => rows<InventoryFeedJob>(db.from("inventory_feed_jobs").select("*").order("created_at", { ascending: false }).limit(limit));
export const listSnapshots = (limit = 100) =>
  rows<InventoryStoreSnapshot>(db.from("inventory_store_snapshots").select("id,run_id,job_id,path,source_dealer_id,store_id,group_id,mapping_id,clean,status,reason,row_count,valid_count,invalid_count,duplicate_count,price_missing_count,photo_missing_count,created_at,applied_at").order("created_at", { ascending: false }).limit(limit));
export const listSharingRules = (groupId: string) => rows<InventorySharingRule>(db.from("inventory_sharing_rules").select("*").eq("group_id", groupId).eq("status", "active").order("priority"));
export const listEnrichmentPolicies = () => rows<StoreEnrichmentPolicy>(db.from("store_enrichment_policies").select("*"));
export const listProviderUsage = (storeId: string) => rows<StoreProviderUsage>(db.from("store_provider_usage").select("*").eq("store_id", storeId).order("at", { ascending: false }).limit(100));
export const listAudit = (groupId: string) => rows<InventoryNetworkAudit>(db.from("inventory_network_audit").select("id,at,actor,group_id,store_id,entity,entity_id,action").eq("group_id", groupId).order("at", { ascending: false }).limit(100));
export const listFeedFiles = () => rows<FeedFile>(db.from("inventory_feed_files").select("id,path,status,quarantine_reason,remote_size,remote_mtime,latest_event_at,discovered_at,last_run_id,last_content_sha256").order("path"));
export const listAllStores = () => rows<DealerStore>(db.from("dealer_stores").select("*").order("display_name"));
export const listOpenMappings = () => rows<InventorySourceMapping>(db.from("inventory_source_mappings").select("*").in("status", ["pending", "approved"]).order("created_at", { ascending: false }).limit(500));
export const listFeedBindings = () => rows<FeedBinding>(db.from("inventory_feed_bindings").select("id,path,tenant_id,status,approved_at").order("path"));
export const listFeedEvents = (limit = 100) => rows<FeedEvent>(db.from("inventory_feed_events").select("id,action,path,received_at").order("received_at", { ascending: false }).limit(limit));
export const listFeedRuns = (opts: { limit?: number; withReport?: boolean } = {}) =>
  rows<FeedRun>(db.from("inventory_feed_runs").select(`id,path,kind,status,failure_reason,started_at,finished_at,affected_store_ids,job_id,content_sha256,remote_mtime${opts.withReport ? ",report" : ""}`).order("started_at", { ascending: false }).limit(opts.limit ?? 100));

export const getOverview = (groupId: string) => rpc<InvOverview | null>("inv_admin_overview", { p_group_id: groupId });
export const getUsage = (storeId: string) => rpc<InvUsage | null>("inv_admin_usage", { p_store_id: storeId });
export const getPreviewContext = (storeId: string) => rpc<PreviewContext | null>("inv_admin_preview_context", { p_store_id: storeId });
export const getPreviewInventory = (storeId: string, channel: Channel, filters: Record<string, unknown> = {}) =>
  rpc<GroupInventoryData | null>("inv_admin_preview_customer_inventory", { p_home_store_id: storeId, p_channel: channel, p_filters: filters });

export const saveStore = (draft: StoreDraft) => rpc<string>("inv_admin_save_store", { p: draft });
export const setControls = (c: { ingestion_paused: boolean; emergency_stop: boolean; reconcile_enabled: boolean }, reason: string) =>
  rpc<void>("inv_admin_set_controls", { p_ingestion_paused: c.ingestion_paused, p_emergency_stop: c.emergency_stop, p_reconcile_enabled: c.reconcile_enabled, p_reason: reason });
export const proposeMapping = (a: { sourceDealerId: string; storeId: string; runId: string; note?: string }) =>
  rpc<string>("inv_admin_propose_mapping", { p_source_dealer_id: a.sourceDealerId, p_store_id: a.storeId, p_observed_identity: {}, p_evidence: { run_id: a.runId }, p_note: a.note ?? null });
export const previewMapping = (sourceDealerId: string, storeId: string, runId: string) =>
  rpc<MappingPreview | null>("inv_admin_preview_mapping", { p_source_dealer_id: sourceDealerId, p_store_id: storeId, p_run_id: runId });
export const decideMapping = (mappingId: string, decision: "approve" | "reject" | "revoke", acknowledgeIdentity = false) =>
  rpc<void>("inv_admin_decide_mapping", { p_mapping_id: mappingId, p_decision: decision, p_acknowledge_identity: acknowledgeIdentity, p_note: null });
export const saveSharingRule = (draft: SharingRuleDraft) => rpc<string>("inv_admin_save_sharing_rule", { p: draft });
export const revokeSharingRule = (ruleId: string) => rpc<void>("inv_admin_revoke_sharing_rule", { p_rule_id: ruleId, p_note: null });
export const saveEnrichmentPolicy = (draft: EnrichmentPolicyDraft) => rpc<void>("inv_admin_save_enrichment_policy", { p: draft });
export const resolveConflict = (conflictId: string, action: "transfer" | "adopt" | "dismiss") => rpc<void>("inv_admin_resolve_conflict", { p_conflict_id: conflictId, p_action: action, p_note: null });
export const reviewRetirement = (inventoryId: string, action: "retire" | "keep") => rpc<void>("inv_admin_review_retirement", { p_inventory_id: inventoryId, p_action: action });
export const retryJob = (jobId: string) => rpc<unknown>("inv_admin_retry_job", { p_job_id: jobId });
export const enqueueImport = (path: string) => rpc<unknown>("inv_admin_enqueue_import", { p_path: path });

async function filesAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("files-inventory-admin", { body });
  if (error) {
    let code = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) code = ((await ctx.json()) as { error?: string }).error ?? code;
    } catch { /* keep message */ }
    throw new FriendlyError(friendlyMessage(code));
  }
  return data as T;
}

export const filesOverview = () => filesAdmin<{ config: { secrets: Record<string, boolean> } }>({ action: "overview" });
export const discoverFiles = () => filesAdmin<Record<string, unknown>>({ action: "discover" });
export const partitionDryRun = (path: string) => filesAdmin<PartitionDryRunResult>({ action: "partition_dry_run", path });
export const importNow = (path: string) => filesAdmin<ImportNowResult>({ action: "import_now", path });
export const proposeBinding = (path: string, tenantId: string) => filesAdmin<{ ok: true }>({ action: "propose_binding", path, tenant_id: tenantId });
export const approveBinding = (path: string, acknowledgeIdentity: boolean) => filesAdmin<{ ok: true }>({ action: "approve_binding", path, acknowledge_identity: acknowledgeIdentity });
export const disableBinding = (path: string) => filesAdmin<{ ok: true }>({ action: "disable_binding", path });

export const isPartitionReport = (r: FeedRun["report"]): r is PartitionDryRunReport => !!r && (r as { kind?: string }).kind === "partition_dry_run";

export const PILOT_ACCOUNT = "marketcheck_primary";

export interface ProviderAccount {
  account_ref: string; plan_name: string | null; pilot_mode: boolean; monthly_call_quota: number; protected_reserve: number;
  priority_floors: Record<string, number>; monthly_usd_cap: number | null; rate_limit_per_minute: number; uncertain_retry_hold_hours: number;
  provider_reported_limit: number | null; provider_reported_used: number | null; provider_reported_remaining: number | null; provider_reset_at: string | null; provider_reported_at: string | null;
}
export interface PilotDashboard {
  account: ProviderAccount;
  period: { start: string; end: string; source: "provider_reset" | "assumed_utc_month" };
  calls: {
    quota: number; consumed: number; billing_uncertain: number; reserved: number; external_unattributed: number; available: number; protected: number; spendable: number;
    provider_reported_used: number | null; provider_reported_remaining: number | null; provider_reported_at: string | null;
  };
  usd: { spent: number | string | null; committed: number | string | null; cap: number | string | null; basis: string };
  projection: { calls_per_day: number; exhausts_spendable_at: string | null; exhausts_before_period_end: boolean };
  by_outcome: Record<string, number>;
  by_channel: Record<string, number>;
  free_refreshes: number;
  by_store_product: Array<{ store_id: string | null; store_name: string | null; product_key: string; calls: number; refused: number; avoided: number; usd: number | string }>;
  refusals: Record<string, number>;
  pending: Array<{ kind: "reservation" | "queued_request"; id: string; product_key: string | null; reason: string | null; priority?: number; store_id: string | null; vin: string | null; estimated_cost_usd: number | string | null; expires_at?: string | null }>;
  repeat_pulls: Array<{ vin: string; product_key: string; paid_calls: number; first_at: string; last_at: string }>;
  catalog_review: Array<{ product_key: string; label: string; rate_status: string; repeat_charge_policy: string; retention_policy: string; cross_store_reuse: string; customer_display: string; verified_at: string | null }>;
}
export interface ProviderRequestHistory {
  id: string; at: string; product_key: string; caller: string; reason: string; priority: number; channel?: string | null; status: string; refusal_reason: string | null;
  free_refresh: boolean; http_status: number | null; estimated_cost_usd: number | string | null; actual_cost_usd: number | string | null; store: string | null;
}
export interface VehicleProviderState {
  account_ref: string; vin: string; product_key: string; state: string; attempts: number; last_attempt_at: string | null; next_eligible_at: string | null;
  partial_fields: string[]; confidence: number | string | null; confidence_scale: "fraction" | "percent" | "unknown" | null; data_delivery_date: string | null; detail: string | null;
}
export interface VehicleProviderHistory { requests: ProviderRequestHistory[]; states: VehicleProviderState[] }
export interface ProviderAiTool { tool_name: string; label: string; product_keys: string[]; max_requests_per_invocation: number; staff_enabled: boolean; allowed_for_automation: boolean; note: string | null }

export type Right3 = "permitted" | "prohibited" | "unknown";
export type RateStatus = "verified" | "list_price_estimate" | "placeholder" | "unknown";
export type RepeatPolicy = "charged" | "free_within_window" | "discounted" | "unknown";
export interface CatalogProductRow {
  account_ref: string; product_key: string; billing_product: string; label: string; endpoint: string; bundled_fields: string[];
  billing_unit: string; quota_units: number; rate_usd: number | null; rate_status: RateStatus; initial_charge_usd: number | null;
  repeat_charge_policy: RepeatPolicy; repeat_charge_usd: number | null; repeat_window_days: number | null; repeat_allowance: number | null;
  repeat_consumes_quota: "yes" | "no" | "unknown";
  retention_policy: "permitted" | "limited" | "prohibited" | "unknown"; retention_days: number | null;
  cross_store_reuse: Right3; customer_display: Right3;
  update_cadence: string; freshness_days: number | null; enabled: boolean; evidence: string | null; evidence_url: string | null; verified_at: string | null; updated_at: string;
}
export interface FieldDefinition { field_key: string; label: string; semantic_kind: string; description: string; cadence: string }
export interface CatalogProductDraft {
  account_ref: string; product_key: string; rate_usd: number | null; rate_status: RateStatus; billing_unit: string; quota_units: number; initial_charge_usd: number | null;
  repeat_charge_policy: RepeatPolicy; repeat_charge_usd: number | null; repeat_window_days: number | null; repeat_allowance: number | null; repeat_consumes_quota: string;
  retention_policy: string; retention_days: number | null; cross_store_reuse: string; customer_display: string; freshness_days: number | null; enabled: boolean;
  evidence: string; evidence_url: string; mark_verified: boolean;
}

export interface IntegrationTiming {
  integration_key: string; integration: "filescom_inventory" | "marketcheck_api" | "marketcheck_bulk";
  expected_delivery_cron: string | null; expected_delivery_tz: string | null; delivery_grace_minutes: number;
  import_mode: "on_completion" | "scheduled" | "manual"; import_cron: string | null; reconciliation_cron: string | null;
  enrichment_mode: "off" | "after_import" | "scheduled"; enrichment_cron: string | null; note: string | null; updated_at: string;
}
export interface BulkContract {
  feed_key: string; label: string; format: "csv" | "jsonl" | "parquet"; compression: "none" | "gzip" | "zstd"; delivery_method: "sftp" | "s3" | "https" | "webhook";
  delivery_scope: "full" | "delta"; data_refresh_cadence: string | null; contracted: boolean; contract_evidence: string | null; contract_verified_at: string | null;
  storage_rights: "permitted" | "limited" | "prohibited" | "unknown"; retention_days: number | null; replay_rights: Right3; sharing_rights: Right3; customer_display: Right3;
  webhook_secret_ref: string | null; enabled: boolean;
}
export interface BulkSchemaVersion {
  feed_key: string; version: string; release_kind: string; status: "upcoming" | "current" | "deprecated" | "retired";
  effective_at: string | null; validation_deadline: string | null; validated_at: string | null; deprecated_fields: string[];
}
export interface BulkDelivery {
  id: string; feed_key: string; environment: "production" | "release_test"; delivery_key: string; scope: string; schema_version: string | null; status: string;
  expected_parts: number | null; received_parts: number; verified_parts: number; completion_evidence: string; row_count: number | null; expected_row_count: number | null;
  expected_at: string | null; received_at: string | null; completed_at: string | null; validated_at: string | null; imported_at: string | null; enriched_at: string | null;
  replay_of: string | null; error: string | null;
}
export interface TimelineFilesRun { id: string; path: string; kind: string; status: string; started_at: string; finished_at: string | null; affected_store_ids: string[]; failure_reason: string | null }
export interface BulkException { id: number; feed_key: string | null; delivery_id: string | null; kind: string; severity: "info" | "warning" | "blocking"; detail: string | null; opened_at: string }
export interface DeliveryTimeline {
  timing: IntegrationTiming[]; contracts: Array<Partial<BulkContract>>; schemas: BulkSchemaVersion[]; bulk_deliveries: BulkDelivery[]; filescom_runs: TimelineFilesRun[]; exceptions: BulkException[];
}
export interface TimingDraft {
  integration_key: string; integration: IntegrationTiming["integration"]; expected_delivery_cron: string; expected_delivery_tz: string; delivery_grace_minutes: number;
  import_mode: string; import_cron: string; reconciliation_cron: string; enrichment_mode: string; enrichment_cron: string; note: string;
}
export interface BulkContractDraft {
  feed_key: string; label: string; format: string; compression: string; delivery_method: string; delivery_scope: string; data_refresh_cadence: string;
  storage_rights: string; retention_days: number | null; replay_rights: string; sharing_rights: string; customer_display: string; webhook_secret_ref: string;
  enabled: boolean; mark_contracted: boolean; contract_evidence: string;
}
export interface ProviderAccountDraft {
  account_ref: string; plan_name: string; pilot_mode: boolean; monthly_call_quota: number; protected_reserve: number; priority_floors: Record<string, number>;
  monthly_usd_cap: number | null; rate_limit_per_minute: number; uncertain_retry_hold_hours: number;
}

export const getPilotDashboard = (ref = PILOT_ACCOUNT) => rpc<PilotDashboard | null>("inv_admin_provider_dashboard", { p_account_ref: ref });
export const getVehicleHistory = (vin: string) => rpc<VehicleProviderHistory | null>("inv_admin_vehicle_provider_history", { p_vin: vin });
export const resetVehicleState = (ref: string, vin: string, productKey: string) => rpc<void>("inv_admin_reset_vehicle_state", { p_account_ref: ref, p_vin: vin, p_product_key: productKey });
export const saveProviderAccount = (draft: ProviderAccountDraft) => rpc<void>("inv_admin_save_provider_account", { p: draft });
export const listAiTools = () => rows<ProviderAiTool>(db.from("provider_ai_tools").select("*").order("tool_name"));
export const saveAiTool = (name: string, enabled: boolean, maxRequests: number | null) => rpc<void>("inv_admin_save_ai_tool", { p_tool_name: name, p_staff_enabled: enabled, p_max_requests: maxRequests });
export const listCatalog = (ref = PILOT_ACCOUNT) => rows<CatalogProductRow>(db.from("provider_product_catalog").select("*").eq("account_ref", ref).order("product_key"));
export const listFieldDefinitions = () => rows<FieldDefinition>(db.from("provider_field_definitions").select("*").order("field_key"));
export const saveCatalogProduct = (draft: CatalogProductDraft) => rpc<void>("inv_admin_save_catalog_product", { p: draft });
export const getDeliveryTimeline = (limit = 50) => rpc<DeliveryTimeline | null>("inv_admin_delivery_timeline", { p_limit: limit });
export const listBulkContracts = () => rows<BulkContract>(db.from("bulk_feed_contracts").select("*").order("feed_key"));
export const saveTiming = (draft: TimingDraft) => rpc<void>("inv_admin_save_timing", { p: draft });
export const saveBulkContract = (draft: BulkContractDraft) => rpc<void>("inv_admin_save_bulk_contract", { p: draft });
export const resolveBulkException = (id: number, resolution: string) => rpc<void>("inv_admin_resolve_bulk_exception", { p_id: id, p_resolution: resolution });

export type MappingVerdict = "match" | "name_review" | "incomplete" | "mismatch";
export interface MappingComparison {
  verdict: MappingVerdict;
  fields: { street?: FieldVerdict; city?: FieldVerdict; state?: FieldVerdict; zip?: FieldVerdict; name?: "match" | "differs" | "unknown" };
  observed?: { name: string | null; street: string | null; city: string | null; state: string | null; zip: string | null };
  store?: { name: string | null; legal_name: string | null; street: string | null; city: string | null; state: string | null; zip: string | null };
  store_updated_at?: string;
  reason?: string;
}
export interface MappingPreview {
  partition: PartitionReportItem; run_id: string; path: string; content_sha256: string | null; remote_mtime: string | null; finished_at: string | null; comparison: MappingComparison;
}

export const isTestPath = (path: string) => /webhooktest/i.test(path);
export const isSetupError = (e: unknown) => explainError(e) === friendlyMessage("42883");

// -- Duplicate reconciliation (migration 0014) ---------------------------------

export type DedupeKind = "duplicate_listings" | "unlinked_inventory" | "archived_episode" | "broken_link" | "cross_tenant" | "store_identity";
export type DedupeDisposition = "eligible" | "needs_review" | "blocked";
export type DedupeVerb = "KEEP" | "LINK" | "PRESERVE" | "ARCHIVE" | "BLOCKED";

export interface DedupeControls {
  detection_enabled: boolean; auto_reconcile_enabled: boolean; purge_enabled: boolean; emergency_stop: boolean;
  max_sets_per_run: number; max_store_share_pct: number; max_unresolved_conflicts: number; max_failures: number;
  preview_ttl_minutes: number; approval_ttl_minutes: number; limits_approved_at: string | null; reason: string | null; updated_at: string;
}
export interface DedupeCandidate {
  id: string; store_id: string | null; store_name: string | null; vin_suffix: string; kind: DedupeKind; status: "open" | "resolved";
  disposition: DedupeDisposition; reasons: string[]; first_seen_at: string; last_checked_at: string;
  summary: { action?: string; canonical_listing_id?: string | null; redundant_listing_ids?: string[]; inventory_id?: string | null; listing_count?: number };
  vehicle: { year: number | null; make: string | null; model: string | null; trim: string | null; stock_number: string | null } | null;
  listing_ymm: string | null;
}
export interface DedupePreviewRow {
  id: string; candidate_id: string | null; vin_suffix: string; kind: DedupeKind; action: string; disposition: DedupeDisposition;
  status: "pending" | "approved" | "applied" | "rejected" | "invalidated"; status_reason: string | null; created_at: string; expires_at: string;
  approval_expires_at: string | null; plan_sha256: string; applied_operation_id: string | null;
}
export interface DedupeOperation {
  id: string; kind: "apply" | "undo"; status: "applied" | "rejected" | "failed"; reason: string | null; action: string | null; vin_suffix: string;
  preview_id: string | null; undo_of: string | null; batch_id: string | null; created_at: string; result: Record<string, unknown>; undone: boolean;
}
export interface DedupeAlias { alias_listing_id: string; canonical_listing_id: string; vin_suffix: string; alias_slug: string | null; operation_id: string; created_at: string; retired_at: string | null }
export interface DedupeBatch { batch_id: string; status: string; stop_reason: string | null; total: number; applied: number; failed: number; skipped: number; pending: number }
export interface DedupeOverview {
  controls: DedupeControls; policy_version: string; last_checked_at: string | null;
  store_controls: Array<{ store_id: string; paused: boolean; reason: string | null; updated_at: string }>;
  candidates: DedupeCandidate[]; previews: DedupePreviewRow[]; operations: DedupeOperation[]; reconciled: DedupeAlias[]; batches: DedupeBatch[];
}
export interface DedupeListing {
  id: string; slug: string | null; status: string; owning_store_id: string | null; inventory_record_id: string | null; feed_source: string | null;
  ymm: string | null; trim: string | null; condition: string | null; mileage: number | null; price: number | null; created_at: string | null; published_at: string | null;
  archived_at: string | null; archive_reason: string | null; market_value: number | null; market_checked_at: string | null;
}
export interface DedupeScore { protected: number; public_identity: number; evidence: number; side_effect: number; unchecked: number; published: boolean; linked: boolean; established: boolean }
export interface DedupePlan {
  policy_version: string; preview_id: string; expires_at: string; generated_at: string; vin_suffix: string; store_name: string | null; kind: DedupeKind;
  action: string; disposition: DedupeDisposition; reasons: string[]; canonical_listing_id: string | null; redundant_listing_ids: string[]; inventory_id: string | null;
  listings: DedupeListing[]; inventory: { id: string; presence: string; listing_id: string | null; stock_number: string | null; first_seen_at: string; last_seen_at: string; enrichment_status: string } | null;
  scores: Record<string, DedupeScore>; decisions: Array<{ record: string; id?: string; verb: DedupeVerb; why: string }>;
  domains: Array<Record<string, unknown> & { domain: string; authority: string; effective_source: string }>;
  conflicts: Array<{ field: string; canonical: unknown; redundant: unknown; rule: string }>;
  blocked_dependencies: Array<{ listing_id: string; table: string; label: string; class: string; count: number | null }>;
  expected_counts: Record<string, number>; provider_calls: number; storage_operations: number; fingerprint: string;
}
export interface DedupePreview {
  id: string; status: DedupePreviewRow["status"]; status_reason: string | null; plan_sha256: string; expires_at: string; approval_expires_at: string | null;
  approved_at: string | null; applied_operation_id: string | null; plan: DedupePlan;
}
export interface DedupeRecoveryPlan {
  operation_id?: string; reversible: boolean; reason: string | null; plan_sha256?: string;
  changed_since?: Array<{ record: string; id: string; changed_fields: string[] }>; restores?: Record<string, string>; not_restored?: string[];
}
export interface DedupeApplyResult { applied?: boolean; replayed?: boolean; reason?: string; operation_id?: string; archived_listing_ids?: string[]; canonical_listing_id?: string }

export const getDedupeOverview = (groupId: string) => rpc<DedupeOverview>("inv_dedupe_overview", { p_group_id: groupId });
export const runDedupeScan = (groupId: string) => rpc<{ candidates: number; checked_at: string }>("inv_dedupe_scan", { p_group_id: groupId });
export const createDedupePreview = (candidateId: string) => rpc<{ preview_id: string; plan_sha256: string; expires_at: string }>("inv_dedupe_create_preview", { p_candidate_id: candidateId });
export const getDedupePreview = (previewId: string) => rpc<DedupePreview>("inv_dedupe_get_preview", { p_preview_id: previewId });
export const approveDedupePreview = (previewId: string, sha: string) => rpc<{ approved: boolean; reason?: string }>("inv_dedupe_approve", { p_preview_id: previewId, p_plan_sha256: sha });
export const applyDedupePreview = (previewId: string, idempotencyKey: string) => rpc<DedupeApplyResult>("inv_dedupe_apply", { p_preview_id: previewId, p_idempotency_key: idempotencyKey });
export const getDedupeRecoveryPlan = (operationId: string) => rpc<DedupeRecoveryPlan>("inv_dedupe_recovery_plan", { p_operation_id: operationId });
export const undoDedupeOperation = (operationId: string, sha: string, idempotencyKey: string) =>
  rpc<{ undone: boolean; reason?: string }>("inv_dedupe_undo", { p_operation_id: operationId, p_plan_sha256: sha, p_idempotency_key: idempotencyKey });
export const setDedupeControls = (patch: { detection_enabled?: boolean; emergency_stop?: boolean }, reason: string) => rpc<void>("inv_dedupe_set_controls", { p: { ...patch, reason } });
export const setDedupeStorePause = (storeId: string, paused: boolean, reason: string) => rpc<void>("inv_dedupe_set_store_pause", { p_store_id: storeId, p_paused: paused, p_reason: reason });
export const revealDedupeVin = (candidateId: string) => rpc<string>("inv_dedupe_reveal_vin", { p_candidate_id: candidateId });
export const checkDedupePurge = (listingId: string) => rpc<{ eligible: boolean; reasons: string[]; note: string }>("inv_dedupe_purge_check", { p_listing_id: listingId });

/** One key per preview, kept for the session, so a retry after a timeout replays instead of applying twice. */
export function dedupeIdempotencyKey(scope: string, id: string): string {
  const name = `dedupe-key:${scope}:${id}`;
  try {
    const existing = sessionStorage.getItem(name);
    if (existing) return existing;
    const key = `${scope}:${id}:${crypto.randomUUID()}`;
    sessionStorage.setItem(name, key);
    return key;
  } catch {
    return `${scope}:${id}:${Date.now()}`;
  }
}
