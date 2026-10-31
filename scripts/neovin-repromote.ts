// Zero-call NeoVIN re-promotion: dry run, apply SQL and rollback SQL.
//
// Reads two JSON exports produced by plain SELECTs (no provider call, no
// write) and plans the additive lift for every listing:
//
//   listings.json   SELECT v.id, v.vin, v.status, v.mc_attributes,
//                          EXISTS (SELECT 1 FROM store_inventory si WHERE si.listing_id = v.id AND si.presence = 'present') AS in_feed
//                   FROM vehicle_listings v
//                   WHERE v.vin IS NOT NULL AND v.id IN (SELECT vehicle_id FROM neovin_snapshots);
//
// Only canonical records are planned: a published listing. Archived listings,
// drafts and anything a duplicate review has not settled are reported as
// out_of_scope and get no SQL. Pass --require-feed to also require a live
// feed record (the strictest scope).
//   snapshots.json  SELECT id, vehicle_id, vin, endpoint, payload, payload_hash,
//                          http_status, fetched_at FROM neovin_snapshots;
//
//   bun run scripts/neovin-repromote.ts <listings.json> <snapshots.json> <outDir>
//
// Writes <outDir>/report.json, apply.sql and rollback.sql. Nothing is applied.
// apply.sql is additive in SQL as well as in the plan (`added || existing`, so
// an existing key always wins), and each statement re-checks the stored
// equipment, so running it twice, or after a newer decode, changes nothing.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { planRepromotion, summarize, type ListingRow, type SnapshotRow } from "../supabase/functions/_shared/neovinRepromotion.ts";

const args = process.argv.slice(2);
const requireFeed = args.includes("--require-feed");
const [listingsPath, snapshotsPath, outDir] = args.filter((a) => !a.startsWith("--"));
if (!listingsPath || !snapshotsPath || !outDir) {
  console.error("usage: bun run scripts/neovin-repromote.ts <listings.json> <snapshots.json> <outDir>");
  process.exit(1);
}

type ScopedListing = ListingRow & { status?: string | null; in_feed?: boolean | null };
const allListings = JSON.parse(readFileSync(listingsPath, "utf8")) as ScopedListing[];
const inScope = (l: ScopedListing) => l.status === "published" && (!requireFeed || l.in_feed === true);
const listings = allListings.filter(inScope);
const outOfScope = allListings.filter((l) => !inScope(l)).map((l) => ({ listingId: l.id, outcome: "out_of_scope", status: l.status ?? null, in_feed: l.in_feed ?? null }));
const snapshots = JSON.parse(readFileSync(snapshotsPath, "utf8")) as (SnapshotRow & { vehicle_id: string | null })[];
const byVehicle = new Map<string, SnapshotRow[]>();
for (const s of snapshots) {
  if (!s.vehicle_id) continue;
  (byVehicle.get(s.vehicle_id) ?? byVehicle.set(s.vehicle_id, []).get(s.vehicle_id)!).push(s);
}

const plans = listings
  .slice()
  .sort((a, b) => (a.id < b.id ? -1 : 1))
  .map((l) => planRepromotion(l, byVehicle.get(l.id) ?? []));

const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const uuid = (s: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error(`not a uuid: ${s}`);
  return `'${s}'`;
};

const apply: string[] = ["BEGIN;"];
const rollback: string[] = ["BEGIN;"];
const before = new Map(listings.map((l) => [l.id, l.mc_attributes ?? {}]));
for (const p of plans) {
  if (p.outcome !== "would_update" || !p.next) continue;
  const prev = before.get(p.listingId) as Record<string, unknown>;
  const prevSheet = (prev.build_sheet ?? null) as Record<string, unknown> | null;
  const nextSheet = p.next.build_sheet as Record<string, unknown>;
  const top: Record<string, unknown> = {};
  const sheetAdds: Record<string, unknown> = {};
  for (const k of p.addedKeys) {
    if (k.startsWith("build_sheet.")) sheetAdds[k.slice(12)] = nextSheet[k.slice(12)];
    else if (k !== "build_sheet") top[k] = p.next[k];
  }
  const equipmentGuard = prevSheet
    ? ["packages", "options", "key_features", "standard", "generic"]
        .map((k) => `(mc_attributes->'build_sheet'->'${k}') IS NOT DISTINCT FROM ${prevSheet[k] === undefined ? "NULL" : lit(prevSheet[k])}`)
        .join("\n    AND ")
    : "mc_attributes->'build_sheet' IS NULL";
  const sheetExpr = prevSheet
    ? `${lit(sheetAdds)} || (mc_attributes->'build_sheet')`
    : lit(nextSheet);
  apply.push(
    `UPDATE public.vehicle_listings SET mc_attributes =\n  jsonb_set(${lit(top)} || coalesce(mc_attributes, '{}'::jsonb), '{build_sheet}', ${sheetExpr})\n` +
    `WHERE id = ${uuid(p.listingId)}\n    AND ${equipmentGuard};`,
  );
  const removeTop = Object.keys(top).map((k) => ` - '${k}'`).join("");
  const sheetRollback = prevSheet
    ? `jsonb_set(mc_attributes${removeTop}, '{build_sheet}', (mc_attributes->'build_sheet')${Object.keys(sheetAdds).map((k) => ` - '${k}'`).join("")})`
    : `mc_attributes${removeTop} - 'build_sheet'`;
  rollback.push(
    `UPDATE public.vehicle_listings SET mc_attributes = ${sheetRollback}\n` +
    `WHERE id = ${uuid(p.listingId)}\n    AND mc_attributes->'build_sheet'->'repromoted_from'->>'snapshot_id' = '${p.snapshotId}';`,
  );
}
apply.push("COMMIT;");
rollback.push("COMMIT;");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  scope: requireFeed ? "published_and_in_feed" : "published",
  ...summarize(plans),
  outOfScope: outOfScope.length,
  listings: plans.map(({ next: _n, ...rest }) => rest),
  excluded: outOfScope,
}, null, 2));
writeFileSync(join(outDir, "apply.sql"), apply.join("\n\n") + "\n");
writeFileSync(join(outDir, "rollback.sql"), rollback.join("\n\n") + "\n");
console.log(JSON.stringify({ scope: requireFeed ? "published_and_in_feed" : "published", ...summarize(plans), outOfScope: outOfScope.length }, null, 2));
