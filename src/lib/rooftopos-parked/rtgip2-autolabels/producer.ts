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

export function episodeOpened(scope: LabelsServerScope, inst: LabelsInstance, opened: { opened_reason: "acquisition" | "trade_in" | "transfer_in" | "reappearance_reviewed"; predecessor_episode_id: string | null; opened_at: string; reappearance_review_resolved?: boolean }, meta: FactMeta, targets: readonly AppId[]) {
  if (inst.episode_state !== "open") throw new LabelsProducerError("episode_not_open");
  if (opened.predecessor_episode_id === inst.episode_id) throw new LabelsProducerError("returning_vehicle_needs_new_episode");
  if (opened.opened_reason === "reappearance_reviewed" && opened.reappearance_review_resolved !== true) throw new LabelsProducerError("reappearance_review_unresolved");
  if (opened.predecessor_episode_id && opened.opened_reason !== "reappearance_reviewed" && opened.opened_reason !== "trade_in" && opened.opened_reason !== "acquisition") {
    throw new LabelsProducerError("predecessor_reason_invalid");
  }
  const { reappearance_review_resolved: _r, ...payload } = opened;
  return produceFor(fact(scope, inst, "custody.episode_opened", meta, { episode_kind: "inventory", ...payload }), targets);
}

export function episodeClosed(scope: LabelsServerScope, inst: LabelsInstance, closed: { closed_reason: "sold_delivered" | "wholesaled" | "transferred_out" | "archived"; closed_at: string }, meta: FactMeta, targets: readonly AppId[]) {
  if (inst.episode_state !== "closed") throw new LabelsProducerError("episode_not_closed");
  return produceFor(fact(scope, inst, "custody.episode_closed", meta, closed), targets);
}

export function saleMilestone(scope: LabelsServerScope, inst: LabelsInstance, m: { milestone: "sold" | "delivered" | "sale_voided"; recorded_at: string; audit_ref: string; verified_by_server: boolean }, meta: FactMeta, targets: readonly AppId[]) {
  if (m.verified_by_server !== true) throw new LabelsProducerError("sale_milestone_unverified");
  return produceFor(fact(scope, inst, "sale.milestone_recorded", meta, { milestone: m.milestone, recorded_at: m.recorded_at, verified: true, audit_ref: m.audit_ref }), targets);
}
