// Local stand-in for a Supabase project, for tests only. Never points at a
// real project. /functions/v1/<name> runs the REAL edge function
// source; /rest/v1 answers the subset of PostgREST that function uses, against
// a scratch Postgres loaded with the repo's migrations. PostgREST itself could
// not be installed in this sandbox, so this translator is the one test double
// in the chain; the SQL functions and the function code are the real ones.
import postgres from "npm:postgres@3.4.9";

const DB_URL = Deno.env.get("PUBLIC_VIEW_DB_URL") ?? "";
const PORT = Number(Deno.env.get("PUBLIC_VIEW_PORT") ?? "54331");
if (!DB_URL) throw new Error("PUBLIC_VIEW_DB_URL required");
const sql = postgres(DB_URL, { max: 4, onnotice: () => {} });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "content-range",
};
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};

type Filter = { text: string; params: unknown[] };
function parseFilter(col: string, raw: string, pi: () => number): Filter {
  let neg = false;
  let v = raw;
  if (v.startsWith("not.")) { neg = true; v = v.slice(4); }
  const dot = v.indexOf(".");
  const op = v.slice(0, dot), val = v.slice(dot + 1);
  const c = `b.${ident(col)}`;
  const map: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE" };
  let text: string; const params: unknown[] = [];
  if (map[op]) { text = `${c}::text ${map[op]} $${pi()}`; params.push(op.endsWith("like") ? val.replace(/\*/g, "%") : val); }
  else if (op === "is") text = `${c} IS ${val === "null" ? "NULL" : val === "true" ? "TRUE" : "FALSE"}`;
  else if (op === "in") { const items = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")); text = `${c}::text = ANY($${pi()})`; params.push(items); }
  else if (op === "cs") { text = `${c} @> $${pi()}::jsonb`; params.push(val); }
  else throw new Error(`unsupported op ${op}`);
  return { text: neg ? `NOT (${text})` : text, params };
}


// Every REST call runs the way PostgREST runs a service-role request: inside a
// transaction, as the service_role role, with the JWT role claim set.
const q = (text: string, params: unknown[] = []) =>
  sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE service_role`);
    await tx.unsafe(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    return await tx.unsafe(text, params as never[]);
  });

// select=a,b,alias:other_table(x,y) -- an embed follows the foreign key from the
// base table to other_table, as PostgREST does for a to-one relationship.
function splitTop(v: string): string[] {
  const out: string[] = []; let depth = 0; let cur = "";
  for (const ch of v) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
async function selectList(base: string, v: string): Promise<string> {
  if (v === "*") return "b.*";
  const parts: string[] = [];
  for (const item of splitTop(v)) {
    const m = /^(?:([a-z_]+):)?([a-z_]+)\((.*)\)$/i.exec(item);
    if (!m) { parts.push(item === "*" ? "b.*" : `b.${ident(item)}`); continue; }
    const [, alias, emb, inner] = m;
    const fk = await sql`select a.attname as fk, af.attname as ref
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and c.conrelid = ${"public." + base}::regclass and c.confrelid = ${"public." + emb}::regclass limit 1`;
    if (!fk.length) throw new Error(`no relationship ${base} -> ${emb}`);
    const innerCols = inner.split(",").map((c) => c.trim() === "*" ? "*" : ident(c.trim())).join(",");
    parts.push(`(SELECT to_jsonb(e) FROM (SELECT ${innerCols} FROM public.${ident(emb)} x WHERE x.${ident(fk[0].ref)} = b.${ident(fk[0].fk)} LIMIT 1) e) AS ${ident(alias || emb)}`);
  }
  return parts.join(",");
}

async function rest(req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  const accept = req.headers.get("accept") ?? "";
  const single = accept.includes("vnd.pgrst.object");
  const err = (status: number, message: string, code = "PGRST000") =>
    new Response(JSON.stringify({ message, code, details: null, hint: null }), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    if (path.startsWith("rpc/")) {
      const fn = path.slice(4);
      const args = req.method === "GET" ? Object.fromEntries(url.searchParams) : await req.json().catch(() => ({}));
      const keys = Object.keys(args);
      const call = `${ident("public")}.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")})`;
      const rows = await q(`SELECT to_jsonb(r) AS j FROM ${call} r`, keys.map((k) => args[k]));
      const data = rows.map((r) => r.j);
      const isSetOf = data.length !== 1 || (data[0] && typeof data[0] === "object" && "id" in (data[0] as object));
      const only = data[0] && typeof data[0] === "object" ? Object.keys(data[0] as object) : [];
      const body = isSetOf ? data : (only.length === 1 && only[0] === fn ? (data[0] as Record<string, unknown>)[fn] : data[0]);
      return new Response(JSON.stringify(body ?? null), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const table = ident(path);
    if (req.method === "POST") {
      const payload = await req.json();
      const rows = Array.isArray(payload) ? payload : [payload];
      const out = [];
      for (const r of rows) {
        const cols = Object.keys(r);
        const res = await q(
          `INSERT INTO public.${table} (${cols.map(ident).join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING to_jsonb(${table}.*) AS j`,
          cols.map((c) => (r[c] !== null && typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c])) as never[],
        );
        out.push(res[0].j);
      }
      return new Response(JSON.stringify(single ? out[0] : out), { status: 201, headers: { ...cors, "Content-Type": "application/json" } });
    }
    let n = 0; const pi = () => ++n;
    const where: string[] = []; const params: unknown[] = [];
    let cols = "*"; let order = ""; let limit = "";
    const patch = req.method === "PATCH" ? await req.json() as Record<string, unknown> : null;
    const setCols = patch ? Object.keys(patch) : [];
    const setSql = setCols.map((c) => `${ident(c)} = $${pi()}`).join(", ");
    if (patch) params.push(...setCols.map((c) => (patch[c] !== null && typeof patch[c] === "object" ? JSON.stringify(patch[c]) : patch[c])));
    for (const [k, v] of url.searchParams) {
      if (k === "select") { cols = await selectList(path, v); continue; }
      if (k === "order") { order = " ORDER BY " + v.split(",").map((o) => { const [c, dir, nulls] = o.split("."); return `${ident(c)} ${dir === "desc" ? "DESC" : "ASC"}${nulls ? ` ${nulls === "nullsfirst" ? "NULLS FIRST" : "NULLS LAST"}` : ""}`; }).join(","); continue; }
      if (k === "limit") { limit = ` LIMIT ${Number(v)}`; continue; }
      if (k === "offset") continue;
      const f = parseFilter(k, v, pi); where.push(f.text); params.push(...f.params);
    }
    const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    if (patch) {
      const rows = await q(`UPDATE public.${table} b SET ${setSql}${w} RETURNING to_jsonb(b.*) AS j`, params);
      return new Response(JSON.stringify(rows.map((r) => r.j)), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (req.method === "HEAD" || (req.headers.get("prefer") ?? "").includes("count=exact") && req.method === "HEAD") {
      const [{ c }] = await q(`SELECT count(*)::int AS c FROM public.${table} b${w}`, params);
      return new Response(null, { status: 200, headers: { ...cors, "content-range": `*/${c}` } });
    }
    const rows = await q(`SELECT to_jsonb(t) AS j FROM (SELECT ${cols} FROM public.${table} b${w}${order}${limit}) t`, params);
    const data = rows.map((r) => r.j);
    if (single) {
      if (data.length !== 1) return err(406, `JSON object requested, multiple (or no) rows returned`, "PGRST116");
      return new Response(JSON.stringify(data[0]), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { ...cors, "Content-Type": "application/json", "content-range": `0-${Math.max(data.length - 1, 0)}/*` } });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(/does not exist/.test(m) ? 404 : 400, m, /does not exist/.test(m) ? "42P01" : "PGRST100");
  }
}

const FUNCTIONS = ["public-listing-view", "autocurb-sync", "dms-webhook", "autofilm-feed"];
const handlers = new Map<string, (r: Request) => Promise<Response>>();
for (const name of FUNCTIONS) {
  await import(`../../functions/${name}/index.ts`).catch((e) => console.log(`skip ${name}: ${e.message}`));
  const g = globalThis as unknown as { __edgeHandler?: (r: Request) => Promise<Response> };
  if (g.__edgeHandler) handlers.set(name, g.__edgeHandler);
  g.__edgeHandler = undefined;
}

Deno.serve({ port: PORT, hostname: "127.0.0.1", onListen: () => console.log(`gateway listening on ${PORT}`) }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (url.pathname.startsWith("/rest/v1/")) return rest(req, url.pathname.slice("/rest/v1/".length));
  const fn = /^\/functions\/v1\/([a-z-]+)/.exec(url.pathname)?.[1];
  const fnHandler = fn ? handlers.get(fn) : undefined;
  if (fnHandler) {
    const res = await fnHandler(req);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  }
  return new Response(JSON.stringify({ message: "not served by local gateway" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
});
