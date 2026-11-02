// AutoLabels rtgip/2 producers: identity, inventory, listing, custody-episode and sale facts.
// Inputs are server-derived rows from the PR #46 vehicle-history model, never browser input.
// Parked: not imported by any runtime module; transport stays OFF.

import { produceFor, type SourceFact } from "../rtgip2/produce.ts";
import type { AppId, EventType } from "../rtgip2/protocol.ts";

/** Filled by the trusted server after it has authenticated the dealer session and tenancy. */
export interface LabelsServerScope {
  tenant_id: string;
  rooftop_id: string;
  scope_verified_server_side: true;
}

export interface LabelsInstance {
  vin: string;
  instance_id: string;
  episode_id: string;
  episode_state: "open" | "closed";
  stock_number: string;
}

export interface FactMeta {
  origin_event_id: string;
  aggregate_id: string;
  revision: number;
  prev_revision: SourceFact["prev_revision"];
  correlation_id: string;
  causation_id?: string | null;
  occurred_at: string;
  emitted_at: string;
}

export class LabelsProducerError extends Error { constructor(code: string) { super(code); } }

const CLOSED_STATUSES = new Set(["sold", "delivered", "wholesale", "archived"]);

function fact(scope: LabelsServerScope, inst: LabelsInstance, type: EventType, meta: FactMeta, payload: Record<string, unknown>): SourceFact {
  if (scope.scope_verified_server_side !== true) throw new LabelsProducerError("scope_not_server_verified");
  return {
    source: "autolabels", event_type: type, tenant_id: scope.tenant_id, rooftop_id: scope.rooftop_id,
    vehicle: { vin: inst.vin, instance_id: inst.instance_id, episode_id: inst.episode_id },
    aggregate_id: meta.aggregate_id, revision: meta.revision, prev_revision: meta.prev_revision,
    origin_event_id: meta.origin_event_id, correlation_id: meta.correlation_id, causation_id: meta.causation_id ?? null,
    occurred_at: meta.occurred_at, emitted_at: meta.emitted_at, payload,
  };
}

export function identityRegistered(scope: LabelsServerScope, inst: LabelsInstance, decoded: { year: number; make: string; model: string; trim: string | null; registered_at: string }, meta: FactMeta, targets: readonly AppId[]) {
  return produceFor(fact(scope, inst, "vehicle.identity_registered", meta, { stock_number: inst.stock_number, ...decoded }), targets);
}

export function inventoryStatusChanged(scope: LabelsServerScope, inst: LabelsInstance, status: string, changed_at: string, meta: FactMeta, targets: readonly AppId[]) {
  // A closed (sold/archived) episode can never report an active inventory status again.
  if (inst.episode_state === "closed" && !CLOSED_STATUSES.has(status)) throw new LabelsProducerError("closed_episode_cannot_reactivate");
  return produceFor(fact(scope, inst, "inventory.status_changed", meta, { status, stock_number: inst.stock_number, changed_at }), targets);
}

export function listingAvailabilityChanged(scope: LabelsServerScope, inst: LabelsInstance, available: boolean, passport_ref: string | null, changed_at: string, meta: FactMeta, targets: readonly AppId[]) {
  if (available && inst.episode_state === "closed") throw new LabelsProducerError("closed_episode_cannot_be_available");
  return produceFor(fact(scope, inst, "listing.availability_changed", meta, { available, passport_ref, changed_at }), targets);
}

/**
 * The advertised price as already published by the Passport price card
 * (buildPassportSaleCard). It is carried, never recalculated; the only check is that the
 * published total equals selling price plus doc fee.
 */
export function pricePublished(scope: LabelsServerScope, inst: LabelsInstance, card: { vehicle_selling_price_cents: number; doc_fee_cents: number; total_advertised_price_cents: number; published_at: string }, meta: FactMeta, targets: readonly AppId[]) {
  if (inst.episode_state === "closed") throw new LabelsProducerError("closed_episode_has_no_price");
  if (card.vehicle_selling_price_cents + card.doc_fee_cents !== card.total_advertised_price_cents) throw new LabelsProducerError("price_card_inconsistent");
  return produceFor(fact(scope, inst, "listing.price_published", meta, { price_context: "advertised", ...card }), targets);
}

/**
 * Authoritative custody-episode rows, read by the server inside the publishing transaction.
 * They mirror PR #46 public.vehicle_instances (one row per custody episode), so the
 * episode's own record, not a caller-supplied reason, decides what kind of opening it is.
 */
export interface EpisodeRecord {
  episode_id: string;
  tenant_id: string;
  vin: string;
  instance_id: string;
  opened_reason: "initial" | "reacquisition" | "restore" | "transfer_in" | "backfill";
  previous_episode_id: string | null;
  custody_state: "in_stock" | "sold" | "awaiting_delivery" | "delivered" | "transferred_out" | "archived";
  status: "active" | "disposed";
}

/** PR #46 public.vehicle_custody_milestones (append-only). */
export interface CustodyMilestoneRecord {
  id: string;
  tenant_id: string;
  episode_id: string;
  vin: string;
  milestone:
    | "sold"
    | "awaiting_delivery"
    | "delivered"
    | "sale_voided"
    | "delivery_corrected"
    | "transferred_out"
    | "archived"
    | "restored";
  to_state: string;
  occurred_at: string;
  source: "staff" | "dms" | "autocurb" | "feed_review" | "integration" | "backfill";
  confirmed_by: string | null;
  corrects_id: string | null;
}

/** PR #46 public.vehicle_reappearance_reviews. */
export interface ReappearanceReviewRecord {
  id: string;
  tenant_id: string;
  vin: string;
  prior_episode_id: string | null;
  status: "open" | "resolved";
  decision: "restore_episode" | "new_episode" | "wrong_store_mapping" | "reject_source" | "keep_quarantined" | null;
  decided_by: string | null;
  resulting_episode_id: string | null;
}

export interface EpisodeHistory {
  episode: EpisodeRecord;
  /** Every other episode this tenant holds for the VIN. */
  vin_episodes: readonly EpisodeRecord[];
  predecessor_milestones: readonly CustodyMilestoneRecord[];
  review: ReappearanceReviewRecord | null;
}

const OPEN_CUSTODY = new Set(["in_stock", "sold", "awaiting_delivery"]);
const ENDED_CUSTODY = new Set(["delivered", "transferred_out", "archived"]);

function isOpenEpisode(r: EpisodeRecord): boolean {
  return r.status === "active" && OPEN_CUSTODY.has(r.custody_state);
}

/**
 * custody.episode_opened, derived from the authoritative history rather than a supplied
 * reason. A returning VIN (any prior episode) must be a reacquisition whose predecessor has
 * ended with a recorded terminal milestone and whose reappearance review was resolved as a
 * new episode for exactly this episode by a named reviewer.
 */
export function episodeOpened(
  scope: LabelsServerScope,
  inst: LabelsInstance,
  history: EpisodeHistory,
  opened: { opened_at: string; acquisition_kind?: "acquisition" | "trade_in" },
  meta: FactMeta,
  targets: readonly AppId[],
) {
  const ep = history.episode;
  if (ep.episode_id !== inst.episode_id || ep.instance_id !== inst.instance_id || ep.vin !== inst.vin)
    throw new LabelsProducerError("history_does_not_match_instance");
  if (ep.tenant_id !== scope.tenant_id) throw new LabelsProducerError("history_tenant_mismatch");
  if (inst.episode_state !== "open" || ep.status !== "active" || ep.custody_state !== "in_stock")
    throw new LabelsProducerError("episode_not_open");
  const others = history.vin_episodes.filter((r) => r.episode_id !== ep.episode_id);
  if (others.some((r) => r.tenant_id !== scope.tenant_id || r.vin !== ep.vin))
    throw new LabelsProducerError("history_tenant_mismatch");
  if (others.some(isOpenEpisode)) throw new LabelsProducerError("another_episode_open");
  let opened_reason: "acquisition" | "trade_in" | "transfer_in" | "reappearance_reviewed";
  let predecessor: string | null = null;
  switch (ep.opened_reason) {
    case "initial":
    case "transfer_in":
      if (ep.previous_episode_id !== null || others.length > 0)
        throw new LabelsProducerError("prior_history_requires_reappearance_review");
      opened_reason = ep.opened_reason === "transfer_in" ? "transfer_in" : (opened.acquisition_kind ?? "acquisition");
      break;
    case "reacquisition": {
      const prevId = ep.previous_episode_id;
      if (!prevId) throw new LabelsProducerError("reacquisition_without_predecessor");
      if (prevId === ep.episode_id) throw new LabelsProducerError("returning_vehicle_needs_new_episode");
      const prev = others.find((r) => r.episode_id === prevId);
      if (!prev) throw new LabelsProducerError("predecessor_not_in_history");
      if (!ENDED_CUSTODY.has(prev.custody_state))
        throw new LabelsProducerError("predecessor_not_closed");
      const terminal = history.predecessor_milestones.filter(
        (m) =>
          m.episode_id === prevId &&
          m.tenant_id === scope.tenant_id &&
          m.vin === ep.vin &&
          ENDED_CUSTODY.has(m.to_state),
      );
      const reverted = history.predecessor_milestones.some(
        (m) => m.episode_id === prevId && (m.milestone === "restored" || m.milestone === "sale_voided") && terminal.some((t) => t.occurred_at <= m.occurred_at),
      );
      if (!terminal.length || reverted) throw new LabelsProducerError("predecessor_closure_unverified");
      const rv = history.review;
      if (
        !rv ||
        rv.tenant_id !== scope.tenant_id ||
        rv.vin !== ep.vin ||
        rv.prior_episode_id !== prevId ||
        rv.status !== "resolved" ||
        rv.decision !== "new_episode" ||
        rv.resulting_episode_id !== ep.episode_id ||
        !rv.decided_by
      )
        throw new LabelsProducerError("reappearance_review_unresolved");
      opened_reason = "reappearance_reviewed";
      predecessor = prevId;
      break;
    }
    case "restore":
      throw new LabelsProducerError("restore_is_not_a_new_episode");
    default:
      throw new LabelsProducerError("backfill_episode_not_publishable");
  }
  return produceFor(
    fact(scope, inst, "custody.episode_opened", meta, {
      episode_kind: "inventory",
      opened_reason,
      predecessor_episode_id: predecessor,
      opened_at: opened.opened_at,
    }),
    targets,
  );
}

export function episodeClosed(scope: LabelsServerScope, inst: LabelsInstance, closed: { closed_reason: "sold_delivered" | "wholesaled" | "transferred_out" | "archived"; closed_at: string }, meta: FactMeta, targets: readonly AppId[]) {
  if (inst.episode_state !== "closed") throw new LabelsProducerError("episode_not_closed");
  return produceFor(fact(scope, inst, "custody.episode_closed", meta, closed), targets);
}

const TRUSTED_SALE_SOURCES = new Set(["staff", "dms", "autocurb"]);

/**
 * sale.milestone_recorded from the append-only milestone row itself (PR #46). The row must
 * belong to this tenant, episode and VIN, come from a trusted source (staff rows need a
 * confirming user), and must not have been corrected or voided by a later row.
 */
export function saleMilestone(
  scope: LabelsServerScope,
  inst: LabelsInstance,
  record: CustodyMilestoneRecord,
  episodeMilestones: readonly CustodyMilestoneRecord[],
  meta: FactMeta,
  targets: readonly AppId[],
) {
  if (record.tenant_id !== scope.tenant_id || record.episode_id !== inst.episode_id || record.vin !== inst.vin)
    throw new LabelsProducerError("milestone_scope_mismatch");
  if (record.milestone !== "sold" && record.milestone !== "delivered" && record.milestone !== "sale_voided")
    throw new LabelsProducerError("not_a_sale_milestone");
  if (!TRUSTED_SALE_SOURCES.has(record.source)) throw new LabelsProducerError("sale_milestone_unverified");
  if (record.source === "staff" && !record.confirmed_by) throw new LabelsProducerError("sale_milestone_unverified");
  if (episodeMilestones.some((m) => m.corrects_id === record.id))
    throw new LabelsProducerError("sale_milestone_superseded");
  return produceFor(
    fact(scope, inst, "sale.milestone_recorded", meta, {
      milestone: record.milestone,
      recorded_at: record.occurred_at,
      verified: true,
      audit_ref: record.id,
    }),
    targets,
  );
}
