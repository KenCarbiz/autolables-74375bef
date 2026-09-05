import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AutoFilm needs "tell me about this lot". vehicle-lookup only answered "tell
// me about this VIN", capped every answer at five rows, and ignored limit /
// page / offset. Five cars out of a 132-car lot is not a partial answer — it is
// a public page telling a customer the dealership has five vehicles, and it
// read as a clean result for weeks because nothing in the response said how
// many there really were.
//
// Deno source, so the contract is asserted against the file. The ROW SHAPE is
// not this file's subject — it moved to _shared/lotFeedRow.ts and is covered by
// lotFeedRow.test.ts, so that autofilm-feed and this endpoint cannot disagree
// about what a vehicle looks like.

const fn = readFileSync(
  join(__dirname, "../../../supabase/functions/vehicle-lookup/index.ts"),
  "utf8",
);


describe("list mode can prove it missed nothing", () => {
  it("counts the whole tenant, not the page", () => {
    // Without a tenant-wide total, a short read is indistinguishable from a
    // small lot — the ambiguity that hid the five-row cap.
    expect(fn).toMatch(/\.select\("id", \{ count: "exact", head: true \}\)/);
    expect(fn).toMatch(/const total = countRes\.count \?\? 0/);
  });

  it("derives has_more from the count rather than from the page being full", () => {
    expect(fn).toMatch(/has_more: from \+ rows\.length < total/);
  });

  it("sorts by VIN, which does not move", () => {
    // Ordering by recency or price lets a vehicle cross a page boundary
    // between requests and appear on neither page.
    expect(fn).toMatch(/\.order\("vin", \{ ascending: true \}\)/);
    const list = fn.slice(fn.indexOf("if (wantsList) {"), fn.indexOf("const isFullVin"));
    expect(list).not.toMatch(/order\("published_at"/);
    expect(list).not.toMatch(/order\("price"/);
  });

  it("pages 0-based with a real range, not a fixed slice", () => {
    expect(fn).toMatch(/const from = page \* limit/);
    expect(fn).toMatch(/\.range\(from, from \+ limit - 1\)/);
    const list = fn.slice(fn.indexOf("if (wantsList) {"), fn.indexOf("const isFullVin"));
    expect(list).not.toMatch(/slice\(0, 5\)/);
  });

  it("honours the caller's limit up to a stated cap", () => {
    expect(fn).toMatch(/MAX_LIST_LIMIT\s*=\s*\d+/);
    expect(fn).toMatch(/DEFAULT_LIST_LIMIT\s*=\s*200/);
  });

  it("accepts the wildcards AutoFilm sends, and a bare tenant", () => {
    expect(fn).toMatch(/q === "\*" \|\| q === "%" \|\| q === ""/);
  });
});

describe("the search path is untouched", () => {
  it("still answers a VIN with at most five candidates", () => {
    expect(fn).toMatch(/rows\.slice\(0, 5\)\.map\(\(r\) => shape\(r,/);
    expect(fn).toMatch(/const isFullVin = q\.length === 17/);
  });
});
