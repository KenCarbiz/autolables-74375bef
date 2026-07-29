import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// marketcheck_prune_inventory used to DELETE every vehicle_listings row whose
// VIN had left the dealer feed. A car that sells leaves the feed on the next
// pull, so the row was destroyed at exactly the moment the customer started
// owning the car -- taking the passport they had just scanned with it.
//
// This is a schema-level guarantee, so the assertions read the migration. It is
// deliberately blunt: the day someone reintroduces a DELETE here, the customer's
// record becomes unrecoverable, and no unit test of application code would
// notice.

const ROOT = join(__dirname, "..", "..", "..");
const sql = readFileSync(
  join(ROOT, "supabase/migrations/20260729030000_retire_instead_of_delete.sql"),
  "utf8",
);

const pruneBody = sql.slice(
  sql.indexOf("CREATE OR REPLACE FUNCTION public.marketcheck_prune_inventory"),
  sql.indexOf("GRANT EXECUTE ON FUNCTION public.marketcheck_prune_inventory"),
);

describe("leaving the feed retires a listing, it never deletes one", () => {
  it("issues no DELETE against vehicle_listings or vehicle_files", () => {
    expect(pruneBody).not.toMatch(/DELETE\s+FROM/i);
  });

  it("retires the listing with a time and a reason", () => {
    expect(pruneBody).toMatch(/SET\s+status\s*=\s*'archived'/);
    expect(pruneBody).toMatch(/archived_at\s*=\s*COALESCE/);
    expect(pruneBody).toMatch(/archive_reason\s*=\s*COALESCE\(vl\.archive_reason,\s*'left_feed'\)/);
  });

  it("never asserts the car was sold, only that it left the feed", () => {
    // A VIN can leave a feed for reasons we cannot see -- wholesaled, pulled
    // from advertising, a feed glitch. Recording 'sold' would be a claim.
    expect(pruneBody).not.toMatch(/'sold'/);
  });

  it("does not re-stamp a row that is already retired", () => {
    // COALESCE keeps the ORIGINAL date, so "when did this leave inventory"
    // survives every subsequent nightly sync.
    expect(pruneBody).toMatch(/vl\.status\s*<>\s*'archived'/);
    expect(pruneBody).toMatch(/vf\.archived_at\s+IS\s+NULL/);
  });

  it("drops the addendum exemption, which decided which cars survived by luck", () => {
    expect(pruneBody).not.toMatch(/addendums/i);
  });
});

describe("the passport outlives the listing", () => {
  const rpc = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.get_vehicle_listing_by_slug"));

  it("resolves a retired vehicle, not only a published one", () => {
    expect(rpc).toMatch(/status = 'published' OR \(status = 'archived'/);
  });

  it("prefers the live listing when a VIN somehow has both", () => {
    expect(rpc).toMatch(/\(status = 'published'\) DESC/);
  });

  it("stays readable by an anonymous shopper", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_vehicle_listing_by_slug\(text\) TO anon/);
  });
});

describe("a VIN that comes back is live again", () => {
  const revive = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.marketcheck_revive_listing"),
    sql.indexOf("GRANT EXECUTE ON FUNCTION public.marketcheck_revive_listing"),
  );

  it("republishes and clears the retirement stamp", () => {
    expect(revive).toMatch(/SET status = 'published', archived_at = NULL, archive_reason = NULL/);
  });

  it("only revives what the feed itself retired", () => {
    // A listing an operator archived on purpose must not be resurrected by a
    // feed pull.
    expect(revive).toMatch(/archive_reason = 'left_feed'/);
  });
});
