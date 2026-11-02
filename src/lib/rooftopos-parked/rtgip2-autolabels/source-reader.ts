// AutoLabels authoritative source reader (server only, inactive). Reads the PR #46 custody
// tables through the proposed rtgip_src readers (supabase/proposed/rtgip_source_readers.proposed.sql)
// as the rtgip_source_reader role, validates every field, and only then calls a producer.
// The producers' record arguments are therefore always database rows for the scope the
// server authenticated, never objects supplied by a caller.

import type { AppId } from "../rtgip2/protocol.ts";
import {
  episodeOpened,
  LabelsProducerError,
  saleMilestone,
  type CustodyMilestoneRecord,
  type EpisodeHistory,
  type EpisodeRecord,
  type FactMeta,
  type LabelsInstance,
  type LabelsServerScope,
  type ReappearanceReviewRecord,
} from "./producer.ts";

/** The server's read-only SQL handle, bound to the rtgip_source_reader role. */
export interface SourceDb {
  /** SELECT rtgip_src.<fn>(...) returning one jsonb value (or null). */
  call(fn: "labels_episode_history" | "labels_episode_milestones", args: [string, string]): Promise<unknown>;
}

/**
 * The authenticated server scope. AutoLabels shares the family tenants table, so the
 * RooftopOS tenant_id is public.tenants.id and the readers are keyed by it directly.
 */
export type LabelsReaderScope = LabelsServerScope;

export class SourceReadError extends Error {
  constructor(code: string) {
    super(code);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function str(o: Obj, k: string, re?: RegExp): string {
  const v = o[k];
  if (typeof v !== "string" || (re && !re.test(v))) throw new SourceReadError(`bad_field:${k}`);
  return v;
}
function strOrNull(o: Obj, k: string, re?: RegExp): string | null {
  return o[k] === null ? null : str(o, k, re);
}
function oneOf<T extends string>(o: Obj, k: string, allowed: readonly T[]): T {
  const v = str(o, k);
  if (!(allowed as readonly string[]).includes(v)) throw new SourceReadError(`bad_field:${k}`);
  return v as T;
}
function oneOfOrNull<T extends string>(o: Obj, k: string, allowed: readonly T[]): T | null {
  return o[k] === null ? null : oneOf(o, k, allowed);
}

function episode(v: unknown, tenant: string): EpisodeRecord {
  if (!isObj(v)) throw new SourceReadError("bad_episode");
  const r: EpisodeRecord = {
    episode_id: str(v, "episode_id", UUID),
    tenant_id: str(v, "tenant_id", UUID),
    vin: str(v, "vin", VIN),
    instance_id: str(v, "instance_id", UUID),
    opened_reason: oneOf(v, "opened_reason", ["initial", "reacquisition", "restore", "transfer_in", "backfill"] as const),
    previous_episode_id: strOrNull(v, "previous_episode_id", UUID),
    custody_state: oneOf(v, "custody_state", ["in_stock", "sold", "awaiting_delivery", "delivered", "transferred_out", "archived"] as const),
    status: oneOf(v, "status", ["active", "disposed"] as const),
  };
  if (r.tenant_id !== tenant) throw new SourceReadError("row_outside_tenant");
  return r;
}

function milestone(v: unknown, tenant: string): CustodyMilestoneRecord {
  if (!isObj(v)) throw new SourceReadError("bad_milestone");
  const r: CustodyMilestoneRecord = {
    id: str(v, "id", UUID),
    tenant_id: str(v, "tenant_id", UUID),
    episode_id: str(v, "episode_id", UUID),
    vin: str(v, "vin", VIN),
    milestone: oneOf(v, "milestone", ["sold", "awaiting_delivery", "delivered", "sale_voided", "delivery_corrected", "transferred_out", "archived", "restored"] as const),
    to_state: str(v, "to_state"),
    occurred_at: str(v, "occurred_at", ISO),
    source: oneOf(v, "source", ["staff", "dms", "autocurb", "feed_review", "integration", "backfill"] as const),
    confirmed_by: strOrNull(v, "confirmed_by", UUID),
    corrects_id: strOrNull(v, "corrects_id", UUID),
  };
  if (r.tenant_id !== tenant) throw new SourceReadError("row_outside_tenant");
  return r;
}

function review(v: unknown, tenant: string): ReappearanceReviewRecord | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) throw new SourceReadError("bad_review");
  const r: ReappearanceReviewRecord = {
    id: str(v, "id", UUID),
    tenant_id: str(v, "tenant_id", UUID),
    vin: str(v, "vin", VIN),
    prior_episode_id: strOrNull(v, "prior_episode_id", UUID),
    status: oneOf(v, "status", ["open", "resolved"] as const),
    decision: oneOfOrNull(v, "decision", ["restore_episode", "new_episode", "wrong_store_mapping", "reject_source", "keep_quarantined"] as const),
    decided_by: strOrNull(v, "decided_by", UUID),
    resulting_episode_id: strOrNull(v, "resulting_episode_id", UUID),
  };
  if (r.tenant_id !== tenant) throw new SourceReadError("row_outside_tenant");
  return r;
}

const arr = (v: unknown, k: string): unknown[] => {
  if (!Array.isArray(v)) throw new SourceReadError(`bad_field:${k}`);
  return v;
};

export async function readEpisodeHistory(
  db: SourceDb,
  scope: LabelsReaderScope,
  episodeId: string,
): Promise<{ inst: LabelsInstance; history: EpisodeHistory }> {
  if (scope.scope_verified_server_side !== true) throw new SourceReadError("scope_not_server_verified");
  if (!UUID.test(scope.tenant_id) || !UUID.test(episodeId)) throw new SourceReadError("bad_reference");
  const raw = await db.call("labels_episode_history", [scope.tenant_id, episodeId]);
  if (raw === null || raw === undefined) throw new SourceReadError("episode_not_found_for_tenant");
  if (!isObj(raw) || !isObj(raw.instance)) throw new SourceReadError("bad_history");
  const t = scope.tenant_id;
  const ep = episode(raw.episode, t);
  const i = raw.instance;
  const stock = i.stock_number;
  if (stock !== null && (typeof stock !== "string" || !stock)) throw new SourceReadError("bad_field:stock_number");
  const inst: LabelsInstance = {
    vin: str(i, "vin", VIN),
    instance_id: str(i, "instance_id", UUID),
    episode_id: str(i, "episode_id", UUID),
    episode_state: oneOf(i, "episode_state", ["open", "closed"] as const),
    stock_number: stock,
  };
  if (inst.episode_id !== ep.episode_id || inst.instance_id !== ep.instance_id || inst.vin !== ep.vin)
    throw new SourceReadError("instance_does_not_match_episode");
  return {
    inst,
    history: {
      episode: ep,
      vin_episodes: arr(raw.vin_episodes, "vin_episodes").map((x) => episode(x, t)),
      predecessor_milestones: arr(raw.predecessor_milestones, "predecessor_milestones").map((x) => milestone(x, t)),
      review: review(raw.review, t),
    },
  };
}

export async function readEpisodeMilestones(
  db: SourceDb,
  scope: LabelsReaderScope,
  episodeId: string,
): Promise<CustodyMilestoneRecord[]> {
  if (scope.scope_verified_server_side !== true) throw new SourceReadError("scope_not_server_verified");
  if (!UUID.test(scope.tenant_id) || !UUID.test(episodeId)) throw new SourceReadError("bad_reference");
  const raw = await db.call("labels_episode_milestones", [scope.tenant_id, episodeId]);
  if (raw === null || raw === undefined) throw new SourceReadError("episode_not_found_for_tenant");
  return arr(raw, "milestones").map((x) => milestone(x, scope.tenant_id));
}

/** custody.episode_opened, decided from the database rows alone. */
export async function publishEpisodeOpened(
  db: SourceDb,
  scope: LabelsReaderScope,
  episodeId: string,
  opened: { opened_at: string; acquisition_kind?: "acquisition" | "trade_in" },
  meta: FactMeta,
  targets: readonly AppId[],
) {
  const { inst, history } = await readEpisodeHistory(db, scope, episodeId);
  return episodeOpened(scope, inst, history, opened, meta, targets);
}

export async function publishSaleMilestone(
  db: SourceDb,
  scope: LabelsReaderScope,
  episodeId: string,
  milestoneId: string,
  meta: FactMeta,
  targets: readonly AppId[],
) {
  const { inst } = await readEpisodeHistory(db, scope, episodeId);
  const rows = await readEpisodeMilestones(db, scope, episodeId);
  const row = rows.find((m) => m.id === milestoneId);
  if (!row) throw new LabelsProducerError("milestone_not_found");
  return saleMilestone(scope, inst, row, rows, meta, targets);
}
