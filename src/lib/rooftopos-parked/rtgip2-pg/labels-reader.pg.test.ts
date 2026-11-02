// @vitest-environment node
// AutoLabels authoritative source reader against the real PR #46 custody tables (scratch
// cluster from supabase/tests/rtgip/pg_integration.sh). The producer decides only from what
// rtgip_src.labels_episode_history returns for the authenticated tenant.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { publishEpisodeOpened, publishSaleMilestone, readEpisodeHistory, type SourceDb } from "../rtgip2-autolabels/source-reader.ts";
import { connect, PG_URL, type Sql } from "./pg.ts";

const run = describe.runIf(!!PG_URL);
let sql: Sql;
const VIN = "1M8GDM9AXKP042788";
const T = { a: randomUUID(), b: randomUUID() };
const ids = { ep1: randomUUID(), ep2: randomUUID(), sold: randomUUID(), delivered: randomUUID(), reviewer: randomUUID(), listing: randomUUID(), file: randomUUID() };
const scope = (tenant = T.a) => ({ tenant_id: tenant, rooftop_id: "rf-nw-01", scope_verified_server_side: true as const });
const meta = { origin_event_id: "org-ep-open-1", aggregate_id: "agg-ep-2", revision: 1, prev_revision: null, correlation_id: "corr-1", occurred_at: "2026-11-02T10:00:00Z", emitted_at: "2026-11-02T10:00:01Z" };

/** Reads run as the NOLOGIN rtgip_source_reader role, in a read-only transaction. */
const reader = (role = "rtgip_source_reader"): SourceDb => ({
  call: (fn, args) =>
    sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}; SET LOCAL transaction_read_only = on`);
      const rows = await tx.unsafe(`SELECT rtgip_src.${fn}($1::uuid, $2::uuid) AS v`, args);
      return rows[0]!.v as unknown;
    }) as Promise<unknown>,
});

run("AutoLabels source reader over the PR #46 custody tables", () => {
  beforeAll(async () => {
    sql = connect();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO public.tenants (id, name, slug) VALUES (${T.a}, 'Synthetic A', ${"rd-a-" + T.a}), (${T.b}, 'Synthetic B', ${"rd-b-" + T.b})`;
      await tx`INSERT INTO auth.users (id, email) VALUES (${ids.reviewer}, ${"rv-" + ids.reviewer + "@example.test"})`;
      await tx`INSERT INTO public.vehicles (vin) VALUES (${VIN}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO public.vehicle_files (id, tenant_id, vin, stock_number) VALUES (${ids.file}, ${T.a}, ${VIN}, 'SYN2002')`;
      await tx`INSERT INTO public.vehicle_listings (id, store_id, tenant_id, vin, slug, vehicle_file_id) VALUES (${ids.listing}, ${randomUUID()}, ${T.a}, ${VIN}, ${"rd-" + ids.listing}, ${ids.file})`;
      // Episode 1: sold and delivered, custody ended.
      await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, status, custody_state, opened_reason, disposed_at, disposition)
        VALUES (${ids.ep1}, ${T.a}, ${VIN}, 'disposed', 'delivered', 'initial', now() - interval '30 days', 'retail_sale')`;
      await tx`INSERT INTO public.vehicle_custody_milestones (id, tenant_id, instance_id, vin, milestone, from_state, to_state, occurred_at, source, confirmed_by)
        VALUES (${ids.sold}, ${T.a}, ${ids.ep1}, ${VIN}, 'sold', 'in_stock', 'sold', '2026-09-01T15:00:00Z', 'staff', ${ids.reviewer}),
               (${ids.delivered}, ${T.a}, ${ids.ep1}, ${VIN}, 'delivered', 'sold', 'delivered', '2026-09-03T15:00:00Z', 'dms', NULL)`;
      // Episode 2: the same VIN reacquired, opened only after a resolved reappearance review.
      await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, status, custody_state, opened_reason, previous_instance_id, listing_id)
        VALUES (${ids.ep2}, ${T.a}, ${VIN}, 'active', 'in_stock', 'reacquisition', ${ids.ep1}, ${ids.listing})`;
      await tx`INSERT INTO public.vehicle_reappearance_reviews (tenant_id, vin, prior_instance_id, prior_custody_state, detected_source, status, decision, decided_by, decided_at, resulting_instance_id)
        VALUES (${T.a}, ${VIN}, ${ids.ep1}, 'delivered', 'feed', 'resolved', 'new_episode', ${ids.reviewer}, now(), ${ids.ep2})`;
    });
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("returns the episode, its chain identity and the predecessor's terminal milestones", async () => {
    const { inst, history } = await readEpisodeHistory(reader(), scope(), ids.ep2);
    expect(inst).toEqual({ vin: VIN, instance_id: ids.ep1, episode_id: ids.ep2, episode_state: "open", stock_number: "SYN2002" });
    expect(history.episode).toMatchObject({ opened_reason: "reacquisition", previous_episode_id: ids.ep1, custody_state: "in_stock", status: "active" });
    expect(history.vin_episodes.map((e) => [e.episode_id, e.custody_state, e.status])).toEqual([[ids.ep1, "delivered", "disposed"]]);
    expect(history.predecessor_milestones.map((m) => m.milestone)).toEqual(["sold", "delivered"]);
    expect(history.review).toMatchObject({ status: "resolved", decision: "new_episode", resulting_episode_id: ids.ep2, decided_by: ids.reviewer });
  });

  it("custody.episode_opened is produced from the rows as a reviewed reappearance", async () => {
    const out = await publishEpisodeOpened(reader(), scope(), ids.ep2, { opened_at: "2026-11-02T10:00:00Z" }, meta, ["autocurb", "autoframe"]);
    expect(out).toHaveLength(2);
    expect(out[0]!.envelope.payload).toMatchObject({ opened_reason: "reappearance_reviewed", predecessor_episode_id: ids.ep1 });
    expect(out[0]!.envelope.tenant_id).toBe(T.a);
  });

  it("sale.milestone_recorded is produced from the stored row; a later correction supersedes it", async () => {
    const ok = await publishSaleMilestone(reader(), scope(), ids.ep1, ids.sold, { ...meta, origin_event_id: "org-sold-1" }, ["autocurb"]);
    expect(ok[0]!.envelope.payload).toMatchObject({ milestone: "sold", audit_ref: ids.sold, verified: true });
    await sql`INSERT INTO public.vehicle_custody_milestones (tenant_id, instance_id, vin, milestone, from_state, to_state, occurred_at, source, confirmed_by, corrects_id)
      VALUES (${T.a}, ${ids.ep1}, ${VIN}, 'sale_voided', 'delivered', 'in_stock', '2026-09-05T15:00:00Z', 'staff', ${ids.reviewer}, ${ids.sold})`;
    await expect(publishSaleMilestone(reader(), scope(), ids.ep1, ids.sold, meta, ["autocurb"])).rejects.toThrow("sale_milestone_superseded");
  });

  it("a voided predecessor sale makes the reappearance unverifiable", async () => {
    await expect(publishEpisodeOpened(reader(), scope(), ids.ep2, { opened_at: "2026-11-02T10:00:00Z" }, meta, ["autocurb"])).rejects.toThrow("predecessor_closure_unverified");
  });

  it("another tenant cannot read the episode, and learns nothing about it", async () => {
    await expect(readEpisodeHistory(reader(), scope(T.b), ids.ep2)).rejects.toThrow("episode_not_found_for_tenant");
  });

  it("an unresolved review blocks the reacquisition", async () => {
    const t = randomUUID(), e1 = randomUUID(), e2 = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO public.tenants (id, name, slug) VALUES (${t}, 'Synthetic C', ${"rd-c-" + t})`;
      await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, status, custody_state, opened_reason) VALUES (${e1}, ${t}, ${VIN}, 'disposed', 'archived', 'initial')`;
      await tx`INSERT INTO public.vehicle_custody_milestones (tenant_id, instance_id, vin, milestone, from_state, to_state, occurred_at, source) VALUES (${t}, ${e1}, ${VIN}, 'archived', 'in_stock', 'archived', '2026-08-01T00:00:00Z', 'staff')`;
      await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, status, custody_state, opened_reason, previous_instance_id) VALUES (${e2}, ${t}, ${VIN}, 'active', 'in_stock', 'reacquisition', ${e1})`;
      await tx`INSERT INTO public.vehicle_reappearance_reviews (tenant_id, vin, prior_instance_id, detected_source, status, resulting_instance_id) VALUES (${t}, ${VIN}, ${e1}, 'feed', 'open', ${e2})`;
    });
    await expect(publishEpisodeOpened(reader(), scope(t), e2, { opened_at: "2026-11-02T10:00:00Z" }, meta, ["autocurb"])).rejects.toThrow("reappearance_review_unresolved");
  });

  it("only the source reader role can execute the readers", async () => {
    for (const role of ["authenticated", "anon", "service_role", "rtgip_inbox_receiver"])
      await expect(readEpisodeHistory(reader(role), scope(), ids.ep2)).rejects.toThrow(/permission denied/);
  });
});
