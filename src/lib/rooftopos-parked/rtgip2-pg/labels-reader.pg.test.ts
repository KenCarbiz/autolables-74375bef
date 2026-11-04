// @vitest-environment node
// AutoLabels authoritative source readers against the real PR #46 custody tables (scratch
// cluster from supabase/tests/rtgip/pg_integration.sh). Every fact is decided only from what
// the rtgip_src readers return for the authenticated tenant AND rooftop.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  publishEpisodeClosed,
  publishEpisodeOpened,
  publishIdentityRegistered,
  publishInventoryStatus,
  publishListingAvailability,
  publishPrice,
  publishSaleMilestone,
  readEpisodeHistory,
  type SourceDb,
} from "../rtgip2-autolabels/source-reader.ts";
import { connect, PG_URL, type Sql } from "./pg.ts";

const run = describe.runIf(!!PG_URL);
let sql: Sql;
const VIN = "1M8GDM9AXKP042788";
const T = { a: randomUUID(), b: randomUUID() };
const S = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID() };
const ids = { ep1: randomUUID(), ep2: randomUUID(), sold: randomUUID(), delivered: randomUUID(), reviewer: randomUUID(), listing: randomUUID(), file: randomUUID() };
const RF = { a1: "rf-nw-01", a2: "rf-nw-02", b1: "rf-se-01" };
const scope = (tenant = T.a, rooftop = RF.a1) => ({ tenant_id: tenant, rooftop_id: rooftop, scope_verified_server_side: true as const });
const route = { correlation_id: "corr-1", emitted_at: "2026-11-02T10:00:01Z", prev_revision: null };

/** Reads run as the NOLOGIN rtgip_source_reader role, in a read-only transaction. */
const reader = (role = "rtgip_source_reader"): SourceDb => ({
  call: (fn, args) =>
    sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}; SET LOCAL transaction_read_only = on`);
      const rows = await tx.unsafe(`SELECT rtgip_src.${fn}($1::uuid, $2::text, $3::uuid) AS v`, args);
      return rows[0]!.v as unknown;
    }) as Promise<unknown>,
});

async function mapRooftop(tx: Sql, tenant: string, rooftop: string, store: string) {
  await tx`INSERT INTO public.dealer_stores (id, tenant_id) VALUES (${store}, ${tenant}) ON CONFLICT DO NOTHING`;
  await tx`INSERT INTO rtgip_src.rooftop_stores (tenant_id, rooftop_id, store_id, mapped_by, reason) VALUES (${tenant}, ${rooftop}, ${store}, ${ids.reviewer}, 'synthetic mapping')`;
}

const asService = (fn: (tx: Sql) => Promise<unknown>) =>
  sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    return fn(tx as unknown as Sql);
  });
const milestone = (tx: Sql, ep: string, m: string, at = "now()") =>
  tx.unsafe(`SELECT public.vehicle_history_record_milestone($1::uuid, $2, ${at}, NULL, 'staff', 'deal-syn', NULL) AS r`, [ep, m]);

run("AutoLabels source readers over the PR #46 custody tables", () => {
  beforeAll(async () => {
    sql = connect();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO public.tenants (id, name, slug) VALUES (${T.a}, 'Synthetic A', ${"rd-a-" + T.a}), (${T.b}, 'Synthetic B', ${"rd-b-" + T.b})`;
      await tx`INSERT INTO auth.users (id, email) VALUES (${ids.reviewer}, ${"rv-" + ids.reviewer + "@example.test"})`;
      await mapRooftop(tx as unknown as Sql, T.a, RF.a1, S.a1);
      await mapRooftop(tx as unknown as Sql, T.a, RF.a2, S.a2);
      await mapRooftop(tx as unknown as Sql, T.b, RF.b1, S.b1);
      await tx`INSERT INTO public.vehicles (vin) VALUES (${VIN}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO public.vehicle_files (id, tenant_id, vin, stock_number, year, make, model, trim) VALUES (${ids.file}, ${T.a}, ${VIN}, 'SYN2002', '2019', 'Synthetic', 'Roadster', 'Base')`;
      await tx`INSERT INTO public.vehicle_listings (id, store_id, owning_store_id, tenant_id, vin, slug, vehicle_file_id, status, condition, price, advertised_price_before_doc, doc_fee, published_at)
        VALUES (${ids.listing}, ${T.a}, ${S.a1}, ${T.a}, ${VIN}, ${"rd-" + ids.listing}, ${ids.file}, 'published', 'used', 25995, 25995, 899, now())`;
      // Episode 1: sold and delivered, custody ended.
      await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, disposed_at, disposition)
        VALUES (${ids.ep1}, ${T.a}, ${VIN}, ${S.a1}, 'disposed', 'delivered', 'initial', now() - interval '30 days', 'retail_sale')`;
      await tx`INSERT INTO public.vehicle_custody_milestones (id, tenant_id, instance_id, vin, milestone, from_state, to_state, occurred_at, source, confirmed_by)
        VALUES (${ids.sold}, ${T.a}, ${ids.ep1}, ${VIN}, 'sold', 'in_stock', 'sold', '2026-09-01T15:00:00Z', 'staff', ${ids.reviewer}),
               (${ids.delivered}, ${T.a}, ${ids.ep1}, ${VIN}, 'delivered', 'sold', 'delivered', '2026-09-03T15:00:00Z', 'dms', NULL)`;
      // Episode 2: the same VIN reacquired, opened only after a resolved reappearance review.
      await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, previous_instance_id, listing_id)
        VALUES (${ids.ep2}, ${T.a}, ${VIN}, ${S.a1}, 'active', 'in_stock', 'reacquisition', ${ids.ep1}, ${ids.listing})`;
      await tx`INSERT INTO public.vehicle_reappearance_reviews (tenant_id, vin, prior_instance_id, prior_custody_state, detected_source, status, decision, decided_by, decided_at, resulting_instance_id)
        VALUES (${T.a}, ${VIN}, ${ids.ep1}, 'delivered', 'feed', 'resolved', 'new_episode', ${ids.reviewer}, now(), ${ids.ep2})`;
    });
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("returns the episode, its chain identity, the predecessor's terminal milestones and the verified authority", async () => {
    const { inst, history, auth } = await readEpisodeHistory(reader(), scope(), ids.ep2);
    expect(inst).toEqual({ vin: VIN, instance_id: ids.ep1, episode_id: ids.ep2, episode_state: "open", stock_number: "SYN2002" });
    expect(auth).toMatchObject({ tenant_id: T.a, rooftop_id: RF.a1, store_id: S.a1, episode_id: ids.ep2, vin: VIN, listing_id: ids.listing });
    expect(history.episode).toMatchObject({ opened_reason: "reacquisition", previous_episode_id: ids.ep1, custody_state: "in_stock", status: "active" });
    expect(history.vin_episodes.map((e) => [e.episode_id, e.custody_state, e.status])).toEqual([[ids.ep1, "delivered", "disposed"]]);
    expect(history.predecessor_milestones.map((m) => m.milestone)).toEqual(["sold", "delivered"]);
    expect(history.review).toMatchObject({ status: "resolved", decision: "new_episode", resulting_episode_id: ids.ep2, decided_by: ids.reviewer });
  });

  it("custody.episode_opened is produced from the rows as a reviewed reappearance, with row-derived meta", async () => {
    const out = await publishEpisodeOpened(reader(), scope(), ids.ep2, {}, route, ["autocurb", "autoframe"]);
    expect(out).toHaveLength(2);
    expect(out[0]!.envelope.payload).toMatchObject({ opened_reason: "reappearance_reviewed", predecessor_episode_id: ids.ep1 });
    expect(out[0]!.envelope.tenant_id).toBe(T.a);
    expect(out[0]!.envelope.rooftop_id).toBe(RF.a1);
  });

  describe("A2 rooftop authority", () => {
    it("same tenant, wrong rooftop: a Store A vehicle is never a Store B fact", async () => {
      await expect(readEpisodeHistory(reader(), scope(T.a, RF.a2), ids.ep2)).rejects.toThrow("episode_rooftop_mismatch");
      await expect(publishPrice(reader(), scope(T.a, RF.a2), ids.ep2, route, ["autocurb"])).rejects.toThrow("episode_rooftop_mismatch");
    });
    it("an unmapped rooftop, an unbound episode and an inactive store are refused", async () => {
      await expect(readEpisodeHistory(reader(), scope(T.a, "rf-unknown"), ids.ep2)).rejects.toThrow("rooftop_unmapped");
      const e = randomUUID(), v = "2T1BURHE5JC123457";
      await sql`INSERT INTO public.vehicles (vin) VALUES (${v}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.vehicle_instances (id, tenant_id, vin) VALUES (${e}, ${T.a}, ${v})`;
      await expect(readEpisodeHistory(reader(), scope(), e)).rejects.toThrow("episode_rooftop_unbound");
      const s = randomUUID(), e2 = randomUUID(), v2 = "5YJ3E1EA7KF000003";
      await sql`INSERT INTO public.dealer_stores (id, tenant_id, status) VALUES (${s}, ${T.a}, 'inactive')`;
      await sql`INSERT INTO public.vehicles (vin) VALUES (${v2}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id) VALUES (${e2}, ${T.a}, ${v2}, ${s})`;
      await expect(readEpisodeHistory(reader(), scope(), e2)).rejects.toThrow("episode_store_not_active_in_tenant");
    });
    it("the listing must belong to the same store, tenant and VIN; an unowned listing is ambiguous", async () => {
      const mk = async (owning: string | null, listingVin: string, episodeVin: string) => {
        const l = randomUUID(), e = randomUUID();
        for (const v of [listingVin, episodeVin]) await sql`INSERT INTO public.vehicles (vin) VALUES (${v}) ON CONFLICT DO NOTHING`;
        await sql`INSERT INTO public.vehicle_listings (id, store_id, owning_store_id, tenant_id, vin, slug) VALUES (${l}, ${T.a}, ${owning}, ${T.a}, ${listingVin}, ${"rd-" + l})`;
        await sql`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, listing_id) VALUES (${e}, ${T.a}, ${episodeVin}, ${S.a1}, ${l})`;
        return e;
      };
      await expect(readEpisodeHistory(reader(), scope(), await mk(null, "1FTFW1E53MFA00001", "1FTFW1E53MFA00001"))).rejects.toThrow("listing_store_ambiguous");
      await expect(readEpisodeHistory(reader(), scope(), await mk(S.a2, "3VWFE21C24M000002", "3VWFE21C24M000002"))).rejects.toThrow("listing_store_mismatch");
      await expect(readEpisodeHistory(reader(), scope(), await mk(S.a1, "1C4RJFBG9MC000004", "JH4KA7561PC008269"))).rejects.toThrow("listing_vin_mismatch");
    });
    it("same VIN in another tenant is a different vehicle instance and stays invisible", async () => {
      await expect(readEpisodeHistory(reader(), scope(T.b, RF.b1), ids.ep2)).rejects.toThrow("episode_not_found_for_tenant");
      const e = randomUUID();
      await sql`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id) VALUES (${e}, ${T.b}, ${VIN}, ${S.b1})`;
      const b = await readEpisodeHistory(reader(), scope(T.b, RF.b1), e);
      expect(b.inst.instance_id).toBe(e);
      expect(b.history.vin_episodes).toEqual([]);
      await expect(readEpisodeHistory(reader(), scope(T.a, RF.a1), e)).rejects.toThrow("episode_not_found_for_tenant");
    });
  });

  describe("A3 source readers", () => {
    it("vehicle identity comes from the vehicle file of the episode's own listing", async () => {
      const [p] = await publishIdentityRegistered(reader(), scope(), ids.ep2, route, ["autocurb"]);
      expect(p!.envelope.payload).toMatchObject({ stock_number: "SYN2002", year: 2019, make: "Synthetic", model: "Roadster", trim: "Base" });
    });
    it("inventory status and listing availability are mapped from custody and listing rows", async () => {
      const [s] = await publishInventoryStatus(reader(), scope(), ids.ep2, route, ["autocurb"]);
      expect(s!.envelope.payload).toMatchObject({ status: "frontline", stock_number: "SYN2002" });
      const [a] = await publishListingAvailability(reader(), scope(), ids.ep2, route, ["autoframe"]);
      expect(a!.envelope.payload).toMatchObject({ available: true, passport_ref: "rd-" + ids.listing });
    });
    it("the advertised price is the Passport card for the stored values (before-doc mode)", async () => {
      const [p] = await publishPrice(reader(), scope(), ids.ep2, route, ["autocurb"]);
      expect(p!.envelope.payload).toMatchObject({ vehicle_selling_price_cents: 2599500, doc_fee_cents: 89900, total_advertised_price_cents: 2689400 });
    });
    it("website_sale_price mode follows the Passport exactly: the fee-inclusive total, selling price derived backward", async () => {
      // Default tenant setting: the advertised `price` already includes the fee, so the
      // Passport shows it as the total and the selling price is total minus fee.
      await sql`INSERT INTO public.dealer_profiles (tenant_id, settings) VALUES (${T.a}, '{"price_display_mode":"website_sale_price"}')
        ON CONFLICT (tenant_id) DO UPDATE SET settings = EXCLUDED.settings`;
      await sql`UPDATE public.vehicle_listings SET website_sale_price = 26894 WHERE id = ${ids.listing}`;
      const [p] = await publishPrice(reader(), scope(), ids.ep2, route, ["autocurb"]);
      expect(p!.envelope.payload).toMatchObject({ vehicle_selling_price_cents: 2509600, doc_fee_cents: 89900, total_advertised_price_cents: 2599500 });
      // A tenant whose advertised price excludes the fee shows the stored website sale price.
      await sql`UPDATE public.dealer_profiles SET settings = '{"price_display_mode":"website_sale_price","advertised_includes_doc_fee":"false"}' WHERE tenant_id = ${T.a}`;
      const [q] = await publishPrice(reader(), scope(), ids.ep2, route, ["autocurb"]);
      expect(q!.envelope.payload).toMatchObject({ vehicle_selling_price_cents: 2599500, doc_fee_cents: 89900, total_advertised_price_cents: 2689400 });
      await sql`DELETE FROM public.dealer_profiles WHERE tenant_id = ${T.a}`;
    });
    it("unauthorized price publication: draft listing, closed episode, wrong rooftop, other roles", async () => {
      await sql`UPDATE public.vehicle_listings SET status = 'draft' WHERE id = ${ids.listing}`;
      await expect(publishPrice(reader(), scope(), ids.ep2, route, ["autocurb"])).rejects.toThrow("listing_not_published");
      await sql`UPDATE public.vehicle_listings SET status = 'published' WHERE id = ${ids.listing}`;
      await expect(publishPrice(reader(), scope(T.b, RF.b1), ids.ep2, route, ["autocurb"])).rejects.toThrow("episode_not_found_for_tenant");
      for (const role of ["authenticated", "service_role"])
        await expect(publishPrice(reader(role), scope(), ids.ep2, route, ["autocurb"])).rejects.toThrow(/permission denied/);
    });
    it("custody.episode_closed takes its reason and time from the terminal milestone", async () => {
      const [c] = await publishEpisodeClosed(reader(), scope(), ids.ep1, route, ["autocurb"]);
      expect(c!.envelope.payload).toEqual({ closed_reason: "sold_delivered", closed_at: "2026-09-03T15:00:00Z" });
      await expect(publishEpisodeClosed(reader(), scope(), ids.ep2, route, ["autocurb"])).rejects.toThrow("episode_not_closed");
    });
  });

  it("sale.milestone_recorded is produced from the stored row; a later correction supersedes it", async () => {
    const ok = await publishSaleMilestone(reader(), scope(), ids.ep1, ids.delivered, route, ["autocurb"]);
    expect(ok[0]!.envelope.payload).toMatchObject({ milestone: "delivered", audit_ref: ids.delivered, verified: true });
    await sql`INSERT INTO public.vehicle_custody_milestones (tenant_id, instance_id, vin, milestone, from_state, to_state, occurred_at, source, confirmed_by, corrects_id, reason)
      VALUES (${T.a}, ${ids.ep1}, ${VIN}, 'delivery_corrected', 'delivered', 'delivered', '2026-09-04T15:00:00Z', 'staff', ${ids.reviewer}, ${ids.delivered}, 'date keyed wrong')`;
    await expect(publishSaleMilestone(reader(), scope(), ids.ep1, ids.delivered, route, ["autocurb"])).rejects.toThrow("sale_milestone_superseded");
  });

  it("the database refuses a delayed sale void on a delivered episode, so the reappearance stays verifiable", async () => {
    await expect(sql`INSERT INTO public.vehicle_custody_milestones (tenant_id, instance_id, vin, milestone, from_state, to_state, occurred_at, source, confirmed_by, corrects_id, reason)
      VALUES (${T.a}, ${ids.ep1}, ${VIN}, 'sale_voided', 'delivered', 'in_stock', '2026-09-05T15:00:00Z', 'staff', ${ids.reviewer}, ${ids.sold}, 'late void')`).rejects.toThrow(/terminal_check/);
    const out = await publishEpisodeOpened(reader(), scope(), ids.ep2, {}, route, ["autocurb"]);
    expect(out[0]!.envelope.payload).toMatchObject({ opened_reason: "reappearance_reviewed" });
  });

  it("an unresolved review blocks the reacquisition", async () => {
    const t = randomUUID(), s = randomUUID(), e1 = randomUUID(), e2 = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO public.tenants (id, name, slug) VALUES (${t}, 'Synthetic C', ${"rd-c-" + t})`;
      await mapRooftop(tx as unknown as Sql, t, "rf-c-01", s);
      await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason) VALUES (${e1}, ${t}, ${VIN}, ${s}, 'disposed', 'archived', 'initial')`;
      await tx`INSERT INTO public.vehicle_custody_milestones (tenant_id, instance_id, vin, milestone, from_state, to_state, occurred_at, source) VALUES (${t}, ${e1}, ${VIN}, 'archived', 'in_stock', 'archived', '2026-08-01T00:00:00Z', 'staff')`;
      await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, previous_instance_id) VALUES (${e2}, ${t}, ${VIN}, ${s}, 'active', 'in_stock', 'reacquisition', ${e1})`;
      await tx`INSERT INTO public.vehicle_reappearance_reviews (tenant_id, vin, prior_instance_id, detected_source, status, resulting_instance_id) VALUES (${t}, ${VIN}, ${e1}, 'feed', 'open', ${e2})`;
    });
    await expect(publishEpisodeOpened(reader(), scope(t, "rf-c-01"), e2, {}, route, ["autocurb"])).rejects.toThrow("reappearance_review_unresolved");
  });

  describe("A6.7 concurrent close and publish serialize on the episode", () => {
    const t = randomUUID(), s = randomUUID(), e = randomUUID(), l = randomUUID(), v = "3VW2B7AJ6JM000003";
    const sc = () => scope(t, "rf-cc-01");
    beforeAll(async () => {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO public.tenants (id, name, slug) VALUES (${t}, 'Synthetic Concurrency', ${"rd-cc-" + t})`;
        await mapRooftop(tx as unknown as Sql, t, "rf-cc-01", s);
        await tx`INSERT INTO public.vehicles (vin) VALUES (${v}) ON CONFLICT DO NOTHING`;
        await tx`INSERT INTO public.vehicle_listings (id, store_id, owning_store_id, tenant_id, vin, slug, status, price, doc_fee, published_at)
          VALUES (${l}, ${t}, ${s}, ${t}, ${v}, ${"rd-" + l}, 'published', 30000, 500, now())`;
        await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, listing_id) VALUES (${e}, ${t}, ${v}, ${s}, ${l})`;
      });
    });
    it("a publish holding the shared lock makes a concurrent custody change wait", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const haveLock = new Promise<void>((r) => (locked = r));
      const pub = sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE rtgip_source_reader");
        const r = await tx.unsafe("SELECT rtgip_src.labels_listing_state($1::uuid, $2::text, $3::uuid) AS v", [t, "rf-cc-01", e]);
        locked();
        await gate;
        return r[0]!.v as { authority: { custody_revision: number } };
      });
      await haveLock;
      let closed = false;
      const close = asService((tx) => milestone(tx, e, "sold")).then(() => (closed = true));
      await new Promise((r) => setTimeout(r, 400));
      expect(closed).toBe(false);
      release();
      expect((await pub).authority.custody_revision).toBe(0);
      await close;
      expect(closed).toBe(true);
    });
    it("a custody close in flight makes the publish wait, then the publish sees the closed episode", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let inFlight!: () => void;
      const started = new Promise<void>((r) => (inFlight = r));
      const close = asService(async (tx) => {
        await milestone(tx, e, "delivered");
        inFlight();
        await gate;
      });
      await started;
      let settled = false;
      const pub = publishPrice(reader(), sc(), e, route, ["autocurb"]).finally(() => (settled = true));
      pub.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);
      release();
      await close;
      await expect(pub).rejects.toThrow("closed_episode_has_no_price");
    });
  });

  describe("canonical identity across the vehicle lifecycle (root of the predecessor chain)", () => {
    const VIN2 = "2HGFC2F59MH000002";
    const t = randomUUID(), mgr = randomUUID(), st = randomUUID();
    const e = { a: randomUUID(), b: randomUUID(), c: randomUUID(), arch: randomUUID(), orphan: randomUUID(), foreign: randomUUID() };
    const sc = () => scope(t, "rf-ch-01");
    beforeAll(async () => {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO public.tenants (id, name, slug) VALUES (${t}, 'Synthetic Chain', ${"rd-ch-" + t})`;
        await mapRooftop(tx as unknown as Sql, t, "rf-ch-01", st);
        await tx`INSERT INTO auth.users (id, email) VALUES (${mgr}, ${"mgr-" + mgr + "@example.test"})`;
        await tx`INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) VALUES (${t}, ${mgr}, 'owner', now())`;
        await tx`INSERT INTO public.vehicles (vin) VALUES (${VIN2}) ON CONFLICT DO NOTHING`;
        // Acquired, sold and delivered; reacquired, sold again; reacquired a second time.
        await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, disposition) VALUES (${e.a}, ${t}, ${VIN2}, ${st}, 'disposed', 'delivered', 'initial', 'retail_sale')`;
        await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, previous_instance_id, disposition) VALUES (${e.b}, ${t}, ${VIN2}, ${st}, 'disposed', 'delivered', 'reacquisition', ${e.a}, 'retail_sale')`;
        await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, previous_instance_id) VALUES (${e.c}, ${t}, ${VIN2}, ${st}, 'active', 'in_stock', 'reacquisition', ${e.b})`;
      });
    });

    it("every episode of the vehicle resolves to the same instance id: the first episode", async () => {
      for (const ep of [e.a, e.b, e.c]) {
        const { inst } = await readEpisodeHistory(reader(), sc(), ep);
        expect([inst.instance_id, inst.episode_id]).toEqual([e.a, ep]);
      }
    });

    it("a service visit on a delivered episode attaches to it and never opens a custody episode", async () => {
      const before = (await sql`SELECT count(*)::int AS c FROM public.vehicle_instances WHERE tenant_id = ${t}`)[0]!.c;
      await sql`INSERT INTO public.service_visits (tenant_id, vin, instance_id, source_app, source_record_id, intake_verification) VALUES (${t}, ${VIN2}, ${e.b}, 'dms', ${"ro-" + e.b}, 'verified_ro')`;
      expect((await sql`SELECT count(*)::int AS c FROM public.vehicle_instances WHERE tenant_id = ${t}`)[0]!.c).toBe(before);
      const { inst, history } = await readEpisodeHistory(reader(), sc(), e.b);
      expect([inst.instance_id, inst.episode_state, history.episode.custody_state]).toEqual([e.a, "closed", "delivered"]);
    });

    it("restore keeps the same episode and instance, only from archived, only by a manager with a reason", async () => {
      await sql`INSERT INTO public.vehicles (vin) VALUES ('3VWFE21C04M000001') ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason) VALUES (${e.arch}, ${t}, '3VWFE21C04M000001', ${st}, 'active', 'archived', 'initial')`;
      const review = async (prior: string, vin: string, state: string) =>
        (await sql`INSERT INTO public.vehicle_reappearance_reviews (tenant_id, vin, prior_instance_id, prior_custody_state, detected_source, status) VALUES (${t}, ${vin}, ${prior}, ${state}, 'feed', 'open') RETURNING id`)[0]!.id as string;
      const resolve = (id: string, decision: string, who: string | null, reason = "staff confirmed the unit never left") =>
        sql.begin(async (tx) => {
          if (who) await tx.unsafe(`SELECT set_config('request.jwt.claims', '{"sub":"${who}","role":"authenticated"}', true)`);
          return (await tx`SELECT public.vehicle_history_resolve_reappearance(${id}, ${decision}, ${reason}) AS r`)[0]!.r as { instance_id: string };
        });
      const delivered = await review(e.c, VIN2, "in_stock");
      await expect(resolve(delivered, "restore_episode", mgr)).rejects.toThrow(/restore_requires_archived_episode/);
      const r = await review(e.arch, "3VWFE21C04M000001", "archived");
      await expect(resolve(r, "restore_episode", randomUUID())).rejects.toThrow(/not_authorized/);
      await expect(resolve(r, "restore_episode", null)).rejects.toThrow(/not_authorized|reviewer_required/);
      await expect(resolve(r, "restore_episode", mgr, "x")).rejects.toThrow(/reason_required/);
      expect((await resolve(r, "restore_episode", mgr)).instance_id).toBe(e.arch);
      const { inst } = await readEpisodeHistory(reader(), sc(), e.arch);
      expect([inst.instance_id, inst.episode_id]).toEqual([e.arch, e.arch]);
      const ms = await sql`SELECT milestone FROM public.vehicle_custody_milestones WHERE instance_id = ${e.arch}`;
      expect(ms.map((m) => m.milestone)).toContain("restored");
    });

    it("a link outside the tenant and VIN is refused at insert; legacy rows with one are refused by the reader", async () => {
      const other = randomUUID();
      await sql`INSERT INTO public.tenants (id, name, slug) VALUES (${other}, 'Synthetic Foreign', ${"rd-fo-" + other})`;
      await sql`INSERT INTO public.vehicle_instances (id, tenant_id, vin, status, custody_state, opened_reason) VALUES (${e.foreign}, ${other}, ${VIN2}, 'disposed', 'delivered', 'initial')`;
      await expect(sql`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, previous_instance_id) VALUES (${e.orphan}, ${t}, ${VIN2}, ${st}, 'disposed', 'archived', 'reacquisition', ${e.foreign})`).rejects.toThrow(/invalid_predecessor_episode/);
      // Simulate drifted legacy data written before the guard existed.
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL session_replication_role = replica");
        await tx`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, previous_instance_id) VALUES (${e.orphan}, ${t}, ${VIN2}, ${st}, 'disposed', 'archived', 'reacquisition', ${e.foreign})`;
      });
      await expect(readEpisodeHistory(reader(), sc(), e.orphan)).rejects.toThrow(/instance_id/);
      // A broken link anywhere in the VIN's history fails the whole read closed.
      await expect(readEpisodeHistory(reader(), sc(), e.c)).rejects.toThrow(/instance_id/);
      const lone = randomUUID(), VIN3 = "5YJSA1E27HF000337";
      await sql`INSERT INTO public.vehicles (vin) VALUES (${VIN3}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO public.vehicle_instances (tenant_id, vin, store_id, status, custody_state, opened_reason) VALUES (${t}, ${VIN3}, ${st}, 'disposed', 'delivered', 'initial')`;
      await sql`INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason) VALUES (${lone}, ${t}, ${VIN3}, ${st}, 'active', 'in_stock', 'reacquisition')`;
      await expect(publishEpisodeOpened(reader(), sc(), lone, {}, route, ["autocurb"])).rejects.toThrow("reacquisition_without_predecessor");
    });
  });

  it("only the source reader role can execute the readers or see the rooftop map", async () => {
    for (const role of ["authenticated", "anon", "service_role", "rtgip_inbox_receiver"])
      await expect(readEpisodeHistory(reader(role), scope(), ids.ep2)).rejects.toThrow(/permission denied/);
    for (const role of ["authenticated", "anon", "service_role"])
      await expect(sql.begin(async (tx) => { await tx.unsafe(`SET LOCAL ROLE ${role}`); return tx`SELECT 1 FROM rtgip_src.rooftop_stores`; })).rejects.toThrow(/permission denied/);
  });
});
