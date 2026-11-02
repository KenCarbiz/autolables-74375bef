// Synthetic, DEV-literal registry for tests. Fictitious tenants, rooftops and VINs only.
// These secrets are public test vectors and must never be provisioned anywhere.

import {
  EVENT_CATALOG, ROUTES,
  type AppId, type EnvelopeV2, type EventType, type Purpose, type Registry, type ServiceConnection, type ServiceKey,
} from "./protocol.ts";

export const T0 = 1_800_000_000; // fixed synthetic clock (seconds)
export const TENANT = "tnt-syn-northwind";
export const ROOFTOP = "rf-nw-01";
export const OTHER_TENANT = "tnt-syn-southwind";
export const OTHER_ROOFTOP = "rf-nw-02";
export const VIN = "1HGCM82633A004352";
export const INSTANCE = "inst-syn-0001";
export const EPISODE = "ep-syn-0001-1";
export const EPISODE_2 = "ep-syn-0001-2";

export const connId = (s: AppId, t: AppId, tenant = TENANT) => `conn:${s}>${t}:${tenant}`;

function grant(s: AppId, t: AppId, tenant = TENANT): ServiceConnection {
  const route = ROUTES.find((r) => r.source === s && r.target === t)!;
  const events = Object.keys(route.events) as EventType[];
  const purposes = [...new Set(Object.values(route.events).flat())] as Purpose[];
  return {
    connection_id: connId(s, t, tenant), source_app: s, target_app: t, tenant_id: tenant, rooftop_ids: [ROOFTOP],
    event_types: events, purposes, producer_enabled: true, reader_enabled: true, status: "active",
  };
}

export const THREE_APP_PAIRS: readonly [AppId, AppId][] = [
  ["autolabels", "autocurb"], ["autocurb", "autolabels"],
  ["autolabels", "autoframe"], ["autoframe", "autolabels"],
  ["autocurb", "autoframe"], ["autoframe", "autocurb"],
];

export function syntheticRegistry(): Registry {
  const connections = [
    ...THREE_APP_PAIRS.map(([s, t]) => grant(s, t)),
    { ...grant("autolabels", "autocurb", OTHER_TENANT), rooftop_ids: ["rf-sw-01"] },
  ];
  const all = connections.map((c) => c.connection_id);
  const k = (key_id: string, owner: ServiceKey["owner"], dialect: ServiceKey["dialect"], conns: string[], status: ServiceKey["status"] = "current"): ServiceKey => ({
    key_id, owner, dialect, connection_ids: conns, status, not_before: T0 - 86_400, not_after: T0 + 86_400 * 90, secret: `dev-only-${key_id}`,
  });
  const ownConns = (app: AppId) => connections.filter((c) => c.source_app === app || c.target_app === app).map((c) => c.connection_id);
  const keys: ServiceKey[] = [
    k("gw-dev-1", "gateway", "rtgip/2", all),
    k("al-dev-1", "autolabels", "rtgip/2", ownConns("autolabels")),
    k("ac-dev-1", "autocurb", "rtgip/2", ownConns("autocurb")),
    k("af-dev-1", "autoframe", "rtgip/2", ownConns("autoframe")),
    k("al-dev-0", "autolabels", "rtgip/2", ownConns("autolabels"), "revoked"),
    k("al-legacy-1", "autolabels", "autolabels.rooftopos/1", ownConns("autolabels")),
    k("ac-legacy-1", "autocurb", "gateway.operator/1", ownConns("autocurb")),
    k("af-legacy-1", "autoframe", "autoframe.raw-hash/1", ownConns("autoframe")),
    k("af-held-1", "autoframe", "autoframe.ts-body/0", ownConns("autoframe")),
  ];
  return { connections, keys };
}

export const keyOf = (reg: Registry, id: string): ServiceKey => {
  const key = reg.keys.find((x) => x.key_id === id);
  if (!key) throw new Error(`fixture_key_missing:${id}`);
  return key;
};

export const signingKeyFor = (app: AppId | "gateway"): string =>
  ({ gateway: "gw-dev-1", autolabels: "al-dev-1", autocurb: "ac-dev-1", autoframe: "af-dev-1", autofilm: "none" })[app];

let seq = 0;
/** Deterministic synthetic UUIDs (v4 layout) for reproducible fixtures. */
export function synthUuid(label: string): string {
  let h = 2166136261;
  for (const ch of `${label}#${seq++}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hx = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hx(h), b = hx(Math.imul(h, 31) ^ 0x9e3779b9), c = hx(Math.imul(h, 131) ^ 0x85ebca6b), d = hx(Math.imul(h, 7) ^ 0xc2b2ae35);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4, 8)}${d}`;
}
export const resetSynthUuid = () => { seq = 0; };

const ISO_AT = "2027-01-15T15:00:00Z";
export const SAMPLE_PAYLOADS: Record<EventType, Record<string, unknown>> = {
  "vehicle.identity_registered": { stock_number: "SYN1001", year: 2024, make: "Synthetic", model: "Sedan", trim: null, registered_at: ISO_AT },
  "inventory.status_changed": { status: "frontline", stock_number: "SYN1001", changed_at: ISO_AT },
  "listing.availability_changed": { available: true, passport_ref: "passport-syn-1001", changed_at: ISO_AT },
  "listing.price_published": { price_context: "advertised", vehicle_selling_price_cents: 2_450_000, doc_fee_cents: 49_900, total_advertised_price_cents: 2_499_900, published_at: ISO_AT },
  "custody.episode_opened": { episode_kind: "inventory", opened_reason: "acquisition", predecessor_episode_id: null, opened_at: ISO_AT },
  "custody.episode_closed": { closed_reason: "sold_delivered", closed_at: ISO_AT },
  "sale.milestone_recorded": { milestone: "sold", recorded_at: ISO_AT, verified: true, audit_ref: "audit-syn-1" },
  "appraisal.completed": { verified_state: "finalized", appraisal_ref: "apr-syn-1", verified_by_ref: "staff-syn-7", finalized_at: ISO_AT, audit_ref: "audit-syn-2" },
  "acquisition.milestone_recorded": { milestone: "deal_finalized", custody_transferred: false, recorded_at: ISO_AT, audit_ref: "audit-syn-3" },
  "acquisition.purchase_completed": { purchase_ref: "pur-syn-1", custody_transferred: true, custody_at: ISO_AT, verified_by_ref: "staff-syn-7", audit_ref: "audit-syn-4", ownership_evidence_refs: ["own-syn-1"], condition_evidence_refs: ["cond-syn-1"] },
  "media.approved": { media_id: "med-syn-1", rendition_id: "rend-syn-1", width: 1500, height: 1000, orientation: "landscape", storage_ref: { bucket: "autoframe-media", object_key: `${TENANT}/${ROOFTOP}/${INSTANCE}/med-syn-1/derived/studio-v1-r2.webp` }, content_sha256: "a".repeat(64), approval_audit_ref: "audit-syn-5", approved_by_ref: "mgr-syn-1", preset_key: "studio", preset_version: 1, media_order: 1, shot_type: "front_34", approved_at: ISO_AT },
  "media.revoked": { media_id: "med-syn-1", reason: "withdrawn", revoked_at: ISO_AT, revocation_audit_ref: "audit-syn-6" },
  "service.mpi_verified": { ro_ref: "ro-syn-1", technician_verified: true, verified_by_ref: "tech-syn-1", verified_at: ISO_AT, evidence_refs: ["ev-syn-1"] },
  "service.repair_verified": { ro_ref: "ro-syn-1", repair_ref: "rep-syn-1", verified_by_ref: "tech-syn-1", verified_at: ISO_AT, evidence_refs: ["ev-syn-2"] },
};

/** A structurally valid draft envelope for a route + event (payload_sha256 filled by sealEnvelope). */
export function draftEnvelope(source: AppId, target: AppId, type: EventType, over: Partial<Omit<EnvelopeV2, "payload_sha256">> = {}): Omit<EnvelopeV2, "payload_sha256"> {
  const spec = EVENT_CATALOG[type];
  const route = ROUTES.find((r) => r.source === source && r.target === target);
  const purpose = (route?.events[type]?.[0] ?? "inventory_sync") as Purpose;
  const event_id = over.event_id ?? synthUuid(`${source}>${target}:${type}`);
  const revision = over.aggregate?.revision ?? 1;
  return {
    protocol: "rtgip/2", schema_version: 2, event_id, event_type: type, source_app: source, target_app: target,
    route: `${source}->${target}`, purpose, tenant_id: TENANT, rooftop_id: ROOFTOP,
    vehicle: { vin: VIN, instance_id: INSTANCE, episode_id: EPISODE, ...(spec.requires_service_visit ? { service_visit_id: "sv-syn-1" } : {}) },
    aggregate: { domain: spec.domain, type: spec.aggregate_type, id: `${spec.aggregate_type}-syn-1`, revision, prev_revision: revision > 1 ? revision - 1 : null },
    origin: { app: source, event_id, revision },
    correlation_id: "corr-syn-1", causation_id: null, occurred_at: ISO_AT, emitted_at: ISO_AT,
    classification: spec.domain === "media" ? "shared_media_meta" : "shared_vehicle_fact",
    payload: structuredClone(SAMPLE_PAYLOADS[type]),
    ...over,
  };
}
