// Shared producer helper: one source fact -> one sealed envelope per authorized target route.
import {
  deriveEventId,
  EVENT_CATALOG,
  ProtocolError,
  routeFor,
  sealEnvelope,
  type AppId,
  type EnvelopeV2,
  type EventType,
  type Purpose,
  type VehicleRef,
} from "./protocol.ts";

export interface SourceFact {
  source: AppId;
  event_type: EventType;
  tenant_id: string;
  rooftop_id: string;
  vehicle: VehicleRef;
  aggregate_id: string;
  revision: number;
  /**
   * Revision chains are per route: the previous revision of this aggregate that was sent on
   * the same route. Pass a per-target map when routes carry different subsets of events.
   */
  prev_revision: number | null | Partial<Record<AppId, number | null>>;
  origin_event_id: string;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: string;
  emitted_at: string;
  payload: Record<string, unknown>;
  purpose?: Purpose;
}

export async function produceFor(
  fact: SourceFact,
  targets: readonly AppId[],
): Promise<{ target: AppId; envelope: EnvelopeV2; body: string }[]> {
  const spec = EVENT_CATALOG[fact.event_type];
  if (spec.owner !== fact.source) throw new ProtocolError("not_source_authority");
  const out: { target: AppId; envelope: EnvelopeV2; body: string }[] = [];
  for (const target of targets) {
    const route = routeFor(fact.source, target);
    if (!route) throw new ProtocolError("unknown_route");
    if (route.phase !== "three_app") throw new ProtocolError("route_reserved");
    const purposes = route.events[fact.event_type];
    if (!purposes) throw new ProtocolError(`event_not_on_route:${route.id}`);
    const purpose = fact.purpose ?? purposes[0];
    if (!purpose || !purposes.includes(purpose)) throw new ProtocolError("purpose_not_allowed");
    const event_id = await deriveEventId(fact.origin_event_id, route.id);
    const pr = fact.prev_revision;
    const prev: number | null | undefined =
      pr !== null && typeof pr === "object"
        ? (pr as Partial<Record<AppId, number | null>>)[target]
        : (pr as number | null);
    if (prev === undefined) throw new ProtocolError(`prev_revision_missing_for:${target}`);
    const sealed = await sealEnvelope({
      protocol: "rtgip/2",
      schema_version: 2,
      event_id,
      event_type: fact.event_type,
      source_app: fact.source,
      target_app: target,
      route: route.id,
      purpose,
      tenant_id: fact.tenant_id,
      rooftop_id: fact.rooftop_id,
      vehicle: fact.vehicle,
      aggregate: {
        domain: spec.domain,
        type: spec.aggregate_type,
        id: fact.aggregate_id,
        revision: fact.revision,
        prev_revision: prev,
      },
      origin: { app: fact.source, event_id: fact.origin_event_id, revision: fact.revision },
      correlation_id: fact.correlation_id,
      causation_id: fact.causation_id,
      occurred_at: fact.occurred_at,
      emitted_at: fact.emitted_at,
      classification: spec.domain === "media" ? "shared_media_meta" : "shared_vehicle_fact",
      payload: fact.payload,
    });
    out.push({ target, ...sealed });
  }
  return out;
}
