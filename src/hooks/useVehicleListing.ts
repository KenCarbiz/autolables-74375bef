import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// useVehicleListing — the public shopper-facing addendum record.
// A dealer publishes a `vehicle_listings` row and the shopper
// views it at /v/<slug>. Matches migration 20260417_platform_expansion.
// ──────────────────────────────────────────────────────────────

export interface ListingProductSnapshot {
  id: string;
  name: string;
  subtitle?: string | null;
  warranty?: string | null;
  badge_type: string;
  price: number;
  price_label?: string | null;
  disclosure?: string | null;
}

export interface ListingTotals {
  base_price?: number;
  accessories_total?: number;
  doc_fee?: number;
  final_price?: number;
}

export interface StickerSnapshot {
  products_snapshot?: ListingProductSnapshot[];
  totals?: ListingTotals;
  tracking_code?: string;
  created_at?: string;
}

export interface DealerSnapshot {
  name?: string;
  phone?: string;
  tagline?: string;
  logo_url?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  primary_color?: string;
}

export interface ValueProp {
  title: string;
  description: string;
  price: string;
}

export interface ListingPhoto {
  url: string;
  alt?: string | null;
  width?: number;
  height?: number;
  kind?: "hero" | "exterior" | "interior" | "detail" | string;
}

export interface ListingFeature {
  icon?: string;            // lucide icon name or token ("shield", "sparkles", "gauge", ...)
  title: string;
  subtitle?: string | null;
}

export interface ListingKeySpecs {
  drivetrain?: string | null;
  transmission?: string | null;
  mpg_city?: number | null;
  mpg_hwy?: number | null;
  mpg_combined?: number | null;
  engine?: string | null;
  fuel?: string | null;
  exterior_color?: string | null;
  interior_color?: string | null;
  body_style?: string | null;
  doors?: number | string | null;
}

export interface ListingCertification {
  program_name?: string;
  coverage_miles?: number;
  coverage_months?: number;
  inspection_points?: number;
  url?: string;
}

export interface ListingPaymentEstimate {
  default_apr?: number;
  default_down?: number;
  default_term_months?: number;
}

export interface ListingRecallCheck {
  checked_at?: string;
  has_open?: boolean;
  do_not_drive?: boolean;
  campaigns?: Array<{
    campaignNumber?: string;
    summary?: string;
    consequence?: string;
    remedy?: string;
    component?: string;
  }>;
}

export interface VehicleListing {
  id: string;
  store_id: string;
  tenant_id: string | null;
  vin: string;
  slug: string;
  ymm: string | null;
  trim: string | null;
  mileage: number | null;
  condition: "new" | "used" | "cpo" | null;
  price: number | null;
  vehicle_state?: string | null;
  default_locale?: "en" | "es" | null;

  // Legacy (migration 20260417_platform_expansion)
  sticker_snapshot: StickerSnapshot;
  dealer_snapshot: DealerSnapshot;
  value_props: ValueProp[];
  documents: { name: string; url: string; type: string }[];
  videos: { id: string; url: string; caption?: string }[];

  // Phase 2 scan-experience fields (migration 20260616204000)
  service_records?: { date?: string; mileage?: string; type?: string; notes?: string }[] | null;
  warranty_info?: {
    factory_months?: number; factory_miles?: number;
    powertrain_months?: number; powertrain_miles?: number;
    in_service_date?: string; notes?: string;
  } | null;
  available_accessories?: { name?: string; price?: string; note?: string }[] | null;

  // Premium shopper-page fields (migration 20260418070000_vdp_scrape...)
  photos: ListingPhoto[];
  description: string | null;
  features: ListingFeature[];
  key_specs: ListingKeySpecs;
  certification: ListingCertification | null;
  factory_sticker_url: string | null;
  scrape_source_url: string | null;
  scrape_last_synced_at: string | null;
  payment_estimate: ListingPaymentEstimate | null;
  recall_check: ListingRecallCheck | null;

  // MarketCheck enrichment (already returned by get_vehicle_listing_by_slug's
  // SELECT *; surfaced here so the shopper page can render insights + options).
  mc_attributes?: Record<string, unknown> | null;
  hero_image_url?: string | null;
  recall_status?: string | null;
  open_recall_count?: number | null;
  market_value?: number | null;
  market_position?: string | null;
  market_payload?: { listingPrice?: number | null; low?: number | null; high?: number | null; belowMarket?: number } | null;

  // Packet curation — per-vehicle module visibility for the public page.
  packet_modules?: Record<string, boolean> | null;

  prep_status: { all_accessories_installed?: boolean; foreman_signed_at?: string } | null;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  view_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Short URL-safe slug — e.g. "koons-lx-9k2a". Collision-resistant but short.
const makeSlug = (seed: string) => {
  const clean = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${clean}-${rand}`;
};

export const useVehicleListing = (storeId: string) => {
  const [listings, setListings] = useState<VehicleListing[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("vehicle_listings")
      .select("*")
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false });
    setListings((data as VehicleListing[]) || []);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const createListing = useCallback(
    async (input: {
      vin: string;
      ymm?: string;
      trim?: string;
      mileage?: number;
      condition?: "new" | "used" | "cpo";
      price?: number;
      sticker_snapshot?: StickerSnapshot;
      dealer_snapshot?: DealerSnapshot;
      value_props?: ValueProp[];
      documents?: { name: string; url: string; type: string }[];
      videos?: { id: string; url: string; caption?: string }[];
      slugSeed?: string;
      createdBy?: string | null;
    }): Promise<VehicleListing | null> => {
      const slug = makeSlug(input.slugSeed || `${input.vin.slice(-6)}-${input.ymm || "veh"}`);
      const { data, error } = await (supabase as any)
        .from("vehicle_listings")
        .insert({
          store_id: storeId,
          vin: input.vin,
          slug,
          ymm: input.ymm || null,
          trim: input.trim || null,
          mileage: input.mileage ?? null,
          condition: input.condition || null,
          price: input.price ?? null,
          sticker_snapshot: input.sticker_snapshot || {},
          dealer_snapshot: input.dealer_snapshot || {},
          value_props: input.value_props || [],
          documents: input.documents || [],
          videos: input.videos || [],
          status: "draft",
          created_by: input.createdBy || null,
        })
        .select()
        .single();
      if (error) {
        // eslint-disable-next-line no-console
        console.error("createListing error", error);
        return null;
      }
      await load();
      return data as VehicleListing;
    },
    [storeId, load]
  );

  const publishListing = useCallback(
    async (
      id: string,
      opts?: {
        recallCheck?: {
          checked_at: string;
          has_open: boolean;
          do_not_drive: boolean;
          campaigns?: unknown[];
        } | null;
      }
    ): Promise<{ ok: boolean; reason?: string }> => {
      const patch: Record<string, unknown> = {
        status: "published",
        published_at: new Date().toISOString(),
      };
      if (opts?.recallCheck) patch.recall_check = opts.recallCheck;
      const { error } = await (supabase as any)
        .from("vehicle_listings")
        .update(patch)
        .eq("id", id);
      if (!error) {
        await load();
        return { ok: true };
      }
      const msg = String(error.message || "");
      if (msg.includes("prep_gate_blocked")) {
        return {
          ok: false,
          reason:
            "This vehicle has no signed prep sign-off with listing unlocked. Complete /prep first.",
        };
      }
      if (msg.includes("recall_gate_blocked")) {
        return {
          ok: false,
          reason:
            "Blocked: NHTSA recall check is missing, stale, or flags this vehicle as do-not-drive. Refresh and resolve before publishing.",
        };
      }
      return { ok: false, reason: msg || "Publish failed" };
    },
    [load]
  );

  const archiveListing = useCallback(
    async (id: string) => {
      const { error } = await (supabase as any)
        .from("vehicle_listings")
        .update({ status: "archived" })
        .eq("id", id);
      if (!error) await load();
      return !error;
    },
    [load]
  );

  const updateListing = useCallback(
    async (id: string, patch: Partial<VehicleListing>) => {
      const { error } = await (supabase as any).from("vehicle_listings").update(patch).eq("id", id);
      if (!error) await load();
      return !error;
    },
    [load]
  );

  const getBySlug = useCallback(async (slug: string): Promise<VehicleListing | null> => {
    const { data, error } = await (supabase as any).rpc("get_vehicle_listing_by_slug", { _slug: slug });
    if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
    return Array.isArray(data) ? (data[0] as VehicleListing) : (data as VehicleListing);
  }, []);

  const recordView = useCallback(async (slug: string) => {
    await (supabase as any).rpc("increment_listing_view", { _slug: slug });
  }, []);

  const embedSnippet = (slug: string) =>
    `<iframe src="${window.location.origin}/v/${slug}" width="100%" height="900" style="border:0" loading="lazy" title="Vehicle Details"></iframe>`;

  const publicUrl = (slug: string) => `${window.location.origin}/v/${slug}`;

  return {
    listings,
    loading,
    load,
    createListing,
    publishListing,
    archiveListing,
    updateListing,
    getBySlug,
    recordView,
    embedSnippet,
    publicUrl,
  };
};
