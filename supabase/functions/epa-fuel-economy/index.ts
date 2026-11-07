// ──────────────────────────────────────────────────────────────────────
// epa-fuel-economy — official EPA fuel economy from fueleconomy.gov (public
// domain; no key required). Matches a listing's year/make/model against the
// EPA vehicle menu with the powertrain-, drivetrain- and engine-aware rules in
// _shared/epaMatch.ts (refusing rather than guessing), and persists the record so the
// customer passport can show a Monroney-style fuel economy panel and the
// Buying Report can use the government annual-fuel-cost figure instead of an
// assumption.
//
// Body: { vin?, tenant_id?, batch?, force? }
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron } from "../_shared/supabase.ts";
import { matchEpa, listingPowertrain, litersOf, driveOf, transOf, cylindersOf, EPA_MATCHER_VERSION, VERIFIED_MATCHERS, type EpaClient } from "../_shared/epaMatch.ts";
import { buildEpaSnapshot, mergeEpaSnapshot, parseFuelPrices, retireEpaRecord, snapshotListingMismatch, type EpaFuelPrices, type EpaSnapshot } from "../_shared/epaSnapshot.ts";

const FE_BASE = "https://www.fueleconomy.gov/ws/rest";
const JSON_HDR = { Accept: "application/json" };

const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);

// fueleconomy.gov returns a bare object for a single menu item and an array
// for many — normalize both shapes.
// deno-lint-ignore no-explicit-any
const menuItems = (b: any): { text: string; value: string }[] => {
  const raw = b?.menuItem ?? [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.filter((m) => m && m.value != null).map((m) => ({ text: String(m.text ?? ""), value: String(m.value) }));
};

const fetchJson = async (url: string) => {
  const res = await fetch(url, { headers: JSON_HDR, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`fueleconomy_${res.status}`);
  return await res.json().catch(() => ({}));
};

const api: EpaClient = {
  models: async (year, make) => menuItems(await fetchJson(`${FE_BASE}/vehicle/menu/model?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}`)),
  options: async (year, make, model) => menuItems(await fetchJson(`${FE_BASE}/vehicle/menu/options?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`)),
  // deno-lint-ignore no-explicit-any
  vehicle: async (id) => { const v: any = await fetchJson(`${FE_BASE}/vehicle/${encodeURIComponent(id)}`); return v && v.id != null ? v : null; },
};

// Fuel prices are read at most once per invocation, only after the first
// match, and only attached to snapshots retrieved the same UTC day.
let fuelPrices: Promise<EpaFuelPrices | null> | null = null;
const currentFuelPrices = () =>
  fuelPrices ??= fetchJson(`${FE_BASE}/fuelprices`)
    .then((b) => parseFuelPrices(b, new Date().toISOString()))
    .catch(() => null);

async function lookupEpa(l: { vin: string | null; ymm: string | null; trim: string | null; mc: Record<string, unknown> }): Promise<EpaSnapshot | { error: string }> {
  const parts = (l.ymm || "").trim().split(/\s+/);
  const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
  const make = parts[1] || "";
  const model = parts.slice(2).join(" ").trim();
  const trim = l.trim ?? (l.mc.trim as string | undefined) ?? null;
  const facts = {
    year, make, model, trim,
    liters: litersOf(String(l.mc.engine ?? l.mc.engine_size ?? "")),
    drive: driveOf(String(l.mc.drivetrain ?? "")),
    trans: transOf(String(l.mc.transmission ?? "")),
    cylinders: cylindersOf(String(l.mc.engine ?? "")),
    powertrain: listingPowertrain({ powertrainType: l.mc.powertrain_type, fuelType: l.mc.fuel_type, trim, model }),
  };
  try {
    const r = await matchEpa(facts, api);
    if ("refused" in r) return { error: r.refused };
    const retrievedAt = new Date().toISOString();
    const snap = buildEpaSnapshot(r.vehicle, {
      listingVin: l.vin,
      matchedOption: `${year} ${make} ${r.model} — ${r.option}`,
      matchBasis: r.basis,
      matcherVersion: EPA_MATCHER_VERSION,
      retrievedAt,
      fuelPrices: await currentFuelPrices(),
    });
    if (!snap) return { error: "invalid_vehicle_record" };
    const mismatch = snapshotListingMismatch(snap, { vin: l.vin, year });
    return mismatch ? { error: mismatch } : snap;
  } catch (_e) {
    return { error: "timeout_or_network" };
  }
}

const verifiedRecord = (r: Record<string, unknown> | null | undefined) =>
  VERIFIED_MATCHERS.includes(String(r?.matcherVersion ?? ""));

// Nothing stored, an already retired record, or a verified match: none of
// these needs a re-check before the 30-day window.
const settled = (r: Record<string, unknown> | null | undefined) =>
  !r || r.status === "retired" || verifiedRecord(r);

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const admin = adminClient();
  const body = await req.json().catch(() => ({}));
  const tenantId: string | null = body.tenant_id || null;

  // ── Auth gate: service-role / cron secret bypasses; otherwise require a
  // signed-in member of the requested tenant (or platform admin).
  if (!isServiceOrCron(req)) {
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: ures, error: uerr } = await admin.auth.getUser(auth);
    const userId = ures?.user?.id;
    if (uerr || !userId) return json(401, { error: "authentication required" });
    if (!tenantId) return json(400, { error: "tenant_id required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!isAdmin) {
      const { data: membership } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
      if (!membership) return json(403, { error: "not a member of this tenant" });
    }
  }

  type Stored = { id: string; vin: string | null; epa_economy: Record<string, unknown> | null; epa_checked_at: string | null };

  // The write only lands if no other refresh touched the row since it was
  // read, so two overlapping refreshes cannot interleave their snapshots.
  const writeIfUnchanged = async (row: Stored, patch: Record<string, unknown>) => {
    // deno-lint-ignore no-explicit-any
    let q = (admin as any).from("vehicle_listings").update(patch).eq("id", row.id);
    q = row.epa_checked_at ? q.eq("epa_checked_at", row.epa_checked_at) : q.is("epa_checked_at", null);
    const { data } = await q.select("id");
    return Array.isArray(data) && data.length > 0;
  };

  const persist = async (row: Stored, snap: EpaSnapshot) => {
    const m = mergeEpaSnapshot(row.epa_economy, snap, VERIFIED_MATCHERS);
    if (m.outcome === "stale") return { outcome: m.outcome, record: m.record };
    const written = await writeIfUnchanged(row, { epa_economy: m.record, epa_checked_at: snap.checkedAt });
    return { outcome: written ? m.outcome : "concurrent_refresh", reason: m.reason, record: m.record };
  };

  // Stamp the attempt so an unmatched model isn't retried every sweep. A
  // network failure, or any refusal of a record a verified matcher (v3 on)
  // wrote, leaves the stored snapshot as it is: a later refusal is a tie or a
  // gap in the service, not evidence the figure is wrong. A definite refusal
  // of an older matcher's record retires it into history, hidden from readers
  // but not deleted.
  const refuse = async (row: Stored, reason: string) => {
    const now = new Date().toISOString();
    const keep = reason === "timeout_or_network" || settled(row.epa_economy);
    await writeIfUnchanged(row, keep ? { epa_checked_at: now } : { epa_economy: retireEpaRecord(row.epa_economy, reason, now), epa_checked_at: now });
  };

  if (body.batch) {
    // Batch sweep: all tenants under cron; pinned to one tenant for a JWT
    // caller. EPA data is static per model-year, so a 30-day re-check is
    // plenty; force overrides.
    const force = !!body.force;
    let q = admin.from("vehicle_listings")
      .select("id, vin, ymm, trim, mc_attributes, epa_economy, epa_checked_at")
      .limit(400);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data: vehicles } = await q;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let checked = 0, matched = 0, skipped = 0, errors = 0;
    let conflicts = 0;
    for (const v of (vehicles || []) as (Stored & { ymm: string | null; trim: string | null; mc_attributes: Record<string, unknown> | null })[]) {
      if (!v.ymm) { skipped++; continue; }
      // A record written by a pre-v3 matcher is re-checked whatever its age.
      if (!force && settled(v.epa_economy) && v.epa_checked_at && new Date(v.epa_checked_at).getTime() > cutoff) { skipped++; continue; }
      const r = await lookupEpa({ vin: v.vin, ymm: v.ymm, trim: v.trim, mc: v.mc_attributes || {} });
      checked++;
      if ("error" in r) {
        errors++;
        await refuse(v, r.error);
      } else {
        const p = await persist(v, r);
        if (p.outcome === "conflict") conflicts++; else matched++;
      }
      await new Promise((res) => setTimeout(res, 150));
    }
    return json(200, { batch: true, checked, matched, skipped, errors, conflicts });
  }

  const vin = String(body.vin || "").toUpperCase().trim();
  if (!validVin(vin)) return json(400, { error: "invalid_vin" });
  let lq = admin.from("vehicle_listings").select("id, vin, ymm, trim, mc_attributes, epa_economy, epa_checked_at").eq("vin", vin);
  if (tenantId) lq = lq.eq("tenant_id", tenantId);
  const { data: listing } = await lq.maybeSingle();
  if (!listing) return json(404, { error: "listing_not_found" });

  const row = listing as unknown as Stored & { ymm: string | null; trim: string | null; mc_attributes: Record<string, unknown> | null };
  const r = await lookupEpa({ vin: row.vin ?? vin, ymm: row.ymm, trim: row.trim ?? null, mc: row.mc_attributes || {} });
  if ("error" in r) { await refuse(row, r.error); return json(200, { vin, available: false, error: r.error }); }
  const p = await persist(row, r);
  const { history: _h, ...current } = p.record;
  return json(200, { vin, available: p.outcome !== "conflict", outcome: p.outcome, reason: p.reason ?? null, retrieved: r, current });
});
