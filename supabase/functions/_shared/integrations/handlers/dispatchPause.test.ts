// @vitest-environment node
import { describe, it, expect } from "vitest";
import base from "../__fixtures__/autofilm_inspection_completed.json";
import type { EnvelopeV1 } from "../envelope.ts";
import { handleDispatch, type DispatchConnection, type DispatchStore, type OutboxRow } from "./dispatch.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const conn: DispatchConnection = {
  id: "c1", app: "autocurb", status: "active", endpoint_url: "https://curb.example.test/in", adapter: "rooftop.v1", external_rooftop_ref: null,
};
const row = (envelope: EnvelopeV1): OutboxRow => ({ id: "o1", tenant_id: TENANT, connection_id: "c1", event_id: envelope.event_id, attempts: 0, envelope });

function store(opts: { allowed?: boolean | "missing"; sent: string[] }) {
  const leased: string[] = [];
  const delivered: string[] = [];
  const s: DispatchStore = {
    listDue: async () => [row({ ...(base as unknown as EnvelopeV1), producer: "autolabels", event_type: "autolabels.vehicle.sold", schema_version: "1.1.0", service_visit_ref: null })],
    loadConnection: async () => conn,
    directionEnabled: async () => true,
    lease: async (id) => { leased.push(id); return true; },
    activeKey: async () => ({ key_id: "k1", secret: "s" }),
    markDelivered: async (id) => { delivered.push(id); },
    markFailure: async () => {},
  };
  if (opts.allowed !== "missing") s.deliveryAllowed = async () => opts.allowed !== false;
  return { s, leased, delivered };
}

const req = () => new Request("https://x.test/dispatch", { method: "POST", body: "{}" });
const deps = (s: DispatchStore, sent: string[]) => ({
  enabled: () => true, authorize: () => true, store: () => s,
  fetcher: (async (_url: string, init: RequestInit) => { sent.push(String(init.body)); return new Response("ok", { status: 200 }); }) as typeof fetch,
  now: () => Date.parse("2026-11-01T12:00:00Z"),
});

describe("dispatch delivery pause", () => {
  it("skips delivery and keeps the row (no lease, no send) while delivery is paused", async () => {
    const sent: string[] = [];
    const { s, leased, delivered } = store({ allowed: false, sent });
    const res = await (await handleDispatch(req(), deps(s, sent))).json();
    expect(res.outcomes).toEqual({ skipped_paused: 1 });
    expect(leased).toEqual([]);
    expect(delivered).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("delivers when allowed and sends a 1.0.0 envelope to a rooftop.v1 consumer", async () => {
    const sent: string[] = [];
    const { s, delivered } = store({ allowed: true, sent });
    const res = await (await handleDispatch(req(), deps(s, sent))).json();
    expect(res.outcomes).toEqual({ delivered: 1 });
    expect(delivered).toEqual(["o1"]);
    const body = JSON.parse(sent[0]);
    expect(body.schema_version).toBe("1.0.0");
    expect("service_visit_ref" in body).toBe(false);
  });
});
