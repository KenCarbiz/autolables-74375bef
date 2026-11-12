// AutoLabels adapter for the Phase 4 four-node isolated staging (ADAPTER-CONTRACT.md section 4).
// Server-only, parked, disposable clusters only. produce() reads the real rtgip_src readers as
// rtgip_source_reader in a read-only transaction; apply() runs the real durable effect
// rtgip_fx.labels_apply inside the caller's open inbox transaction; record() returns the
// committed business rows for the acceptance suite. Nothing here writes inventory, listings,
// prices or custody, and nothing here enables transport.
import type postgres from "postgres";
import { ROUTES, type AppId, type EnvelopeV2, type EventType } from "../rtgip2/protocol.ts";
import type { AdmissionEffect } from "../rtgip2/admission.ts";
import {
  publishEpisodeClosed,
  publishEpisodeOpened,
  publishIdentityRegistered,
  publishInventoryStatus,
  publishListingAvailability,
  publishPrice,
  publishSaleMilestone,
  type RouteMeta,
  type SourceDb,
} from "./source-reader.ts";

export type Sql = ReturnType<typeof postgres>;
export type Scope = { tenant_id: string; rooftop_id: string };
export type ApplyResult = { ok: boolean; reason: string; duplicate?: boolean };

export interface StagingAdapter {
  app: "autolabels" | "autocurb" | "autoframe";
  produce(db: Sql, kind: string, scope: Scope, ref: Record<string, string>): Promise<{ envelope: EnvelopeV2; body: string }[]>;
  apply(tx: Sql, envelope: EnvelopeV2): Promise<ApplyResult>;
  record(db: Sql, envelope: EnvelopeV2): Promise<Record<string, unknown> | null>;
}

const KINDS = {
  identity_registered: "vehicle.identity_registered",
  episode_opened: "custody.episode_opened",
  inventory_status: "inventory.status_changed",
  listing_availability: "listing.availability_changed",
  price_published: "listing.price_published",
  sale_milestone: "sale.milestone_recorded",
  episode_closed: "custody.episode_closed",
} as const satisfies Record<string, EventType>;
export type ProduceKind = keyof typeof KINDS;
export const PRODUCE_KINDS = Object.keys(KINDS) as ProduceKind[];

/** Every target AutoLabels may send this event type to on a three-app route. */
export function targetsFor(type: EventType): AppId[] {
  return ROUTES.filter((r) => r.source === "autolabels" && r.phase === "three_app" && r.events[type]).map((r) => r.target);
}

export function readerDb(db: Sql): SourceDb {
  return {
    call: (fn, args) =>
      db.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE rtgip_source_reader; SET LOCAL transaction_read_only = on");
        return (await tx.unsafe(`SELECT rtgip_src.${fn}($1::uuid, $2::text, $3::uuid) AS v`, args))[0]!.v as unknown;
      }) as Promise<unknown>,
  };
}

const need = (ref: Record<string, string>, k: string): string => {
  const v = ref[k];
  if (!v) throw new Error(`ref_missing:${k}`);
  return v;
};

/**
 * ref: episode_id (required), milestone_id (sale_milestone), targets (comma list, defaults to
 * every route for the event), correlation_id, causation_id, emitted_at, prev_revision (a number,
 * "null", or JSON per target). The fact, its revision and its time always come from the rows.
 */
async function produce(db: Sql, kind: string, scope: Scope, ref: Record<string, string>) {
  if (!(kind in KINDS)) throw new Error(`unknown_produce_kind:${kind}`);
  const k = kind as ProduceKind;
  const s = { ...scope, scope_verified_server_side: true as const };
  const ep = need(ref, "episode_id");
  const targets = (ref.targets ? ref.targets.split(",") : targetsFor(KINDS[k])) as AppId[];
  const prev = ref.prev_revision === undefined || ref.prev_revision === "null" ? null : (JSON.parse(ref.prev_revision) as RouteMeta["prev_revision"]);
  const route: RouteMeta = {
    correlation_id: ref.correlation_id ?? `corr:autolabels:${kind}:${ep}`,
    causation_id: ref.causation_id ?? null,
    emitted_at: ref.emitted_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    prev_revision: prev,
  };
  const r = readerDb(db);
  const out =
    k === "identity_registered" ? await publishIdentityRegistered(r, s, ep, route, targets)
    : k === "episode_opened" ? await publishEpisodeOpened(r, s, ep, {}, route, targets)
    : k === "inventory_status" ? await publishInventoryStatus(r, s, ep, route, targets)
    : k === "listing_availability" ? await publishListingAvailability(r, s, ep, route, targets)
    : k === "price_published" ? await publishPrice(r, s, ep, route, targets)
    : k === "sale_milestone" ? await publishSaleMilestone(r, s, ep, need(ref, "milestone_id"), route, targets)
    : await publishEpisodeClosed(r, s, ep, route, targets);
  return out.map(({ envelope, body }) => ({ envelope, body }));
}

const txOf = (tx: Sql | { sql: Sql }): Sql => ("sql" in tx && typeof tx.sql === "function" ? tx.sql : (tx as Sql));

/** The real effect, in the caller's transaction, under the consumer role, then back to the caller's role. */
async function apply(tx: Sql | { sql: Sql }, envelope: EnvelopeV2): Promise<ApplyResult> {
  const t = txOf(tx);
  const [{ role }] = (await t.unsafe("SELECT current_user AS role")) as unknown as [{ role: string }];
  await t.unsafe("SET LOCAL ROLE rtgip_labels_consumer");
  try {
    const rows = await t.unsafe("SELECT rtgip_fx.labels_apply($1::text::jsonb) AS r", [JSON.stringify(envelope)]);
    const r = rows[0]!.r as { ok: boolean; reason?: string; duplicate?: boolean };
    return { ok: r.ok === true, reason: r.reason ?? (r.ok ? "applied" : "refused"), ...(r.duplicate ? { duplicate: true } : {}) };
  } finally {
    await t.unsafe(`SET LOCAL ROLE ${JSON.stringify(role)}`);
  }
}

/** For admitDelivery: a refused effect carries a reason and is quarantined; an accepted one does not. */
export const labelsAdmissionEffect: AdmissionEffect = async (tx, e) => {
  const r = await apply(tx as unknown as { sql: Sql }, e);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
};

/** The committed AutoLabels business rows for one inbound event, read as the cluster owner. */
async function record(db: Sql, envelope: EnvelopeV2): Promise<Record<string, unknown> | null> {
  const applied = (await db`SELECT event_id::text, source_app, source_event_id, event_type, outcome, envelope_sha256
    FROM rtgip_fx.applied WHERE event_id = ${envelope.event_id}::uuid`)[0];
  if (!applied) return null;
  const evt = envelope.origin.event_id;
  const src = envelope.source_app;
  const evidence = await db`SELECT episode_id::text, instance_root::text, vin, kind, refs, source_revision::int AS revision
    FROM rtgip_fx.acquisition_evidence WHERE source_app = ${src} AND source_event_id = ${evt}`;
  const reviews = await db`SELECT kind, vin, prior_episode_id::text, status, evidence_refs
    FROM rtgip_fx.reconciliation_reviews WHERE source_app = ${src} AND source_event_id = ${evt}`;
  const media = envelope.event_type.startsWith("media.")
    ? (await db`SELECT media_id, episode_id::text, state, active_in_gallery, approval_revision::int AS revision, source_event_id
        FROM rtgip_fx.media_refs WHERE media_id = ${envelope.aggregate.id}`)[0] ?? null
    : null;
  const revocation = (await db`SELECT reason, audit_ref, episode_closed FROM rtgip_fx.media_revocations WHERE source_event_id = ${evt}`)[0] ?? null;
  const reinstatement = (await db`SELECT audit_ref FROM rtgip_fx.media_reinstatements WHERE source_event_id = ${evt}`)[0] ?? null;
  const episode = (await db`SELECT status, custody_state FROM public.vehicle_instances
    WHERE id::text = ${envelope.vehicle.episode_id} AND tenant_id = ${envelope.tenant_id}::uuid`)[0] ?? null;
  return { applied, evidence: [...evidence], reviews: [...reviews], media, revocation, reinstatement, episode };
}

export const labelsStagingAdapter: StagingAdapter = { app: "autolabels", produce, apply, record };
