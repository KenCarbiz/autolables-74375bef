// Resolve a dealership's market area from its rooftop ZIP.
//
// V3 section 23 permits geographic terminology when verified dealership
// location information is supplied, and forbids spamming city names. So this
// runs ONCE PER TENANT and stores the result, rather than computing a radius
// on every vehicle: the market area is a property of the dealership, and a
// per-generation geo computation would be both wasteful and non-deterministic.
//
// The market area is a 45-MILE radius (owner direction, 2026-09-08). A wider
// radius does not mean a longer town list inside one description -- naming
// more towns per description is doorway-page behaviour. It means a larger POOL
// that the writer rotates across the fleet, so every vehicle names two or
// three places and the lot as a whole covers the radius. The limit is
// therefore the size of that pool, not the size of any one description.
//
//   node scripts/build-selling-areas.mjs <zips.csv> <zip> [radiusMiles] [limit]
//
// Output is the envelope description_settings.selling_areas_meta stores, plus
// the plain name list for description_settings.selling_areas. Every distance
// in it was measured; nothing in this file guesses one.

import { readFileSync } from "node:fs";

const R_MILES = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(s));
}

// ZIPs with no delivery area — PO-Box-only and similar — carry a COUNTY
// CENTROID rather than their own coordinate, and many ZIPs then share one
// point: 06011 Bristol, 06030 Farmington, 06045 Manchester and 06102 Hartford
// all sit on 41.791776,-72.718832, which put Bristol 2.6 miles from Hartford
// instead of eighteen. Nationally one coordinate is shared by 452 ZIPs.
// Trusting them silently produces a market area that is simply wrong.
const FALLBACK_SHARE_LIMIT = 3;

export function parseZips(csv) {
  const [head, ...rows] = csv.trim().split("\n");
  const cols = head.split(",");
  const i = (n) => cols.indexOf(n);
  const parsed = [];
  const seen = new Map();
  for (const line of rows) {
    const f = line.split(",");
    const lat = Number(f[i("lat")]), lon = Number(f[i("lon")]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue;
    const point = `${lat},${lon}`;
    seen.set(point, (seen.get(point) || 0) + 1);
    parsed.push({ code: f[i("code")], city: f[i("city")], state: f[i("state")], lat, lon, point });
  }
  const out = new Map();
  for (const z of parsed) {
    if (seen.get(z.point) > FALLBACK_SHARE_LIMIT) continue;
    out.set(z.code, z);
  }
  return out;
}

export function marketArea(zips, originZip, radiusMiles, limit = 20) {
  const origin = zips.get(originZip);
  if (!origin) throw new Error(`unknown ZIP ${originZip}`);
  // No population column exists, and distance alone surfaced hamlets over real
  // markets — Bozrah ahead of Springfield. How many ZIPs a city carries is a
  // rough size proxy that IS in the data, and it is good enough to rank by.
  const size = new Map();
  for (const [, p] of zips) {
    const k = `${p.city}, ${p.state}`;
    size.set(k, (size.get(k) || 0) + 1);
  }
  const best = new Map();
  for (const [, p] of zips) {
    if (p.state !== origin.state && haversine(origin, p) > radiusMiles) continue;
    const d = haversine(origin, p);
    if (d > radiusMiles) continue;
    const key = `${p.city}, ${p.state}`;
    if (!best.has(key) || best.get(key).miles > d) {
      best.set(key, { area: key, miles: Math.round(d * 10) / 10, size: size.get(key) || 1 });
    }
  }
  // Nearest-first then capped returned twenty towns all inside ten miles,
  // which is not the market area anyone means by "forty miles". Sample across
  // the radius instead: the near towns matter most, the far ones are what the
  // radius was for. A prompt carrying every one of the two hundred towns in
  // range would be keyword spam, which the writing standard forbids.
  const ranked = [...best.values()].sort((a, b) => a.miles - b.miles);
  const bands = [0.25, 0.5, 0.75, 1].map((f) => radiusMiles * f);
  const share = [0.4, 0.25, 0.2, 0.15];
  const picked = [];
  let from = 0;
  bands.forEach((upper, i) => {
    const want = Math.max(1, Math.round(limit * share[i]));
    const inBand = ranked
      .filter((x) => (i === 0 ? x.miles >= from : x.miles > from) && x.miles <= upper)
      .sort((a, b) => b.size - a.size || a.miles - b.miles);
    picked.push(...inBand.slice(0, want));
    from = upper;
  });
  // Top up from the nearest remainder if a band was thin.
  for (const x of ranked) {
    if (picked.length >= limit) break;
    if (!picked.includes(x)) picked.push(x);
  }
  return picked.sort((a, b) => a.miles - b.miles).slice(0, limit);
}

export const DEFAULT_RADIUS_MILES = 45;
export const DEFAULT_POOL_SIZE = 40;

export function marketAreaEnvelope(zips, originZip, radiusMiles, limit, dataset) {
  const areas = marketArea(zips, originZip, radiusMiles, limit);
  return {
    method: "radius_derived",
    origin_zip: originZip,
    radius_miles: radiusMiles,
    dataset: dataset || "unspecified",
    derived_at: new Date().toISOString(),
    areas: areas.map(({ area, miles }) => ({ area, miles })),
  };
}

const [csvPath, zip, radius, limit, dataset] = process.argv.slice(2);
if (csvPath) {
  const miles = Number(radius) || DEFAULT_RADIUS_MILES;
  const envelope = marketAreaEnvelope(
    parseZips(readFileSync(csvPath, "utf8")), zip, miles,
    Number(limit) || DEFAULT_POOL_SIZE, dataset);
  console.log(JSON.stringify({
    selling_areas: envelope.areas.map((a) => a.area),
    selling_areas_meta: envelope,
    geo_radius_miles: miles,
    geo_origin_zip: zip,
  }, null, 2));
}
