import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// useDealToken — persisted, expiring deal-signing tokens.
// Replaces the legacy localStorage deal_qr_token scheme.
// Backed by public.deal_signing_tokens (migration 20260418).
// ──────────────────────────────────────────────────────────────

export interface DealTokenPayload {
  vin: string;
  stock_number?: string;
  year?: string | number;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: number;
  condition?: string;
  attached_documents?: Array<{
    type: string;
    data?: Record<string, unknown>;
  }>;
  buyer?: { name?: string; phone?: string; email?: string };
  cobuyer?: { name?: string; phone?: string };
  dealer_snapshot?: Record<string, unknown>;
}

export interface DealTokenRow {
  id: string;
  tenant_id: string | null;
  token: string;
  vehicle_file_id: string;
  vehicle_payload: DealTokenPayload;
  status: "pending" | "signed" | "expired" | "revoked";
  expires_at: string;
  signed_at: string | null;
  created_at: string;
}

const randomToken = () => {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40);
};

export const useDealToken = () => {
  const createToken = useCallback(
    async (vehicleFileId: string, payload: DealTokenPayload): Promise<string | null> => {
      const token = randomToken();
      const { error } = await (supabase as any).from("deal_signing_tokens").insert({
        token,
        vehicle_file_id: vehicleFileId,
        vehicle_payload: payload,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("createToken error", error);
        return null;
      }
      return token;
    },
    []
  );

  const getToken = useCallback(async (token: string): Promise<DealTokenRow | null> => {
    const { data, error } = await (supabase as any).rpc("get_deal_token", { _token: token });
    if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
    return Array.isArray(data) ? (data[0] as DealTokenRow) : (data as DealTokenRow);
  }, []);

  const signToken = useCallback(
    async (args: {
      token: string;
      signedPayload: Record<string, unknown>;
      contentHash: string;
      customerIp: string | null;
      userAgent: string;
      esignConsent: Record<string, unknown>;
    }): Promise<boolean> => {
      const { data, error } = await (supabase as any).rpc("sign_deal_token", {
        _token: args.token,
        _signed_payload: args.signedPayload,
        _content_hash: args.contentHash,
        _customer_ip: args.customerIp,
        _user_agent: args.userAgent,
        _esign_consent: args.esignConsent,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("signToken error", error);
        return false;
      }
      return Boolean(data);
    },
    []
  );

  const revokeToken = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await (supabase as any)
      .from("deal_signing_tokens")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", id);
    return !error;
  }, []);

  return { createToken, getToken, signToken, revokeToken };
};
