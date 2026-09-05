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
// Deno source, so the shaping rules are mirrored here and the contract is
// asserted against the file.

const fn = readFileSync(
  join(__dirname, "../../../supabase/functions/vehicle-lookup/index.ts"),
  "utf8",
);

// Mirrors LIST_DENY in the function; the assertion below keeps them in step.
const DENY = new Set([
  "install_token",
  "created_by", "assigned_agent_id",
  "recall_override_by", "recall_override_at", "recall_override_notes",
  "price_parse_notes",
  "blackbook", "mc_raw", "market_payload", "comparables",
  "history_payload", "recall_payload",
]);

const httpsOnly = (u: unknown): string | null =>
  typeof u === "string" && /^https:\/\//i.test(u.trim()) ? u.trim() : null;

// Mirrors shapeListRow.
const shapeListRow = (r: Record<string, unknown>, stockFromFiles?: string | null) => {
  const mc = (r.mc_attributes || {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (DENY.has(k)) continue;
    out[k] = v;
  }
  out.stock = (mc.stock ?? mc.stock_number ?? null) ?? stockFromFiles ?? null;
  out.window_sticker_url = httpsOnly(r.oem_sticker_url);
  out.msrp = typeof mc.msrp === "number" ? mc.msrp : null;
  out.market_value = r.market_value ?? null;
  out.savings = r.dealer_discount ?? null;
  return out;
};

describe("list mode can prove it missed nothing", () => {
  it("counts the whole tenant, not the page", () => {
    // Without a tenant-wide total, a short read is indistinguishable from a
    // small lot — the ambiguity that hid the five-row cap.
    expect(fn).toMatch(/\.select\("id", \{ count: "exact", head: true \}\)/);
    expect(fn).toMatch(/const total = countRes\.count \?\? 0/);
  });

  it("derives has_more from the count rather than from the page being full", () => {
    // A page capped below what the caller asked for still reports honestly.
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

describe("rows are the listing row, not a projection of it", () => {
  it("passes through a column nobody has taught it about", () => {
    // The whole point: a field added to the listing reaches AutoFilm on its
    // own. A hand-picked projection drifts the first time somebody adds one,
    // and the drift is silent — a forgotten field looks exactly like a vehicle
    // that has no value for it.
    const out = shapeListRow({ vin: "1", some_new_column_2027: "hello" });
    expect(out.some_new_column_2027).toBe("hello");
  });

  it("is built by copying the row, not by naming fields", () => {
    expect(fn).toMatch(/for \(const \[k, v\] of Object\.entries\(r\)\) \{[\s\S]{0,120}LIST_DENY\.has\(k\)/);
    expect(fn).toMatch(/\.select\("\*"\)/);
  });

  it("keeps the function's denylist and this test in step", () => {
    const block = fn.slice(fn.indexOf("const LIST_DENY = new Set(["), fn.indexOf("]);", fn.indexOf("const LIST_DENY")));
    for (const key of DENY) {
      expect(block, `${key} missing from LIST_DENY`).toContain(`"${key}"`);
    }
  });
});

describe("what never leaves the building", () => {
  it("never ships a credential", () => {
    const out = shapeListRow({ vin: "1", install_token: "secret-token" });
    expect(out.install_token).toBeUndefined();
  });

  it("never ships internal actors or operational notes", () => {
    const out = shapeListRow({
      vin: "1", created_by: "user-uuid", assigned_agent_id: "agent-uuid",
      recall_override_by: "manager", recall_override_notes: "called the OEM",
      price_parse_notes: "regex fell through",
    });
    for (const k of ["created_by", "assigned_agent_id", "recall_override_by", "recall_override_notes", "price_parse_notes"]) {
      expect(out[k], `${k} leaked`).toBeUndefined();
    }
  });

  it("never redistributes licensed provider payloads", () => {
    // Black Book is paid valuation data and AutoFilm renders none of it.
    const out = shapeListRow({ vin: "1", blackbook: { retail: 1 }, mc_raw: { big: true }, comparables: [1, 2] });
    expect(out.blackbook).toBeUndefined();
    expect(out.mc_raw).toBeUndefined();
    expect(out.comparables).toBeUndefined();
  });
});

describe("the four fields the passport shows and the feed never carried", () => {
  it("reads msrp from where the passport reads it", () => {
    // passportV2Data.ts takes msrp off mc_attributes; there is no column. Two
    // derivations of the same number is how one page prices a car differently
    // from another.
    expect(shapeListRow({ vin: "1", mc_attributes: { msrp: 62335 } }).msrp).toBe(62335);
    expect(shapeListRow({ vin: "1", mc_attributes: {} }).msrp).toBeNull();
    expect(shapeListRow({ vin: "1", mc_attributes: { msrp: "62335" } }).msrp).toBeNull();
  });

  it("states savings, never computes it", () => {
    // A savings figure derived from msrp - price would be our arithmetic
    // presented as the dealership's claim.
    expect(shapeListRow({ vin: "1", dealer_discount: 2500 }).savings).toBe(2500);
    expect(shapeListRow({ vin: "1", mc_attributes: { msrp: 60000 }, price: 55000 }).savings).toBeNull();
  });

  it("keeps market_value separate from msrp", () => {
    const out = shapeListRow({ vin: "1", market_value: 48000, mc_attributes: { msrp: 62335 } });
    expect(out.market_value).toBe(48000);
    expect(out.msrp).toBe(62335);
  });

  it("serves only an https window sticker", () => {
    expect(shapeListRow({ vin: "1", oem_sticker_url: "https://x/s.pdf" }).window_sticker_url).toBe("https://x/s.pdf");
    // http is a mixed-content block in the browser.
    expect(shapeListRow({ vin: "1", oem_sticker_url: "http://x/s.pdf" }).window_sticker_url).toBeNull();
    expect(shapeListRow({ vin: "1" }).window_sticker_url).toBeNull();
  });

  it("never hands out the expiring factory-sticker URL as the window sticker", () => {
    // The generated sticker lives in a private bucket behind short-lived
    // signed URLs. A stored copy opens fine on sync day and returns InvalidJWT
    // a week later — the failure the dealer side just had to be fixed for.
    expect(fn).toMatch(/const windowStickerUrl = \(r: any\): string \| null => httpsOnly\(r\.oem_sticker_url\)/);
    expect(fn).not.toMatch(/window_sticker_url = .*factory_sticker_url/);
  });

  it("gives a durable documents address for everything else", () => {
    // Minted per view, and it carries the reproduction disclosure a raw PDF
    // deep link would strip.
    expect(fn).toMatch(/\$\{PASSPORT_BASE\}\/\$\{slug\}\/documents/);
  });
});
