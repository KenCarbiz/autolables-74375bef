/**
 * Section 6: the candidate uses only interfaces Lovable Cloud supports. Postgres RPCs callable only by
 * the service role, RLS on every table with no browser grants, writes only through SECURITY DEFINER
 * functions with a pinned search_path, no custom login roles, Vault, cron or extra extensions; and
 * TypeScript that is server-only, reads no environment secrets and ships with both switches OFF.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { checker, openDb } from "./harness";

const sql = openDb();
const { check, report } = checker("section6_interface");
const RPCS = ["gw_r2_admit", "gw_r2_save_admission_receipt", "gw_r2_claim", "gw_r2_complete", "gw_r2_fail", "gw_r2_record_uncommitted"];
try {
  const fns = await sql`SELECT p.proname, p.prosecdef, p.proconfig,
      has_function_privilege('service_role', p.oid, 'execute') svc,
      has_function_privilege('authenticated', p.oid, 'execute') auth,
      has_function_privilege('anon', p.oid, 'execute') anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'gw\\_r2\\_%'`;
  const byName = new Map(fns.map((f) => [f["proname"] as string, f]));
  for (const name of RPCS) {
    const f = byName.get(name);
    check(`${name} exists`, !!f);
    check(`${name} is SECURITY DEFINER with a pinned search_path`, f!["prosecdef"] === true && (f!["proconfig"] as string[] | null)?.some((c) => c.startsWith("search_path=")) === true);
    check(`${name} is executable by service_role only`, f!["svc"] === true && f!["auth"] === false && f!["anon"] === false);
  }
  const redrive = byName.get("gw_r2_redrive")!;
  check("redrive is a signed-in member RPC only (not anon, not service_role)", redrive["auth"] === true && !redrive["svc"] && !redrive["anon"] && redrive["prosecdef"] === true);
  const asUser = async (sub: string, fn: string) =>
    sql.begin(async (tx) => {
      await tx`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub, role: "authenticated" })},true)`;
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx.unsafe(fn);
    }).then(() => "ok", (e: Error) => e.message);
  check("redrive refuses a signed-in non-admin", (await asUser(crypto.randomUUID(), "SELECT gw_r2_redrive('no-such-delivery','CASE-1')")) === "admin and case required");
  for (const f of fns.filter((x) => (x["proname"] as string).endsWith("_internal") || x["proname"] === "gw_r2_route_allowed" || x["proname"] === "gw_r2_append_only"))
    check(`${f["proname"]} is not callable by API roles`, !f["svc"] && !f["auth"] && !f["anon"]);
  check("every gw_r2 function pins its search_path", fns.every((f) => (f["proconfig"] as string[] | null)?.some((c) => c.startsWith("search_path="))));

  const tables = await sql`SELECT c.relname, c.relrowsecurity rls,
      has_table_privilege('authenticated', c.oid, 'select') a_sel, has_table_privilege('anon', c.oid, 'select') n_sel,
      has_table_privilege('service_role', c.oid, 'select') s_sel,
      has_table_privilege('service_role', c.oid, 'insert') OR has_table_privilege('service_role', c.oid, 'update') OR has_table_privilege('service_role', c.oid, 'delete') s_write
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'gw\\_r2\\_%'`;
  check("nine gw_r2 tables", tables.length === 9);
  for (const t of tables) {
    check(`${t["relname"]}: RLS on, no browser access`, t["rls"] === true && !t["a_sel"] && !t["n_sel"]);
    check(`${t["relname"]}: service_role reads, writes only through RPCs`, t["s_sel"] === true && t["s_write"] === false);
  }
  const roles = (await sql`SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' AND rolname NOT IN ('anon','authenticated','service_role') AND NOT rolsuper`).map((r) => r["rolname"] as string);
  check("no custom database roles", roles.length === 0);
  const ext = (await sql`SELECT extname FROM pg_extension WHERE extname<>'plpgsql' ORDER BY 1`).map((r) => r["extname"] as string);
  check("only Supabase-standard extensions", ext.every((e) => ["pgcrypto", "uuid-ossp", "pg_stat_statements"].includes(e)));
  check("no cron schedule and no Vault dependency", !ext.includes("pg_cron") && !ext.includes("supabase_vault"));
  const settings = (await sql`SELECT environment, external_delivery_enabled, global_kill FROM gw_settings WHERE id=1`)[0]!;
  check("Gateway settings: DEV, external delivery OFF", settings["environment"] === "DEV" && settings["external_delivery_enabled"] === false);

  const dir = path.resolve("src/lib/gateway/rtgip2");
  const runtime = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const text = (f: string) => readFileSync(path.join(dir, f), "utf8");
  check("no runtime module imports a browser Supabase client", runtime.every((f) => !/@supabase\/supabase-js|integrations\/supabase/.test(text(f))));
  check("no runtime module reads environment secrets", runtime.every((f) => !/process\.env|Deno\.env|import\.meta\.env/.test(text(f))));
  check("no runtime module makes its own network call", runtime.every((f) => !/\bfetch\(/.test(text(f))));
  check("database access is the narrow server-only RPC port", /export interface CandidateRpc/.test(text("store.server.ts")) && runtime.filter((f) => /rpc\.call\(/.test(text(f))).every((f) => f.endsWith(".server.ts")));
  check("ingress and outbound switches ship OFF", /RTGIP2_INGRESS_ENABLED = false as const/.test(text("verify.ts")) && /RTGIP2_OUTBOUND_ENABLED = false as const/.test(text("verify.ts")));
  check("AutoFilm routes are reserved, never three_app", !/autofilm[^\n]*three_app/.test(text("core.ts")));
  report();
} finally {
  await sql.end();
}
