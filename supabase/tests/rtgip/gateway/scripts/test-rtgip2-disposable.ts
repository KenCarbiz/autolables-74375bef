/** Actual Gateway admission/dispatch against disposable Postgres. Synthetic receipt sink is NOT a peer adapter. */
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  sealEnvelope,
  signEnvelope,
  type Registry,
  type ServiceKey,
} from "../src/lib/gateway/rtgip2/core";
import { createRtgip2Handler } from "../src/lib/gateway/rtgip2/handler.server";
import { candidateStore } from "../src/lib/gateway/rtgip2/store.server";
import {
  deliveryIdentity,
  receiptDraft,
  receiptDigest,
  signReceiptV2,
  verifyReceiptV2,
} from "../src/lib/gateway/rtgip2/receipt";
import { verifyAdmission, type IdentityMapping } from "../src/lib/gateway/rtgip2/verify";
import { dispatcherStep, type DeliveryLease } from "../src/lib/gateway/rtgip2/dispatcher.server";

const dbname = process.argv[2];
if (!dbname || !/^gw_candidate_[a-z0-9_]+$/.test(dbname))
  throw new Error("Disposable database name required");
const sql = postgres({
  host: "/tmp/gateway-final/socket",
  username: "lovable",
  database: dbname,
  max: 8,
});
const now = () => Math.floor(Date.now() / 1000);
const connection = "r2-synthetic-connection";
const ephemeral = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const keys: ServiceKey[] = ["autolabels", "gateway", "autocurb"].map((owner) => ({
  key_id: `r2-${owner}`,
  owner: owner as ServiceKey["owner"],
  dialect: "rtgip/2",
  connection_ids: [connection],
  status: "current",
  not_before: now() - 60,
  not_after: now() + 3600,
  secret: ephemeral(),
}));
const source = keys.find((k) => k.owner === "autolabels"),
  gateway = keys.find((k) => k.owner === "gateway"),
  target = keys.find((k) => k.owner === "autocurb");
if (!source || !gateway || !target) throw new Error("Keys missing");
const results: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean) {
  results.push({ name, pass });
  if (!pass) throw new Error(name);
}
const call = async (name: string, args: Record<string, unknown>) => {
  if (!/^gw_r2_[a-z_]+$/.test(name)) throw new Error("RPC allowlist");
  const params = Object.values(args).map((v) =>
    v && typeof v === "object" ? JSON.stringify(v) : v,
  ) as (string | number | null)[];
  const rows = await sql.unsafe(
    `SELECT public.${name}(${params.map((_, i) => `$${i + 1}${Object.values(args)[i] && typeof Object.values(args)[i] === "object" ? "::text::jsonb" : ""}`).join(",")}) AS result`,
    params,
  );
  return rows[0]?.["result"];
};
try {
  // The disposable template already contains the proposal; never install it on a shared backend.
  if (!(await sql`SELECT to_regclass('public.gw_r2_connections') exists`)[0]?.["exists"]) {
    await sql.unsafe(readFileSync("docs/proposals/final-execution/rtgip2.sql", "utf8"));
  }
  await sql`INSERT INTO gw_r2_connections(id,source_app,target_app,tenant_id,rooftop_id,events,purposes,status,source_enabled,target_enabled)VALUES(${connection},'autolabels','autocurb','grp-syn-northwind','rt-syn-nw-01',ARRAY['inventory.status_changed'],ARRAY['inventory_sync'],'active',true,true)`;
  for (const key of keys)
    await sql`INSERT INTO gw_r2_keys(id,owner,connections,status,not_before,not_after,fingerprint)VALUES(${key.key_id},${key.owner},ARRAY[${connection}], 'current',to_timestamp(${key.not_before}),to_timestamp(${key.not_after}),${"0".repeat(64)})`;
  await sql`INSERT INTO gw_r2_mappings VALUES(${connection},'r2-instance','r2-episode','r2-store','DEVSYN00000000401','r2-reviewed','active')`;
  const { envelope, body } = await sealEnvelope({
    protocol: "rtgip/2",
    schema_version: 2,
    event_id: "",
    event_type: "inventory.status_changed",
    source_app: "autolabels",
    target_app: "autocurb",
    route: "autolabels->autocurb",
    purpose: "inventory_sync",
    tenant_id: "grp-syn-northwind",
    rooftop_id: "rt-syn-nw-01",
    vehicle: { vin: "DEVSYN00000000401", instance_id: "r2-instance", episode_id: "r2-episode" },
    aggregate: {
      domain: "inventory",
      type: "episode",
      id: "r2-episode",
      revision: 1,
      prev_revision: null,
    },
    origin: { app: "autolabels", event_id: "r2-origin", revision: 1 },
    correlation_id: "r2-correlation",
    causation_id: null,
    occurred_at: new Date().toISOString(),
    emitted_at: new Date().toISOString(),
    classification: "shared_vehicle_fact",
    payload: { status: "in_stock", stock_number: "SYN-1", changed_at: new Date().toISOString() },
  });
  const registry: Registry = {
    keys,
    connections: [
      {
        connection_id: connection,
        source_app: "autolabels",
        target_app: "autocurb",
        tenant_id: envelope.tenant_id,
        rooftop_ids: [envelope.rooftop_id],
        event_types: [envelope.event_type],
        purposes: [envelope.purpose],
        producer_enabled: true,
        reader_enabled: true,
        status: "active",
      },
    ],
  };
  const mapping: IdentityMapping = {
    ...envelope.vehicle,
    tenant_id: envelope.tenant_id,
    rooftop_id: envelope.rooftop_id,
    source_app: envelope.source_app,
    source_store_id: "r2-store",
    connection_id: connection,
    status: "active",
    reviewed_ref: "r2-reviewed",
  };
  const store = candidateStore({ call }, async () => gateway.key_id);
  const handler = createRtgip2Handler(
    {
      registry: async () => ({ registry, mappings: [mapping] }),
      now,
      ...store,
      resolveSigningKey: async (id) => keys.find((k) => k.key_id === id) ?? null,
    },
    true,
  );
  const headers = await signEnvelope(body, envelope, source, now(), "r2_nonce_synthetic_0001");
  const request = () =>
    new Request("http://localhost/local-candidate", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
  const replies = await Promise.all(Array.from({ length: 8 }, () => handler(request())));
  const payloads = await Promise.all(replies.map((r) => r.json()));
  if (!replies.every((r) => r.status === 200)) {
    // Surface only the SQL error category, never request bodies, keys or signatures.
    try {
      const durable = await store.admit(
        await verifyAdmission(
          { ...headers },
          new TextEncoder().encode(body),
          registry,
          [mapping],
          now(),
        ),
      );
      const receipt = await signReceiptV2(
        await receiptDraft(
          {
            envelope,
            connection_id: connection,
            delivery_id: durable.delivery_id,
            kind: "gateway_admission",
          },
          "admitted",
          durable.issued_at,
          null,
        ),
        gateway,
      );
      await store.persistSignedEvidence(durable, receipt);
    } catch (error) {
      console.error(
        "Admission SQL diagnostic:",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }
  check(
    "concurrent exact admission retries",
    replies.every((r) => r.status === 200) &&
      new Set(payloads.map((p) => JSON.stringify(p.receipt))).size === 1,
  );
  check(
    "one durable admitted event",
    Number((await sql`SELECT count(*) n FROM gw_r2_admissions`)[0]?.["n"]) === 1,
  );
  check(
    "one durable nonce",
    Number((await sql`SELECT count(*) n FROM gw_r2_nonces`)[0]?.["n"]) === 1,
  );
  const verified = await verifyAdmission(
    { ...headers },
    new TextEncoder().encode(body),
    registry,
    [mapping],
    now(),
  );
  const identity = await deliveryIdentity(envelope, connection);
  const adm = payloads[0]?.receipt;
  await verifyReceiptV2(
    adm,
    { envelope, connection_id: connection, delivery_id: identity, kind: "gateway_admission" },
    registry,
    now(),
  );
  check(
    "signed admission reads back from durable store",
    (await sql`SELECT receipt FROM gw_r2_receipts WHERE delivery_id=${identity}`)[0]?.["receipt"]
      ?.signature === adm.signature,
  );
  const changed = await sealEnvelope({
    ...envelope,
    aggregate: { ...envelope.aggregate, revision: 2, prev_revision: 1 },
  });
  const badHeaders = await signEnvelope(
    changed.body,
    changed.envelope,
    source,
    now(),
    "r2_nonce_synthetic_0002",
  );
  const conflict = await handler(
    new Request("http://localhost/local-candidate", {
      method: "POST",
      headers: { ...badHeaders, "content-type": "application/json" },
      body: changed.body,
    }),
  );
  check(
    "conflicting envelope returns no receipt",
    conflict.status === 503 && !(await conflict.json()).receipt,
  );
  const claimed = await sql`SELECT * FROM gw_r2_claim('worker-1',4,5)`;
  const first = claimed[0];
  if (!first) throw new Error("lease missing");
  check("one lane head claimed", claimed.length === 1);
  await sql`UPDATE gw_r2_dispatch SET lease_until=clock_timestamp()-interval '1 second' WHERE delivery_id=${identity}`;
  const reclaimed = (await sql`SELECT * FROM gw_r2_claim('worker-1',4,5)`)[0];
  if (!reclaimed) throw new Error("reclaimed missing");
  check(
    "generation fences reused worker label",
    Number(reclaimed["generation"]) === Number(first["generation"]) + 1 &&
      reclaimed["token"] !== first["token"],
  );
  check(
    "stale failure cannot reopen delivery",
    (await call("gw_r2_fail", {
      _id: identity,
      _generation: first["generation"],
      _token: first["token"],
    })) === "lost_lease",
  );
  const lease: DeliveryLease = {
    delivery_id: identity,
    connection_id: connection,
    generation: Number(reclaimed["generation"]),
    token: String(reclaimed["token"]),
    canonical_body: body,
    envelope,
    admission_receipt: adm,
  };
  const inbox = await signReceiptV2(
    await receiptDraft({ ...lease, kind: "target_inbox" }, "applied", now(), adm),
    target,
  );
  const commit = await signReceiptV2(
    await receiptDraft({ ...lease, kind: "consumer_commit" }, "applied", now(), inbox),
    target,
  );
  const status = await dispatcherStep(
    "worker-1",
    {
      registry: async () => registry,
      now,
      claim: async () => [lease],
      gatewayKey: async () => gateway,
      nonce: () => "r2_forward_nonce_00001",
      send: async () => [inbox, commit],
      complete: store.complete,
      fail: store.fail,
    },
    true,
  );
  check("actual dispatcher commits verified chain", status[0] === "committed");
  check(
    "lost completion ACK recovers exact result",
    (await store.complete(lease, [inbox, commit])) === "exact_retry",
  );
  check(
    "all three immutable receipts persisted",
    Number((await sql`SELECT count(*) n FROM gw_r2_receipts`)[0]?.["n"]) === 3,
  );
  check("terminal stale failure remains fenced", (await store.fail(lease)) === "lost_lease");
  let denied = false;
  try {
    await sql`UPDATE gw_r2_admissions SET envelope_sha256=${"0".repeat(64)} WHERE delivery_id=${identity}`;
  } catch {
    denied = true;
  }
  check("admission evidence immutable", denied);
  check(
    "browser admission execute denied",
    !(
      await sql`SELECT has_function_privilege('authenticated','gw_r2_admit(text,text,text,text,text,bigint,text)','execute') allowed`
    )[0]?.["allowed"],
  );
  check(
    "browser raw envelope denied",
    !(
      await sql`SELECT has_table_privilege('authenticated','gw_r2_admissions','select') allowed`
    )[0]?.["allowed"],
  );
  check(
    "permanent live transport off",
    (await sql`SELECT external_delivery_enabled FROM gw_settings WHERE id=1`)[0]?.[
      "external_delivery_enabled"
    ] === false,
  );
  const crashing = await sealEnvelope({
    ...envelope,
    origin: { ...envelope.origin, event_id: "r2-crashing-origin" },
  });
  const crashId = await deliveryIdentity(crashing.envelope, connection);
  const crash = spawnSync("bun", ["scripts/rtgip2-crash-child.ts", dbname], {
    input: JSON.stringify({
      body: crashing.body,
      connection,
      sourceKey: source.key_id,
      gatewayKey: gateway.key_id,
      nonce: "r2_crashing_nonce_0001",
      timestamp: now(),
      deliveryId: crashId,
    }),
    encoding: "utf8",
    timeout: 10000,
  });
  check("actual process terminated inside admission transaction", crash.signal === "SIGKILL");
  check(
    "process crash rolled back admission and nonce",
    Number(
      (await sql`SELECT count(*) n FROM gw_r2_admissions WHERE delivery_id=${crashId}`)[0]?.["n"],
    ) === 0 &&
      Number(
        (await sql`SELECT count(*) n FROM gw_r2_nonces WHERE nonce='r2_crashing_nonce_0001'`)[0]?.[
          "n"
        ],
      ) === 0,
  );
  const restartedHandler = createRtgip2Handler(
    {
      registry: async () => ({ registry, mappings: [mapping] }),
      now,
      ...candidateStore({ call }, async () => gateway.key_id),
      resolveSigningKey: async (id) => keys.find((k) => k.key_id === id) ?? null,
    },
    true,
  );
  const crashHeaders = await signEnvelope(
    crashing.body,
    crashing.envelope,
    source,
    now(),
    "r2_crashing_nonce_0001",
  );
  const recovered = await restartedHandler(
    new Request("http://localhost/local-candidate", {
      method: "POST",
      headers: { ...crashHeaders, "content-type": "application/json" },
      body: crashing.body,
    }),
  );
  check("new handler recovers admission after killed process", recovered.status === 200);
  const recoveredReceipt = (await recovered.json()).receipt;
  gateway.status = "previous";
  await sql`UPDATE gw_r2_keys SET status='previous' WHERE id=${gateway.key_id}`;
  const rotated: ServiceKey = {
    ...gateway,
    key_id: "r2-gateway-rotated",
    status: "current",
    secret: ephemeral(),
  };
  keys.push(rotated);
  await sql`INSERT INTO gw_r2_keys(id,owner,connections,status,not_before,not_after,fingerprint)VALUES(${rotated.key_id},'gateway',ARRAY[${connection}], 'current',to_timestamp(${rotated.not_before}),to_timestamp(${rotated.not_after}),${"0".repeat(64)})`;
  const rotatedHandler = createRtgip2Handler(
    {
      registry: async () => ({ registry, mappings: [mapping] }),
      now,
      ...candidateStore({ call }, async () => rotated.key_id),
      resolveSigningKey: async (id) => keys.find((k) => k.key_id === id) ?? null,
    },
    true,
  );
  const rotationRetry = await rotatedHandler(
    new Request("http://localhost/local-candidate", {
      method: "POST",
      headers: { ...crashHeaders, "content-type": "application/json" },
      body: crashing.body,
    }),
  );
  check(
    "key rotation recovers original durably signed admission",
    rotationRetry.status === 200 &&
      JSON.stringify((await rotationRetry.json()).receipt) === JSON.stringify(recoveredReceipt),
  );
  gateway.status = "current";
  await sql`UPDATE gw_r2_keys SET status='current' WHERE id=${gateway.key_id}`;
  const replay = await restartedHandler(
    new Request("http://localhost/local-candidate", {
      method: "POST",
      headers: { ...crashHeaders, "content-type": "application/json" },
      body: crashing.body,
    }),
  );
  check(
    "lost admission ACK returns original signed result",
    replay.status === 200 &&
      JSON.stringify((await replay.json()).receipt) === JSON.stringify(recoveredReceipt),
  );
  const budgetLease = (await sql`SELECT * FROM gw_r2_claim('budget-worker',4,5)`)[0];
  if (!budgetLease) throw Error("Budget lease missing");
  await sql`UPDATE gw_r2_dispatch SET attempts=10,lease_until=clock_timestamp()-interval '1 second' WHERE delivery_id=${crashId}`;
  const budgetClaim = await sql`SELECT * FROM gw_r2_claim('budget-recovery',4,5)`;
  check(
    "expired crash leases stop at ten attempts",
    budgetClaim.length === 0 &&
      (await sql`SELECT state,last_reason FROM gw_r2_dispatch WHERE delivery_id=${crashId}`)[0]?.[
        "last_reason"
      ] === "attempt_budget_exhausted",
  );
  const laneA = await sealEnvelope({
    ...envelope,
    origin: { ...envelope.origin, event_id: "r2-lane-a" },
  });
  const laneB = await sealEnvelope({
    ...envelope,
    origin: { ...envelope.origin, event_id: "r2-lane-b" },
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const aId = await deliveryIdentity(laneA.envelope, connection),
    bId = await deliveryIdentity(laneB.envelope, connection);
  const firstTx = sql.begin(async (tx) => {
    await tx`SELECT gw_r2_admit(${laneA.body},${connection},${source.key_id},${gateway.key_id},'r2_lane_a_nonce_00001',${now()},${aId})`;
    entered();
    await gate;
  });
  await started;
  let secondFinished = false;
  const secondTx =
    sql`SELECT gw_r2_admit(${laneB.body},${connection},${source.key_id},${gateway.key_id},'r2_lane_b_nonce_00001',${now()},${bId})`.then(
      () => {
        secondFinished = true;
      },
    );
  const pause = await sql`SELECT pg_sleep(0.08)`;
  void pause;
  const blocked = !secondFinished;
  release();
  await Promise.all([firstTx, secondTx]);
  const order =
    await sql`SELECT delivery_id FROM gw_r2_admissions WHERE delivery_id IN(${aId},${bId}) ORDER BY seq`;
  check(
    "lane admission serializes before publishing sequence",
    blocked && order[0]?.["delivery_id"] === aId && order[1]?.["delivery_id"] === bId,
  );
  await sql`UPDATE gw_r2_keys SET status='revoked' WHERE id=${source.key_id}`;
  const revoked = await restartedHandler(
    new Request("http://localhost/local-candidate", {
      method: "POST",
      headers: { ...crashHeaders, "content-type": "application/json" },
      body: crashing.body,
    }),
  );
  check(
    "transactional revocation beats stale verifier registry",
    revoked.status === 503 && !(await revoked.json()).receipt,
  );
  void verified;
} finally {
  writeFileSync(
    "docs/releases/evidence/final-execution/rtgip2-disposable.json",
    JSON.stringify(
      { kind: "actual_gateway_disposable_with_synthetic_receipt_sink_not_peer", results },
      null,
      2,
    ) + "\n",
  );
  await sql.end();
}
console.log(
  JSON.stringify({
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    peer_interoperability_proven: false,
  }),
);
