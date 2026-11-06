export type LegacyFeed = "autofilm_feed" | "autocurb_sync" | "dms_webhook";

export interface HeaderReader {
  get(name: string): string | null;
}

export interface SignedKeyRecord {
  key_id: string;
  status: "active" | "retiring" | "revoked";
  not_after: string | null;
  connection: {
    id: string;
    tenant_id: string;
    status: "pending" | "active" | "paused" | "revoked" | "error";
  };
}

export interface BindingRecord {
  id: string;
  legacy_unsigned: "allowed" | "rejected";
}

export type ClaimOutcome =
  | { outcome: "new" }
  | { outcome: "replay"; response: StoredResponse }
  | { outcome: "in_progress" }
  | { outcome: "conflict" };

export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface LegacyFeedStore {
  loadKey(keyId: string): Promise<SignedKeyRecord | null>;
  keySecret(keyId: string): Promise<string | null>;
  bindingFor(connectionId: string, feed: LegacyFeed, provider: string | null): Promise<BindingRecord | null>;
  tenantForAutocurbId(autocurbTenantId: string): Promise<string | null>;
  legacySecret(feed: LegacyFeed, provider: string | null): Promise<string | null>;
  legacyAllowed(tenantId: string, feed: LegacyFeed, provider: string | null): Promise<boolean>;
  claimRequest(connectionId: string, feed: LegacyFeed, key: string, bodySha256: string): Promise<ClaimOutcome>;
  completeRequest(connectionId: string, key: string, response: StoredResponse): Promise<void>;
}
