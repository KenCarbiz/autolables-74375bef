// @vitest-environment node
// The route catalog and forbidden-key list that the proposed SQL admission check enforces
// are generated from rtgip2/protocol.ts. With RTGIP_SQL_CATALOG_WRITE set the block in the
// SQL file is rewritten; otherwise the committed block must equal what the code produces.
import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_CATALOG, FORBIDDEN_KEYS, ROUTES, type EventType } from "../rtgip2/protocol.ts";

const SQL = join(dirname(fileURLToPath(import.meta.url)), "../../../../supabase/proposed/rtgip_v2_delivery.proposed.sql");
const BEGIN = "-- BEGIN GENERATED rtgip catalog (rtgip2-matrix/sql-catalog.gen.test.ts; do not edit by hand)";
const END = "-- END GENERATED rtgip catalog";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: readonly (string | number)[]) => q(`{${xs.join(",")}}`);

function generated(): string {
  const rows: string[] = [];
  for (const r of ROUTES.filter((x) => x.phase === "three_app"))
    for (const [t, purposes] of Object.entries(r.events) as [EventType, readonly string[]][]) {
      const spec = EVENT_CATALOG[t];
      rows.push(`  (${q(r.id)}, ${q(t)}, ${q(spec.owner)}, ${arr(purposes)}, ${arr(spec.schema_versions)})`);
    }
  const keys = [...FORBIDDEN_KEYS].sort().map((k) => `(${q(k)})`);
  return [
    BEGIN,
    "DELETE FROM rtgip.event_catalog;",
    "INSERT INTO rtgip.event_catalog (route, event_type, owner, purposes, schema_versions) VALUES",
    rows.join(",\n") + ";",
    "DELETE FROM rtgip.forbidden_keys;",
    `INSERT INTO rtgip.forbidden_keys (key) VALUES ${keys.join(", ")};`,
    END,
  ].join("\n");
}

it("the SQL route catalog and forbidden keys are generated from protocol.ts", () => {
  const sql = readFileSync(SQL, "utf8");
  const a = sql.indexOf(BEGIN);
  const b = sql.indexOf(END);
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const current = sql.slice(a, b + END.length);
  const want = generated();
  if (process.env.RTGIP_SQL_CATALOG_WRITE) writeFileSync(SQL, sql.replace(current, want));
  else expect(current).toBe(want);
});
