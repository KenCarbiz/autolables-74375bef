// MarketCheck SANDBOX harness — free, isolated, never touches Supabase.
//
//   MARKETCHECK_SANDBOX_API_KEY=... bun scripts/marketcheck-sandbox.ts [--vins 6] [--out <dir>] [--fixture]
//
// 1. Discovers sample VINs from sandbox inventory search (no hard-coded VINs).
// 2. For each VIN calls basic decode, NeoVIN decode and history.
// 3. Probes the v4.9.0 `match` parameter (valid → 200 expected, invalid →
//    blocked client-side, raw invalid → provider 400) and an invalid param.
// 4. Runs every vehicle through the real Passport pipeline (structuredSheet →
//    derivePassport → data contract → buildNextPassportData → coverage) and
//    writes a field-level report: received / normalized / consumed /
//    displayed / excluded / missing.
//
// Safety: sandbox host + sandbox key only (resolveMarketcheckConfig refuses
// anything else), 5 req/s, a hard per-run cap (default 60 requests, well inside
// the 25,000/month sandbox allowance), and no database client is imported.
// Price prediction / comparables are not in the sandbox; those are covered by
// stored production fixtures (src/lib/vehicleData/__fixtures__).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MarketcheckClient, resolveMarketcheckConfig, MATCH_ATTRIBUTES, type McResult } from "../supabase/functions/_shared/marketcheckClient";
import { structuredSheet } from "../supabase/functions/_shared/neovinSheet";
import { derivePassport } from "../src/lib/passportV2Data";
import { buildVehiclePassportDataContract } from "../src/lib/vehicleData/dataContract";
import { buildNextPassportData } from "../src/lib/passport/nextPassportData";
import { deriveVerificationReport } from "../src/lib/passport/verificationSummary";
import { buildPassportSaleCard } from "../src/lib/passport/saleCard";
import { assessPassportCoverage } from "../src/lib/vehicleData/passportCoverage";
import { unmappedFields, resolveRow, type FieldGroup } from "../src/lib/vehicleData/fieldRegistry";
import type { VehicleListing } from "../src/hooks/useVehicleListing";

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
};

const maxVins = Number(arg("vins", "6"));
const outDir = arg("out", "sandbox-report");
const writeFixture = process.argv.includes("--fixture");

// --offline replays stored production fixtures through a fake sandbox so the
// harness itself can be verified with no key and no network.
const offline = process.argv.includes("--offline");
const config = offline
  ? { environment: "sandbox" as const, baseUrl: "https://api.sandbox.marketcheck.com/v2", apiKey: "offline" }
  : (() => {
    try { return resolveMarketcheckConfig("sandbox", (k) => process.env[k]); }
    catch (e) { console.error(`sandbox not configured: ${(e as Error).message}`); process.exit(2); }
  })();
const calls: { url: string; status: number | null; attempt: number }[] = [];

async function offlineFetch(input: string | URL | Request): Promise<Response> {
  const { default: rows } = await import("../src/lib/vehicleData/__fixtures__/acceptanceVehicles.json");
  const u = new URL(String(input));
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const all = rows as Bag[];
  if (u.pathname.endsWith("/search/car/active")) {
    if (u.searchParams.get("rows") === "abc") return json(400, { code: 400, message: "Request validation failed: Parameter (rows) is not a valid integer" });
    const want = u.searchParams.get("car_type");
    const pick = all.filter((r) => !want || (want === "new") === (r.condition === "new")).slice(0, Number(u.searchParams.get("rows") || 1));
    return json(200, { num_found: pick.length, listings: pick.map((r) => {
      const m = bag(r.mc_attributes);
      return { id: `fx-${r.vin}`, vin: r.vin, price: Number(r.price), miles: r.mileage, inventory_type: r.condition, msrp: m.msrp, exterior_color: m.exterior_color, interior_color: m.interior_color, dom: m.dom,
        build: { year: m.year, make: m.make, model: m.model, trim: m.trim, version: m.version, body_type: m.body_type, engine: m.engine, transmission: m.transmission, drivetrain: m.drivetrain, fuel_type: m.fuel_type, powertrain_type: m.powertrain_type, std_seating: m.std_seating, made_in: m.made_in } };
    }) });
  }
  const vin = u.pathname.split("/").find((p) => p.length === 17);
  const row = all.find((r) => r.vin === vin);
  if (u.pathname.includes("/neovin/")) return row?.neovin ? json(200, row.neovin) : json(404, { message: "VIN not found" });
  if (u.pathname.includes("/decode/car/")) return row ? json(200, { year: bag(row.mc_attributes).year, make: bag(row.mc_attributes).make }) : json(404, { message: "VIN not found" });
  if (u.pathname.includes("/history/car/")) return json(200, []);
  return json(404, { message: "Endpoint not available in sandbox" });
}

const mc = new MarketcheckClient({
  config, ratePerSecond: 5, maxRequests: Number(arg("max-requests", "60")),
  ...(offline ? { fetchImpl: offlineFetch as typeof fetch } : {}),
  onRequest: (i) => calls.push({ url: i.url, status: i.status, attempt: i.attempt }),
});

const summarize = (r: McResult) => (r.ok ? { ok: true, status: r.status } : { ok: false, ...r.error });

/** Same shape marketcheck-sync writes: build spread + listing signals. */
function listingFromSandbox(l: Bag, neovin: unknown, history: unknown): VehicleListing {
  const b = bag(l.build);
  const sheet = neovin ? structuredSheet(neovin) : null;
  const n = bag(neovin);
  const mcAttrs: Bag = {
    ...b,
    msrp: l.msrp ?? null, exterior_color: l.exterior_color ?? null, interior_color: l.interior_color ?? null,
    base_ext_color: l.base_ext_color ?? null, base_int_color: l.base_int_color ?? null,
    seating: b.std_seating ?? null, dom: l.dom ?? null, dom_active: l.dom_active ?? null, dom_180: l.dom_180 ?? null,
    first_seen_at: l.first_seen_at ?? null, last_seen_at: l.last_seen_at ?? null,
    carfax_1_owner: l.carfax_1_owner ?? null, carfax_clean_title: l.carfax_clean_title ?? null,
    seller_type: l.seller_type ?? null, in_transit: l.in_transit ?? null, vehicle_status: l.vehicle_status ?? null,
    fees: l.fees ?? null, price_includes_fees: l.price_includes_fees ?? null,
    mc_listing_id: l.id ?? null,
    ...(sheet ? { build_sheet: sheet, base_msrp: n.msrp ?? null, delivery_charges: n.delivery_charges ?? null, total_msrp: n.combined_msrp ?? null, specs_source: "neovin", specs_decoded_at: new Date().toISOString() } : {}),
  };
  const entries = Array.isArray(history) ? (history as Bag[]) : [];
  return {
    id: `sandbox-${l.id}`, vin: l.vin, slug: `sandbox-${String(l.vin).slice(-6).toLowerCase()}`,
    status: "published", condition: String(l.inventory_type || "used").toLowerCase(),
    ymm: [b.year, b.make, b.model].filter(Boolean).join(" "), trim: b.trim ?? null,
    mileage: l.miles ?? null, price: l.price ?? null, doc_fee: null,
    mc_attributes: mcAttrs, mc_raw: l, key_specs: {},
    history_payload: entries.length ? {
      available: true, source: "marketcheck_history", checked_at: new Date().toISOString(), owners: null, inServiceDate: null,
      firstSeen: entries.map((e) => String(e.first_seen_at ?? "")).filter(Boolean).sort()[0] ?? null,
      entries: entries.map((e) => ({ price: e.price ?? null, miles: e.miles ?? null, seller_type: e.seller_type ?? null, inventory_type: e.inventory_type ?? null, dealer: null, first_seen: e.first_seen_at ?? null, last_seen: e.last_seen_at ?? null })),
    } : null,
    photos: (bag(l.media).photo_links as string[] | undefined) ?? [],
  } as unknown as VehicleListing;
}

function fieldReport(group: FieldGroup, obj: unknown) {
  const keys = Object.keys(bag(obj));
  return keys.map((k) => {
    const row = resolveRow(group, k);
    return { group, path: k, mapped: !!row, destination: row?.destination ?? null, status: row?.status ?? "unmapped" };
  });
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const probes: Bag = {};

  // 1. Discover VINs (mix of new and used if the sample has both)
  const used = await mc.searchActive({ rows: Math.ceil(maxVins / 2), car_type: "used" });
  const fresh = await mc.searchActive({ rows: Math.ceil(maxVins / 2), car_type: "new" });
  probes.search_used = summarize(used);
  probes.search_new = summarize(fresh);
  const listings = [used, fresh].flatMap((r) => (r.ok ? ((bag(r.data).listings as Bag[]) ?? []) : []))
    .filter((l) => typeof l.vin === "string" && (l.vin as string).length === 17).slice(0, maxVins);

  // 2. match parameter (v4.9.0)
  probes.match_valid = summarize(await mc.searchActive({ rows: 1, match: MATCH_ATTRIBUTES.slice(0, 3).join(",") }));
  try { await mc.searchActive({ rows: 1, match: "year,color" }); probes.match_invalid_client = "NOT BLOCKED"; }
  catch (e) { probes.match_invalid_client = `blocked before send: ${(e as Error).message}`; }
  probes.invalid_param = summarize(await mc.searchActive({ rows: "abc" }));

  // 3. Per-VIN endpoints + pipeline
  const vehicles: Bag[] = [];
  const fixtures: Bag[] = [];
  for (const l of listings) {
    const vin = String(l.vin);
    const basic = await mc.decodeBasic(vin);
    const neovin = await mc.decodeNeovin(vin);
    const hist = await mc.history(vin);
    const nv = neovin.ok ? neovin.data : null;
    const listing = listingFromSandbox(l, nv, hist.ok ? hist.data : null);
    const d = derivePassport(listing);
    const contract = buildVehiclePassportDataContract(listing, d);
    const next = buildNextPassportData({
      d, listing: listing as never, report: deriveVerificationReport(d, listing),
      saleCard: buildPassportSaleCard(d, String((listing as unknown as Bag).condition)), gallery: [], contract,
    });
    const coverage = assessPassportCoverage(listing, nv);
    vehicles.push({
      vin, ymm: (listing as unknown as Bag).ymm, condition: (listing as unknown as Bag).condition,
      endpoints: { basic_decode: summarize(basic), neovin: summarize(neovin), history: summarize(hist) },
      received: {
        listing: fieldReport("listing", l), build: fieldReport("listing.build", l.build),
        neovin: fieldReport("neovin", nv), basic_decode_keys: basic.ok ? Object.keys(bag(basic.data)) : [],
      },
      unmapped: {
        listing: unmappedFields("listing", l), build: unmappedFields("listing.build", l.build),
        dealer: unmappedFields("listing.dealer", l.dealer), media: unmappedFields("listing.media", l.media),
        neovin: unmappedFields("neovin", nv),
      },
      normalized: { build_sheet: !!bag(listing.mc_attributes).build_sheet, msrp: contract.buildSheet?.msrp ?? null },
      displayed: {
        equipment: { state: next.equipment.state, basis: next.equipment.basis, packages: next.equipment.packages.length, options: next.equipment.options.length, notVerified: next.equipment.notVerified.length, features: next.equipment.featureCount },
        factoryMsrp: { state: next.factoryMsrp.state, total: next.factoryMsrp.total, status: next.factoryMsrp.status },
        specifications: next.specifications.groups.map((g) => g.name),
        timeline: next.timeline.events.map((e) => `${e.label} (${e.status})`),
        warranty: next.warranty.state,
      },
      coverage: coverage.categories.map((c) => ({ key: c.key, status: c.status, detail: c.detail })),
    });
    if (writeFixture) fixtures.push({ listing, neovin: nv });
  }

  const report = {
    generated_at: new Date().toISOString(), environment: mc.environment, host: config.baseUrl,
    requests_sent: mc.requestsSent, calls, probes, vehicles,
  };
  writeFileSync(join(outDir, "sandbox-report.json"), JSON.stringify(report, null, 2));
  if (writeFixture) writeFileSync(join("src/lib/vehicleData/__fixtures__", "sandboxVehicles.json"), JSON.stringify(fixtures));
  console.log(`sandbox: ${vehicles.length} vehicles, ${mc.requestsSent} requests → ${join(outDir, "sandbox-report.json")}`);
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
