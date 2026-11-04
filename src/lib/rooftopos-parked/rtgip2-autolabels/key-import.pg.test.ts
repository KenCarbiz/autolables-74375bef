// @vitest-environment node
// C-S4 Alternative S1, local evidence: the one-time Vault key import against a disposable AutoLabels
// node built from empty, with hosted-equivalent server logging (supabase/tests/rtgip/key_import_pg.sh).
// The deployed rtgip2-key-import bundle is served under Deno exactly as the Edge Function entry runs
// it, except that this file passes compiledEnabled: true. Every key here is generated at test start
// and discarded with the cluster. Not hosted evidence.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { KEY_IMPORT_IDS, keySecretName } from "../rtgip2-key-import/key-import.ts";
import { STAGING_PROJECT_REF } from "./runtime-config.ts";
import { denoAvailable, liftTransportCheck, setTransport } from "../rtgip2-runtime/pg-harness.ts";
import { serveKeyImport, type KeyImportServer } from "../rtgip2-staging/key-import-harness.ts";

const PG_URL = process.env.RTGIP_PG_URL ?? "";
const PG_LOG = process.env.RTGIP_KI_PGLOG ?? "";
const PGBIN = process.env.RTGIP_KI_PGBIN ?? "";
const REMOVAL = process.env.RTGIP_KI_REMOVAL ?? "";
const FROZEN_BEFORE = process.env.RTGIP_KI_FROZEN_BEFORE ?? "";
const DENO_BIN = process.env["RTGIP_DENO"] ?? "/tmp/denobin/node_modules/.bin/deno";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BUNDLE = path.join(ROOT, "supabase/functions/_shared/rtgip2-key-import.bundle.js");
export const KEY_IMPORT_RESULT_LABEL =
  "S1 local evidence, disposable AutoLabels node with hosted-equivalent logging, deployed key-import bundle under Deno, not hosted evidence";
const run = describe.runIf(!!PG_URL && !!PG_LOG && denoAvailable());

type Id = (typeof KEY_IMPORT_IDS)[number];
const hex32 = () => randomBytes(32).toString("hex");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const good = Object.fromEntries(KEY_IMPORT_IDS.map((k) => [k, hex32()])) as Record<Id, string>;
const fp = (k: Id) => sha(good[k]);
const BAD = { malformed: "ZZ".repeat(32), wrong: hex32() };
const sent: string[] = [];
const servers: KeyImportServer[] = [];
const serve = async (keyEnv: Record<string, string>) => {
  const k = await serveKeyImport({
    bundleFile: BUNDLE,
    stagingRef: STAGING_PROJECT_REF,
    dbUrl: PG_URL,
    keyEnv,
    deno: DENO_BIN,
  });
  servers.push(k);
  return k;
};
const evidence: Record<string, unknown> = { classification: KEY_IMPORT_RESULT_LABEL };

let sql: ReturnType<typeof postgres>;
let gs: KeyImportServer;
let bad: KeyImportServer;

const replies: string[] = [];
async function call(s: { url: string }, body: unknown) {
  const raw = JSON.stringify(body);
  sent.push(raw);
  const r = await fetch(`${s.url}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
  const text = await r.text();
  replies.push(text);
  return { status: r.status, doc: JSON.parse(text) as Record<string, unknown>, text };
}

async function issue(k: string, f: string, ttl = "10 minutes") {
  const r =
    await sql`SELECT ticket_id::text AS ticket_id, token FROM rtgip.key_import_issue(${k}, ${f}, 'TEST-S1-LOCAL', ${ttl}::interval)`;
  return { ticket_id: String(r[0]!.ticket_id), token: String(r[0]!.token) };
}
const issueError = async (k: string, f: string, ttl = "10 minutes") => {
  try {
    await issue(k, f, ttl);
    return "issued";
  } catch (e) {
    return String((e as Error).message);
  }
};
const outcome = async (ticket: string) =>
  (await sql`SELECT outcome FROM rtgip.key_import_tickets WHERE ticket_id = ${ticket}::uuid`)[0]
    ?.outcome as string | null;
const vaultCount = async () =>
  Number(
    (await sql`SELECT count(*) AS n FROM vault.decrypted_secrets WHERE name LIKE 'rtgip:%'`)[0]!.n,
  );
const frozen = async () =>
  String(
    (
      await sql`SELECT md5(string_agg(p.proname || ':' || pg_get_functiondef(p.oid), '|' ORDER BY p.proname, p.oid)) AS h
                FROM pg_proc p WHERE p.pronamespace = 'rtgip'::regnamespace AND p.proname NOT LIKE 'key_import%'`
    )[0]!.h,
  );
const setDb = async (name: string, value: string | null) => {
  await sql.unsafe(
    value === null
      ? `ALTER DATABASE rtgip_ki RESET "${name}"`
      : `ALTER DATABASE rtgip_ki SET "${name}" = '${value}'`,
  );
};

run(KEY_IMPORT_RESULT_LABEL, () => {
  beforeAll(async () => {
    sql = postgres(PG_URL, { max: 4, onnotice: () => {} });
    gs = await serve(Object.fromEntries(KEY_IMPORT_IDS.map((k) => [keySecretName(k), good[k]])));
    bad = await serve({
      [keySecretName("stg-autolabels-1")]: BAD.malformed,
      [keySecretName("stg-autoframe-1")]: BAD.wrong,
      [keySecretName("stg-gateway-1")]: `${good["stg-gateway-1"]}\n`,
    });
  }, 180_000);
  afterAll(async () => {
    for (const s of servers) await s.stop();
    await sql?.end();
    if (process.env.RTGIP_KI_REPORT)
      writeFileSync(process.env.RTGIP_KI_REPORT, JSON.stringify(evidence, null, 2));
  });

  it("installs without touching a single rtgip/2 delivery function, and grants only what the import needs", async () => {
    expect(await frozen()).toBe(FROZEN_BEFORE);
    const fns = [
      "rtgip.key_import_issue(text,text,text,interval)",
      "rtgip.key_import_claim(uuid,text)",
      "rtgip.key_import_finish(uuid,text,text,text)",
    ];
    const others = [
      "anon",
      "authenticated",
      "service_role",
      "rtgip_outbox_writer",
      "rtgip_dispatcher",
      "rtgip_inbox_receiver",
      "rtgip_operator",
    ];
    const rows =
      await sql`SELECT r AS role, f AS fn, has_function_privilege(r, f, 'EXECUTE') AS x FROM unnest(${sql.array([...others, "rtgip_key_importer"])}::text[]) r, unnest(${sql.array(fns)}::text[]) f`;
    for (const row of rows)
      expect([row.role, row.fn, row.x]).toEqual([
        row.role,
        row.fn,
        row.role === "rtgip_key_importer" && !String(row.fn).includes("issue"),
      ]);
    const tbl = await sql`SELECT r AS role,
                           has_table_privilege(r, 'rtgip.key_import_tickets', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') OR has_table_privilege(r, 'rtgip.key_import_install', 'SELECT,UPDATE') AS t,
                           has_table_privilege(r, 'vault.decrypted_secrets', 'SELECT') AS v, has_function_privilege(r, 'vault.create_secret(text,text,text,uuid)', 'EXECUTE') AS c
                          FROM unnest(${sql.array([...others, "rtgip_key_importer"])}::text[]) r`;
    // service_role reads Vault on Supabase by design (it holds the service key); the importer never does.
    for (const row of tbl)
      expect([row.role, row.t, row.v, row.c]).toEqual([
        row.role,
        false,
        row.role === "service_role",
        row.role === "service_role",
      ]);
    const role = (
      await sql`SELECT rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = 'rtgip_key_importer'`
    )[0]!;
    expect(role).toEqual({
      rolcanlogin: false,
      rolinherit: false,
      rolsuper: false,
      rolcreaterole: false,
      rolbypassrls: false,
    });
    for (const r of ["anon", "authenticated", "service_role", "rtgip_key_importer"]) {
      const err = await sql
        .begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${r}`);
          await tx`SELECT * FROM rtgip.key_import_issue('stg-autolabels-1', ${fp("stg-autolabels-1")}, 'X-ATTEMPT', '1 minute')`;
        })
        .then(() => "ran")
        .catch((e: Error) => e.message);
      expect([r, err]).toEqual([r, expect.stringMatching(/permission denied/)]);
    }
    evidence.install = {
      frozen_functions_md5: FROZEN_BEFORE,
      privileges:
        "only rtgip_key_importer may claim/finish; issue is owner-only; no API role reads tickets or Vault",
    };
  });

  it("issues tickets only for the four approved key ids, real fingerprints, short lifetimes, transport off and a free Vault name", async () => {
    expect(await issueError("stg-autolabels-2", fp("stg-autolabels-1"))).toMatch(
      /key_import_key_not_approved/,
    );
    expect(await issueError("prod-autolabels-1", fp("stg-autolabels-1"))).toMatch(
      /key_import_key_not_approved/,
    );
    expect(await issueError("stg-autolabels-1", "abc")).toMatch(/check constraint/);
    expect(await issueError("stg-autolabels-1", sha(""))).toMatch(/check constraint/);
    expect(await issueError("stg-autolabels-1", fp("stg-autolabels-1"), "16 minutes")).toMatch(
      /key_import_bad_ttl/,
    );
    await sql`INSERT INTO vault.secrets (name, secret) VALUES ('rtgip:stg-autocurb-1', ${"0".repeat(64)})`;
    expect(await issueError("stg-autocurb-1", fp("stg-autocurb-1"))).toMatch(
      /key_import_vault_name_taken/,
    );
    await sql`DELETE FROM vault.secrets WHERE name = 'rtgip:stg-autocurb-1'`;
    await liftTransportCheck(sql as never);
    await setTransport(sql as never, true);
    expect(await issueError("stg-autocurb-1", fp("stg-autocurb-1"))).toMatch(
      /key_import_transport_on/,
    );
    await setTransport(sql as never, false);
    const t = await issue("stg-autocurb-1", fp("stg-autocurb-1"));
    expect(await issueError("stg-autocurb-1", fp("stg-autocurb-1"))).toMatch(
      /key_import_one_open_per_key/,
    );
    const r = await call(gs, { ticket_id: t.ticket_id, token: "0".repeat(64) });
    expect([r.status, r.doc]).toEqual([409, { reason: "key_import_token_mismatch" }]);
    const stored = (
      await sql`SELECT token_sha256 FROM rtgip.key_import_tickets WHERE ticket_id = ${t.ticket_id}::uuid`
    )[0]!;
    expect(stored.token_sha256).toBe(sha(t.token));
    expect(JSON.stringify(await sql`SELECT * FROM rtgip.key_import_tickets`)).not.toContain(
      t.token,
    );
    const after = await call(gs, t);
    expect([after.status, after.doc]).toEqual([409, { reason: "key_import_ticket_used" }]);
    expect(await vaultCount()).toBe(0);
  });

  it("refuses unknown, expired, replayed and wrongly presented tickets, and burns each one", async () => {
    expect((await call(gs, { ticket_id: randomUUID(), token: hex32() })).doc).toEqual({
      reason: "key_import_ticket_unknown",
    });
    const e = await issue("stg-autocurb-1", fp("stg-autocurb-1"), "1 second");
    await new Promise((r) => setTimeout(r, 1300));
    expect((await call(gs, e)).doc).toEqual({ reason: "key_import_ticket_expired" });
    expect(await outcome(e.ticket_id)).toBe("key_import_ticket_expired");
    expect((await call(gs, e)).doc).toEqual({ reason: "key_import_ticket_used" });

    const w = await issue("stg-autocurb-1", fp("stg-autocurb-1"));
    const direct =
      await sql`SELECT * FROM rtgip.key_import_claim(${w.ticket_id}::uuid, ${w.token})`;
    expect(direct[0]).toEqual({ status: "key_import_wrong_role", key_id: null, fingerprint: null });
    expect((await call(gs, w)).doc).toEqual({ reason: "key_import_ticket_used" });

    const f = await issue("stg-autocurb-1", fp("stg-autocurb-1"));
    const fin = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE rtgip_key_importer");
      await tx.unsafe("SET LOCAL statement_timeout = '5s'");
      return tx`SELECT rtgip.key_import_finish(${f.ticket_id}::uuid, ${f.token}, ${good["stg-autocurb-1"]}, NULL) AS r`;
    });
    expect(fin[0]!.r).toBe("key_import_not_claimed");
    expect(await vaultCount()).toBe(0);
    expect(
      (
        await sql`SELECT finished_at FROM rtgip.key_import_tickets WHERE ticket_id = ${f.ticket_id}::uuid`
      )[0]!.finished_at,
    ).toBeNull();
    await sql`UPDATE rtgip.key_import_install SET server_addr = '192.0.2.10'`;
    expect((await call(gs, f)).doc).toEqual({ reason: "key_import_wrong_server" });
    await sql`UPDATE rtgip.key_import_install SET server_addr = inet_server_addr()`;
    const tamper =
      await sql`UPDATE rtgip.key_import_tickets SET outcome = 'imported' WHERE ticket_id = ${f.ticket_id}::uuid`
        .then(() => "updated")
        .catch((x: Error) => x.message);
    expect(tamper).toMatch(/only moves forward/);
    const del =
      await sql`DELETE FROM rtgip.key_import_tickets WHERE ticket_id = ${f.ticket_id}::uuid`
        .then(() => "deleted")
        .catch((x: Error) => x.message);
    expect(del).toMatch(/append-only/);
  });

  it("refuses to run while any server-log path could record a bind parameter or a plan", async () => {
    const cases: [string, string, string][] = [
      ["log_statement", "all", "log_statement"],
      ["log_statement", "mod", "log_statement"],
      ["log_min_duration_statement", "0", "log_min_duration_statement"],
      ["log_min_duration_sample", "0", "log_min_duration_sample"],
      ["log_transaction_sample_rate", "1", "log_transaction_sample_rate"],
      ["log_parameter_max_length_on_error", "-1", "log_parameter_max_length_on_error"],
      ["debug_print_plan", "on", "debug_print"],
      ["auto_explain.log_min_duration", "0", "auto_explain"],
      ["auto_explain.log_min_duration", "5000", "auto_explain"],
      ["pgaudit.log", "all", "pgaudit"],
    ];
    const seen: Record<string, string> = {};
    for (const [name, value, why] of cases) {
      await setDb(name, value);
      try {
        const t = await issue("stg-autocurb-1", fp("stg-autocurb-1"));
        const r = await call(gs, t);
        expect([name, value, r.status, r.doc]).toEqual([
          name,
          value,
          409,
          { reason: "key_import_unsafe_logging" },
        ]);
        const a = (
          await sql`SELECT detail FROM rtgip.audit_log WHERE actor = 'key_import' AND detail->>'ticket_id' = ${t.ticket_id} AND action = 'claim_refused'`
        )[0]!;
        expect((a.detail as Record<string, unknown>).unsafe_setting).toBe(why);
        seen[`${name}=${value}`] = why;
      } finally {
        await setDb(name, null);
      }
    }
    expect(await vaultCount()).toBe(0);
    evidence.unsafe_logging_refusals = seen;
  });

  it("never sends missing, malformed or non-matching material: the function refuses before the database sees it", async () => {
    const want: [Id, string][] = [
      ["stg-autolabels-1", "key_import_secret_malformed"],
      ["stg-autocurb-1", "key_import_secret_missing"],
      ["stg-autoframe-1", "key_import_fingerprint_mismatch"],
      ["stg-gateway-1", "key_import_secret_malformed"],
    ];
    for (const [k, reason] of want) {
      const t = await issue(k, fp(k));
      const r = await call(bad, t);
      expect([k, r.status, r.doc]).toEqual([k, 409, { key_id: k, outcome: "refused", reason }]);
      expect(await outcome(t.ticket_id)).toBe(reason);
    }
    expect(await vaultCount()).toBe(0);
  });

  it("rolls a failed Vault write back and records only the code", async () => {
    await setDb("test.vault_fail", "on");
    try {
      const t = await issue("stg-gateway-1", fp("stg-gateway-1"));
      const r = await call(gs, t);
      expect([r.status, r.doc]).toEqual([
        409,
        { key_id: "stg-gateway-1", outcome: "refused", reason: "key_import_vault_write_failed" },
      ]);
    } finally {
      await setDb("test.vault_fail", null);
    }
    expect(await vaultCount()).toBe(0);
  });

  it("imports each key once: concurrent replays of one ticket admit exactly one, and the Vault value matches its fingerprint", async () => {
    const t = await issue("stg-autolabels-1", fp("stg-autolabels-1"));
    const rs = await Promise.all([0, 1, 2, 3].map(() => call(gs, t)));
    expect(rs.filter((r) => r.status === 200).map((r) => r.doc)).toEqual([
      { key_id: "stg-autolabels-1", outcome: "imported", fingerprint_verified: true },
    ]);
    expect(rs.filter((r) => r.status === 409).map((r) => r.doc.reason)).toEqual([
      "key_import_ticket_used",
      "key_import_ticket_used",
      "key_import_ticket_used",
    ]);
    for (const k of ["stg-gateway-1", "stg-autocurb-1", "stg-autoframe-1"] as const) {
      const r = await call(gs, await issue(k, fp(k)));
      expect([r.status, r.doc]).toEqual([
        200,
        { key_id: k, outcome: "imported", fingerprint_verified: true },
      ]);
    }
    const v =
      await sql`SELECT name, encode(sha256(convert_to(decrypted_secret, 'UTF8')), 'hex') AS h FROM vault.decrypted_secrets WHERE name LIKE 'rtgip:%' ORDER BY name`;
    expect(v.map((r) => [r.name, r.h])).toEqual(
      [...KEY_IMPORT_IDS].sort().map((k) => [`rtgip:${k}`, fp(k)]),
    );
    const tk =
      await sql`SELECT key_id, count(*)::int AS n FROM rtgip.key_import_tickets WHERE outcome = 'imported' GROUP BY key_id ORDER BY key_id`;
    expect(tk.map((r) => [r.key_id, r.n])).toEqual([...KEY_IMPORT_IDS].sort().map((k) => [k, 1]));
    for (const k of KEY_IMPORT_IDS)
      expect(await issueError(k, fp(k))).toMatch(/key_import_vault_name_taken/);
    const rt =
      await sql`SELECT (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'rtgip:stg-autolabels-1' LIMIT 1) = ${good["stg-autolabels-1"]} AS same`;
    expect(rt[0]!.same).toBe(true);
    evidence.imported = KEY_IMPORT_IDS.map((k) => ({
      key_id: k,
      vault_name: `rtgip:${k}`,
      fingerprint: fp(k),
    }));
  });

  it("removal drops the functions and the role, keeps the nonsecret record and the Vault keys, and leaves delivery unchanged", async () => {
    const tickets = Number((await sql`SELECT count(*) AS n FROM rtgip.key_import_tickets`)[0]!.n);
    for (let i = 0; i < 2; i++)
      execFileSync(
        path.join(PGBIN, "psql"),
        [PG_URL, "-v", "ON_ERROR_STOP=1", "-qAtX", "-f", REMOVAL],
        { stdio: "pipe" },
      );
    const fns =
      await sql`SELECT proname FROM pg_proc WHERE pronamespace = 'rtgip'::regnamespace AND proname LIKE 'key_import%' ORDER BY proname`;
    expect(fns.map((r) => r.proname)).toEqual(["key_import_tickets_guard"]);
    expect(
      (await sql`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'rtgip_key_importer'`)[0]!
        .n,
    ).toBe(0);
    expect(Number((await sql`SELECT count(*) AS n FROM rtgip.key_import_tickets`)[0]!.n)).toBe(
      tickets,
    );
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM rtgip.audit_log WHERE actor = 'key_import' AND action = 'import_removed'`
      )[0]!.n,
    ).toBe(1);
    expect(await vaultCount()).toBe(4);
    expect(await frozen()).toBe(FROZEN_BEFORE);
    const r = await call(gs, { ticket_id: randomUUID(), token: hex32() });
    expect(r.status).toBe(409);
    expect(r.doc).toEqual({ reason: "internal_error" });
    evidence.removal = {
      functions_left: fns.map((x) => x.proname),
      role: "dropped",
      tickets_kept: tickets,
      vault_keys_kept: 4,
    };
  });

  it("leaves no key material in server logs, pg_stat_statements, pg_stat_activity, a database dump, function output, replies or audit rows", async () => {
    const secrets = [...Object.values(good), BAD.malformed, BAD.wrong];
    const dump = execFileSync(
      path.join(PGBIN, "pg_dump"),
      [PG_URL, "--exclude-table-data=vault.secrets"],
      { maxBuffer: 1 << 28 },
    ).toString();
    const stmts = (
      await sql`SELECT coalesce(string_agg(query, E'\n'), '') AS q FROM pg_stat_statements`
    )[0]!.q as string;
    const act = (
      await sql`SELECT coalesce(string_agg(query, E'\n'), '') AS q FROM pg_stat_activity`
    )[0]!.q as string;
    const audit = JSON.stringify(
      await sql`SELECT * FROM rtgip.audit_log WHERE actor = 'key_import'`,
    );
    const tickets = JSON.stringify(await sql`SELECT * FROM rtgip.key_import_tickets`);
    const sources: Record<string, string> = {
      server_log: readFileSync(PG_LOG, "utf8"),
      pg_stat_statements: stmts,
      pg_stat_activity: act,
      dump_without_vault_table: dump,
      function_output: servers.map((s) => s.log()).join("\n"),
      http_requests: sent.join("\n"),
      http_replies: replies.join("\n"),
      audit_rows: audit,
      ticket_rows: tickets,
    };
    const hits = Object.entries(sources).flatMap(([name, text]) =>
      secrets.filter((s) => text.includes(s)).map(() => name),
    );
    expect(hits).toEqual([]);
    expect(stmts).toContain("key_import_finish");
    expect(sources.server_log.length).toBeGreaterThan(0);

    // Controls: the same scan does find a value when a logging path is open, so a clean result means something.
    const controls = { log_statement: hex32(), auto_explain: hex32() };
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL log_statement = 'all'");
      await tx.unsafe("SELECT length($1::text) AS n", [controls.log_statement]);
    });
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL auto_explain.log_min_duration = 0");
      await tx.unsafe("SELECT length($1::text) AS n", [controls.auto_explain]);
    });
    await new Promise((r) => setTimeout(r, 300));
    const log2 = readFileSync(PG_LOG, "utf8");
    expect([log2.includes(controls.log_statement), log2.includes(controls.auto_explain)]).toEqual([
      true,
      true,
    ]);
    expect(secrets.filter((s) => log2.includes(s))).toEqual([]);
    evidence.exposure_scan = {
      sources: Object.keys(sources),
      secrets_scanned: secrets.length,
      hits: 0,
      controls_detected: ["log_statement=all bind parameter", "auto_explain plan parameters"],
      server_log_bytes: log2.length,
    };
  });
});
