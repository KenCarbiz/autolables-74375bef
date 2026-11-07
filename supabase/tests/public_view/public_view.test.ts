// Calls the public-listing-view handler exactly as it is on main (no availability
// projection) through the local gateway, then runs what the Passport does with that
// response. Proves the frontend-only fix works against today's server.
import assert from "node:assert/strict";
import { readPassportAvailability, availabilityCopy } from "../../functions/_shared/listingDisposition.ts";

const BASE = Deno.env.get("PUBLIC_VIEW_URL") ?? "";
const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !BASE };

async function view(slug: string) {
  const res = await fetch(`${BASE}/functions/v1/public-listing-view`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer local-anon-key-not-real", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ slug }),
  });
  const body = await res.json();
  return { status: res.status, listing: body.listing as Record<string, unknown> };
}

// slug, Passport disposition, label shown (null = no notice, purchase on)
const cases: Array<[string, string, string | null]> = [
  ["demo-available", "available", null],
  ["demo-relisted", "available", null],
  ["demo-relisted-unreviewed", "available", null],
  ["demo-left-feed", "missing_from_feed", "No longer listed"],
  ["demo-sold", "missing_from_feed", "No longer listed"],
  ["demo-deal-signed", "missing_from_feed", "No longer listed"],
  ["demo-prior-episode-sold", "missing_from_feed", "No longer listed"],
  ["demo-transferred", "missing_from_feed", "No longer listed"],
  ["demo-duplicate", "withdrawn", "No longer listed"],
  ["demo-archived-no-reason", "unknown", "No longer listed"],
];

for (const [slug, disposition, label] of cases) {
  Deno.test({ name: `${slug}: Passport reads ${disposition}`, ...opts, fn: async () => {
    const { status, listing } = await view(slug);
    assert.equal(status, 200);
    assert.equal("availability" in listing, false, "server on main sends no projection");
    for (const k of ["id", "status", "archived_at", "archive_reason", "published_at"]) {
      assert.equal(k in listing, true, `${k} must reach the Passport for the fallback`);
    }
    const a = readPassportAvailability(listing);
    assert.equal(a.disposition, disposition);
    assert.equal(a.purchasable, disposition === "available");
    assert.notEqual(a.disposition, "sold", "the frontend alone never claims a sale");
    assert.equal(availabilityCopy(a, "Synthetic Demo Motors")?.label ?? null, label);
  } });
}
