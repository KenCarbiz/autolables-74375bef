// Local stand-in for the hosted project's front door during the escalation
// run: /rest/v1 is forwarded to a local PostgREST over the isolated database,
// and /functions/v1/send-email is a fake sender that records each request and
// answers 200, or 500 for an address on the refuse list. Nothing leaves the
// machine.

const pgrst = Deno.env.get("PGRST_URL") ?? "";
const serviceKey = Deno.env.get("SERVICE_KEY") ?? "";
let refuse = (Deno.env.get("REFUSE_PREFIXES") ?? "").split(",").filter(Boolean);
const sent: Array<{ to: string; subject: string; authorized: boolean; status: number; html: string }> = [];

Deno.serve({ port: Number(Deno.env.get("GATEWAY_PORT") ?? "54401"), onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/rest/v1/")) {
    const headers = new Headers(req.headers);
    headers.delete("host");
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const res = await fetch(pgrst + url.pathname.slice("/rest/v1".length) + url.search, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
    });
    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(await res.arrayBuffer(), { status: res.status, headers: out });
  }
  if (url.pathname === "/functions/v1/send-email" && req.method === "POST") {
    const body = await req.json() as { to?: string[]; subject?: string; html?: string };
    const to = body.to?.[0] ?? "";
    const status = refuse.some((p) => to.startsWith(p)) ? 500 : 200;
    sent.push({ to, subject: body.subject ?? "", html: body.html ?? "", authorized: req.headers.get("authorization") === `Bearer ${serviceKey}`, status });
    return Response.json(status === 200 ? { id: `fake-${sent.length}` } : { error: "refused by the fake sender" }, { status });
  }
  if (url.pathname === "/__sent") return Response.json(sent);
  if (url.pathname === "/__accept_all") { refuse = []; return new Response("ok"); }
  return new Response("not found", { status: 404 });
});
