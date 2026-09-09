import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The fetch layer lives in an edge function, outside tsconfig and outside
// vitest's module graph, so nothing else in this suite can reach it. Its
// invariants are the ones that make the read model SHADOW rather than a
// second writer, and they are the kind that a one-line edit silently breaks:
// a `.upsert` added to "cache the projection", a JWT branch added to "let the
// page try it", a `.from()` that forgets the tenant filter and reads another
// dealer's cars under the service-role key. So they are pinned here against
// the deployed source text, the way crawlFormat.test.ts pins the crawler's
// render request.

const PATH = join(__dirname, "../../../supabase/functions/vehicle-file-read-model/index.ts");
const SRC = readFileSync(PATH, "utf8");

const section = (start: string, end: string): string => {
  const a = SRC.indexOf(start);
  if (a < 0) throw new Error(`"${start}" not found in the read-model source`);
  const b = SRC.indexOf(end, a);
  if (b < 0) throw new Error(`"${end}" not found after "${start}"`);
  return SRC.slice(a, b);
};

/** Every `.from(` in the file, with the statement it opens. */
const fromStatements = (): Array<{ target: string; statement: string }> => {
  const out: Array<{ target: string; statement: string }> = [];
  const pattern = /\.from\(([^)]*)\)/g;
  for (const match of SRC.matchAll(pattern)) {
    const at = match.index ?? 0;
    const end = SRC.indexOf(";", at);
    out.push({ target: match[1], statement: SRC.slice(at, end < 0 ? SRC.length : end) });
  }
  return out;
};

const vehicleQueryBlock = section("const VEHICLE_QUERIES", "\n/**");
const tenantQueryBlock = section("const TENANT_QUERIES", "const QUERIES_PER_BATCH");

describe("the read model is shadow only", () => {
  it("writes to nothing", () => {
    for (const write of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(SRC, `the shadow model must not ${write}`).not.toContain(write);
    }
  });

  it("calls no RPC, which is the other way a read can become a write", () => {
    expect(SRC).not.toContain(".rpc(");
  });

  it("calls no provider: every stamp it reports was read, never re-fetched", () => {
    expect(SRC).not.toMatch(/\bfetch\(/);
    expect(SRC.toLowerCase()).not.toContain("firecrawl");
    expect(SRC.toLowerCase()).not.toContain("marketcheck.com");
    expect(SRC.toLowerCase()).not.toContain("api.openai");
    expect(SRC).not.toContain("https://api.");
  });
});

describe("auth is service role or the shared cron secret, and nothing else", () => {
  it("accepts the service-role key or x-cron-secret", () => {
    expect(SRC).toContain('const cronSecret = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";');
    expect(SRC).toContain('const isCron = !!cronSecret && (req.headers.get("x-cron-secret") || "") === cronSecret;');
    expect(SRC).toMatch(/if \(auth !== serviceKey && !isCron\) return json\(/);
  });

  it("has no user-JWT path", () => {
    // The bundle spans tables scoped by current_tenant_id() and tables scoped
    // by a tenant_members list. A JWT caller would get a bundle whose gaps
    // depend on which policy answered, which is worse than no bundle.
    expect(SRC).not.toContain("auth.getUser(");
    expect(SRC).not.toContain('"tenant_members"');
    expect(SRC).not.toContain("SUPABASE_ANON_KEY");
    expect(SRC).not.toContain("global: { headers");
  });

  it("never logs a key or puts one in a reply", () => {
    expect(SRC).not.toMatch(/console\.(log|info|warn|error)/);
    // Every line that touches a secret, enumerated: read it, compare it, hand
    // it to the client. A key never reaches a response body or a log line.
    const secretLines = SRC.split("\n")
      .map((line) => line.trim())
      .filter((line) => /serviceKey|cronSecret/.test(line) && !line.startsWith("//"));
    expect(secretLines).toEqual([
      'const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");',
      'if (!supabaseUrl || !serviceKey) return json({ error: "Missing Supabase env vars" }, 500);',
      'const cronSecret = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";',
      'const isCron = !!cronSecret && (req.headers.get("x-cron-secret") || "") === cronSecret;',
      'if (auth !== serviceKey && !isCron) return json({ error: "service role or cron secret required" }, 401);',
      "const db = createClient(supabaseUrl, serviceKey, {",
    ]);
  });
});

describe("every read is scoped to one tenant", () => {
  const statements = fromStatements();

  it("reads six places and no more", () => {
    expect(statements.map((s) => s.target)).toEqual([
      "spec.table",
      "SHAPE_QUERY.table",
      "spec.table",
      '"vehicle_listings"',
      '"vehicle_listings"',
      '"vehicle_listings"',
    ]);
  });

  it("carries an explicit tenant filter on every query but the one tenant-less table", () => {
    for (const { target, statement } of statements) {
      if (target === "SHAPE_QUERY.table") continue;
      const scoped = statement.includes('.eq("tenant_id", tenantId)')
        || statement.includes(".eq(spec.tenantColumn, tenantId)");
      expect(scoped, `${target}: ${statement.slice(0, 120)}`).toBe(true);
    }
  });

  it("scopes the tenant-less provider table to this batch's own VINs", () => {
    // provider_payload_shapes records the shape a provider's payload arrived
    // in, which belongs to the provider and not to any dealer, so there is no
    // tenant column to filter on. sample_vin is the narrowest filter there is.
    const shape = section("const SHAPE_QUERY", "interface TenantQuery");
    expect(shape).toContain('table: "provider_payload_shapes"');
    expect(shape).toContain('keyColumn: "sample_vin"');
    const statement = statements.find((s) => s.target === "SHAPE_QUERY.table");
    expect(statement?.statement).toContain(".in(SHAPE_QUERY.keyColumn, vins)");
    expect(SRC.match(/tenantColumn/g)?.length).toBeGreaterThan(0);
    expect(shape).not.toContain("tenantColumn");
  });

  it("declares a tenant column on every vehicle query", () => {
    const declared = [...vehicleQueryBlock.matchAll(/tenantColumn: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(declared).toHaveLength(30);
    for (const column of declared) expect(["tenant_id", "store_id"]).toContain(column);
    // audit_log is the one table that names the tenant `store_id`; it is also
    // the only record a refused page reading leaves behind.
    expect(declared.filter((c) => c === "store_id")).toHaveLength(1);
    expect(vehicleQueryBlock).toMatch(/table: "audit_log", tenantColumn: "store_id"/);
  });

  it("makes the tenant column mandatory in the shape, not optional", () => {
    expect(SRC).toMatch(/tenantColumn: "tenant_id" \| "store_id";/);
  });
});

describe("the bundle is fetched in a fixed number of round trips", () => {
  const vehicleQueries = [...vehicleQueryBlock.matchAll(/\{ table: "([a-z_]+)"/g)].map((m) => m[1]);
  const tenantQueries = [...tenantQueryBlock.matchAll(/\{ table: "([a-z_]+)"/g)].map((m) => m[1]);

  it("batches by table, one query per table over every id in the batch", () => {
    expect(new Set(vehicleQueries).size).toBe(vehicleQueries.length);
    expect(vehicleQueries).toHaveLength(30);
    // 30 vehicle tables + provider_payload_shapes.
    expect(SRC).toContain("const QUERIES_PER_BATCH = VEHICLE_QUERIES.length + 1;");
    expect(section("const grouped = await Promise.all", "VEHICLE_QUERIES.forEach"))
      .toContain("...VEHICLE_QUERIES.map((spec) => runVehicleQuery(db, tenantId, spec, ids, vins, ctx))");
  });

  it("reads the tenant-wide inputs once a run, not once a vehicle", () => {
    expect(tenantQueries).toEqual([
      "dealer_profiles",
      "source_authority_rules",
      "inventory_sync_runs",
      "marketcheck_sync_config",
    ]);
    // shadow_parity fetches the tenant scope before the chunk loop.
    const parity = section("async function shadowParityAction", "const rows: ParityRow[]");
    expect(parity).toContain("const tenant = await fetchTenantScope(db, tenantId, ctx);");
    expect(section("for (let start = 0; start < listings.length", "const summary ="))
      .not.toContain("fetchTenantScope");
  });

  it("costs 36 round trips for one vehicle: 1 listing + 4 tenant + 31 batched", () => {
    const readModel = section("async function readModelAction", "async function shadowParityAction");
    expect(readModel).toContain("const listing = await fetchOneListing(db, tenantId, vehicleId, vin, ctx);");
    expect(readModel).toContain("fetchTenantScope(db, tenantId, ctx)");
    expect(readModel).toContain("fetchVehicleBatch(db, tenantId, [listing], ctx)");
    const perVehicle = 1 + 4 + (30 + 1);
    expect(perVehicle).toBe(36);
  });

  it("names every query and reports the count, the elapsed time and the bytes read", () => {
    for (const table of [...vehicleQueries, ...tenantQueries]) {
      expect(SRC).toContain(`"${table}"`);
    }
    expect(SRC).toMatch(/queryCount: ctx\.queryCount/);
    expect(SRC).toMatch(/payloadBytes: ctx\.payloadBytes/);
    expect(SRC).toMatch(/elapsedMs: Date\.now\(\) - startedAt/);
    // Every runner counts its own round trip, whether or not it succeeded.
    expect(SRC.match(/ctx\.queryCount \+= 1;/g)).toHaveLength(6);
  });

  it("orders every vehicle query by the writer's own stamp, newest first", () => {
    const stamps = [...vehicleQueryBlock.matchAll(/timeColumn: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(stamps).toHaveLength(30);
    expect(SRC).toContain(".order(spec.timeColumn, { ascending: false, nullsFirst: false })");
    // Postgres orders DESC as NULLS FIRST; without nullsFirst:false an
    // unstamped row would take [0] from a stamped one and the section would
    // read as unstamped-UNKNOWN when a real stamp exists.
    expect(SRC).toContain(".order(SHAPE_QUERY.timeColumn, { ascending: false, nullsFirst: false })");
    expect(SRC).toContain("query.order(spec.timeColumn, { ascending: false, nullsFirst: false })");
  });
});

describe("a gap is reported, never inferred and never thrown", () => {
  it("turns a failed read into a missing-sources line", () => {
    const runner = section("async function runVehicleQuery", "async function runShapeQuery");
    expect(runner).toContain("ctx.missing.push(`${spec.table}: ${error.message}`);");
    expect(runner).toContain("return new Map();");
    expect(SRC.match(/ctx\.missing\.push\(/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("says so when a row cap truncated a table rather than reporting a short list", () => {
    expect(SRC).toContain("if (rows.length >= cap) ctx.missing.push(capNote(spec.table, cap));");
    expect(SRC).toContain("was reached, so some rows for these vehicles were not read.");
  });

  it("hands the bundle's own failures to every vehicle it assembled", () => {
    expect(SRC).toContain("sources.missing = [...missing];");
  });
});

describe("shadow_parity cannot report a truncated run as a complete one", () => {
  const parity = section("async function shadowParityAction", "serve(async (req)");

  it("stops inside the gateway's idle limit", () => {
    expect(SRC).toContain("const RUN_BUDGET_MS = 120_000;");
    expect(parity).toContain("const deadlineAt = startedAt + RUN_BUDGET_MS;");
    expect(parity).toMatch(/if \(Date\.now\(\) > deadlineAt\) \{\s*truncated = true;\s*break;/);
  });

  it("reports what it compared, what it skipped, and where to resume", () => {
    expect(parity).toContain("const skipped = listings.length - compared;");
    expect(parity).toMatch(/truncated,/);
    expect(parity).toContain("next_offset: nextOffset,");
    // A finished page still chains when the tenant has more active cars than
    // the page covered, so a caller cannot mistake one page for the fleet.
    expect(parity).toContain("(activeVins !== null && offset + listings.length < activeVins ? offset + listings.length : null)");
    expect(parity).toContain("activeVins,");
  });

  it("aggregates server-side and returns no whole models", () => {
    expect(parity).toContain("const summary = summariseParity(rows, activeVins ?? compared, missingSources);");
    expect(parity).toContain('rows: rows.filter((row) => row.verdict !== "MATCH"),');
    expect(parity).not.toMatch(/\bmodel,/);
  });

  it("counts an active listing the way the maps define it", () => {
    const count = section("async function countActiveListings", "async function fetchActiveListings");
    expect(count).toContain('.is("archived_at", null)');
    expect(count).toContain('.neq("status", "archived")');
  });
});

describe("the bundle it assembles is the contract's bundle", () => {
  const assembly = section("function assembleSources", "// ── Vehicle selection");

  it("starts from emptySources so a new slot cannot be silently unfilled", () => {
    expect(assembly).toContain("const sources = emptySources(tenantId);");
  });

  it("fills every slot the builders read", () => {
    for (const slot of [
      "listing", "file", "facts", "snapshot", "sourceRecords", "factConflicts", "neovin",
      "advertisedPrices", "crawlAttempt", "crawlRefusals", "factorySticker", "getReady",
      "workItems", "reconEstimates", "safetyInspections", "prepSignOffs", "deliveryClearance",
      "lifecycle", "generatedDocuments", "signedDocuments", "staleFlags", "recallTasks",
      "descriptionVersion", "descriptionChannels", "descriptionExceptions", "engagement",
      "leads", "changeHistory", "valueHistory", "providerShapes", "dealerProfile",
      "authorityRules", "syncRuns", "syncConfig", "missing",
    ]) {
      expect(assembly, `sources.${slot} is never filled`).toContain(`sources.${slot} =`);
    }
  });

  it("reads the crawl refusals from the audit action, the only record a refusal leaves", () => {
    expect(assembly).toContain('sources.crawlRefusals = many("audit_log");');
    expect(vehicleQueryBlock).toContain('eq: [["action", "advertised_price_crawl_skipped"]]');
  });

  it("merges the three engagement writers into the one list buildCustomer expects", () => {
    expect(assembly).toContain('...many("passport_engagement")');
    expect(assembly).toContain('...many("qr_scan_events")');
    expect(assembly).toContain('...many("customer_engagement_events")');
  });

  it("matches VIN-keyed rows case-insensitively, since the join is on upper(vin)", () => {
    expect(SRC).toContain('const key = keyKind === "vin" ? raw.toUpperCase() : raw;');
    expect(assembly).toContain('const vin = typeof listing.vin === "string" ? listing.vin.toUpperCase() : "";');
  });
});

/**
 * Every VEHICLE_QUERIES entry, parsed from the one line that declares it.
 * `columns` is "" when the entry does not narrow its projection.
 */
const vehicleSpecs = (): Array<{
  table: string;
  keyColumn: string;
  timeColumn: string;
  columns: string;
  isNull: string;
  eq: string[];
}> =>
  vehicleQueryBlock
    .split("\n")
    .filter((line) => line.trim().startsWith("{ table:"))
    .map((line) => {
      const field = (name: string): string =>
        line.match(new RegExp(`[\\s,{]${name}: "([^"]*)"`))?.[1] ?? "";
      return {
        table: field("table"),
        keyColumn: field("keyColumn"),
        timeColumn: field("timeColumn"),
        columns: field("columns"),
        isNull: field("isNull"),
        eq: [...line.matchAll(/\[\["([^"]+)",/g)].map((m) => m[1]),
      };
    });

describe("a query reads the columns its builders read, and not the ones they discard", () => {
  const specs = vehicleSpecs();

  it("parses every spec line, so the checks below cover the whole plan", () => {
    expect(specs).toHaveLength(30);
    for (const spec of specs) {
      expect(spec.table, "a spec line without a table").not.toBe("");
      expect(spec.keyColumn, `${spec.table} has no keyColumn`).not.toBe("");
      expect(spec.timeColumn, `${spec.table} has no timeColumn`).not.toBe("");
    }
  });

  it("reads whole rows by default, so a new table cannot start out half-read", () => {
    expect(SRC).toContain('.select(spec.columns ?? "*")');
    expect(SRC).not.toContain('.select("*").eq(spec.tenantColumn');
  });

  it("narrows exactly one table, and says which", () => {
    // Narrowing is a silent contract: a builder that later reads a column
    // left out here gets `undefined` and loses the fact without an error, so
    // a second narrowed table has to be argued for here before it lands.
    expect(specs.filter((spec) => spec.columns !== "").map((spec) => spec.table))
      .toEqual(["vehicle_value_history"]);
  });

  it("reads the five vehicle_value_history columns the builders read", () => {
    const spec = specs.find((s) => s.table === "vehicle_value_history");
    expect(spec?.columns.split(",")).toEqual([
      "vin",          // groupRows keys the batch on it
      "source",       // market.ts names the snapshot's writer from it
      "market_value", // market.ts's candidate and presentation.ts's event
      "captured_at",  // the order key, and the event's stamp
      "created_at",   // presentation.ts's latestStamp fallback
    ]);
  });

  it("leaves out the payload column that caused the Gate 2 timeout", () => {
    // `payload` is 24 MB of jsonb over the pilot tenant's 6,696 rows, and
    // 4,383 of those are marketcheck_sync snapshots carrying a payload and no
    // market_value at all — exactly the rows both builders discard. PostgREST
    // renders the whole row through json_agg, so selecting it measured mean
    // 3,359 ms and max 7,676 ms against the 8 s statement timeout and was
    // cancelled for 50 of the pilot's 130 vehicles. The plan was never the
    // problem: it is a bitmap scan on idx_vehicle_value_history_vin either
    // way, 2,927 shared buffers with the column and 351 without.
    const spec = specs.find((s) => s.table === "vehicle_value_history");
    for (const unread of ["payload", "listing_price", "position", "below_market"]) {
      expect(spec?.columns.split(","), `${unread} is read by nothing`).not.toContain(unread);
    }
  });

  it("keeps every narrowed projection able to answer its own query", () => {
    for (const spec of specs) {
      if (spec.columns === "") continue;
      const named = spec.columns.split(",");
      // groupRows reads keyColumn off the returned row; without it the batch
      // groups to nothing and every vehicle reads as having no history.
      expect(named, `${spec.table}: grouping reads ${spec.keyColumn}`).toContain(spec.keyColumn);
      // The stamp the model reports as the row's observation time.
      expect(named, `${spec.table}: the model reports ${spec.timeColumn}`).toContain(spec.timeColumn);
      // A filtered row has to be able to show why it is in the bundle.
      if (spec.isNull) expect(named, `${spec.table}: filtered on ${spec.isNull}`).toContain(spec.isNull);
      for (const column of spec.eq) {
        expect(named, `${spec.table}: filtered on ${column}`).toContain(column);
      }
    }
  });
});
