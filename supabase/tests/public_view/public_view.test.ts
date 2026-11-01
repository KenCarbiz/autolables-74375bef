// Calls the real public-listing-view handler through the local gateway and
// checks what a shopper's browser would receive for each disposition.
import assert from "node:assert/strict";

const BASE = Deno.env.get("PUBLIC_VIEW_URL") ?? "";
const withFoundation = Deno.env.get("WITH_FOUNDATION") !== "0";
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

const cases: Array<[string, string, string]> = [
  ["demo-available", "available", "listing_status"],
  ["demo-left-feed", "missing_from_feed", "feed_absence"],
  ["demo-deal-signed", "sale_pending", "deal_record"],
  ["demo-relisted", "available", "listing_status"],
  ["demo-duplicate", "withdrawn", "listing_status"],
  ["demo-archived-no-reason", "unknown", "listing_status"],
];
if (withFoundation) {
  cases.push(["demo-sold", "sold", "custody_milestone"], ["demo-transferred", "transferred", "custody_milestone"]);
} else {
  // Without the custody tables, an archived car that was really delivered can
  // only be called "no longer listed": archived alone never reads as sold.
  cases.push(["demo-sold", "missing_from_feed", "feed_absence"], ["demo-transferred", "missing_from_feed", "feed_absence"]);
}

for (const [slug, disposition, basis] of cases) {
  Deno.test({ name: `${slug} -> ${disposition} (${basis})`, ...opts, fn: async () => {
    const { status, listing } = await view(slug);
    assert.equal(status, 200);
    const a = listing.availability as Record<string, unknown>;
    assert.equal(a.disposition, disposition);
    assert.equal(a.basis, basis);
    const purchasable = disposition === "available";
    assert.equal(a.purchasable, purchasable);
    assert.equal(a.price_status, purchasable ? "current_offer" : "last_advertised");
    if (!purchasable) {
      assert.deepEqual(listing.payment_estimator, { enabled: false });
      assert.equal(listing.price_drop_watch, false);
      assert.equal(typeof listing.price, "number", "last advertised price stays as history");
    }
    for (const k of ["install_token", "deal_status", "sale_price", "selling_price", "customer_name", "created_by"]) {
      assert.equal(k in listing, false, `${k} must not reach the shopper`);
    }
  } });
}

Deno.test({ name: "unknown slug is 404, never a guessed listing", ...opts, fn: async () => {
  const { status } = await view("demo-does-not-exist");
  assert.equal(status, 404);
} });

Deno.test({ name: "the bare VIN of a sold car resolves to the same record, still not purchasable", ...opts, fn: async () => {
  const { status, listing } = await view("5YJ3E1EA0SF000003");
  assert.equal(status, 200);
  assert.equal((listing.availability as Record<string, unknown>).purchasable, false);
} });
