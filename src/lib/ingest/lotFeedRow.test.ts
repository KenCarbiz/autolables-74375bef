import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// autofilm-feed named its output fields one by one and therefore shipped 140
// vehicles with no `make` — nothing named it, so nothing carried it. AutoFilm's
// inventory screens filter on `make IS NOT NULL`, so all 140 synced
// successfully and were then invisible and uncounted on every screen. The sync
// reported 140 written and every log looked clean.
//
// That is what a hand-picked projection does: a field the feed forgot is
// indistinguishable from a vehicle that has no value for it.

const fnDir = join(__dirname, "../../../supabase/functions");
const shared = readFileSync(join(fnDir, "_shared/lotFeedRow.ts"), "utf8");
const feed = readFileSync(join(fnDir, "autofilm-feed/index.ts"), "utf8");
const lookup = readFileSync(join(fnDir, "vehicle-lookup/index.ts"), "utf8");

// Mirrors shapeLotRow in _shared/lotFeedRow.ts. Deno source, so the behaviour
// is reproduced here and the contract is asserted against the file below.
const DENY = new Set([
  "install_token", "created_by", "assigned_agent_id",
  "recall_override_by", "recall_override_at", "recall_override_notes",
  "price_parse_notes", "blackbook", "mc_raw", "market_payload",
  "comparables",
]);
const str = (v: unknown): string | null =>
  typeof v === "string" ? (v.trim() || null)
    : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v
    : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;

type Row = Record<string, unknown>;
type File = Record<string, unknown> | null;

const shapeLotRow = (row: Row, file?: File) => {
  const mc = (row.mc_attributes || {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (DENY.has(k)) continue;
    out[k] = v;
  }
  out.year = num(mc.year) ?? num(file?.year) ?? null;
  out.make = str(mc.make) ?? str(file?.make) ?? null;
  out.model = str(mc.model) ?? str(file?.model) ?? null;
  out.trim = str(row.trim) ?? str(file?.trim) ?? null;
  out.stock_number = str(mc.stock_no) ?? str(mc.stock) ?? str(mc.stock_number)
    ?? str(file?.stock_number) ?? null;
  out.body_style = str(mc.body_type) ?? str(mc.body_style) ?? null;
  out.msrp = num(mc.msrp);
  out.market_value = num(row.market_value);
  out.savings = num(row.dealer_discount);
  out.window_sticker_url =
    typeof row.oem_sticker_url === "string" && /^https:\/\//i.test(row.oem_sticker_url)
      ? row.oem_sticker_url : null;
  return out;
};

describe("the blocker: a vehicle with no discrete make is invisible", () => {
  it("carries make, model and year as their own fields", () => {
    const out = shapeLotRow(
      { vin: "1", ymm: "2019 Acura TLX", mc_attributes: { year: 2019, make: "Acura", model: "TLX" } },
    );
    expect(out.make).toBe("Acura");
    expect(out.model).toBe("TLX");
    expect(out.year).toBe(2019);
  });

  it("keeps ymm as well — it is the display title", () => {
    const out = shapeLotRow({ vin: "1", ymm: "2019 Acura TLX", mc_attributes: { make: "Acura" } });
    expect(out.ymm).toBe("2019 Acura TLX");
  });

  it("falls back to vehicle_files, which holds the same three discretely", () => {
    // marketcheck-sync writes year/make/model to vehicle_files and composes
    // ymm from the same values in the same pass.
    const out = shapeLotRow({ vin: "1", ymm: "2019 Acura TLX" }, { year: "2019", make: "Acura", model: "TLX" });
    expect(out.make).toBe("Acura");
    expect(out.year).toBe(2019);
  });

  it("never splits the display string to manufacture a make", () => {
    // "2026 Land Rover Range Rover Sport" splits to a make of "Land". A wrong
    // make is worse than a missing one: null is a gap a consumer can see and
    // count, "Land" is an answer it will act on.
    const out = shapeLotRow({ vin: "1", ymm: "2026 Land Rover Range Rover Sport" });
    expect(out.make).toBeNull();
    expect(shared).not.toMatch(/split\(\/\\s\+\//);
    expect(shared).toContain("Splitting `ymm` back apart is explicitly NOT done here");
  });

  it("counts the rows a consumer will filter out, rather than letting them vanish", () => {
    expect(shared).toMatch(/export const identityIncomplete/);
    expect(feed).toMatch(/identity_incomplete,/);
  });
});

describe("the three additions", () => {
  it("msrp comes from where the passport reads it", () => {
    expect(shapeLotRow({ vin: "1", mc_attributes: { msrp: 51200 } }).msrp).toBe(51200);
    expect(shapeLotRow({ vin: "1", mc_attributes: {} }).msrp).toBeNull();
  });

  it("body_style comes from the decoded build", () => {
    expect(shapeLotRow({ vin: "1", mc_attributes: { body_type: "Sedan" } }).body_style).toBe("Sedan");
    expect(shapeLotRow({ vin: "1" }).body_style).toBeNull();
  });

  it("market_value stays separate from msrp", () => {
    const out = shapeLotRow({ vin: "1", market_value: 24406, price: 25880, mc_attributes: { msrp: 0 } });
    expect(out.market_value).toBe(24406);
    // The sample AutoFilm cited: market_value below price, market_position
    // at_market. A reference price at or below the sale price must never be
    // presented as a discount, and this feed states both rather than deciding.
    expect(out.market_value as number).toBeLessThan(out.price as number);
  });

  it("states savings, never computes it", () => {
    expect(shapeLotRow({ vin: "1", dealer_discount: 1500 }).savings).toBe(1500);
    expect(shapeLotRow({ vin: "1", mc_attributes: { msrp: 60000 }, price: 55000 }).savings).toBeNull();
  });
});

describe("the shape is allow-by-default", () => {
  it("passes through a column nobody has taught it about", () => {
    expect(shapeLotRow({ vin: "1", some_new_column_2027: "hello" }).some_new_column_2027).toBe("hello");
  });

  it("autofilm-feed selects the whole row rather than naming fields", () => {
    // The named list is the bug. What may NOT go out is named instead.
    expect(feed).toMatch(/\.select\("\*"\)/);
    expect(feed).not.toMatch(/"vin, ymm, trim, condition, mileage, status, price,"/);
    expect(feed).toMatch(/shapeLotRow\(/);
  });

  it("still withholds credentials and licensed payloads", () => {
    const out = shapeLotRow({
      vin: "1", install_token: "secret", blackbook: { retail: 1 },
      created_by: "uuid", mc_raw: { big: true },
    });
    for (const k of ["install_token", "blackbook", "created_by", "mc_raw"]) {
      expect(out[k], `${k} leaked`).toBeUndefined();
    }
  });

  it("keeps the module's denylist and this mirror in step", () => {
    const block = shared.slice(shared.indexOf("export const LOT_FEED_DENY"), shared.indexOf("]);"));
    for (const key of DENY) expect(block, `${key} missing`).toContain(`"${key}"`);
  });
});

describe("both lot endpoints shape rows the same way", () => {
  it("share one module rather than each having their own", () => {
    // Two endpoints that both answer "the whole lot" and each shape their own
    // rows is how one ends up missing `make` while the other carries it.
    expect(feed).toMatch(/from "\.\.\/_shared\/lotFeedRow\.ts"/);
    expect(lookup).toMatch(/from "\.\.\/_shared\/lotFeedRow\.ts"/);
    expect(lookup).not.toMatch(/const shapeListRow =/);
  });

  it("both read the discrete identity from vehicle_files", () => {
    for (const [name, src] of [["autofilm-feed", feed], ["vehicle-lookup", lookup]] as const) {
      expect(src, `${name} must join vehicle_files`)
        .toMatch(/select\("vin, year, make, model, trim, stock_number"\)/);
    }
  });
});

describe("the window sticker a consumer may link", () => {
  const SB = "https://proj.supabase.co";
  const resolver = (slug: string) =>
    `${SB}/functions/v1/public-document-asset?slug=${slug}&document_type=factory_sticker&asset_type=pdf&redirect=1`;

  // Mirrors windowSticker().
  const sticker = (row: Record<string, unknown>, opts?: { hasFactorySticker?: boolean }) => {
    const oem = typeof row.oem_sticker_url === "string" && /^https:\/\//i.test(row.oem_sticker_url)
      ? row.oem_sticker_url : null;
    if (oem) return { url: oem, kind: "oem" };
    if (opts?.hasFactorySticker && typeof row.slug === "string" && row.slug) {
      return { url: resolver(row.slug), kind: "reproduction" };
    }
    return { url: null, kind: null };
  };

  it("prefers the genuine OEM document", () => {
    const s2 = sticker({ oem_sticker_url: "https://x/oem.pdf", slug: "a" }, { hasFactorySticker: true });
    expect(s2.url).toBe("https://x/oem.pdf");
    expect(s2.kind).toBe("oem");
  });

  it("reaches the filed build record the sticker column never pointed at", () => {
    // oem_sticker_url is null on all 140 of Harte's live vehicles while 102
    // have a published factory sticker PDF filed. Reading the column alone
    // reported "no window sticker" for three quarters of the lot that has one.
    const s2 = sticker({ slug: "acura-tlx-624253" }, { hasFactorySticker: true });
    expect(s2.url).toBe(resolver("acura-tlx-624253"));
    expect(s2.kind).toBe("reproduction");
  });

  it("says nothing rather than guessing when no document is filed", () => {
    expect(sticker({ slug: "a" }, { hasFactorySticker: false })).toEqual({ url: null, kind: null });
  });

  it("labels a reproduction as one", () => {
    // A regenerated build record is not an original OEM-issued Monroney label
    // and must never be presented as one. The kind travels with the URL rather
    // than leaving the consumer to guess.
    expect(shared).toMatch(/export type WindowStickerKind = "oem" \| "reproduction"/);
    expect(feed).toMatch(/window_sticker_kind/);
  });

  it("is an address, never a signature", () => {
    // The signed URL expires; storing one is what made published vehicles
    // serve dead links once it aged out.
    expect(shared).toMatch(/redirect=1/);
    expect(shared).not.toMatch(/createSignedUrl/);
  });

  it("rejects a non-https OEM url", () => {
    expect(sticker({ oem_sticker_url: "http://x/oem.pdf" }).url).toBeNull();
  });

  it("resolves through a route that re-checks publication on every visit", () => {
    const asset = readFileSync(join(fnDir, "public-document-asset/index.ts"), "utf8");
    expect(asset).toMatch(/const wantsRedirect =/);
    // 302, not 301: the target is a short-lived credential and must not be
    // cached as this URL's permanent answer.
    expect(asset).toMatch(/status: 302/);
    expect(asset).toMatch(/"Cache-Control": "no-store"/);
    // The gate is unchanged — still published-only, still slug-keyed.
    expect(asset).toMatch(/get_published_document_asset/);
  });

  it("both endpoints resolve stickers the same way", () => {
    for (const [name, src] of [["autofilm-feed", feed], ["vehicle-lookup", lookup]] as const) {
      expect(src, `${name} must look up published stickers`)
        .toMatch(/document_status", "published"\)/);
      expect(src, `${name} must pass hasFactorySticker`).toMatch(/hasFactorySticker:/);
    }
  });
});

describe("the contract AutoFilm probes against", () => {
  it("accepts either header name for the same secret", () => {
    // A 401 over which of two names carried the identical value is a wasted
    // round trip, not a security boundary.
    expect(feed).toMatch(/req\.headers\.get\("x-lookup-secret"\)/);
    expect(feed).toMatch(/req\.headers\.get\("x-autofilm-key"\)/);
    // CORS has to allow it too, or a browser preflight strips it.
    expect(feed).toMatch(/x-lookup-secret, x-autofilm-key/);
  });

  it("states how far it got as well as how to continue", () => {
    expect(feed).toMatch(/has_more: hasMore,/);
    expect(feed).toMatch(/next_cursor: hasMore \?/);
    expect(feed).toMatch(/^\s+limit,$/m);
    expect(feed).toMatch(/total: count \?\? 0,/);
  });

  it("pages by VIN cursor, which cannot skip a row between requests", () => {
    expect(feed).toMatch(/\.order\("vin", \{ ascending: true \}\)/);
    expect(feed).toMatch(/pageQuery\.gt\("vin", cursor\)/);
    // limit + 1 is how it knows there is another page without a second count.
    expect(feed).toMatch(/\.limit\(limit \+ 1\)/);
  });
});

describe("detail mode: everything we hold about one vehicle", () => {
  it("is a mode on the same route and credential, keyed by VIN", () => {
    expect(feed).toMatch(/const detailVin = \(pathVin \|\| url\.searchParams\.get\("vin"\) \|\| ""\)\.toUpperCase\(\)/);
    expect(feed).toMatch(/vin must be a 17-character VIN/);
    expect(feed).toMatch(/if \(detailVin\) \{/);
  });

  it("answers 404 for a VIN this tenant does not have", () => {
    // Not an empty vehicle object — a consumer must not write copy about a car
    // that returned nothing.
    expect(feed).toMatch(/error: "not_found", vin: detailVin/);
    expect(feed).toMatch(/\.eq\("tenant_id", tenantId\)\s*\n?\s*\.eq\("vin", detailVin\)/);
  });

  it("serves facts through the ledger's own copy gate", () => {
    // usable_in_copy is a decision already recorded against the fact. A
    // consumer does not get to reverse it.
    expect(feed).toMatch(/from\("vehicle_facts"\)/);
    expect(feed).toMatch(/\.eq\("usable_in_copy", true\)/);
  });

  it("labels every fact instead of filtering to VERIFIED", () => {
    // VERIFIED-only would drop engine, drivetrain, transmission and trim — all
    // HIGH from the provider — and a talking-point writer that cannot see the
    // engine is not much of one.
    for (const field of ["confidence:", "authority:", "source:", "observed_at:"]) {
      expect(feed, `fact ${field} missing`).toContain(field);
    }
    expect(feed).toMatch(/verified_fact_count: facts\.filter\(\(f\) => f\.confidence === "VERIFIED"\)\.length/);
  });

  it("unwraps the ledger's value envelope", () => {
    // fact_value is stored as {"v": 59390}; handing a consumer the envelope
    // makes every reader unwrap it, and one of them eventually will not.
    expect(feed).toMatch(/\(f\.fact_value as \{ v\?: unknown \} \| null\)\?\.v \?\? f\.fact_value/);
  });

  it("says when two sources still disagree about this car", () => {
    // A consumer generating copy should know before it writes a sentence.
    expect(feed).toMatch(/has_unresolved_conflicts: snap\.has_unresolved_conflicts === true/);
    expect(feed).toMatch(/from\("vehicle_snapshots"\)/);
    expect(feed).toMatch(/order\("snapshot_version", \{ ascending: false \}\)/);
  });

  it("shapes the vehicle through the same shaper as the list", () => {
    // A detail call that built its own row shape would be the projection bug
    // again, one endpoint further along.
    const block = feed.slice(feed.indexOf("if (detailVin) {"), feed.indexOf("const base = ()"));
    expect(block).toMatch(/shapeLotRow\(row,/);
  });

  it("does not load facts for every row of a list page", () => {
    // 20 facts x 500 vehicles is a different endpoint's job.
    const listPart = feed.slice(feed.indexOf("const base = ()"));
    expect(listPart).not.toMatch(/from\("vehicle_facts"\)/);
  });
});

describe("recall and history reach the consumer", () => {
  it("are no longer withheld", () => {
    // "No open recalls" and "one owner, no accidents reported" are the most
    // load-bearing things said about a used car, and the summary columns alone
    // cannot support the claim.
    const denyBlock = shared.slice(shared.indexOf("export const LOT_FEED_DENY"), shared.indexOf("]);"));
    expect(denyBlock).not.toContain('"recall_payload"');
    expect(denyBlock).not.toContain('"history_payload"');
    // Still withheld: licensed and bulky.
    expect(denyBlock).toContain('"blackbook"');
    expect(denyBlock).toContain('"mc_raw"');
  });

  it("strips competitors' listing URLs out of the history", () => {
    // The timeline is the talking point. A live link to another dealer's VDP
    // on a customer-facing page is an own goal.
    expect(shared).toMatch(/export function scrubHistory/);
    expect(shared).toMatch(/const \{ vdp_url: _dropped, \.\.\.rest \}/);
    // The dealer name stays — the timeline is meaningless without knowing a
    // change of hands happened.
    expect(shared).not.toMatch(/dealer: _drop/);
  });

  it("caps a long history rather than shipping it whole", () => {
    expect(shared).toMatch(/entries_truncated: entries\.length > cap/);
  });
});

describe("detail_version: cache the deep record, refetch only when it moves", () => {
  it("is a content hash, not the listing's updated_at", () => {
    // updated_at is touched by the nightly sync whether or not the build
    // changed, so a version derived from it moves every night for every car
    // and caches nothing.
    expect(shared).toMatch(/export async function detailVersion/);
    expect(shared).toMatch(/crypto\.subtle\.digest\("SHA-256"/);
    const block = shared.slice(shared.indexOf("const DETAIL_VERSION_FIELDS"), shared.indexOf("export async function detailVersion"));
    expect(block).not.toContain('"updated_at"');
  });

  it("covers the equipment a walkaround describes", () => {
    const block = shared.slice(shared.indexOf("const DETAIL_VERSION_FIELDS"), shared.indexOf("] as const;"));
    for (const f of ["mc_attributes", "photos", "epa_economy", "warranty_info",
                     "recall_payload", "history_payload", "available_accessories"]) {
      expect(block, `${f} missing from detail_version`).toContain(`"${f}"`);
    }
  });

  it("moves when the fact ledger moves, not only when the listing row does", () => {
    expect(shared).toMatch(/snapshot\?\.content_checksum \?\? null/);
    expect(shared).toMatch(/snapshot\?\.snapshot_version \?\? null/);
  });

  it("deliberately ignores price and mileage", () => {
    // Both move often, are carried fresh in the list on every sync, and a
    // consumer re-reading a whole build sheet because a price dropped $200 is
    // the churn this exists to prevent.
    const block = shared.slice(shared.indexOf("const DETAIL_VERSION_FIELDS"), shared.indexOf("] as const;"));
    for (const f of ["price", "mileage", "market_value", "status"]) {
      expect(block, `${f} must not move detail_version`).not.toContain(`"${f}"`);
    }
  });

  it("is on every list row and echoed by the detail call", () => {
    expect(feed).toMatch(/shaped\.detail_version = await detailVersion\(/);
    expect(feed).toMatch(/detail_version: vehicle\.detail_version,/);
  });

  it("loads snapshots once per page, not once per row", () => {
    const listPart = feed.slice(feed.indexOf("const snapByVehicle"));
    expect(listPart).toMatch(/\.in\("vehicle_id", ids\)/);
  });
});

describe("the addressing AutoFilm actually uses", () => {
  it("accepts /vehicle/{vin} as well as ?vin=", () => {
    expect(feed).toMatch(/\/vehicle\\\/\(\[\^\/\?#\]\+\)/);
    expect(feed).toMatch(/pathVin \|\| url\.searchParams\.get\("vin"\)/);
  });

  it("is exempted from the JWT gateway", () => {
    // AutoFilm sends no Authorization header. Left to the platform default this
    // 401s at the gateway before the function's own auth ever runs, and the
    // failure looks like a broken feed rather than a config gap.
    const cfg = readFileSync(join(fnDir, "../config.toml"), "utf8");
    const block = cfg.slice(cfg.indexOf("[functions.autofilm-feed]"));
    expect(block.slice(0, 60)).toMatch(/verify_jwt = false/);
  });
});

describe("updated_since narrows the count too", () => {
  it("filters the total and the page together", () => {
    // A total counting the whole lot while the rows carried only the changed
    // ones would fail the caller's "rows must equal total" check on every
    // incremental pull.
    expect(feed).toMatch(/const scoped = \(q: any\) => \(updatedSince \? q\.gte\("updated_at", updatedSince\) : q\)/);
    expect(feed).toMatch(/const \{ count, error: countErr \} = await scoped\(/);
    expect(feed).toMatch(/const base = \(\) =>\s*\n?\s*scoped\(/);
  });

  it("rejects a timestamp it cannot parse", () => {
    expect(feed).toMatch(/updated_since must be ISO-8601/);
  });
});
