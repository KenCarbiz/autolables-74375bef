// rtgip/3 public key records, pins and key resolution (contract "Signature and keys", keyset rtgip/3-keyset/1).
// Pure: the caller supplies the database rows, the RTGIP3_KEY_PINS value and the clock. Copied byte for byte into the
// app runtimes; its only import outside rtgip3/ is the frozen rtgip/2 canonical JSON.
import { canonicalize } from "../rtgip2/core";
import { fail, fromHex, HEX64, importSigningKey, sha256Hex, type SigningKey3 } from "./sig";

export const PROTOCOL3_KEYS = "rtgip/3" as const;
export const KEY_ENVS = ["stg", "prd"] as const;
export const KEY_ID3 = /^(stg|prd)-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$/;
export type Owner3 = "gateway" | "autolabels" | "autocurb" | "autoframe";

export interface PublicKeyRecord {
  alg: string;
  connection_ids: string[];
  fingerprint: string;
  key_id: string;
  not_after: number;
  not_before: number;
  owner: string;
  protocol: string;
  public_key: string;
  revoked_at: number | null;
  revoked_reason: string | null;
  status: string;
}

export interface KeyContext3 {
  keys: readonly PublicKeyRecord[];
  /** key_id -> recordPin(record), from RTGIP3_KEY_PINS. Revocation for compromise removes the pin. */
  pins: Readonly<Record<string, string>>;
  now: number;
  /** The only key-id environment this node accepts: stg or prd (kat in tests). */
  env: string;
}

export type KeyResolution = { ok: true; key: PublicKeyRecord } | { ok: false; reason: string };

/** pin = sha256(canonical(record without status, revoked_at, revoked_reason, connection_ids)). */
export function recordPin(k: PublicKeyRecord): Promise<string> {
  const { status: _s, revoked_at: _r, revoked_reason: _q, connection_ids: _c, ...fixed } = k;
  return sha256Hex(canonicalize(fixed));
}

/** RTGIP3_KEY_PINS = "key_id:pin,key_id:pin". Any malformed or repeated entry voids the whole value (fail closed). */
export function parsePins(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (value === undefined || value.trim() === "") return out;
  for (const entry of value.split(",")) {
    const m = /^\s*([a-z0-9-]{1,64}):([0-9a-f]{64})\s*$/.exec(entry);
    if (!m || Object.hasOwn(out, m[1]!)) throw new Error("pins_malformed");
    out[m[1]!] = m[2]!;
  }
  return out;
}

/** The owner a key id names, or null when it is not a key id of `env`. */
export function ownerOfKeyId(keyId: string, env: string): Owner3 | null {
  if (!/^[a-z]{2,8}$/.test(env)) return null;
  const m = new RegExp(`^${env}-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$`).exec(keyId);
  return m ? (m[1] as Owner3) : null;
}

/**
 * Check order 2.5 step 3: the key exists for this environment, is pinned and its row still matches the pin, the stored
 * fingerprint is sha256(public_key), protocol rtgip/3, alg ed25519, not revoked, valid now (and at `at`, the receipt
 * issued_at or origin timestamp, when given), and the row owner equals both the owner in the key id and `owner`.
 */
export async function resolveKey3(ctx: KeyContext3, keyId: string, owner: string, at?: number): Promise<KeyResolution> {
  const idOwner = ownerOfKeyId(keyId, ctx.env);
  const key = ctx.keys.find((k) => k.key_id === keyId);
  if (!key || idOwner === null) return fail("unknown_key");
  const pinned = Object.hasOwn(ctx.pins, keyId) ? ctx.pins[keyId] : undefined;
  if (pinned === undefined || pinned !== (await recordPin(key))) return fail("key_not_pinned");
  if (!HEX64.test(key.public_key) || (await sha256Hex(fromHex(key.public_key))) !== key.fingerprint) return fail("key_not_pinned");
  if (key.protocol !== PROTOCOL3_KEYS) return fail("key_dialect_mismatch");
  if (key.alg !== "ed25519") return fail("alg_mismatch");
  if (key.status === "revoked" || key.revoked_at !== null) return fail("key_revoked");
  if (ctx.now < key.not_before || ctx.now > key.not_after) return fail("key_outside_validity");
  if (at !== undefined && (at < key.not_before || at > key.not_after)) return fail("key_outside_validity");
  if (key.owner !== idOwner || key.owner !== owner) return fail("signer_key_mismatch");
  return { ok: true, key };
}

/**
 * The one key this node signs with: exactly one current, resolvable key of `owner` (a second current key is a
 * registry error and is refused rather than chosen by row order). Null means no_signing_key.
 */
export async function currentSigningRecord(ctx: KeyContext3, owner: Owner3): Promise<PublicKeyRecord | null> {
  const current = ctx.keys.filter((k) => k.owner === owner && k.status === "current" && ownerOfKeyId(k.key_id, ctx.env) === owner);
  if (current.length !== 1) return null;
  const r = await resolveKey3(ctx, current[0]!.key_id, owner);
  return r.ok ? r.key : null;
}

/**
 * Resolve this node's signing record, then import its private key with the load-time self-test against the pinned
 * public key. `secretOf` returns the PKCS#8 base64 for a key id; how it is named is the runtime's business.
 */
export async function loadSigningKey3(
  ctx: KeyContext3,
  owner: Owner3,
  secretOf: (keyId: string) => string | undefined,
): Promise<SigningKey3 | null> {
  const record = await currentSigningRecord(ctx, owner);
  if (!record) return null;
  return importSigningKey(record.key_id, owner, secretOf(record.key_id), record.public_key);
}
