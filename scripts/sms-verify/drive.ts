// Imports supabase/functions/_shared/signalhouse.ts (the module every SMS
// function uses) with the real Signal House SDK it pins, points it at the
// local capture server, and checks what the SDK sends and how our wrapper
// reads the answers. Synthetic credentials and numbers; no provider call.
import { sendSignalHouseSms, SignalHouseError, toSignalHouseNumber } from "../../supabase/functions/_shared/signalhouse.ts";

const CAPTURE = Deno.env.get("CAPTURE_URL") ?? "http://127.0.0.1:54451";
const results: boolean[] = [];
const check = (label: string, expected: unknown, actual: unknown) => {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
};
const seen = async () => (await (await fetch(`${CAPTURE}/__seen`)).json()) as Array<Record<string, unknown>>;
const attempt = async (to: string, body: string) => {
  try { return { ok: true, value: await sendSignalHouseSms(to, body) }; }
  catch (e) { return { ok: false, code: e instanceof SignalHouseError ? e.code : "thrown", status: (e as SignalHouseError).status, message: String((e as Error).message).slice(0, 80) }; }
};

await seen(); // start from an empty capture queue

check("number normalisation (no SDK involved)", ["12025550100", "12025550100", null], [toSignalHouseNumber("(202) 555-0100"), toSignalHouseNumber("+1 202 555 0100"), toSignalHouseNumber("555")]);

const sent = await attempt("(202) 555-0100", "Synthetic compatibility check");
const req = (await seen())[0] ?? {};
check("send: our wrapper reads a 2xx envelope as one enqueued message", { ok: true, value: { provider: "signalhouse", messageId: "synthetic-msg-1", enqueuedCount: 1, blockedNumbers: [] } }, sent);
check("send: one POST to /message/sms", ["POST", "/message/sms"], [req.method, req.path]);
check("send: bearer token from SIGNALHOUSE_API_KEY, JSON body", ["Bearer synt…", true], [req.authorization, String(req.contentType).startsWith("application/json")]);
check("send: body fields the API expects", {
  senderPhoneNumber: "12025550199", recipientPhoneNumber: ["12025550100"], messageBody: "Synthetic compatibility check",
  statusCallbackUrl: "http://127.0.0.1:54451/status", enableShortlink: false,
}, req.body);
check("send: no idempotency key is sent by our wrapper", null, req.idempotencyKey);

check("blocked: a 2xx that enqueued nobody is reported as blocked", { ok: false, code: "blocked", status: 422 }, (({ ok, code, status }) => ({ ok, code, status }))(await attempt("2025550100", "Synthetic [dnc]") as { ok: boolean; code: string; status: number }));
await seen();
check("rejected: a 4xx is reported as send_failed with the provider's status", { ok: false, code: "send_failed", status: 400 }, (({ ok, code, status }) => ({ ok, code, status }))(await attempt("2025550100", "Synthetic [reject]") as { ok: boolean; code: string; status: number }));
await seen();

if (Deno.env.get("CHECK_TIMEOUT") === "1") {
  const t0 = Date.now();
  const hung = await attempt("2025550100", "Synthetic [hang]") as { ok: boolean; code: string; status: number; message: string };
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`      hung request settled after ${secs}s: ${JSON.stringify(hung)}`);
  await seen();
  check("timeout: a hung provider request settles as send_failed within 35 s", { ok: false, code: "send_failed", within: true }, { ok: hung.ok, code: hung.code, within: secs <= 35 });
}

console.log(`\n${results.length} checks, ${results.filter((r) => !r).length} failed`);
Deno.exit(results.every(Boolean) ? 0 : 1);
