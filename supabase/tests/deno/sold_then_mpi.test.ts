// Boundary scenario through the real AutoFilm v1 adapter, the real ingest and
// apply handlers, and the proposed SQL: a car is sold and delivered, then comes
// back for an MPI. AutoFilm's own sending side is not in this repository, so
// the producer here is the adapter's documented wire shape, not AutoFilm code.
import { admin, afBody, afHeaders, assert, runApply, seed, startServer, VIN } from "./harness.ts";

const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !Deno.env.get("ROOFTOP_TEST_DB_URL") };

async function asService<T>(fn: (tx: typeof admin) => Promise<T>): Promise<T> {
  return await admin.begin(async (tx) => {
    await tx`set local role service_role`;
    await tx`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
    return await fn(tx as unknown as typeof admin);
  }) as T;
}

Deno.test({ name: "sold -> delivered -> later AutoFilm MPI: same vehicle, new service visit, no inventory opened", ...opts, fn: async () => {
  const srv = startServer();
  try {
    const s = await seed({ adapter: "autofilm.v1" });
    const [inst] = await admin`select id from public.vehicle_instances where tenant_id = ${s.tenantId} and vin = ${VIN} and status = 'active'`;
    await admin`insert into public.vehicle_listings (tenant_id, store_id, vin, slug, status, published_at, archived_at, archive_reason)
      values (${s.tenantId}, ${s.tenantId}, ${VIN}, ${"sold-" + s.tenantId.slice(0, 8)}, 'archived', now() - interval '40 days', now() - interval '9 days', 'left_feed')`;
    await asService(async (tx) => {
      await tx`select public.vehicle_history_record_milestone(${inst.id}, 'sold', now() - interval '12 days', null, 'staff', 'deal-1', null)`;
      await tx`select public.vehicle_history_record_milestone(${inst.id}, 'delivered', now() - interval '10 days', null, 'staff', 'deal-1', null)`;
      const v = await tx`select coalesce(max(version), 0)::int v from public.vehicle_history_settings where scope_type = 'platform' and key = 'service.attach_enabled'`;
      await tx`select public.vehicle_history_set_setting('platform', null, 'service.attach_enabled', 'true', ${v[0].v}, 'synthetic test')`;
      await tx`select public.vehicle_history_set_setting('tenant', ${s.tenantId}, 'service.attach_enabled', 'true', 0, 'synthetic test')`;
    });
    const before = {
      instances: (await admin`select count(*)::int n from public.vehicle_instances where tenant_id = ${s.tenantId} and vin = ${VIN}`)[0].n,
      listing: (await admin`select status, archived_at from public.vehicle_listings where tenant_id = ${s.tenantId} and vin = ${VIN}`)[0],
    };

    const ro = "7d1e0c44-1b2a-4c3d-9e8f-000000000777";
    const body = afBody(s, "mpi.report.published", { ro_id: ro, ro_number: "RO-20001", vin: VIN });
    const res = await srv.post(`/ingest?connection=${s.connId}`, body, await afHeaders(s, body));
    assert.ok([200, 202].includes(res.status), `ingest ${res.status}`);
    await res.body?.cancel();
    const applied = await runApply(srv);
    assert.equal(applied.status, 200);

    const [vehicle] = await admin`select count(*)::int n from public.vehicles where vin = ${VIN}`;
    assert.equal(vehicle.n, 1, "one global vehicle identity");
    const visits = await admin`select id, instance_id, source_app, source_record_id from public.service_visits where tenant_id = ${s.tenantId} and vin = ${VIN}`;
    assert.equal(visits.length, 1, "one new service visit");
    assert.equal(visits[0].instance_id, null, "the visit is not attached to the delivered episode");
    const ev = await admin`select vin, instance_id, service_visit_id from public.inspection_evidence where tenant_id = ${s.tenantId}`;
    assert.equal(ev.length, 1);
    assert.equal(ev[0].vin, VIN);
    assert.equal(ev[0].instance_id, null);
    assert.equal(ev[0].service_visit_id, visits[0].id);

    const after = {
      instances: (await admin`select count(*)::int n from public.vehicle_instances where tenant_id = ${s.tenantId} and vin = ${VIN}`)[0].n,
      active: (await admin`select count(*)::int n from public.vehicle_instances where tenant_id = ${s.tenantId} and vin = ${VIN} and status = 'active'`)[0].n,
      listing: (await admin`select status, archived_at from public.vehicle_listings where tenant_id = ${s.tenantId} and vin = ${VIN}`)[0],
      reviews: (await admin`select count(*)::int n from public.vehicle_reappearance_reviews where tenant_id = ${s.tenantId} and vin = ${VIN}`)[0].n,
    };
    assert.equal(after.instances, before.instances, "no custody episode opened");
    assert.equal(after.active, 0, "no active inventory");
    assert.deepEqual(after.listing, before.listing, "listing not reactivated");
    assert.equal(after.reviews, 0, "service intake is not a reappearance");
    const [state] = await admin`select custody_state from public.vehicle_instances where id = ${inst.id}`;
    assert.equal(state.custody_state, "delivered");
  } finally {
    await srv.close();
  }
} });
