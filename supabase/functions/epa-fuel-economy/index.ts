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
import { matchEpa, listingPowertrain, litersOf, driveOf, EPA_MATCHER_VERSION, type EpaClient, type MatchResult } from "../_shared/epaMatch.ts";

const FE_BASE = "https://www.fueleconomy.gov/ws/rest";
const JSON_HDR = { Accept: "application/json" };

const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);

interface EpaRecord {
  vehicleId: number;
  matchedOption: string;
  city: number | null;
  highway: number | null;
  combined: number | null;
  annualFuelCost: number | null;
  co2TailpipeGpm: number | null;
  ghgScore: number | null;
  rangeMiles: number | null;
  fuelType: string | null;
  atvType: string | null;
  matchBasis: MatchResult["basis"];
  matcherVersion: string;
  source: "fueleconomy.gov";
  checkedAt: string;
}

// deno-lint-ignore no-explicit-any
const num = (v: any): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

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

async function lookupEpa(l: { ymm: string | null; trim: string | null; mc: Record<string, unknown> }): Promise<EpaRecord | { error: string }> {
  const parts = (l.ymm || "").trim().split(/\s+/);
  const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
  const make = parts[1] || "";
  const model = parts.slice(2).join(" ").trim();
  const trim = l.trim ?? (l.mc.trim as string | undefined) ?? null;
  const facts = {
    year, make, model, trim,
    liters: litersOf(String(l.mc.engine ?? l.mc.engine_size ?? "")),
    drive: driveOf(String(l.mc.drivetrain ?? "")),
    powertrain: listingPowertrain({ powertrainType: l.mc.powertrain_type, fuelType: l.mc.fuel_type, trim, model }),
  };
  try {
    const r = await matchEpa(facts, api);
    if ("refused" in r) return { error: r.refused };
    const v = r.vehicle;
    return {
      vehicleId: Number(v.id),
      matchedOption: `${year} ${make} ${r.model} — ${r.option}`,
      city: num(v.city08),
      highway: num(v.highway08),
      combined: num(v.comb08),
      annualFuelCost: num(v.fuelCost08),
      co2TailpipeGpm: num(v.co2TailpipeGpm),
      ghgScore: num(v.ghgScore),
      rangeMiles: num(v.rangeA) ?? num(v.range),
      fuelType: v.fuelType ? String(v.fuelType) : null,
      atvType: v.atvType ? String(v.atvType) : null,
      matchBasis: r.basis,
      matcherVersion: EPA_MATCHER_VERSION,
      source: "fueleconomy.gov",
      checkedAt: new Date().toISOString(),
    };
  } catch (_e) {
    return { error: "timeout_or_network" };
  }
}

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

  // deno-lint-ignore no-explicit-any
  const persist = async (id: string, rec: EpaRecord) =>
    await (admin as any).from("vehicle_listings")
      .update({ epa_economy: rec, epa_checked_at: rec.checkedAt })
      .eq("id", id);

  // Stamp the attempt so an unmatched model isn't retried every sweep. A
  // definite refusal also clears a stored match: the earlier matcher's record
  // for a car the new one will not match is not this car's data. A network
  // failure leaves what is stored.
  const refuse = async (id: string, reason: string) =>
    // deno-lint-ignore no-explicit-any
    await (admin as any).from("vehicle_listings")
      .update(reason === "timeout_or_network"
        ? { epa_checked_at: new Date().toISOString() }
        : { epa_economy: null, epa_checked_at: new Date().toISOString() })
      .eq("id", id);

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
    for (const v of (vehicles || []) as { id: string; vin: string | null; ymm: string | null; trim: string | null; mc_attributes: Record<string, unknown> | null; epa_economy: Record<string, unknown> | null; epa_checked_at: string | null }[]) {
      if (!v.ymm) { skipped++; continue; }
      // A record written by an earlier matcher is re-checked whatever its age.
      const current = v.epa_economy?.matcherVersion === EPA_MATCHER_VERSION || !v.epa_economy;
      if (!force && current && v.epa_checked_at && new Date(v.epa_checked_at).getTime() > cutoff) { skipped++; continue; }
      const r = await lookupEpa({ ymm: v.ymm, trim: v.trim, mc: v.mc_attributes || {} });
      checked++;
      if ("error" in r) {
        errors++;
        await refuse(v.id, r.error);
      } else { await persist(v.id, r); matched++; }
      await new Promise((res) => setTimeout(res, 150));
    }
    return json(200, { batch: true, checked, matched, skipped, errors });
  }

  const vin = String(body.vin || "").toUpperCase().trim();
  if (!validVin(vin)) return json(400, { error: "invalid_vin" });
  let lq = admin.from("vehicle_listings").select("id, ymm, trim, mc_attributes").eq("vin", vin);
  if (tenantId) lq = lq.eq("tenant_id", tenantId);
  const { data: listing } = await lq.maybeSingle();
  if (!listing) return json(404, { error: "listing_not_found" });

  const r = await lookupEpa({ ymm: listing.ymm as string | null, trim: (listing.trim as string | null) ?? null, mc: (listing.mc_attributes as Record<string, unknown>) || {} });
  if ("error" in r) { await refuse(listing.id as string, r.error); return json(200, { vin, available: false, error: r.error }); }
  await persist(listing.id as string, r);
  return json(200, { vin, available: true, ...r });
});
