import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SnapshotProduct } from "./addendumMapping";

// Loads the latest addendum packet for a vehicle (keyed by VIN, as the signing
// flow stores it). Exposes the frozen products_snapshot the customer signs
// against, plus signing status, so the addendum sticker can be built from — and
// validated against — the exact packet. Read-only; never mutates signing data.
export interface LatestAddendum {
  id: string;
  products: SnapshotProduct[];
  status: string | null;
  signedAt: string | null;
  contentHash: string | null;
  customerName: string | null;
  totalPrice: number | null;
  createdAt: string;
}

export function useLatestAddendum(vin?: string | null) {
  const [addendum, setAddendum] = useState<LatestAddendum | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vin) { setAddendum(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // deno-lint-ignore no-explicit-any
        const { data } = await (supabase as any)
          .from("addendums")
          .select("id, products_snapshot, status, signed_at, content_hash, customer_name, total_price, created_at")
          .eq("vehicle_vin", vin)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        setLoading(false);
        if (!data) { setAddendum(null); return; }
        setAddendum({
          id: data.id,
          products: Array.isArray(data.products_snapshot) ? data.products_snapshot : [],
          status: data.status ?? null,
          signedAt: data.signed_at ?? null,
          contentHash: data.content_hash ?? null,
          customerName: data.customer_name ?? null,
          totalPrice: data.total_price ?? null,
          createdAt: data.created_at,
        });
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [vin]);

  return { addendum, loading };
}
