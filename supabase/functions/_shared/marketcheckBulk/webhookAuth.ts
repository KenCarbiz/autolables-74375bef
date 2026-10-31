// Authentication for FUTURE MarketCheck delivery notifications. Deliberately
// independent of the Files.com receiver (no shared code or assumptions). The
// real header names, secret and signing scheme must come from MarketCheck's
// contract documentation; until all are configured this fails closed.
// Replay protection is the caller's job: dedupe on the returned digest.

export type BulkWebhookInput = {
  rawBody: Uint8Array;
  headers: Headers | Record<string, string | undefined>;
  secret: string | null;
  signatureHeader: string | null; // header NAME carrying the signature
  timestampHeader: string | null; // header NAME carrying the unix timestamp
  toleranceSeconds?: number;
  now?: Date | number;
};

export type BulkWebhookResult = { ok: boolean; reason: string; digest?: string };

function headerValue(h: BulkWebhookInput["headers"], name: string): string | null {
  if (typeof (h as Headers).get === "function") return (h as Headers).get(name);
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(h as Record<string, string | undefined>)) if (k.toLowerCase() === want) return v ?? null;
  return null;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export async function verifyBulkWebhook(i: BulkWebhookInput): Promise<BulkWebhookResult> {
  if (!i.secret || !i.signatureHeader || !i.timestampHeader) return { ok: false, reason: "not_configured" };
  const sigRaw = headerValue(i.headers, i.signatureHeader);
  if (!sigRaw) return { ok: false, reason: "missing_signature" };
  const tsRaw = headerValue(i.headers, i.timestampHeader);
  if (!tsRaw) return { ok: false, reason: "missing_timestamp" };
  if (!/^\d{1,13}$/.test(tsRaw.trim())) return { ok: false, reason: "invalid_timestamp" };
  let ts = Number(tsRaw.trim());
  if (ts > 1e11) ts = Math.floor(ts / 1000); // tolerate millisecond timestamps
  const nowSec = Math.floor((i.now instanceof Date ? i.now.getTime() : i.now ?? Date.now()) / 1000);
  if (Math.abs(nowSec - ts) > (i.toleranceSeconds ?? 300)) return { ok: false, reason: "stale_timestamp" };

  const prefix = new TextEncoder().encode(`${tsRaw.trim()}.`);
  const msg = new Uint8Array(prefix.length + i.rawBody.length);
  msg.set(prefix, 0);
  msg.set(i.rawBody, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(i.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = hex(await crypto.subtle.sign("HMAC", key, msg));
  const provided = sigRaw.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!constantTimeEqual(digest, provided)) return { ok: false, reason: "bad_signature" };
  return { ok: true, reason: "ok", digest };
}
