// AutoFrame rtgip/2 consumer effects. Parked: not wired into any route. Receives AutoLabels identity/custody facts
// and AutoCurb acquisition facts, and keeps a vehicle registry the approval flow checks.

import type { ConsumerEffect } from "../rtgip2/delivery.ts";
import type { EnvelopeV2 } from "../rtgip2/protocol.ts";

export interface FrameVehicle {
  tenant_id: string;
  rooftop_id: string;
  vin: string;
  registered_by_autolabels: boolean;
  stock_number: string | null;
  /**
   * terminal is set by any sold/delivered/wholesale/archived fact and is never cleared by a
   * delayed or reordered opening event; only a sale_voided milestone on an open episode clears it.
   */
  episodes: Record<string, { state: "open" | "closed"; terminal?: boolean }>;
  current_episode_id: string | null;
  /** Approvals are only allowed while the current episode is open and listing-available. */
  approvals_allowed: boolean;
  listing_available: boolean;
}

export interface FrameIntake {
  tenant_id: string;
  rooftop_id: string;
  vin: string;
  instance_ref: string;
  episode_ref: string;
  reason: "purchase_completed" | "appraisal_completed";
  source_event_id: string;
}

export interface FrameProjection {
  vehicles: Record<string, FrameVehicle>;
  intake: FrameIntake[];
}

export const emptyFrameProjection = (): FrameProjection => ({ vehicles: {}, intake: [] });

type Fail = { ok: false; reason: string };
const TERMINAL = new Set(["sold", "delivered", "wholesale", "archived"]);
const isLive = (v: FrameVehicle, ep: string) =>
  v.episodes[ep]?.state === "open" && !v.episodes[ep]?.terminal;
const fail = (reason: string): Fail => ({ ok: false, reason });

function vehicle(p: FrameProjection, e: EnvelopeV2, create: boolean): FrameVehicle | Fail {
  const v = p.vehicles[e.vehicle.instance_id];
  if (!v) {
    if (!create) return fail("unknown_instance");
    const fresh: FrameVehicle = {
      tenant_id: e.tenant_id,
      rooftop_id: e.rooftop_id,
      vin: e.vehicle.vin,
      registered_by_autolabels: true,
      stock_number: null,
      episodes: {},
      current_episode_id: null,
      approvals_allowed: false,
      listing_available: false,
    };
    p.vehicles[e.vehicle.instance_id] = fresh;
    return fresh;
  }
  if (v.tenant_id !== e.tenant_id) return fail("tenant_mismatch");
  if (v.rooftop_id !== e.rooftop_id) return fail("rooftop_mismatch");
  if (v.vin !== e.vehicle.vin) return fail("vin_mismatch");
  return v;
}

function fromAutoLabels(p: FrameProjection, e: EnvelopeV2): { ok: true } | Fail {
  const pl = e.payload as Record<string, unknown>;
  const v = vehicle(p, e, e.event_type === "vehicle.identity_registered");
  if ("ok" in v) return v;
  const ep = e.vehicle.episode_id;
  switch (e.event_type) {
    case "vehicle.identity_registered":
      v.stock_number = String(pl["stock_number"]);
      v.episodes[ep] ??= { state: "open" };
      v.current_episode_id ??= ep;
      v.approvals_allowed = isLive(v, v.current_episode_id);
      return { ok: true };
    case "custody.episode_opened": {
      const prior = v.episodes[ep];
      if (prior?.state === "closed" || prior?.terminal) return fail("episode_closed");
      v.episodes[ep] = { state: "open" };
      v.current_episode_id = ep;
      v.approvals_allowed = true;
      v.listing_available = false;
      return { ok: true };
    }
    case "custody.episode_closed":
      if (!v.episodes[ep]) return fail("episode_not_registered");
      v.episodes[ep] = { state: "closed", terminal: true };
      if (v.current_episode_id === ep) {
        v.approvals_allowed = false;
        v.listing_available = false;
      }
      return { ok: true };
    case "inventory.status_changed":
    case "sale.milestone_recorded": {
      if (!v.episodes[ep]) return fail("episode_not_registered");
      const value = String(pl["status"] ?? pl["milestone"]);
      const record = v.episodes[ep];
      if (TERMINAL.has(value)) record!.terminal = true;
      else if (value === "sale_voided" && record!.state === "open") record!.terminal = false;
      if (v.current_episode_id === ep) {
        v.approvals_allowed = isLive(v, ep);
        if (!v.approvals_allowed) v.listing_available = false;
      }
      return { ok: true };
    }
    case "listing.availability_changed":
      if (!v.episodes[ep]) return fail("episode_not_registered");
      if (
        (v.episodes[ep].state === "closed" || v.episodes[ep].terminal) &&
        pl["available"] === true
      )
        return fail("episode_closed");
      if (v.current_episode_id === ep) v.listing_available = pl["available"] === true;
      return { ok: true };
    default:
      return fail("unsupported_event_for_consumer");
  }
}

function fromAutoCurb(p: FrameProjection, e: EnvelopeV2): { ok: true } | Fail {
  // Acquisition context opens a shot-list intake. It does not register identity: only
  // AutoLabels does that, so a provisional AutoCurb ref never becomes an AutoFrame vehicle.
  const known = p.vehicles[e.vehicle.instance_id];
  if (
    known &&
    (known.tenant_id !== e.tenant_id ||
      known.rooftop_id !== e.rooftop_id ||
      known.vin !== e.vehicle.vin)
  )
    return fail("identity_mismatch");
  const reason =
    e.event_type === "acquisition.purchase_completed"
      ? "purchase_completed"
      : e.event_type === "appraisal.completed"
        ? "appraisal_completed"
        : null;
  if (!reason) return fail("unsupported_event_for_consumer");
  p.intake.push({
    tenant_id: e.tenant_id,
    rooftop_id: e.rooftop_id,
    vin: e.vehicle.vin,
    instance_ref: e.vehicle.instance_id,
    episode_ref: e.vehicle.episode_id,
    reason,
    source_event_id: e.origin.event_id,
  });
  return { ok: true };
}

export const frameConsumer: ConsumerEffect<FrameProjection> = (p, e) => {
  if (e.target_app !== "autoframe") return fail("wrong_destination");
  switch (e.origin.app) {
    case "autolabels":
      return fromAutoLabels(p, e);
    case "autocurb":
      return fromAutoCurb(p, e);
    default:
      return fail("unsupported_source");
  }
};
