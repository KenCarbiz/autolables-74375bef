// Stand-in for the Signal House API during the SDK compatibility check. It
// records every request the real SDK sends and answers with a canned envelope
// chosen by the message body, so nothing reaches the provider and no message
// is sent. Bound to 127.0.0.1; the checked code runs with network access
// limited to 127.0.0.1.
const port = Number(Deno.env.get("CAPTURE_PORT") ?? "54451");
const seen: Array<Record<string, unknown>> = [];

Deno.serve({ hostname: "127.0.0.1", port, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/__seen") return Response.json(seen.splice(0));
  const raw = await req.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw); } catch { /* recorded as text below */ }
  seen.push({
    method: req.method,
    path: url.pathname,
    authorization: (req.headers.get("authorization") ?? "").replace(/^(Bearer )(.{4}).*$/, "$1$2…"),
    contentType: req.headers.get("content-type"),
    idempotencyKey: req.headers.get("idempotency-key"),
    body: Object.keys(body).length ? body : raw.slice(0, 200),
  });
  const text = String(body.messageBody ?? "");
  if (text.includes("[hang]")) { await new Promise((r) => setTimeout(r, 40_000)); }
  if (text.includes("[dnc]")) {
    return Response.json({ enqueuedCount: 0, insertedMessages: [], dncBlockedNumbers: ["12025550100"] });
  }
  if (text.includes("[reject]")) return Response.json({ message: "senderPhoneNumber is not on an active campaign" }, { status: 400 });
  return Response.json({ enqueuedCount: 1, insertedMessages: [{ messageId: "synthetic-msg-1" }], dncBlockedNumbers: [] });
});
