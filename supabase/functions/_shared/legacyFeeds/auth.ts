import { hmacHex, sha256Hex, timingSafeEqualHex, verify, withinSkew } from "../integrations/signing.ts";
import type { HeaderReader, LegacyFeed, LegacyFeedStore } from "./types.ts";

export type ClaimedTenant =
  | { kind: "tenant_id"; value: string }
  | { kind: "autocurb_tenant_id"; value: string }
  | null;

export interface AuthInput {
  feed: LegacyFeed;
  provider?: string | null;
  method: string;
  pathAndQuery: string;
  rawBody: string;
  headers: HeaderReader;
  nowSeconds: number;
  claimedTenant: ClaimedTenant;
}

export interface SignedAuth {
  ok: true;
  mode: "signed";
  tenantId: string;
  connectionId: string;
  idempotencyKey: string | null;
  bodySha256: string;
  transportKey: string;
}

export interface LegacyAuth {
  ok: true;
  mode: "legacy";
  tenantId: string | null;
}

export interface AuthFailure {
  ok: false;
  status: 400 | 401 | 403 | 500 | 503;
  error: string;
}

export type AuthResult = SignedAuth | LegacyAuth | AuthFailure;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status: AuthFailure["status"], error: string): AuthFailure => ({ ok: false, status, error });

export const MAX_IDEMPOTENCY_KEY = 200;

export function canonicalGetTarget(pathname: string, search: string, functionName: string): string {
  const marker = `/${functionName}`;
  const at = pathname.indexOf(marker);
  const rest = at >= 0 ? pathname.slice(at + marker.length) : pathname;
  const path = rest.startsWith("/") ? rest : `/${rest}`;
  const pairs = Array.from(new URLSearchParams(search).entries())
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
  const query = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return query ? `${path}?${query}` : path;
}

const signedMessageBody = (input: AuthInput): string =>
  input.method === "GET" ? `GET ${input.pathAndQuery}` : input.rawBody;

export const hasSignedHeaders = (h: HeaderReader): boolean =>
  h.get("x-rooftop-key-id") !== null || h.get("x-rooftop-timestamp") !== null || h.get("x-rooftop-signature") !== null;

async function authenticateSigned(input: AuthInput, store: LegacyFeedStore): Promise<AuthResult> {
  const keyId = input.headers.get("x-rooftop-key-id") ?? "";
  const ts = input.headers.get("x-rooftop-timestamp") ?? "";
  const signature = input.headers.get("x-rooftop-signature") ?? "";
  if (!keyId || !ts || !signature) return fail(401, "unauthorized");

  const record = await store.loadKey(keyId);
  if (!record || record.key_id !== keyId) return fail(401, "unauthorized");
  if (record.status === "revoked") return fail(401, "unauthorized");
  if (record.not_after && Date.parse(record.not_after) <= input.nowSeconds * 1000) return fail(401, "unauthorized");
  if (record.connection.status !== "active") return fail(403, "connection_inactive");

  if (!/^\d{1,12}$/.test(ts) || !withinSkew(Number(ts), input.nowSeconds)) return fail(401, "stale_request");

  const secret = await store.keySecret(keyId);
  if (!secret) return fail(401, "unauthorized");
  if (!(await verify(secret, ts, keyId, signedMessageBody(input), signature))) return fail(401, "unauthorized");

  const provider = input.provider ?? null;
  const connection = record.connection;
  const binding = await store.bindingFor(connection.id, input.feed, provider);
  if (!binding) return fail(403, "feed_not_bound");

  const claim = input.claimedTenant;
  if (claim) {
    const claimed = claim.kind === "autocurb_tenant_id"
      ? await store.tenantForAutocurbId(claim.value)
      : claim.value.toLowerCase();
    if (claimed !== connection.tenant_id.toLowerCase()) return fail(403, "tenant_mismatch");
  }

  let idempotencyKey: string | null = null;
  if (input.method !== "GET") {
    idempotencyKey = input.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) return fail(400, "idempotency_key_required");
  }

  return {
    ok: true,
    mode: "signed",
    tenantId: connection.tenant_id,
    connectionId: connection.id,
    idempotencyKey,
    bodySha256: await sha256Hex(input.rawBody),
    // A byte-identical capture replayed inside the skew window carries the same
    // signature even if the attacker swaps Idempotency-Key, which is unsigned.
    transportKey: `sig:${await sha256Hex(signature)}`,
  };
}

const LEGACY_MISSING: Record<LegacyFeed, (provider: string | null) => AuthFailure> = {
  autofilm_feed: () => fail(503, "feed not enabled"),
  autocurb_sync: () => fail(500, "AUTOCURB_SYNC_SECRET not configured"),
  dms_webhook: (p) => fail(500, `DMS_SECRET_${(p ?? "").toUpperCase()} not configured`),
};

const LEGACY_BAD: Record<LegacyFeed, string> = {
  autofilm_feed: "unauthorized",
  autocurb_sync: "invalid signature",
  dms_webhook: "invalid signature",
};

async function legacyCredentialMatches(input: AuthInput, secret: string): Promise<boolean> {
  if (input.feed === "autofilm_feed") {
    const presented = input.headers.get("x-lookup-secret") ?? input.headers.get("x-autofilm-key") ?? "";
    return timingSafeEqualHex(presented, secret);
  }
  const header = input.feed === "autocurb_sync" ? "x-autocurb-signature" : "x-dms-signature";
  const expected = "sha256=" + (await hmacHex(secret, input.rawBody));
  return timingSafeEqualHex(input.headers.get(header) ?? "", expected);
}

async function authenticateLegacy(input: AuthInput, store: LegacyFeedStore): Promise<AuthResult> {
  const provider = input.provider ?? null;
  const secret = await store.legacySecret(input.feed, provider);
  if (!secret) return LEGACY_MISSING[input.feed](provider);
  if (!(await legacyCredentialMatches(input, secret))) return fail(401, LEGACY_BAD[input.feed]);

  let tenantId: string | null = null;
  const claim = input.claimedTenant;
  if (claim) {
    tenantId = claim.kind === "autocurb_tenant_id" ? await store.tenantForAutocurbId(claim.value) : claim.value;
  }
  if (tenantId && UUID_RE.test(tenantId) && !(await store.legacyAllowed(tenantId, input.feed, provider))) {
    return fail(401, "legacy_auth_retired");
  }
  return { ok: true, mode: "legacy", tenantId };
}

export function authenticateLegacyFeed(input: AuthInput, store: LegacyFeedStore): Promise<AuthResult> {
  return hasSignedHeaders(input.headers) ? authenticateSigned(input, store) : authenticateLegacy(input, store);
}

export const DEPRECATION_HEADER = { "X-AutoLabels-Auth-Deprecated": "legacy-shared-secret" } as const;

