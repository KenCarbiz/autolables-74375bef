/**
 * The staging GatewayPort over the vendored candidate (rtgip2-staging/candidate-gateway.ts), from an
 * EMPTY database: bootstrap, registry provisioning, admission, rtgip/2-forward/1 to a local target,
 * rtgip/2-receipt-query/1, held, quarantined, conflict and registry revocation. Synthetic only.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import postgres from "postgres";
import { checker, ephemeral, now } from "./harness";

const AL = process.env.AL_REPO;
if (!AL) throw new Error("AL_REPO required");
const P = `${AL}/src/lib/rooftopos-parked`;
const proto = (await import(`${P}/rtgip2/protocol.ts`)) as typeof import("../../../../../src/lib/rooftopos-parked/rtgip2/protocol");
const rv2 = (await import(`${P}/rtgip2/receipt-v2.ts`)) as typeof import("../../../../../src/lib/rooftopos-parked/rtgip2/receipt-v2");
const rq = (await import(`${P}/rtgip2/receipt-query.ts`)) as typeof import("../../../../../src/lib/rooftopos-parked/rtgip2/receipt-query");
const adm = (await import(`${P}/rtgip2/admission.ts`)) as typeof import("../../../../../src/lib/rooftopos-parked/rtgip2/admission");
const port = (await import(`${P}/rtgip2-staging/candidate-gateway.ts`)) as typeof import("../../../../../src/lib/rooftopos-parked/rtgip2-staging/candidate-gateway");
type Registry = import("../../../../../src/lib/rooftopos-parked/rtgip2/protocol").Registry;
type ServiceKey = import("../../../../../src/lib/rooftopos-parked/rtgip2/protocol").ServiceKey;
type ReceiptV2 = import("../../../../../src/lib/rooftopos-parked/rtgip2/receipt-v2").ReceiptV2;

const dbname = process.argv[2];
if (!dbname || !/^gw_candidate_[a-z0-9_]+$/.test(dbname)) throw new Error("Disposable database name required");
const empty = `${dbname}_empty`;
const admin = postgres({ host: "/tmp/gateway-final/socket", username: "lovable", database: "postgres", max: 1, onnotice: () => {} });
await admin.unsafe(`DROP DATABASE IF EXISTS ${empty}`);
await admin.unsafe(`CREATE DATABASE ${empty} TEMPLATE template0`);
await admin.end();
const sql = postgres({ host: "/tmp/gateway-final/socket", username: "lovable", database: empty, max: 8, onnotice: () => {} });
const { check, report } = checker("candidate_gateway_port");

const TENANT = "tnt-port-synthetic";
const ROOFTOP = "rf-port-01";
const CONN = `conn:autolabels>autocurb:${TENANT}:${ROOFTOP}`;
const keyOf = (owner: ServiceKey["owner"]): ServiceKey => ({
  key_id: `port-${owner}-${ephemeral().slice(0, 8)}`,
  owner,
  dialect: "rtgip/2",
  connection_ids: [CONN],
  status: "current",
  not_before: now() - 600,
  not_after: now() + 3600,
  secret: ephemeral(),
});
const keys = { gateway: keyOf("gateway"), autolabels: keyOf("autolabels"), autocurb: keyOf("autocurb") };
const registry: Registry = {
  keys: Object.values(keys),
  connections: [
    {
      connection_id: CONN,
      source_app: "autolabels",
      target_app: "autocurb",
      tenant_id: TENANT,
      rooftop_ids: [ROOFTOP],
      event_types: ["inventory.status_changed"],
      purposes: ["inventory_sync"],
      producer_enabled: true,
      reader_enabled: true,
      status: "active",
    },
  ],
};
let mappings = [{ connection_id: CONN, instance_id: "port-instance", episode_id: "port-episode", source_store_id: "port-store", vin: "DEVSYN00000000777", reviewed_ref: "port-reviewed" }];

// A local target speaking rtgip/2-forward/1: it requires the admission header and answers with signed receipts.
let mode: "applied" | "held" | "quarantined" = "applied";
let forwardHeaderOk = true;
const target = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    const h = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    const v = await proto.verifyDelivery(h, raw, { registry, nowSec: now(), expectedSigner: "gateway", nonces: { claim: async () => "claimed" } });
    const header = adm.decodeAdmissionHeader(h[adm.ADMISSION_HEADER]);
    if (!("delivery" in v) || !header) {
      forwardHeaderOk = false;
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ reason: "forward_refused" }));
      return;
    }
    const e = v.delivery.envelope;
    const x = { envelope: e, connection_id: CONN, delivery_id: await rv2.deliveryIdentity(e, CONN) };
    const inbox = await rv2.signReceiptV2(await rv2.receiptDraft({ ...x, kind: "target_inbox" }, mode, now(), header.receipt), keys.autocurb);
    const receipts: ReceiptV2[] = [inbox];
    if (mode === "applied") receipts.push(await rv2.signReceiptV2(await rv2.receiptDraft({ ...x, kind: "consumer_commit" }, "applied", now(), inbox), keys.autocurb));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ reason: null, receipts }));
  });
});
await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
const targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;

try {
  const loaded = await port.bootstrapCandidateGateway(sql as never);
  check("from-empty bootstrap loads migrations 0000-0042 then the proposals", loaded === 43);
  const gw = new port.CandidateGateway(sql as never, {
    reg: () => registry,
    mappings: () => mappings,
    targets: () => ({ autolabels: targetUrl, autocurb: targetUrl, autoframe: targetUrl }),
  });
  await gw.provision();
  check("provisioning mirrors the registry", (await sql`SELECT count(*)::int n FROM gw_r2_connections WHERE status='active'`)[0]!.n === 1);

  let n = 0;
  const produce = async (revision: number, origin = `port-origin-${revision}`, stock = `PORT-${revision}`) =>
    proto.sealEnvelope({
      protocol: "rtgip/2",
      schema_version: 2,
      event_id: "",
      event_type: "inventory.status_changed",
      source_app: "autolabels",
      target_app: "autocurb",
      route: "autolabels->autocurb",
      purpose: "inventory_sync",
      tenant_id: TENANT,
      rooftop_id: ROOFTOP,
      vehicle: { vin: "DEVSYN00000000777", instance_id: "port-instance", episode_id: "port-episode" },
      aggregate: { domain: "inventory", type: "episode", id: "port-episode", revision, prev_revision: revision > 1 ? revision - 1 : null },
      origin: { app: "autolabels", event_id: origin, revision },
      correlation_id: "port-correlation",
      causation_id: null,
      occurred_at: new Date().toISOString(),
      emitted_at: new Date().toISOString(),
      classification: "shared_vehicle_fact",
      payload: { status: "in_stock", stock_number: stock, changed_at: new Date().toISOString() },
    });
  const deliver = async (p: { envelope: import("../../../../../src/lib/rooftopos-parked/rtgip2/protocol").EnvelopeV2; body: string }) =>
    gw.admit({ headers: (await proto.signEnvelope(p.body, p.envelope, keys.autolabels, now(), `port_src_${String(++n).padStart(8, "0")}`)) as unknown as Record<string, string>, body: p.body });
  const ask = async (delivery_id: string, event_id: string) => {
    const q = await rq.signReceiptQuery({ delivery_id, event_id }, keys.autolabels, now(), `port_qry_${String(++n).padStart(8, "0")}`);
    return gw.query({ headers: q.headers as unknown as Record<string, string>, body: q.body });
  };
  const verifyChain = async (chain: ReceiptV2[], e: import("../../../../../src/lib/rooftopos-parked/rtgip2/protocol").EnvelopeV2) => {
    const x = { envelope: e, connection_id: CONN, delivery_id: await rv2.deliveryIdentity(e, CONN) };
    for (let i = 0; i < chain.length; i++) await rv2.verifyReceiptV2(chain[i], { ...x, kind: chain[i]!.kind }, registry, now(), chain.slice(0, i));
    return chain.map((r) => `${r.kind}:${r.outcome}`).join(",");
  };
  const state = async (e: { event_id: string }) => (await sql`SELECT d.state FROM gw_r2_dispatch d JOIN gw_r2_admissions a USING(delivery_id) WHERE a.event_id=${e.event_id}::uuid`)[0]?.state;

  const e1 = await produce(1);
  const r1 = await deliver(e1);
  check("admission answers 200 with one signed admission receipt", r1.status === 200 && r1.doc.receipts?.length === 1);
  check("admission forwards with the rtgip-admission-receipt header", forwardHeaderOk);
  check("applied delivery commits in the candidate", (await state(e1.envelope)) === "committed");
  const id1 = await rv2.deliveryIdentity(e1.envelope, CONN);
  const q1 = await ask(id1, e1.envelope.event_id);
  check("receipt query returns the full verified chain", q1.status === 200 && (await verifyChain(q1.doc.receipts!, e1.envelope)) === "gateway_admission:admitted,target_inbox:applied,consumer_commit:applied");
  const again = await deliver(e1);
  check("exact retry returns the same admission receipt", again.status === 200 && JSON.stringify(again.doc.receipts) === JSON.stringify(r1.doc.receipts));

  mode = "held";
  const e2 = await produce(2);
  check("held delivery admitted", (await deliver(e2)).status === 200);
  check("held delivery is parked, not failed", (await state(e2.envelope)) === "target_persisted");
  const id2 = await rv2.deliveryIdentity(e2.envelope, CONN);
  const q2 = await ask(id2, e2.envelope.event_id);
  check("query reports the held inbox", (await verifyChain(q2.doc.receipts!, e2.envelope)) === "gateway_admission:admitted,target_inbox:held");
  mode = "applied";
  await gw.makeDue();
  check("held delivery re-forwarded", (await gw.forward()) === 1);
  check("held delivery commits later", (await state(e2.envelope)) === "committed");
  check("query then returns the committed chain", (await verifyChain((await ask(id2, e2.envelope.event_id)).doc.receipts!, e2.envelope)).endsWith("consumer_commit:applied"));

  mode = "quarantined";
  const e3 = await produce(3);
  await deliver(e3);
  check("quarantined delivery is terminal in the candidate", (await state(e3.envelope)) === "quarantined");
  const q3 = await ask(await rv2.deliveryIdentity(e3.envelope, CONN), e3.envelope.event_id);
  check("query reports the quarantine evidence", (await verifyChain(q3.doc.receipts!, e3.envelope)) === "gateway_admission:admitted,target_inbox:quarantined");
  mode = "applied";

  const clash = await produce(1, "port-origin-1", "PORT-CHANGED");
  check("same event id, different envelope: 409 admission_conflict", clash.envelope.event_id === e1.envelope.event_id && (await deliver(clash)).status === 409);
  const wrongSource = await ask(id1, e1.envelope.event_id).then(() => rq.signReceiptQuery({ delivery_id: id1, event_id: e1.envelope.event_id }, keys.autocurb, now(), "port_qry_wrongsrc1"));
  check("receipt query refuses a key that did not send the delivery", (await gw.query({ headers: wrongSource.headers as unknown as Record<string, string>, body: wrongSource.body })).status === 403);
  const film = await produce(4);
  check("AutoFilm scope refused before verification", (await gw.admit({ headers: { "rtgip-scope": "autolabels;autofilm;x" }, body: film.body })).status === 403);

  mappings = [];
  await gw.provision();
  const e5 = await produce(5);
  const r5 = await deliver(e5);
  check("after the registry drops the mapping the next event is refused 403", r5.status === 403 && /mapping/.test(String(r5.doc.reason)));
  check("refused event leaves no admission", (await sql`SELECT count(*)::int n FROM gw_r2_admissions WHERE event_id=${e5.envelope.event_id}::uuid`)[0]!.n === 0);
  report();
} finally {
  target.close();
  await sql.end();
}
