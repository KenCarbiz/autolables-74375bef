import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCopyTargets, pickCopySourceUrl, shouldAttemptCopy, copyAttemptKey,
  explainCopyOutcome, OEM_COPY_MAX_ATTEMPTS,
  type OemCopyAttemptRow, type OemCopyListingRow, type OemHostedRow,
} from "../../../supabase/functions/_shared/oemDocCopy";

const ROOT = join(__dirname, "..", "..", "..");
const fn = readFileSync(join(ROOT, "supabase/functions/oem-document-store/index.ts"), "utf8");
const sql = readFileSync(join(ROOT, "supabase/migrations/20260908140000_oem_document_copy_attempts.sql"), "utf8");
const cron = readFileSync(join(ROOT, "supabase/migrations/20260908141000_oem_document_copy_sweep_cron.sql"), "utf8");
const entitle = readFileSync(join(ROOT, "supabase/migrations/20260908142000_oem_distribution_entitlement_backfill.sql"), "utf8");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-08T12:00:00Z");

const INFINITI_TENANT = "11111111-1111-1111-1111-111111111111";
const HONDA_TENANT = "22222222-2222-2222-2222-222222222222";

const listing = (over: Partial<OemCopyListingRow>): OemCopyListingRow => ({
  id: "listing-1", tenant_id: INFINITI_TENANT, vin: "JN1AAAAAAAA000001",
  ymm: "2026 INFINITI QX60 LUXE", ...over,
});

const franchises = (map: Record<string, string[]>) =>
  new Map(Object.entries(map).map(([t, brands]) => [t, new Set(brands)]));

const base = {
  franchiseBrands: franchises({ [INFINITI_TENANT]: ["infiniti"] }),
  hosted: [] as OemHostedRow[],
  attempts: [] as OemCopyAttemptRow[],
  now: NOW,
};

describe("the franchise rule decides the worklist before anything is fetched", () => {
  it("takes a copy of the dealer's own brand", () => {
    const targets = buildCopyTargets([listing({})], base);
    expect(targets.map((t) => t.kind).sort()).toEqual(["brochure", "owners_manual"]);
    expect(targets[0].brand).toBe("INFINITI");
    expect(targets[0].model).toBe("QX60 LUXE");
    expect(targets[0].year).toBe(2026);
  });

  it("never queues an off-brand car, even on a franchised dealer's lot", () => {
    // The INFINITI store's used Honda links. Licensing, not a limitation:
    // redistributing another manufacturer's PDF is the thing the rule forbids.
    const targets = buildCopyTargets(
      [listing({ ymm: "2021 Honda Accord EX-L", vin: "1HGAAAAAAAA00002" })], base,
    );
    expect(targets).toEqual([]);
  });

  it("never queues a car for a dealer with no derived franchise at all", () => {
    // Same INFINITI, different lot. Possession is not permission: holding the
    // PDF for the INFINITI store does not entitle the Honda store to it.
    const targets = buildCopyTargets(
      [listing({ tenant_id: HONDA_TENANT, vin: "JN1AAAAAAAA000009" })], base,
    );
    expect(targets).toEqual([]);
  });

  it("skips a vehicle whose ymm cannot produce the key the passport looks up", () => {
    expect(buildCopyTargets([listing({ ymm: "INFINITI QX60" })], base)).toEqual([]);
    expect(buildCopyTargets([listing({ ymm: null })], base)).toEqual([]);
  });
});

describe("re-running the sweep is free", () => {
  it("skips a model-year whose copy is already stored", () => {
    const hosted: OemHostedRow[] = [
      { tenant_id: INFINITI_TENANT, brand: "INFINITI", model: "QX60 LUXE", model_year: 2026, document_kind: "owners_manual" },
    ];
    const targets = buildCopyTargets([listing({})], { ...base, hosted });
    expect(targets.map((t) => t.kind)).toEqual(["brochure"]);
  });

  it("matches a held copy case-insensitively and on a missing model year", () => {
    const hosted: OemHostedRow[] = [
      { tenant_id: INFINITI_TENANT, brand: "infiniti", model: "qx60 luxe", model_year: 2026, document_kind: "brochure" },
      { tenant_id: INFINITI_TENANT, brand: "infiniti", model: "qx60 luxe", model_year: 2026, document_kind: "owners_manual" },
    ];
    expect(buildCopyTargets([listing({})], { ...base, hosted })).toEqual([]);
  });

  it("collapses a fleet of one model into one copy, most-stocked model first", () => {
    const listings = [
      listing({ id: "a", vin: "JN1AAAAAAAA000001" }),
      listing({ id: "b", vin: "JN1AAAAAAAA000002" }),
      listing({ id: "c", vin: "JN1AAAAAAAA000003", ymm: "2026 INFINITI QX55 ESSENTIAL" }),
    ];
    const targets = buildCopyTargets(listings, base);
    expect(targets).toHaveLength(4);
    expect(targets[0].vehicleCount).toBe(2);
    expect(targets[0].model).toBe("QX60 LUXE");
  });
});

describe("a failure is bounded, remembered and eventually re-opened", () => {
  const attempt = (over: Partial<OemCopyAttemptRow>): OemCopyAttemptRow => ({
    tenant_id: INFINITI_TENANT, brand_key: "infiniti", model_key: "qx60 luxe",
    year_key: 2026, document_kind: "owners_manual", outcome: "link_missing",
    attempts: 1, last_attempt_at: new Date(NOW - 5 * DAY).toISOString(), ...over,
  });

  it("re-opens a missing manufacturer link after its cooldown", () => {
    expect(shouldAttemptCopy(attempt({}), { now: NOW })).toBe(true);
    expect(shouldAttemptCopy(
      attempt({ last_attempt_at: new Date(NOW - 1 * DAY).toISOString() }), { now: NOW },
    )).toBe(false);
  });

  it("never re-downloads a document it already holds", () => {
    for (const outcome of ["stored", "already_stored"]) {
      expect(shouldAttemptCopy(
        attempt({ outcome, last_attempt_at: new Date(NOW - 900 * DAY).toISOString() }), { now: NOW },
      )).toBe(false);
    }
  });

  it("never re-downloads a document that is simply too large to hold", () => {
    expect(shouldAttemptCopy(
      attempt({ outcome: "too_large", last_attempt_at: new Date(NOW - 900 * DAY).toISOString() }), { now: NOW },
    )).toBe(false);
  });

  it("stops after the attempt ceiling, however long it waits", () => {
    expect(shouldAttemptCopy(
      attempt({ attempts: OEM_COPY_MAX_ATTEMPTS, last_attempt_at: new Date(NOW - 900 * DAY).toISOString() }),
      { now: NOW },
    )).toBe(false);
  });

  it("treats an unreadable or unknown row as settled rather than as a licence to retry", () => {
    expect(shouldAttemptCopy(attempt({ last_attempt_at: "not a date" }), { now: NOW })).toBe(false);
    expect(shouldAttemptCopy(attempt({ outcome: "from_a_newer_deploy" }), { now: NOW })).toBe(false);
  });

  it("re-asks a non-franchised brand monthly, because a store can win a franchise", () => {
    const cold = attempt({ outcome: "not_franchised", last_attempt_at: new Date(NOW - 10 * DAY).toISOString() });
    expect(shouldAttemptCopy(cold, { now: NOW })).toBe(false);
    expect(shouldAttemptCopy(
      attempt({ outcome: "not_franchised", last_attempt_at: new Date(NOW - 31 * DAY).toISOString() }), { now: NOW },
    )).toBe(true);
  });

  it("honours force, which is the only way past a terminal verdict", () => {
    expect(shouldAttemptCopy(attempt({ outcome: "too_large" }), { now: NOW, force: true })).toBe(true);
  });

  it("keeps a cooling-off model out of the worklist", () => {
    const attempts = [attempt({ last_attempt_at: new Date(NOW - 1 * DAY).toISOString() })];
    const targets = buildCopyTargets([listing({})], { ...base, attempts });
    expect(targets.map((t) => t.kind)).toEqual(["brochure"]);
  });

  it("keys the ledger exactly as the unique constraint does", () => {
    expect(copyAttemptKey(INFINITI_TENANT, " INFINITI ", "QX60 Luxe", null, "brochure"))
      .toBe(`${INFINITI_TENANT}|infiniti|qx60 luxe|0|brochure`);
  });
});

describe("the source link is the passport's link, or there is none", () => {
  const rows = [
    { url: "https://owners.infinitiusa.com/qx60-2026.pdf", year: 2026 },
    { url: "https://owners.infinitiusa.com/qx60-2024.pdf", year: 2024 },
    { url: "https://owners.infinitiusa.com/qx60-portal", year: null },
  ];

  it("prefers the exact model year", () => {
    expect(pickCopySourceUrl(rows, 2026)).toBe("https://owners.infinitiusa.com/qx60-2026.pdf");
  });

  it("falls back within two model years, then to a year-less row", () => {
    expect(pickCopySourceUrl(rows, 2023)).toBe("https://owners.infinitiusa.com/qx60-2024.pdf");
    expect(pickCopySourceUrl(rows, 2010)).toBe("https://owners.infinitiusa.com/qx60-portal");
  });

  it("returns null rather than inventing a URL", () => {
    // A dead link on a customer-facing packet is worse than an absent one.
    expect(pickCopySourceUrl([], 2026)).toBeNull();
    expect(pickCopySourceUrl([{ url: "  ", year: 2026 }], 2026)).toBeNull();
    expect(pickCopySourceUrl([{ url: "http://insecure.example/manual.pdf", year: 2026 }], 2026)).toBeNull();
  });
});

describe("the dealer is told which branch this vehicle took", () => {
  it("distinguishes a stored copy from a link, and says why the link", () => {
    expect(explainCopyOutcome("stored", "owners_manual")).toMatch(/copy of the owner's manual is stored/i);
    expect(explainCopyOutcome("not_franchised", "brochure")).toMatch(/not franchised for this brand/i);
    expect(explainCopyOutcome("link_missing", "owners_manual")).toMatch(/nightly sweep retries/i);
    expect(explainCopyOutcome("too_large", "owners_manual")).toMatch(/larger than this dealership stores/i);
  });
});

// ── Structural guarantees the runtime cannot be unit tested for here ──
// Edge functions are outside tsconfig and are not executed by this suite, so
// these read the source. They guard the properties that would fail silently.

describe("oem-document-store still claims before it fetches", () => {
  it("asks the gate before any manufacturer byte is requested", () => {
    const claimAt = fn.indexOf("claim_oem_document_hosting");
    const fetchAt = fn.indexOf("await fetch(req.sourceUrl");
    expect(claimAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(fetchAt);
  });

  it("returns without fetching when the dealer is not franchised", () => {
    expect(fn).toMatch(/if \(decision !== "host"\) \{/);
    expect(fn).toMatch(/reason: "not_franchised_for_brand"/);
  });

  it("routes the sweep through the same claim rather than around it", () => {
    // The sweep calls storeDocument, which starts at the claim. A second
    // storage path that skipped it would be the one way to host a document
    // with no decision behind it.
    expect(fn).toMatch(/const result = await storeDocument\(admin, request\)/);
    expect(fn.match(/admin\.storage\.from\(BUCKET\)\.upload\(/g) ?? []).toHaveLength(1);
  });

  it("never invents a source URL when no manufacturer link was harvested", () => {
    expect(fn).toMatch(/if \(!request\.sourceUrl\) \{/);
    expect(fn).toMatch(/"link_missing"/);
  });

  it("keeps the sweep service-role only", () => {
    const guardAt = fn.indexOf("isServiceOrCron(req)");
    const sweepAt = fn.indexOf('String(body.mode || "") === "sweep"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(sweepAt);
  });

  it("records the copy with an insert, because the table's uniqueness is an expression index", () => {
    // PostgREST's on_conflict takes a plain column list and cannot name
    // (tenant_id, lower(brand), lower(model), COALESCE(model_year, 0),
    // document_kind), so the upsert this replaced raised 42P10 on every
    // first-time copy: fetched, uploaded, un-recorded, deleted again, 500
    // discarded by the caller. Hosting stored nothing at all.
    expect(fn).toMatch(/await admin\.from\("oem_hosted_documents"\)\.insert\(/);
    expect(fn).not.toMatch(/onConflict: "tenant_id,brand,model,model_year,document_kind"/);
  });

  it("keeps the file when another run stored the same document first", () => {
    // The path is deterministic, so the object just uploaded IS the winning
    // row's object. Deleting it on a duplicate key would break that copy.
    const dup = fn.indexOf('=== "23505"');
    const remove = fn.indexOf("storage.from(BUCKET).remove([path])");
    expect(dup).toBeGreaterThan(-1);
    expect(dup).toBeLessThan(remove);
  });

  it("records an attempt on the ingest path and on every sweep outcome", () => {
    expect(fn.match(/await recordCopyAttempt\(/g) ?? []).toHaveLength(4);
  });

  it("leaves the dealer out of the worklist when their franchise cannot be read", () => {
    // "We could not check" is not "we are allowed".
    expect(fn).toMatch(/derive_oem_franchise_brands/);
    expect(fn).toMatch(/if \(error \|\| !Array\.isArray\(data\)\) continue;/);
  });
});

describe("the copy ledger makes a missing document queryable", () => {
  it("keys one row per dealer, brand, model, model-year and kind", () => {
    expect(sql).toMatch(/CONSTRAINT uq_oem_document_copy_attempts\s*\n?\s*UNIQUE \(tenant_id, brand_key, model_key, year_key, document_kind\)/);
  });

  it("increments the attempt count instead of resetting it", () => {
    // A plain upsert would reset attempts to 1 and the ceiling would never
    // be reached, so an unreachable CDN would be re-downloaded forever.
    expect(sql).toMatch(/attempts\s*=\s*public\.oem_document_copy_attempts\.attempts \+ 1/);
  });

  it("never un-resolves a document that is already in the bucket", () => {
    expect(sql).toMatch(/resolved_at\s*=\s*COALESCE\(public\.oem_document_copy_attempts\.resolved_at, EXCLUDED\.resolved_at\)/);
  });

  it("scopes reads to the dealer's own rows with the cached uid", () => {
    expect(sql).toMatch(/CREATE POLICY "oem copy attempts readable by tenant"/);
    expect(sql).toMatch(/TO authenticated/);
    expect(sql).toMatch(/WHERE user_id = \(SELECT auth\.uid\(\)\)/);
  });

  it("exposes the backlog through the reader's own RLS", () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.oem_document_copy_backlog\s*\nWITH \(security_invoker = on\)/);
    expect(sql).toMatch(/WHERE a\.resolved_at IS NULL/);
  });

  it("gives the sweep no write path from the browser", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.record_oem_document_copy_attempt[\s\S]*?FROM PUBLIC, anon, authenticated/);
  });
});

describe("the franchise stays derived, and the declaration is only recorded", () => {
  it("still takes the decision from the gate, not from the caller or the profile", () => {
    expect(sql).toMatch(/v_may := public\.tenant_may_host_oem_documents\(_tenant_id, v_brand, _store_id\)/);
    expect(sql).toMatch(/v_decision := CASE WHEN v_may THEN 'host' ELSE 'link' END/);
  });

  it("records what the dealer says its franchises are without consulting it", () => {
    // dealer_profiles.settings.dealer_oem_brands is a statement, not evidence.
    // It appears in the snapshot and nowhere in the decision.
    expect(sql).toMatch(/'declared_brands', to_jsonb\(v_declared\)/);
    expect(sql).toMatch(/'declared_not_derived'/);
    const decisionLine = sql.slice(sql.indexOf("v_may := public.tenant_may_host"), sql.indexOf("v_declared := "));
    expect(decisionLine).not.toMatch(/declared/);
  });

  it("reads the declaration from the dealer profile rather than a hardcoded brand", () => {
    expect(sql).toMatch(/dp\.settings->>'dealer_oem_brands'/);
    const body = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.declared_oem_brands"),
      sql.indexOf("GRANT EXECUTE ON FUNCTION public.declared_oem_brands"));
    expect(body).not.toMatch(/infiniti|toyota|honda/i);
  });
});

describe("the sweep runs after the link harvest that feeds it", () => {
  it("is scheduled later than packet-backfill's 09:40", () => {
    expect(cron).toMatch(/_cron_expr TEXT DEFAULT '20 10 \* \* \*'/);
  });

  it("calls oem-document-store in sweep mode with a bounded download budget", () => {
    expect(cron).toMatch(/functions\/v1\/oem-document-store/);
    expect(cron).toMatch(/"mode": "sweep"/);
    expect(cron).toMatch(/"store_limit": 8/);
  });
});

describe("every car of a copied model serves the copy, not just the first one", () => {
  it("mints the missing per-vehicle decisions through the gate, never around it", () => {
    // A stored copy is keyed per model; entitlement is keyed per VIN. Writing
    // events directly would be backdating a decision nobody made.
    expect(entitle).toMatch(/PERFORM public\.record_oem_distribution\(/);
    expect(entitle).not.toMatch(/INSERT INTO public\.oem_distribution_events/);
  });

  it("only ever entitles a document actually held", () => {
    expect(entitle).toMatch(/JOIN public\.oem_hosted_documents h/);
  });

  it("stops minting once the dealer no longer holds the franchise", () => {
    // New distributions stop; the ones already given stand.
    expect(entitle).toMatch(/IF public\.tenant_may_host_oem_documents\(_tenant_id, v_row\.brand, NULL\) THEN/);
  });

  it("derives the lookup key exactly as the copies were stored under", () => {
    // Second word is the make, everything after it is the model — the shared
    // oemDocKeyFromYmm rule, not oem_make_from_ymm's multi-word rejoin. The
    // clever version would fail to match the row it is looking for.
    expect(entitle).toMatch(/make := v_parts\[2\];/);
    expect(entitle).toMatch(/model := array_to_string\(v_parts\[3:v_len\], ' '\);/);
    expect(entitle).toMatch(/v_parts\[1\] !~ '\^\(19\|20\)\\d\{2\}\$'/);
  });

  it("skips only the vehicles that already have their decision", () => {
    expect(entitle).toMatch(/NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.oem_distribution_events e/);
    expect(entitle).toMatch(/AND e\.decision = 'host'/);
  });

  it("runs on every sweep, including the nights with nothing left to download", () => {
    // The steady state of a swept fleet is "every copy already held" — which
    // is exactly when a new arrival of an already-copied model needs its
    // decision minted. Gating this on the download plan would never reach it.
    expect(fn).toMatch(/backfill_oem_distribution_entitlements/);
    expect(fn).toMatch(/if \(!franchiseBrands\.size\) \{/);
    expect(fn).not.toMatch(/if \(!planned\.length\) \{/);
  });
});
