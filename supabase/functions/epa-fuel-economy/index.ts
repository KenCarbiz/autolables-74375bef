// ──────────────────────────────────────────────────────────────────────
// epa-fuel-economy — official EPA fuel economy from fueleconomy.gov (public
// domain; no key required). Matches a listing's year/make/model against the
// EPA vehicle menu, prefers the option whose text matches the decoded engine
// displacement and drivetrain, and persists the normalized record so the
// customer passport can show a Monroney-style fuel economy panel and the
// Buying Report can use the government annual-fuel-cost figure instead of an
// assumption.
//
// Body: { vin?, tenant_id?, batch?, force? }
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron } from "../_shared/supabase.ts";

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

// EPA model names sometimes carry suffixes ("Q50 AWD") — try the exact model,
// then progressively shorter prefixes of the listing's model words.
const findModels = async (year: string, make: string, model: string): Promise<string[]> => {
  const b = await fetchJson(`${FE_BASE}/vehicle/menu/model?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}`);
  const models = menuItems(b).map((m) => m.text);
  const target = model.toLowerCase();
  const exact = models.filter((m) => m.toLowerCase() === target);
  if (exact.length) return exact;
  const starts = models.filter((m) => m.toLowerCase().startsWith(target) || target.startsWith(m.toLowerCase()));
  if (starts.length) return starts;
  const first = target.split(/\s+/)[0];
  return models.filter((m) => m.toLowerCase().split(/\s+/)[0] === first);
};

const pickOption = (options: { text: string; value: string }[], hints: { liters: string | null; awd: boolean }): { text: string; value: string } | null => {
  if (!options.length) return null;
  const scored = options.map((o) => {
    const t = o.text.toLowerCase();
    let score = 0;
    if (hints.liters && t.includes(`${hints.liters} l`)) score += 2;
    if (hints.awd && /(awd|4wd|4x4|all.?wheel)/.test(t)) score += 1;
    if (!hints.awd && /(awd|4wd|4x4)/.test(t)) score -= 1;
    return { o, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0].o;
};

async function lookupEpa(l: { ymm: string | null; mc: Record<string, unknown> }): Promise<EpaRecord | { error: string }> {
  const parts = (l.ymm || "").trim().split(/\s+/);
  const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : null;
  const make = parts[1] || null;
  const model = parts.slice(2).join(" ").trim() || null;
  if (!year || !make || !model) return { error: "missing_ymm" };

  const engine = String(l.mc.engine ?? l.mc.engine_size ?? "");
  const liters = engine.match(/(\d\.\d)\s*l/i)?.[1] ?? null;
  const awd = /(awd|4wd|4x4|all.?wheel)/i.test(String(l.mc.drivetrain ?? ""));

  try {
    const models = await findModels(year, make, model);
    if (!models.length) return { error: "no_model_match" };
    for (const m of models) {
      const b = await fetchJson(`${FE_BASE}/vehicle/menu/options?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(m)}`);
      const opt = pickOption(menuItems(b), { liters, awd });
      if (!opt) continue;
      // deno-lint-ignore no-explicit-any
      const v: any = await fetchJson(`${FE_BASE}/vehicle/${opt.value}`);
      if (!v || v.id == null) continue;
      return {
        vehicleId: Number(v.id),
        matchedOption: `${year} ${make} ${m} — ${opt.text}`,
        city: num(v.city08),
        highway: num(v.highway08),
        combined: num(v.comb08),
        annualFuelCost: num(v.fuelCost08),
        co2TailpipeGpm: num(v.co2TailpipeGpm),
        ghgScore: num(v.ghgScore),
        rangeMiles: num(v.rangeA) ?? num(v.range),
        fuelType: v.fuelType ? String(v.fuelType) : null,
        source: "fueleconomy.gov",
        checkedAt: new Date().toISOString(),
      };
    }
    return { error: "no_option_match" };
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

  if (body.batch) {
    // Batch sweep: all tenants under cron; pinned to one tenant for a JWT
    // caller. EPA data is static per model-year, so a 30-day re-check is
    // plenty; force overrides.
    const force = !!body.force;
    let q = admin.from("vehicle_listings")
      .select("id, vin, ymm, mc_attributes, epa_checked_at")
      .limit(400);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data: vehicles } = await q;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let checked = 0, matched = 0, skipped = 0, errors = 0;
    for (const v of (vehicles || []) as { id: string; vin: string | null; ymm: string | null; mc_attributes: Record<string, unknown> | null; epa_checked_at: string | null }[]) {
      if (!v.ymm) { skipped++; continue; }
      if (!force && v.epa_checked_at && new Date(v.epa_checked_at).getTime() > cutoff) { skipped++; continue; }
      const r = await lookupEpa({ ymm: v.ymm, mc: v.mc_attributes || {} });
      checked++;
      if ("error" in r) {
        errors++;
        // Stamp the attempt so an unmatched model isn't retried every sweep.
        // deno-lint-ignore no-explicit-any
        await (admin as any).from("vehicle_listings").update({ epa_checked_at: new Date().toISOString() }).eq("id", v.id);
      } else { await persist(v.id, r); matched++; }
      await new Promise((res) => setTimeout(res, 150));
    }
    return json(200, { batch: true, checked, matched, skipped, errors });
  }

  const vin = String(body.vin || "").toUpperCase().trim();
  if (!validVin(vin)) return json(400, { error: "invalid_vin" });
  let lq = admin.from("vehicle_listings").select("id, ymm, mc_attributes").eq("vin", vin);
  if (tenantId) lq = lq.eq("tenant_id", tenantId);
  const { data: listing } = await lq.maybeSingle();
  if (!listing) return json(404, { error: "listing_not_found" });

  const r = await lookupEpa({ ymm: listing.ymm as string | null, mc: (listing.mc_attributes as Record<string, unknown>) || {} });
  if ("error" in r) return json(200, { vin, available: false, error: r.error });
  await persist(listing.id as string, r);
  return json(200, { vin, available: true, ...r });
});
