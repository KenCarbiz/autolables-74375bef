// rtgip/3 Ed25519 primitives (freeze rtgip/3-contract-freeze/1). Web Crypto only: no imports, no I/O, no environment
// access, so this exact file runs under Node, workerd and Deno and is copied byte for byte into the app runtimes.
// Verifier wrapper order (contract "Signature and keys"): 128 lowercase hex, canonical S < L, R a canonical point, the
// public key a canonical point and not of small order, then Web Crypto. Strict cofactorless RFC 8032, fails closed.

export type Verdict = { ok: true } | { ok: false; reason: string };
export const OK: Verdict = { ok: true };
export const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export const SIG3 = /^[0-9a-f]{128}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
export const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";
export const SELFTEST_PREFIX = "rtgip/3-selftest";
const PRIVATE_B64 = /^[A-Za-z0-9+/]{64}$/;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const P = (1n << 255n) - 19n;

const te = new TextEncoder();
export const utf8 = (s: string): Uint8Array => te.encode(s);
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9a-f]*$/.test(h)) throw new Error("bad_hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}
export function b64urlEncode(s: string): string {
  let bin = "";
  for (const b of utf8(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** Strict base64url (no padding, URL alphabet only) to fatal UTF-8 text; throws on anything else. */
export function b64urlDecode(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad_b64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const mod = (a: bigint, m = P): bigint => ((a % m) + m) % m;
function powmod(b: bigint, e: bigint, m = P): bigint {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
const inv = (a: bigint): bigint => powmod(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const SQRT_M1 = powmod(2n, (P - 1n) / 4n);
type Pt = readonly [bigint, bigint];
const le = (b: Uint8Array): bigint => b.reduceRight((acc, x) => (acc << 8n) | BigInt(x), 0n);

function decodePoint(b: Uint8Array): Pt | null {
  if (b.length !== 32) return null;
  const v = le(b);
  const sign = (v >> 255n) & 1n;
  const y = v & ((1n << 255n) - 1n);
  if (y >= P) return null;
  const y2 = mod(y * y);
  const x2 = mod(mod(y2 - 1n) * inv(mod(D * y2 + 1n)));
  let x = powmod(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = mod(x * SQRT_M1);
  if (mod(x * x - x2) !== 0n) return null;
  if (x === 0n && sign === 1n) return null;
  if ((x & 1n) !== sign) x = mod(-x);
  return [x, y];
}
function addPt(a: Pt, b: Pt): Pt {
  const k = mod(D * a[0] * b[0] * a[1] * b[1]);
  return [mod((a[0] * b[1] + a[1] * b[0]) * inv(1n + k)), mod((a[1] * b[1] + a[0] * b[0]) * inv(mod(1n - k)))];
}
export const isCanonicalPoint = (b: Uint8Array): boolean => decodePoint(b) !== null;
/** True for the eight small-order points and for any encoding that is not a canonical curve point. */
export function isUnusablePublicKey(pk: Uint8Array): boolean {
  const pt = decodePoint(pk);
  if (!pt) return true;
  let q: Pt = pt;
  for (let i = 0; i < 3; i++) q = addPt(q, q);
  return q[0] === 0n && q[1] === 1n;
}
/** The signature is 128 lowercase hex and its S half, little endian, is below the group order L. */
export const signatureWellFormed = (sigHex: string): boolean => SIG3.test(sigHex) && le(fromHex(sigHex).slice(32)) < L;

const asBytes = (m: string | Uint8Array): Uint8Array => (typeof m === "string" ? utf8(m) : m);

export async function verifyEd25519(pkHex: string, message: string | Uint8Array, sigHex: string): Promise<Verdict> {
  if (!signatureWellFormed(sigHex)) return fail("signature_malformed");
  const sig = fromHex(sigHex);
  if (decodePoint(sig.slice(0, 32)) === null) return fail("bad_signature");
  if (!HEX64.test(pkHex)) return fail("bad_signature");
  const pk = fromHex(pkHex);
  if (isUnusablePublicKey(pk)) return fail("bad_signature");
  try {
    const key = await crypto.subtle.importKey("raw", pk as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, sig as BufferSource, asBytes(message) as BufferSource);
    return ok ? OK : fail("bad_signature");
  } catch {
    return fail("bad_signature");
  }
}

/** A loaded private key. It only signs; the key material is non-extractable and never leaves Web Crypto. */
export interface SigningKey3 {
  readonly key_id: string;
  readonly owner: string;
  readonly public_key: string;
  sign(message: string): Promise<string>;
}

export const selfTestProbe = (keyId: string): string => `${SELFTEST_PREFIX}\n${keyId}`;

/**
 * Load-time self-test (keyset load_time_self_test): import the PKCS#8 key (base64, 64 characters) non-extractable,
 * sign the fixed probe and verify it with the pinned public key. Any mismatch or malformed input returns null, and the
 * caller then refuses to sign (no_signing_key). The secret itself is never returned or logged.
 */
export async function importSigningKey(
  keyId: string,
  owner: string,
  pkcs8Base64: string | undefined,
  pinnedPublicKey: string,
): Promise<SigningKey3 | null> {
  if (pkcs8Base64 === undefined || !PRIVATE_B64.test(pkcs8Base64) || !HEX64.test(pinnedPublicKey)) return null;
  try {
    const der = Uint8Array.from(atob(pkcs8Base64), (c) => c.charCodeAt(0));
    if (der.length !== 48 || toHex(der.slice(0, 16)) !== PKCS8_ED25519_PREFIX) return null;
    const key = await crypto.subtle.importKey("pkcs8", der as BufferSource, { name: "Ed25519" }, false, ["sign"]);
    const sign = async (message: string): Promise<string> =>
      toHex(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, utf8(message) as BufferSource)));
    const probe = selfTestProbe(keyId);
    if (!(await verifyEd25519(pinnedPublicKey, probe, await sign(probe))).ok) return null;
    return Object.freeze({ key_id: keyId, owner, public_key: pinnedPublicKey, sign });
  } catch {
    return null;
  }
}
