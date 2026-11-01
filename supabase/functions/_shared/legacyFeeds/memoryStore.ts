import type {
  BindingRecord, ClaimOutcome, LegacyFeed, LegacyFeedStore, SignedKeyRecord, StoredResponse,
} from "./types.ts";

export interface MemoryState {
  keys: Record<string, { record: SignedKeyRecord; secret: string | null }>;
  bindings: Array<{ connectionId: string; feed: LegacyFeed; provider: string | null; binding: BindingRecord }>;
  autocurbTenants: Record<string, string>;
  legacySecrets: Record<string, string>;
  rejected: Array<{ tenantId: string; feed: LegacyFeed; provider: string | null }>;
  receipts: Map<string, { hash: string; status: "processing" | "done"; response?: StoredResponse }>;
  writes: number;
}

export function memoryStore(initial: Partial<MemoryState> = {}): LegacyFeedStore & { state: MemoryState } {
  const state: MemoryState = {
    keys: {}, bindings: [], autocurbTenants: {}, legacySecrets: {}, rejected: [],
    receipts: new Map(), writes: 0, ...initial,
  };
  const legacyName = (feed: LegacyFeed, provider: string | null) => `${feed}:${provider ?? ""}`;
  return {
    state,
    async loadKey(keyId) { return state.keys[keyId]?.record ?? null; },
    async keySecret(keyId) { return state.keys[keyId]?.secret ?? null; },
    async bindingFor(connectionId, feed, provider) {
      return state.bindings.find((b) => b.connectionId === connectionId && b.feed === feed && b.provider === provider)?.binding ?? null;
    },
    async tenantForAutocurbId(id) { return state.autocurbTenants[id] ?? null; },
    async legacySecret(feed, provider) { return state.legacySecrets[legacyName(feed, provider)] ?? null; },
    async legacyAllowed(tenantId, feed, provider) {
      return !state.rejected.some((r) => r.tenantId === tenantId && r.feed === feed && r.provider === provider);
    },
    async claimRequest(connectionId, _feed, key, bodySha256): Promise<ClaimOutcome> {
      const id = `${connectionId}:${key}`;
      const existing = state.receipts.get(id);
      if (!existing) {
        state.receipts.set(id, { hash: bodySha256, status: "processing" });
        return { outcome: "new" };
      }
      if (existing.hash !== bodySha256) return { outcome: "conflict" };
      if (existing.status === "done" && existing.response) return { outcome: "replay", response: existing.response };
      return { outcome: "in_progress" };
    },
    async completeRequest(connectionId, key, response) {
      const r = state.receipts.get(`${connectionId}:${key}`);
      if (r) { r.status = "done"; r.response = response; }
    },
  };
}
