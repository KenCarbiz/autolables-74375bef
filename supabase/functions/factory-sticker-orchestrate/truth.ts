// Persisting the shared VIN truth snapshot.
//
// The resolution rules live in the mirrored library; this module is only
// the database side of them — record what a provider said, record the
// facts derived from it, and record a new snapshot ONLY when a material
// field moved.
//
// The "only when material" part is the expensive one to get wrong. Every
// nightly refresh passes through here for every vehicle; if an unchanged
// VIN minted a snapshot, it would also mint a document version and
// regenerate a PDF for the entire inventory, nightly.

import {
  candidatesFromListing,
  type TruthListingRow,
} from "../_shared/factorySticker/lib/vehicleTruth/ingest.ts";
import {
  buildVehicleSnapshot,
  carryForward,
  decideSnapshotVersion,
  type VehicleTruthSnapshot,
} from "../_shared/factorySticker/lib/vehicleTruth/snapshot.ts";
import { contentChecksum } from "../_shared/factorySticker/lib/vehicleTruth/materialChange.ts";
import {
  compileTenantAuthority,
  EMPTY_AUTHORITY,
  type SourceAuthorityRule,
} from "../_shared/factorySticker/lib/vehicleTruth/tenantAuthority.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface TruthResult {
  snapshot_id: string | null;
  version: number;
  created: boolean;
  reason: string;
  affected_families: string[];
  conflicts: number;
  blocking_conflicts: number;
}

interface CurrentSnapshotRow {
  id: string;
  snapshot_version: number;
  snapshot_json: VehicleTruthSnapshot;
}

/**
 * Record the raw provider payload.
 *
 * Deduplicated on (tenant, vin, source, checksum): an unchanged nightly
 * response is the same evidence retrieved again, not new evidence, so it
 * must not grow the table without bound. The retrieval is still visible in
 * the ledger; this table holds what was said, not how often.
 */
export async function recordSourcePayload(
  admin: Admin,
  args: {
    tenantId: string; vehicleId: string; vin: string;
    sourceKind: string; sourceName: string;
    payload: Record<string, unknown>;
    billable?: boolean; requestReason?: string | null;
  },
): Promise<string | null> {
  const checksum = contentChecksum(args.payload);
  const { data } = await admin.from("vehicle_source_records")
    .upsert({
      tenant_id: args.tenantId,
      vehicle_id: args.vehicleId,
      vin: args.vin,
      source_kind: args.sourceKind,
      source_name: args.sourceName,
      payload: args.payload,
      payload_checksum: checksum,
      billable: !!args.billable,
      request_reason: args.requestReason ?? null,
    }, { onConflict: "tenant_id,vin,source_kind,payload_checksum", ignoreDuplicates: false })
    .select("id").maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Resolve the vehicle and persist the result.
 *
 * Returns the snapshot every generator should then read, whether or not a
 * new version was created — a reused snapshot is still the answer.
 */
export async function refreshVehicleTruth(
  admin: Admin,
  tenantId: string,
  listing: Record<string, unknown>,
  opts: { sourceRecordIds?: Record<string, string>; retrievedAt?: string } = {},
): Promise<TruthResult> {
  const vehicleId = String(listing.id || "");
  const vin = String(listing.vin || "").toUpperCase().trim();

  const candidates = candidatesFromListing(listing as unknown as TruthListingRow, {
    retrievedAt: opts.retrievedAt ?? new Date().toISOString(),
    sourceRecordIds: opts.sourceRecordIds,
  });

  // The dealership's own Source Authority configuration decides who wins
  // per field. Resolving without it would silently ignore a setting the
  // dealer can see and edit, which is worse than not offering the setting.
  let authority = EMPTY_AUTHORITY;
  try {
    const { data: rules } = await admin.from("source_authority_rules")
      .select("field_key, primary_source, secondary_source, conflict_behavior")
      .eq("tenant_id", tenantId);
    if (rules?.length) authority = compileTenantAuthority(rules as SourceAuthorityRule[]);
  } catch {
    // A tenant that never opened the settings screen has no rules; the
    // built-in ordering is the documented default, not a failure.
  }

  const built = buildVehicleSnapshot(vin, candidates, authority);

  const { data: currentRow } = await admin.from("vehicle_snapshots")
    .select("id, snapshot_version, snapshot_json")
    .eq("vehicle_id", vehicleId)
    .order("snapshot_version", { ascending: false })
    .limit(1).maybeSingle();
  const current = (currentRow || null) as CurrentSnapshotRow | null;

  // Candidate facts are written whether or not a snapshot version follows:
  // knowing that MarketCheck still says the same thing is worth recording
  // even when nothing material moved.
  for (const [factKey, fact] of Object.entries(built.facts)) {
    await admin.from("vehicle_facts").upsert({
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      fact_key: factKey,
      fact_value: { v: fact.value },
      source_kind: fact.source,
      source_record_id: fact.evidence.sourceRecordId ?? null,
      confidence: fact.confidence,
      authority: fact.authority,
      usable_in_copy: fact.usableInCopy,
      evidence: fact.evidence,
      observed_at: fact.observedAt ?? new Date().toISOString(),
    }, { onConflict: "vehicle_id,fact_key,source_kind" });
  }

  const decision = decideSnapshotVersion(
    current ? { snapshot: current.snapshot_json, version: current.snapshot_version } : null,
    built.snapshot,
  );
  // Silence from a provider must not erase a fact already proved, so the
  // stored snapshot is the carried-forward one, not the raw resolution.
  const toStore = current ? carryForward(current.snapshot_json, built.snapshot) : built.snapshot;

  const blocking = built.conflicts.filter((c) => c.blocksGeneration);
  for (const conflict of built.conflicts) {
    await admin.from("vehicle_fact_conflicts").upsert({
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      fact_key: conflict.factKey,
      authority: conflict.authority,
      candidates: conflict.candidates,
      blocks_generation: conflict.blocksGeneration,
      status: "open",
    }, { onConflict: "vehicle_id,fact_key", ignoreDuplicates: true });
  }

  if (!decision.createVersion && current) {
    return {
      snapshot_id: current.id,
      version: current.snapshot_version,
      created: false,
      reason: decision.reason,
      affected_families: [],
      conflicts: built.conflicts.length,
      blocking_conflicts: blocking.length,
    };
  }

  const { data: inserted, error } = await admin.from("vehicle_snapshots").insert({
    tenant_id: tenantId,
    vehicle_id: vehicleId,
    vin,
    snapshot_version: decision.nextVersion,
    parent_snapshot_id: current?.id ?? null,
    snapshot_json: toStore,
    content_checksum: decision.checksum,
    material_changes: decision.changes,
    affected_families: decision.affectedFamilies,
    source_kinds: built.sourceKinds,
    has_unresolved_conflicts: blocking.length > 0,
  }).select("id").maybeSingle();

  if (error) {
    // A concurrent orchestration already wrote this version. The other run's
    // snapshot is equally valid, so read it rather than failing generation.
    const { data: retry } = await admin.from("vehicle_snapshots")
      .select("id, snapshot_version").eq("vehicle_id", vehicleId)
      .order("snapshot_version", { ascending: false }).limit(1).maybeSingle();
    const row = (retry || null) as { id: string; snapshot_version: number } | null;
    return {
      snapshot_id: row?.id ?? null,
      version: row?.snapshot_version ?? decision.nextVersion,
      created: false,
      reason: "concurrent_write",
      affected_families: [],
      conflicts: built.conflicts.length,
      blocking_conflicts: blocking.length,
    };
  }

  return {
    snapshot_id: (inserted as { id?: string } | null)?.id ?? null,
    version: decision.nextVersion,
    created: true,
    reason: decision.reason,
    affected_families: decision.affectedFamilies,
    conflicts: built.conflicts.length,
    blocking_conflicts: blocking.length,
  };
}
