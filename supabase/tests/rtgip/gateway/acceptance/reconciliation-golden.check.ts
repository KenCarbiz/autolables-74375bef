/**
 * Section 6: a NONZERO golden reconciliation corpus. The candidate's own v2/v3 test compares the two on
 * fixtures where every invariant counter is zero, so it cannot tell a working check from a dead one.
 * Here each invariant is broken a known number of times in one synthetic tenant and both gw_reconcile
 * (v2) and gw_reconcile_v3 must report exactly the golden counts, which the vendored TS report model
 * must accept as compatible. Reconciliation is read-only over this data; nothing is repaired or removed.
 */
import { compatibleCounters, validateV3Report } from "../../src/lib/gateway/rtgip2/reconciliation";
import { INVARIANT_CHECKS } from "../../src/lib/gateway/reconcile";
import { checker, openDb } from "./harness";

const sql = openDb();
const { check, report } = checker("section6_reconciliation_golden");
const T = "grp-syn-golden";
const R = "rt-syn-golden-01";

// One row per seeded defect. Healthy rows exist so a check that over-counts also fails.
const GOLDEN: Record<(typeof INVARIANT_CHECKS)[number], number> = {
  missing_fanout: 1, // appraisal.completed fans to curb->labels and curb->film; only the first copy exists
  delivered_without_inbox: 1, // delivered copy, target never wrote its inbox row
  terminal_without_inbox: 2, // the delivered copy above + a duplicate copy with no inbox
  inbox_without_ack: 1, // inbox row whose queue copy is dead (not an acknowledged status)
  dead_without_dead_letter: 1, // dead copy with no dead-letter row
  projection_behind_delivered: 1, // delivered revision 2, projection still at revision 1
  stuck_messages: 2, // expired lease + pending for 20 minutes
};

try {
  const uuid = () => crypto.randomUUID();
  await sql`INSERT INTO gw_tenants(id,name,is_synthetic) VALUES(${T},'Golden corpus (synthetic)',true)`;
  await sql`INSERT INTO gw_rooftops(id,tenant_id,name,city,state) VALUES(${R},${T},'Golden 01','Synthetic','SY')`;
  let n = 0;
  type Copy = { route: string; status: string; inbox?: boolean; lease?: "expired"; age?: string; late?: boolean; dlq?: string };
  async function event(o: { type: string; agg: string; rev: number; copies: Copy[]; projection?: number }) {
    const id = uuid();
    const at = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const seq = (await sql`INSERT INTO gw_outbox(event_id,tenant_id,rooftop_id,source_app,event_type,schema_version,aggregate_type,aggregate_id,aggregate_revision,
        vin,instance_id,episode_id,classification,payload_hash,envelope,occurred_at,emitted_at)
      VALUES(${id},${T},${R},'autocurb',${o.type},1,'vehicle',${o.agg},${o.rev},'DEVSYN00000000999','golden-instance','golden-episode',
        'shared_vehicle_fact',${"0".repeat(64)},${sql.json({ synthetic: true, n: ++n })},${at},${at}) RETURNING seq`)[0]!["seq"];
    for (const c of o.copies) {
      const accepted = c.age ? sql`now() - ${c.age}::interval` : sql`now() - interval '2 minutes'`;
      const delivered = c.status === "delivered" || c.status === "duplicate" ? (c.late ? sql`now()` : sql`now() - interval '2 minutes' + interval '5 seconds'`) : sql`NULL`;
      const qid = (await sql`INSERT INTO gw_queue(event_id,outbox_seq,route_id,tenant_id,target_app,lane_key,status,attempts,lease_until,accepted_at,delivered_at)
        VALUES(${id},${seq},${c.route},${T},'autolabels',${`golden|${o.agg}`},${c.status},1,
          ${c.lease === "expired" ? sql`now() - interval '1 minute'` : sql`NULL`},${accepted},${delivered}) RETURNING id`)[0]!["id"];
      if (c.inbox) await sql`INSERT INTO gw_inbox(target_app,event_id,tenant_id,result) VALUES('autolabels',${id},${T},'applied')`;
      if (c.dlq) await sql`INSERT INTO gw_dead_letters(queue_id,event_id,tenant_id,route_id,reason,attempts) VALUES(${qid},${id},${T},${c.route},${c.dlq},5)`;
    }
    if (o.projection !== undefined)
      await sql`INSERT INTO gw_projections(tenant_id,target_app,aggregate_type,aggregate_id,source_revisions)
        VALUES(${T},'autolabels','vehicle',${o.agg},${sql.json({ "autocurb:vehicle": o.projection })})
        ON CONFLICT(tenant_id,target_app,aggregate_type,aggregate_id) DO UPDATE SET source_revisions=EXCLUDED.source_revisions`;
  }
  const L = "curb->labels";
  await event({ type: "acquisition.closed", agg: "g-healthy", rev: 1, copies: [{ route: L, status: "delivered", inbox: true }], projection: 1 });
  await event({ type: "acquisition.closed", agg: "g-late", rev: 1, copies: [{ route: L, status: "delivered", inbox: true, late: true }], projection: 1 });
  await event({ type: "acquisition.closed", agg: "g-no-inbox", rev: 1, copies: [{ route: L, status: "delivered" }], projection: 1 });
  await event({ type: "acquisition.closed", agg: "g-duplicate", rev: 1, copies: [{ route: L, status: "duplicate" }] });
  await event({ type: "acquisition.closed", agg: "g-dead-acked", rev: 1, copies: [{ route: L, status: "dead", inbox: true, dlq: "POISON: synthetic golden poison" }] });
  await event({ type: "acquisition.closed", agg: "g-dead-no-dlq", rev: 1, copies: [{ route: L, status: "dead" }] });
  await event({ type: "acquisition.closed", agg: "g-stuck-lease", rev: 1, copies: [{ route: L, status: "leased", lease: "expired" }] });
  await event({ type: "acquisition.closed", agg: "g-stuck-pending", rev: 1, copies: [{ route: L, status: "pending", age: "20 minutes" }] });
  await event({ type: "acquisition.closed", agg: "g-behind", rev: 1, copies: [{ route: L, status: "delivered", inbox: true }] });
  await event({ type: "acquisition.closed", agg: "g-behind", rev: 2, copies: [{ route: L, status: "delivered", inbox: true }], projection: 1 });
  await event({ type: "appraisal.completed", agg: "g-fanout", rev: 1, copies: [{ route: L, status: "delivered", inbox: true }], projection: 1 });

  const actor = uuid();
  await sql`INSERT INTO gw_tenant_members(user_id,tenant_id,role) VALUES(${actor},${T},'admin')`;
  const before = Number((await sql`SELECT count(*) n FROM gw_queue WHERE tenant_id=${T}`)[0]!["n"]);
  const [v2, v3] = await sql.begin(async (tx) => {
    await tx`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: actor, role: "authenticated" })},true)`;
    return [(await tx`SELECT gw_reconcile(${T}) r`)[0]!["r"], (await tx`SELECT gw_reconcile_v3(${T}) r`)[0]!["r"]];
  });
  for (const k of INVARIANT_CHECKS) {
    check(`v2 ${k} = ${GOLDEN[k]}`, v2[k] === GOLDEN[k]);
    check(`v3 ${k} = ${GOLDEN[k]}`, v3[k] === GOLDEN[k]);
  }
  check("every invariant in the corpus is nonzero", INVARIANT_CHECKS.every((k) => GOLDEN[k] > 0));
  check("never_lose_ok is false in both", v2["never_lose_ok"] === false && v3["never_lose_ok"] === false);
  check("informational late delivery counted, not an invariant", v3["late_deliveries"] === 1 && v2["late_deliveries"] === 1);
  check("poison dead letter classified", v3["dlq"]?.["poison"] === 1 && JSON.stringify(v2["dlq"]) === JSON.stringify(v3["dlq"]));
  check("missing fanout key names the absent route", JSON.stringify(v3["missing_fanout_keys"]?.map((x: { route_id: string }) => x.route_id)) === JSON.stringify(["curb->film"]));
  check("projection-behind key names the aggregate", v3["projection_behind_keys"]?.[0]?.["aggregate_id"] === "g-behind");
  check("vendored TS model accepts the v3 report", validateV3Report(v3));
  check("vendored TS model finds v2 and v3 counters compatible", compatibleCounters(v2, v3));
  const tampered = { ...v3, stuck_messages: 0 };
  check("vendored TS model rejects a v3 report that hides a stuck message", !compatibleCounters(v2, tampered));
  check("reconciliation repaired or removed nothing", Number((await sql`SELECT count(*) n FROM gw_queue WHERE tenant_id=${T}`)[0]!["n"]) === before);
  check("both runs recorded with their mismatch totals", Number((await sql`SELECT count(*) n FROM gw_reconciliation_runs WHERE tenant_id=${T} AND mismatches>0`)[0]!["n"]) === 2);
  console.log(JSON.stringify({ golden: GOLDEN, v3: Object.fromEntries(INVARIANT_CHECKS.map((k) => [k, v3[k]])) }));
  report();
} finally {
  await sql.end();
}
