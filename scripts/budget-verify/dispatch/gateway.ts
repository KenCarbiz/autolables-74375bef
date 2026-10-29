// Local stand-in for what provider-budget-alerts talks to:
//   /rest/v1/*                  a local PostgREST over the throwaway database;
//   /auth/v1/user               two synthetic sessions (platform admin, dealer user);
//   /functions/v1/send-email    recorded, answered 200 (or 500 while failing);
//   /functions/v1/send-sms      recorded, answered 200 (or 500 while failing).
// Nothing is delivered anywhere; the function runs with network access limited
// to 127.0.0.1.

const pgrst = Deno.env.get("PGRST_URL") ?? "";
const port = Number(Deno.env.get("GATEWAY_PORT") ?? "54431");
const USERS: Record<string, string> = {
  "session-platform-admin": "b1000000-0000-4000-8000-000000000001",
  "session-dealer-user": "b1000000-0000-4000-8000-000000000002",
};
let failing = new Set<string>();
const sent: Array<{ channel: string; to: unknown; subject?: string; body?: string; html?: string }> = [];

Deno.serve({ hostname: "127.0.0.1", port, onListen: () => {} }, async (req) => {
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
  if (url.pathname === "/auth/v1/user") {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const id = USERS[token];
    return id
      ? Response.json({ id, aud: "authenticated", role: "authenticated", email: `${id}@example.test` })
      : Response.json({ msg: "invalid token" }, { status: 401 });
  }
  if (url.pathname === "/functions/v1/send-email" || url.pathname === "/functions/v1/send-sms") {
    const channel = url.pathname.endsWith("email") ? "email" : "sms";
    const b = await req.json() as { to: unknown; subject?: string; body?: string; html?: string };
    sent.push({ channel, to: b.to, subject: b.subject, body: b.body, html: b.html });
    return failing.has(channel)
      ? Response.json({ error: "injected failure" }, { status: 500 })
      : Response.json({ success: true });
  }
  if (url.pathname === "/__sent") return Response.json(sent.splice(0));
  if (url.pathname === "/__fail") {
    failing = new Set((url.searchParams.get("ch") ?? "").split(",").filter(Boolean));
    return new Response("ok");
  }
  return new Response("not found", { status: 404 });
});
