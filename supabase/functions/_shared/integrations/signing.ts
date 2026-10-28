const encoder = new TextEncoder();

export const SIGNING_DOMAIN = "rooftopos.v1";
export const MAX_SKEW_SECONDS = 300;

const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export const signingMessage = (ts: string | number, keyId: string, bodySha256Hex: string): string =>
  `${SIGNING_DOMAIN}\n${ts}\n${keyId}\n${bodySha256Hex}`;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function sign(secret: string, ts: string | number, keyId: string, rawBody: string): Promise<string> {
  return `v1=${await hmacHex(secret, signingMessage(ts, keyId, await sha256Hex(rawBody)))}`;
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function verify(
  secret: string,
  ts: string | number,
  keyId: string,
  rawBody: string,
  presentedSignature: string,
): Promise<boolean> {
  if (!secret || !presentedSignature) return false;
  const expected = await sign(secret, ts, keyId, rawBody);
  return timingSafeEqualHex(expected, presentedSignature.trim());
}

export const withinSkew = (tsSeconds: number, nowSeconds: number, maxSkewSeconds = MAX_SKEW_SECONDS): boolean =>
  Number.isFinite(tsSeconds) && Math.abs(nowSeconds - tsSeconds) <= maxSkewSeconds;
