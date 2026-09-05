import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Harte reported vehicles that are never scraped — a 2027 QX80 among them —
// while the nightly run reported success every night.
//
// The crawler built its work list from advertised_prices ordered
// captured_at DESC, de-duped to the latest row per VIN, then cut at `limit`
// (500 on the cron). Crawling a vehicle writes a fresh snapshot, which lifts
// that VIN straight back to the top of "newest first". So the same head of the
// list was re-crawled every night and everything past the cut was never
// reached again — a starvation loop that reinforces itself, not a backlog that
// drains.
//
// Two more ways in were closed at the same time: the seed pass (the only entry
// for a car with no snapshot at all) was gated on `rows.length < limit`, and
// the seeder itself skipped any vehicle with a null price.

const fn = readFileSync(
  join(__dirname, "../../../supabase/functions/crawl-advertised-prices/index.ts"),
  "utf8",
);
const sql = readFileSync(
  join(__dirname, "../../../supabase/migrations/20260904090000_advertised_price_crawl_queue.sql"),
  "utf8",
);
const panel = readFileSync(
  join(__dirname, "../../components/admin/PriceIntegrityPanel.tsx"),
  "utf8",
);

describe("the queue rotates instead of re-crawling the same head", () => {
  it("orders by staleness, least recently crawled first", () => {
    expect(sql).toMatch(/ORDER BY latest\.captured_at ASC NULLS FIRST/);
  });

  it("picks the latest row per VIN across the whole table", () => {
    // A client-side window over the newest N snapshots cannot see a vehicle
    // whose last snapshot has aged out — which is exactly the starved one.
    expect(sql).toMatch(/DISTINCT ON \(ap\.tenant_id, upper\(ap\.vin\)\)/);
    expect(sql).toMatch(/ORDER BY ap\.tenant_id, upper\(ap\.vin\), ap\.captured_at DESC/);
  });

  it("only considers rows that actually have somewhere to crawl", () => {
    expect(sql).toMatch(/COALESCE\(ap\.source_url, ''\) <> ''/);
  });

  it("is reachable only by the crawler", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.advertised_price_crawl_queue/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.advertised_price_crawl_queue\(uuid, integer\) TO service_role/);
  });

  it("the crawler reads the queue rather than re-deriving it newest-first", () => {
    expect(fn).toMatch(/rpc\("advertised_price_crawl_queue"/);
    // The shape that caused the starvation.
    expect(fn).not.toMatch(/\.order\("captured_at", \{ ascending: false \}\)\s*\n\s*\.limit\(2000\)/);
  });
});

describe("a vehicle with no snapshot can still get in", () => {
  it("seeds unconditionally, not only when there is room left", () => {
    // The old gate: `if (rows.length < limit) {`. Once there were `limit`
    // priced VINs, a never-priced car had no snapshot to age and therefore no
    // way into the queue, permanently.
    expect(fn).not.toMatch(/if \(rows\.length < limit\) \{\s*\n\s*const pricedKeys/);
    expect(fn).toMatch(/rows\.unshift\(\.\.\.seeds\)/);
  });

  it("puts never-priced vehicles first", () => {
    const block = fn.slice(fn.indexOf("const seeds: LatestRow[] = []"));
    expect(block.indexOf("rows.unshift(...seeds)")).toBeGreaterThan(-1);
    // and still honours the run's cap
    expect(block).toMatch(/if \(rows\.length > limit\) rows\.length = limit/);
  });

  it("does not seed a VIN that already has a snapshot", () => {
    expect(fn).toMatch(/if \(pricedKeys\.has\(k\) \|\| seen\.has\(k\)\) continue/);
    // pricedKeys is built from an over-fetch, so "not in today's cut" is never
    // mistaken for "never priced".
    expect(fn).toMatch(/_limit: Math\.max\(limit \* 4, 2000\)/);
  });
});

describe("the seeder gives every live vehicle a target", () => {
  it("no longer skips vehicles the feed delivered without a price", () => {
    // Matched against code only — the comment explaining the old filter
    // quotes it verbatim.
    const code = panel.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/\.not\("price", "is", null\)/);
    expect(panel).toMatch(/advertised_price: l\.price \?\? 0/);
  });

  it("skips rather than emits a URL it cannot fill", () => {
    // {STOCK} used to be replaced with "" for a vehicle with no stock number,
    // producing a real-looking address that 404s every night and is recorded
    // as a generic failure.
    expect(panel).toMatch(/const needsStock = \/\\\{stock\\\}\/i\.test\(p\)/);
    expect(panel).toMatch(/needsStock \? all\.filter\(\(l\) => !!stockFor\(l\)\) : all/);
  });

  it("finds the stock number wherever it is filed", () => {
    // The seeder read only sticker_snapshot.stock_number — one of the several
    // places a stock number lands.
    expect(panel).toMatch(/import \{ vehicleStockNumber \}/);
    expect(panel).not.toMatch(/sticker_snapshot\?\.\["stock_number"\] as string/);
  });

  it("reads vehicle_files, where the number often ONLY lives", () => {
    // Harte's 2027 QX80: mc_attributes.stock_no null, sticker_snapshot null,
    // vehicle_files.stock_number "4648N". A seeder reading the listing alone
    // finds nothing and skips exactly the car that needs a URL most.
    expect(panel).toMatch(/from\("vehicle_files"\)/);
    expect(panel).toMatch(/const stockFor = /);
    expect(panel).toMatch(/needsStock \? all\.filter\(\(l\) => !!stockFor\(l\)\) : all/);
    expect(panel).toContain('stockFor(l) || ""');
  });

  it("says how many it skipped instead of reporting a clean seed", () => {
    expect(panel).toMatch(/skipped — no stock number for the \{STOCK\} token/);
  });
});

describe("asking about one VIN gives an answer", () => {
  it("names the reason when a VIN has nothing to crawl", () => {
    // "picked: 0" was indistinguishable from a successful no-op, which is how
    // a car sits un-scraped for weeks while every run reports success.
    expect(fn).toMatch(/reason: "no_source_url"/);
    expect(fn).toMatch(/if \(targetVin && rows\.length === 0\)/);
  });
});

describe("a run that cannot finish says so", () => {
  it("stops on a budget rather than being killed mid-loop", () => {
    // 500 serial fetches with a 12s timeout each cannot fit an edge function's
    // wall clock. Being killed left no summary and no audit row, so a partial
    // run was indistinguishable from a complete one.
    expect(fn).toMatch(/RUN_BUDGET_MS/);
    expect(fn).toMatch(/ranOutOfTime = true; break;/);
  });

  it("reports coverage, not just successes", () => {
    for (const key of ["processed", "queue_depth", "unvisited", "ran_out_of_time"]) {
      expect(fn, `${key} missing from the run summary`).toMatch(new RegExp(`${key}[,:]`));
    }
  });
});
