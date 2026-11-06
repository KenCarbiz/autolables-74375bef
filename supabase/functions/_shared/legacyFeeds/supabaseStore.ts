import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { ExistingListing, HeldVehicle } from "./archivedGuard.ts";
import type { BindingRecord, ClaimOutcome, LegacyFeed, LegacyFeedStore, SignedKeyRecord, StoredResponse } from "./types.ts";

type Db = SupabaseClient;

interface KeyRow {
  key_id: string;
  status: SignedKeyRecord["status"];
  not_after: string | null;
  connection: SignedKeyRecord["connection"] | SignedKeyRecord["connection"][] | null;
}

const LEGACY_ENV: Record<LegacyFeed, (provider: string | null) => string> = {
  autofilm_feed: () => "AUTOLABELS_LOOKUP_SECRET",
  autocurb_sync: () => "AUTOCURB_SYNC_SECRET",
  dms_webhook: (p) => `DMS_SECRET_${(p ?? "").toUpperCase()}`,
};

export function supabaseLegacyFeedStore(db: Db): LegacyFeedStore & {
  holdArchived(tenantId: string, vin: string, listing: ExistingListing, feed: LegacyFeed, ref: string): Promise<HeldVehicle>;
} {
  return {
    async loadKey(keyId) {
      const { data } = await db
        .from("integration_connection_keys")
        .select("key_id,status,not_after,connection:integration_connections(id,tenant_id,status)")
        .eq("key_id", keyId)
        .maybeSingle();
      const row = data as unknown as KeyRow | null;
      const connection = Array.isArray(row?.connection) ? row?.connection[0] : row?.connection;
      if (!row || !connection) return null;
      return { key_id: row.key_id, status: row.status, not_after: row.not_after, connection };
    },
    async keySecret(keyId) {
      const { data } = await db.rpc("integration_key_secret", { p_key_id: keyId });
      return typeof data === "string" && data ? data : null;
    },
    async bindingFor(connectionId, feed, provider) {
      let q = db.from("legacy_feed_bindings").select("id,legacy_unsigned")
        .eq("connection_id", connectionId).eq("feed", feed);
      q = provider ? q.eq("provider", provider) : q.is("provider", null);
      const { data } = await q.maybeSingle();
      return (data as BindingRecord | null) ?? null;
    },
    async tenantForAutocurbId(autocurbTenantId) {
      const { data } = await db.from("tenants").select("id").eq("autocurb_tenant_id", autocurbTenantId).maybeSingle();
      return (data as { id?: string } | null)?.id ?? null;
    },
    legacySecret(feed, provider) {
      return Promise.resolve(Deno.env.get(LEGACY_ENV[feed](provider)) ?? null);
    },
    async legacyAllowed(tenantId, feed, provider) {
      // Fails open: before the migration is applied the RPC does not exist and legacy callers must keep working.
      try {
        const { data, error } = await db.rpc("legacy_feed_legacy_allowed", {
          p_tenant: tenantId, p_feed: feed, p_provider: provider,
        });
        if (error) return true;
        return data !== false;
      } catch {
        return true;
      }
    },
    async claimRequest(connectionId, feed, key, bodySha256) {
      const { data, error } = await db.rpc("legacy_feed_claim_request", {
        p_connection: connectionId, p_feed: feed, p_key: key, p_body_sha256: bodySha256,
      });
      if (error || !data) throw new Error("idempotency_claim_failed");
      return data as ClaimOutcome;
    },
    async completeRequest(connectionId, key, response: StoredResponse) {
      await db.rpc("legacy_feed_complete_request", { p_connection: connectionId, p_key: key, p_response: response });
    },
    async holdArchived(tenantId, vin, listing, feed, ref) {
      let reviewId: string | null = null;
      try {
        const { data, error } = await db.rpc("legacy_feed_hold_archived", {
          p_tenant: tenantId, p_vin: vin, p_listing_id: listing.id, p_feed: feed, p_ref: ref,
        });
        if (!error && typeof data === "string") reviewId = data;
      } catch { /* the hold is still reported in the response when the RPC is not deployed */ }
      return { vin, reason: "archived_listing_requires_review", review_id: reviewId };
    },
  };
}
