// LOCAL VALIDATION ONLY. A stand-in for the Supabase HTTP surface run_staging.ts
// talks to, so the runner can be exercised end to end against a local Postgres:
//   /functions/v1/integration-{ingest,apply,dispatch,health}  the real handlers and
//       the real isServiceOrCron gate, over pg-backed stores (../deno/pgStores.ts)
//   /auth/v1/token?grant_type=password  checks the bcrypt hash in auth.users
//   /rest/v1/<table>, /rest/v1/        PostgREST-like reads/inserts executed as the
//       anon or authenticated role with request.jwt.claims set, so RLS and grants
//       are the database's own.
// Tokens are opaque "local-user.<uuid>" strings, not JWTs. Started by
// local_validate.sh with an import map that stubs the esm.sh supabase-js import.
// Env: SHIM_PORT, SHIM_DB_URL, SHIM_ANON_KEY, CRON_SHARED_SECRET,
//      ROOFTOP_INTEGRATIONS_ENABLED, SHIM_DISPATCH_HOST (https host rewritten to this shim).

import { handleApply } from "../../functions/_shared/integrations/handlers/apply.ts";
import { handleDispatch } from "../../functions/_shared/integrations/handlers/dispatch.ts";
import { handleHealth } from "../../functions/_shared/integrations/handlers/health.ts";
import { handleIngest } from "../../functions/_shared/integrations/handlers/ingest.ts";
import { isServiceOrCron } from "../../functions/_shared/supabase.ts";
import { connect, pgApplyStore, pgDispatchStore, pgHealthStore, pgIngestStore } from "../deno/pgStores.ts";

const PORT = Number(Deno.env.get("SHIM_PORT") ?? "54340");
const DB_URL = Deno.env.get("SHIM_DB_URL") ?? "";
const ANON = Deno.env.get("SHIM_ANON_KEY") ?? "";
const DISPATCH_HOST = Deno.env.get("SHIM_DISPATCH_HOST") ?? "staging-shim.local";
const enabled = () => Deno.env.get("ROOFTOP_INTEGRATIONS_ENABLED") === "true";

const svc = connect(DB_URL, "service_role");
const admin = connect(DB_URL, null);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const userFrom = (req: Request): string | null => {
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return t.startsWith("local-user.") ? t.slice("local-user.".length) : null;
};

const localFetch: typeof fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
    .replace(`https://${DISPATCH_HOST}`, `http://127.0.0.1:${PORT}`);
  if (!url.startsWith(`http://127.0.0.1:${PORT}/`)) return Promise.reject(new Error(`shim refuses to dispatch off-box: ${url}`));
  return fetch(url, init);
};

const health = pgHealthStore(svc);
const healthStore = {
  ...health,
  authenticate: (jwt: string) => Promise.resolve(jwt.startsWith("local-user.") ? { userId: jwt.slice("local-user.".length) } : null),
};

async function asRole(req: Request, run: (tx: ReturnType<typeof connect>) => Promise<unknown>) {
  if (req.headers.get("apikey") !== ANON) return json(401, { message: "Invalid API key" });
  const sub = userFrom(req);
  const role = sub ? "authenticated" : "anon";
  const claims = JSON.stringify(sub ? { sub, role } : { role });
  try {
    const out = await admin.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      return await run(tx as unknown as ReturnType<typeof connect>);
    });
    return out instanceof Response ? out : json(200, out);
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    const status = code === "42501" ? (role === "anon" ? 401 : 403) : code === "42P01" ? 404 : 400;
    return json(status, { code, message: (e as Error).message });
  }
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

async function restHandler(req: Request, path: string, url: URL) {
  const table = path.slice("/rest/v1/".length);
  if (!table) {
    return await asRole(req, async (tx) => {
      const rows = await tx`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v','m') and has_table_privilege(c.oid, 'SELECT')`;
      return { swagger: "2.0", paths: Object.fromEntries([["/", {}], ...rows.map((r) => [`/${r.relname}`, {}])]) };
    });
  }
  if (!IDENT.test(table)) return json(404, { message: "not found" });
  if (req.method === "POST") {
    const body = await req.json() as Record<string, unknown>;
    const cols = Object.keys(body).filter((c) => IDENT.test(c));
    return await asRole(req, async (tx) => {
      await tx.unsafe(`insert into public.${table} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
        cols.map((c) => body[c] as string));
      return new Response(null, { status: 201 });
    });
  }
  const select = url.searchParams.get("select") ?? "*";
  const cols = select === "*" ? "*" : select.split(",").filter((c) => IDENT.test(c)).join(",");
  const filters: string[] = [];
  const params: string[] = [];
  for (const [k, v] of url.searchParams) {
    if (k === "select" || !IDENT.test(k) || !v.startsWith("eq.")) continue;
    params.push(v.slice(3));
    filters.push(`${k}::text = $${params.length}`);
  }
  return await asRole(req, (tx) =>
    tx.unsafe(`select ${cols} from public.${table}${filters.length ? ` where ${filters.join(" and ")}` : ""}`, params)
  );
}

Deno.serve({ port: PORT, hostname: "127.0.0.1", onListen: () => console.log(`shim listening on ${PORT}`) }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/functions/v1/integration-ingest") return handleIngest(req, { enabled, store: () => pgIngestStore(svc) });
  if (path === "/functions/v1/integration-apply") return handleApply(req, { enabled, authorize: isServiceOrCron, store: () => pgApplyStore(svc) });
  if (path === "/functions/v1/integration-dispatch") {
    return handleDispatch(req, { enabled, authorize: isServiceOrCron, store: () => pgDispatchStore(svc), fetcher: localFetch });
  }
  if (path === "/functions/v1/integration-health") return handleHealth(req, { enabled, store: () => healthStore });
  if (path === "/auth/v1/token") {
    if (req.headers.get("apikey") !== ANON) return json(401, { message: "Invalid API key" });
    const { email, password } = await req.json() as { email: string; password: string };
    const rows = await admin`select id from auth.users where email = ${email}
      and encrypted_password = extensions.crypt(${password}, encrypted_password)`;
    return rows.length ? json(200, { access_token: `local-user.${rows[0].id}`, token_type: "bearer" }) : json(400, { error: "invalid_grant" });
  }
  if (path.startsWith("/rest/v1/")) return await restHandler(req, path, url);
  return json(404, { message: "not found" });
});
