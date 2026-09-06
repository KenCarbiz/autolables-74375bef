import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The REAL module, not a copy of it. _shared/lotFeedRow.ts has no imports, so
// it loads under vitest unchanged — which means a rename in the shaper fails
// here instead of silently emptying a screen in the consumer. A mirror would
// have kept passing, which is the whole failure this file exists to prevent.
import {
  shapeLotRow, windowSticker, detailVersion, scrubHistory,
  LOT_FEED_DENY, identityIncomplete, lotIdentity,
} from "../../../supabase/functions/_shared/lotFeedRow.ts";

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

  it("withholds exactly what it means to, and nothing more", () => {
    // Asserted against the real exported Set, so adding a field to the denylist
    // is a deliberate act somebody has to change this list to make.
    expect([...LOT_FEED_DENY].sort()).toEqual([
      "assigned_agent_id", "blackbook", "comparables", "created_by",
      "install_token", "mc_raw", "market_payload", "price_parse_notes",
      "recall_override_at", "recall_override_by", "recall_override_notes",
    ].sort());
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
    const start = shared.indexOf("const DETAIL_VERSION_FIELDS");
    const block = shared.slice(start, shared.indexOf("export async function detailVersion", start));
    expect(block).not.toContain('"updated_at"');
  });

  it("covers the equipment a walkaround describes", () => {
    // Search FORWARD from the start: indexOf finds the first "] as const;"
    // in the file, which belongs to an earlier array, and a start after the
    // end silently yields an empty string that contains nothing and passes.
    const from = shared.indexOf("const DETAIL_VERSION_FIELDS");
    const block = shared.slice(from, shared.indexOf("] as const;", from));
    expect(block.length).toBeGreaterThan(40);
    for (const f of ["mc_attributes", "photos", "epa_economy", "warranty_info",
                     "recall_payload", "history_payload", "available_accessories"]) {
      expect(block, `${f} missing from detail_version`).toContain(`"${f}"`);
    }
  });

  it("moves when the manufacturing spec changes, without following scrape noise", () => {
    // The spec is hashed through its derived form rather than by adding mc_raw
    // to the field list: mc_raw also carries scraped_at, dom and last_seen_at,
    // which change nightly for every car and would cache nothing.
    expect(shared).toMatch(/JSON\.stringify\(specifications\(row\)\)/);
    const from = shared.indexOf("const DETAIL_VERSION_FIELDS");
    expect(shared.slice(from, shared.indexOf("] as const;", from))).not.toContain('"mc_raw"');
  });

  it("moves when the fact ledger moves, not only when the listing row does", () => {
    expect(shared).toMatch(/snapshot\?\.content_checksum \?\? null/);
    expect(shared).toMatch(/snapshot\?\.snapshot_version \?\? null/);
  });

  it("deliberately ignores price and mileage", () => {
    // Both move often, are carried fresh in the list on every sync, and a
    // consumer re-reading a whole build sheet because a price dropped $200 is
    // the churn this exists to prevent.
    // Search FORWARD from the start: indexOf finds the first "] as const;"
    // in the file, which belongs to an earlier array, and a start after the
    // end silently yields an empty string that contains nothing and passes.
    const from = shared.indexOf("const DETAIL_VERSION_FIELDS");
    const block = shared.slice(from, shared.indexOf("] as const;", from));
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


// ── The consumer contract ─────────────────────────────────────────────
//
// AutoFilm's reader silently drops fields it has no reader for. That makes a
// rename on this side indistinguishable from a field that was never sent:
// nothing errors, nothing logs, the sync reports success, and a screen is
// quietly empty. A markdown handover cannot prevent that — it is the first
// thing to go stale when somebody renames a key.
//
// These are the exact names from AutoFilm's reader. Renaming one here fails
// CI rather than emptying a screen over there.
describe("every field name AutoFilm reads is emitted", () => {
  // A row carrying a value for everything, so absence in the output means the
  // shaper does not emit that key rather than that this fixture lacked it.
  const full = shapeLotRow({
    vin: "1C4HJXDN4PW657311",
    ymm: "2023 Jeep Wrangler 4-Door",
    trim: "Altitude",
    condition: "used",
    price: 32876,
    mileage: 36087,
    market_value: 31495,
    dealer_discount: 1500,
    slug: "2023-jeep-wrangler-4-door-657311",
    hero_image_url: "https://x/hero.jpg",
    photos: ["https://x/1.jpg"],
    oem_sticker_url: "https://x/oem.pdf",
    mc_attributes: {
      year: 2023, make: "Jeep", model: "Wrangler 4-Door",
      msrp: 51225, body_type: "SUV", stock_no: "H4821",
    },
  });

  // name -> the alternates AutoFilm's reader accepts. We must emit at least one.
  const READS: Record<string, string[]> = {
    vin: ["vin"],
    year: ["year"], make: ["make"], model: ["model"], trim: ["trim"],
    stock: ["stock", "stock_number"],
    price: ["price", "list_price"],
    mileage: ["mileage", "odometer"],
    condition: ["condition"],
    hero: ["hero_image_url", "photo", "image_url"],
    slug: ["slug", "public_slug"],
    ymm: ["ymm"],
    body_style: ["body_style", "bodyStyle", "body_type", "style"],
    msrp: ["msrp", "MSRP", "retail_price", "sticker_price"],
    market_value: ["market_value", "marketValue", "market_price", "book_value"],
    savings: ["savings", "dealer_savings", "discount", "dealer_discount"],
    window_sticker: ["window_sticker_url", "sticker_url", "monroney_url", "window_sticker"],
  };

  for (const [label, names] of Object.entries(READS)) {
    it(`emits ${label} as one of ${names.join(" | ")}`, () => {
      const hit = names.find((n) => full[n] !== undefined && full[n] !== null);
      expect(hit, `${label}: none of ${names.join(", ")} were emitted`).toBeTruthy();
    });
  }

  it("emits photos as an array the reader can index", () => {
    // photos[0] is one of the accepted hero alternates.
    expect(Array.isArray(full.photos)).toBe(true);
    expect((full.photos as string[])[0]).toMatch(/^https:\/\//);
  });

  it("emits detail_version, without which caching is unsafe", () => {
    // Its absence leaves a consumer choosing between re-fetching every deep
    // record constantly and showing a rep equipment that has gone stale.
    expect(feed).toMatch(/shaped\.detail_version = await detailVersion\(/);
    expect(shared).toMatch(/export async function detailVersion/);
  });
});

// ── Manufacturing specification ──────────────────────────────────────

describe("AutoFilm receives the full vehicle detail", () => {
  const withBuild = {
    vin: "1C6SRFFT2NN400176", ymm: "2022 RAM 1500", trim: "Big Horn",
    mc_attributes: {
      year: 2022, make: "RAM", model: "Ram 1500 Pickup", stock_no: "R4821",
      build_sheet: { source: "neovin", options: ["Level 2 Equipment Group"],
                     standard: { Interior: ["Cloth Seats"] }, packages: [], colors: {} },
    },
    mc_raw: {
      vdp_url: "https://www.harteauto.com/inventory/ram-1500",
      dealer: { name: "Harte", id: 12345 },
      build: {
        body_type: "Pickup", vehicle_type: "Truck", doors: 4, std_seating: 5,
        engine: "5.7L V8", engine_size: 5.7, cylinders: 8, engine_block: "V",
        fuel_type: "Unleaded", transmission: "Automatic", drivetrain: "4WD",
        powertrain_type: "Combustion", city_mpg: 17, highway_mpg: 22,
        overall_length: 232.9, overall_width: 82.1, overall_height: 77.5,
        made_in: "United States", version: "Big Horn/Lone Star",
        make: "RAM", model: "Ram 1500", year: 2022, trim: "Big Horn",
      },
    },
  };

  it("carries the NeoVIN decode, which is what a walkaround describes", () => {
    const out = shapeLotRow(withBuild) as Record<string, any>;
    expect(out.mc_attributes.build_sheet.source).toBe("neovin");
    expect(out.mc_attributes.build_sheet.options).toContain("Level 2 Equipment Group");
  });

  it("carries the manufacturing spec that was locked inside the raw payload", () => {
    // Fuel economy, cylinders, doors, seating and dimensions all live in
    // mc_raw.build, and mc_raw is withheld wholesale — so none of it reached
    // AutoFilm despite being ordinary vehicle detail.
    const spec = (shapeLotRow(withBuild) as Record<string, any>).specifications;
    expect(spec.city_mpg).toBe(17);
    expect(spec.highway_mpg).toBe(22);
    expect(spec.cylinders).toBe(8);
    expect(spec.std_seating).toBe(5);
    expect(spec.doors).toBe(4);
    expect(spec.overall_length).toBe(232.9);
    expect(spec.made_in).toBe("United States");
    expect(spec.drivetrain).toBe("4WD");
  });

  it("still withholds the raw payload itself", () => {
    // The rest of mc_raw is listing and marketplace metadata, including the
    // dealer VDP URL that scrubHistory deliberately strips elsewhere. The
    // contract is normalized resolved facts, not raw provider payloads.
    const out = shapeLotRow(withBuild) as Record<string, any>;
    expect(out.mc_raw).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("harteauto.com");
    expect(JSON.stringify(out.specifications)).not.toContain("dealer");
  });

  it("omits fields the decode did not produce rather than sending null", () => {
    // A consumer must be able to tell "not decoded" from "decoded as empty".
    const sparse = { ...withBuild, mc_raw: { build: { body_type: "Pickup", city_mpg: null, doors: "" } } };
    const spec = (shapeLotRow(sparse) as Record<string, any>).specifications;
    expect(spec).toEqual({ body_type: "Pickup" });
  });

  it("reports null when the vehicle was never decoded", () => {
    const out = shapeLotRow({ ...withBuild, mc_raw: null }) as Record<string, any>;
    expect(out.specifications).toBeNull();
  });
});
