// AutoCurb rtgip/2 consumer effects. Inbound facts land in a separate vehicle-context
// projection. They can never write appraisal, offer, pricing, status or CRM fields.

import type { ConsumerEffect } from "../rtgip2/delivery.ts";
import type { EnvelopeV2 } from "../rtgip2/protocol.ts";
import { findProtectedKeys } from "../denylist.ts";

export interface CurbVehicleContext {
  tenant_id: string;
  rooftop_id: string;
  vin: string;
  /** AutoLabels identity, once registered. */
  identity: { stock_number: string; year: number; make: string; model: string; trim: string | null } | null;
  /** terminal is set by a sold/delivered fact and survives delayed or reordered opening events. */
  episodes: Record<string, { state: "open" | "closed"; opened_reason: string | null; closed_reason: string | null; terminal?: boolean }>;
  inventory_status: Record<string, string>;
  sale_milestones: { episode_id: string; milestone: string; at: string; audit_ref: string }[];
  /** Public advertised price context from AutoLabels; never AutoCurb's own valuation. */
  advertised_price: Record<string, { total_advertised_price_cents: number; published_at: string }>;
  media: Record<string, { episode_id: string; state: "approved" | "revoked"; revision: number; storage_object_key: string | null; shot_type: string | null; revocations?: string[]; reinstatements?: string[] }>;
}

export interface CurbProjection {
  /** Keyed by AutoLabels instance id. */
  vehicles: Record<string, CurbVehicleContext>;
}

export const emptyCurbProjection = (): CurbProjection => ({ vehicles: {} });

type Fail = { ok: false; reason: string };
const TERMINAL = new Set(["sold", "delivered", "wholesale", "archived"]);
const fail = (reason: string): Fail => ({ ok: false, reason });

function vehicleFor(p: CurbProjection, e: EnvelopeV2, create: boolean): CurbVehicleContext | Fail {
  const v = p.vehicles[e.vehicle.instance_id];
  if (!v) {
    if (!create) return fail("unknown_instance");
    const fresh: CurbVehicleContext = { tenant_id: e.tenant_id, rooftop_id: e.rooftop_id, vin: e.vehicle.vin, identity: null, episodes: {}, inventory_status: {}, sale_milestones: [], advertised_price: {}, media: {} };
    p.vehicles[e.vehicle.instance_id] = fresh;
    return fresh;
  }
  if (v.tenant_id !== e.tenant_id) return fail("tenant_mismatch");
  if (v.rooftop_id !== e.rooftop_id) return fail("rooftop_mismatch");
  if (v.vin !== e.vehicle.vin) return fail("vin_mismatch");
  return v;
}

function fromAutoLabels(p: CurbProjection, e: EnvelopeV2): { ok: true } | Fail {
  const pl = e.payload as Record<string, unknown>;
  const v = vehicleFor(p, e, e.event_type === "vehicle.identity_registered");
  if ("ok" in v) return v;
  const ep = e.vehicle.episode_id;
  switch (e.event_type) {
    case "vehicle.identity_registered":
      v.identity = { stock_number: String(pl.stock_number), year: Number(pl.year), make: String(pl.make), model: String(pl.model), trim: (pl.trim as string | null) ?? null };
      v.episodes[ep] ??= { state: "open", opened_reason: null, closed_reason: null };
      return { ok: true };
    case "custody.episode_opened":
      if (v.episodes[ep]?.state === "closed" || v.episodes[ep]?.terminal) return fail("episode_closed");
      v.episodes[ep] = { state: "open", opened_reason: String(pl.opened_reason), closed_reason: null };
      return { ok: true };
    case "custody.episode_closed":
      if (!v.episodes[ep]) return fail("episode_not_registered");
      v.episodes[ep] = { ...v.episodes[ep], state: "closed", closed_reason: String(pl.closed_reason) };
      return { ok: true };
    case "inventory.status_changed":
      if (!v.episodes[ep]) return fail("episode_not_registered");
      v.inventory_status[ep] = String(pl.status);
      if (TERMINAL.has(String(pl.status))) v.episodes[ep].terminal = true;
      return { ok: true };
    case "sale.milestone_recorded":
      if (!v.episodes[ep]) return fail("episode_not_registered");
      if (TERMINAL.has(String(pl.milestone))) v.episodes[ep].terminal = true;
      else if (pl.milestone === "sale_voided" && v.episodes[ep].state === "open") v.episodes[ep].terminal = false;
      v.sale_milestones.push({ episode_id: ep, milestone: String(pl.milestone), at: String(pl.recorded_at), audit_ref: String(pl.audit_ref) });
      return { ok: true };
    case "listing.price_published":
      if (!v.episodes[ep] || v.episodes[ep].state !== "open" || v.episodes[ep].terminal) return fail("episode_not_open");
      v.advertised_price[ep] = { total_advertised_price_cents: Number(pl.total_advertised_price_cents), published_at: String(pl.published_at) };
      return { ok: true };
    default:
      return fail("unsupported_event_for_consumer");
  }
}

function fromAutoFrame(p: CurbProjection, e: EnvelopeV2): { ok: true } | Fail {
  const v = vehicleFor(p, e, false);
  if ("ok" in v) return v;
  const ep = e.vehicle.episode_id;
  if (!v.episodes[ep]) return fail("episode_not_registered");
  const pl = e.payload as Record<string, unknown>;
  const id = String(pl.media_id);
  if (id !== e.aggregate.id) return fail("media_aggregate_mismatch");
  const prior = v.media[id];
  if (prior && prior.episode_id !== ep) return fail("media_vehicle_reassignment");
  if (e.event_type === "media.revoked") {
    v.media[id] = { episode_id: ep, state: "revoked", revision: e.aggregate.revision, storage_object_key: null, shot_type: prior?.shot_type ?? null,
      revocations: [...(prior?.revocations ?? []), String(pl.revocation_audit_ref)], reinstatements: prior?.reinstatements ?? [] };
    return { ok: true };
  }
  if (e.event_type !== "media.approved") return fail("unsupported_event_for_consumer");
  const storage = pl.storage_ref as { object_key: string };
  if (!storage.object_key.startsWith(`${e.tenant_id}/${e.rooftop_id}/${e.vehicle.instance_id}/`)) return fail("storage_ref_out_of_scope");
  // Withdrawal tombstones are permanent: a higher-revision approval must name a fresh,
  // audited reinstatement or the revoked image stays revoked.
  const tomb = prior?.revocations ?? [];
  const reinstated = typeof pl.reinstatement_audit_ref === "string" ? pl.reinstatement_audit_ref : null;
  if (tomb.length) {
    if (!reinstated) return fail("revoked_media_requires_reinstatement");
    if ((prior?.reinstatements ?? []).includes(reinstated) || tomb.includes(reinstated)) return fail("reinstatement_ref_reused");
  }
  v.media[id] = { episode_id: ep, state: "approved", revision: e.aggregate.revision, storage_object_key: storage.object_key, shot_type: String(pl.shot_type),
    revocations: tomb, reinstatements: tomb.length && reinstated ? [...(prior?.reinstatements ?? []), reinstated] : (prior?.reinstatements ?? []) };
  return { ok: true };
}

export const curbConsumer: ConsumerEffect<CurbProjection> = (p, e) => {
  if (e.target_app !== "autocurb") return fail("wrong_destination");
  // Defense in depth: the protocol already refuses these keys, and the inbound projection
  // must never be able to touch appraisal, offer, status or CRM fields.
  if (findProtectedKeys(e.payload).length) return fail("protected_field_in_payload");
  switch (e.origin.app) {
    case "autolabels": return fromAutoLabels(p, e);
    case "autoframe": return fromAutoFrame(p, e);
    default: return fail("unsupported_source");
  }
};
