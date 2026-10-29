// Local stand-in for everything the inventory sync talks to during the
// isolated run: /rest/v1 goes to a local PostgREST over the throwaway
// database, /functions/v1/* records each downstream function the sync would
// invoke and answers 200 without doing anything, and /mc/v2/* serves a
// recorded synthetic MarketCheck response chosen by the driver. Nothing leaves
// the machine; the function itself runs with network access limited to
// 127.0.0.1.

const pgrst = Deno.env.get("PGRST_URL") ?? "";
const fixtureDir = Deno.env.get("FIXTURE_DIR") ?? "";
let scenario = "clean";
const provider: Array<{ path: string; params: Record<string, string>; status: number }> = [];
const functions: Array<{ fn: string; body: unknown }> = [];

Deno.serve({ hostname: "127.0.0.1", port: Number(Deno.env.get("GATEWAY_PORT") ?? "54411"), onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/rest/v1/")) {
    const headers = new Headers(req.headers);
    headers.delete("host");
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const res = await fetch(pgrst + url.pathname.slice("/rest/v1".length) + url.search, {
      method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined,
    });
    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    const empty = res.status === 204 || res.status === 304;
    return new Response(empty ? null : await res.arrayBuffer(), { status: res.status, headers: out });
  }
  if (url.pathname.startsWith("/functions/v1/")) {
    const body = req.method === "POST" ? await req.json().catch(() => null) : null;
    functions.push({ fn: url.pathname.slice("/functions/v1/".length), body });
    return Response.json({ ok: true, stub: true });
  }
  if (url.pathname.startsWith("/mc/v2/")) {
    const path = url.pathname.slice("/mc/v2".length);
    const params = Object.fromEntries([...url.searchParams].filter(([k]) => k !== "api_key"));
    let status = 200;
    let body: unknown = { num_found: 0, listings: [] };
    if (scenario === "refused") status = 429;
    else if (path === "/dealerships/inventory") body = JSON.parse(await Deno.readTextFile(`${fixtureDir}/feed-${scenario}.json`));
    else if (path === "/dealerships/car") body = { num_found: 0, dealerships: [] };
    provider.push({ path, params, status });
    return status === 200 ? Response.json(body) : Response.json({ code: 429, message: "synthetic refusal" }, { status });
  }
  if (url.pathname === "/__scenario") { scenario = url.searchParams.get("name") ?? "clean"; return new Response(scenario); }
  if (url.pathname === "/__provider") return Response.json(provider.splice(0));
  if (url.pathname === "/__functions") return Response.json(functions.splice(0));
  return new Response("not found", { status: 404 });
});
