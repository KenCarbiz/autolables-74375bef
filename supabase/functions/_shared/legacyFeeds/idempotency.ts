import type { LegacyAuth, SignedAuth } from "./auth.ts";
import { DEPRECATION_HEADER } from "./auth.ts";
import type { LegacyFeed, LegacyFeedStore, StoredResponse } from "./types.ts";

export interface FeedOutcome {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export async function runFeedWrite(
  store: LegacyFeedStore,
  auth: SignedAuth | LegacyAuth,
  feed: LegacyFeed,
  run: () => Promise<StoredResponse>,
): Promise<FeedOutcome> {
  if (auth.mode === "legacy") {
    const out = await run();
    return { ...out, headers: { ...DEPRECATION_HEADER } };
  }

  const key = auth.idempotencyKey ?? "";
  const replay = (body: unknown): FeedOutcome => ({ status: 200, body, headers: { "Idempotent-Replay": "true" } });

  const transport = await store.claimRequest(auth.connectionId, feed, auth.transportKey, auth.bodySha256);
  if (transport.outcome === "replay") return replay(transport.response.body);
  if (transport.outcome !== "new") return { status: 409, body: { error: "request_in_progress" }, headers: {} };

  const claim = await store.claimRequest(auth.connectionId, feed, key, auth.bodySha256);
  if (claim.outcome === "replay") {
    await store.completeRequest(auth.connectionId, auth.transportKey, claim.response);
    return replay(claim.response.body);
  }
  if (claim.outcome === "conflict") {
    const out = { status: 409, body: { error: "idempotency_key_reused" } };
    await store.completeRequest(auth.connectionId, auth.transportKey, out);
    return { ...out, headers: {} };
  }
  if (claim.outcome === "in_progress") {
    return { status: 409, body: { error: "request_in_progress" }, headers: {} };
  }

  const out = await run();
  if (out.status < 500) {
    await store.completeRequest(auth.connectionId, key, out);
    await store.completeRequest(auth.connectionId, auth.transportKey, out);
  }
  return { ...out, headers: {} };
}
