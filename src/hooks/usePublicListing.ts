import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { passportSessionId } from "@/lib/passportEngagement";
import { governPublicListing } from "@/lib/passport/publicSurface";
import type { PublicClaimDecision } from "@/lib/market/publicClaim";
import type { VehicleListing } from "@/hooks/useVehicleListing";

// Shared, cached fetch for the public Vehicle Passport (`public-listing-view`).
//
// Every Passport surface (the main /v/:slug page and each section sub-page)
// reads the SAME vehicle. Keying the fetch by VIN through React Query means the
// listing is fetched once and served from cache as the shopper moves between
// sections — so navigating the left-hand nav swaps the body instantly instead
// of re-fetching and remounting (which read as a full "refresh"). staleTime
// keeps it from refetching during a normal browsing session.

export const publicListingKey = (slug: string) => ["public-listing", (slug || "").trim().toUpperCase()];

export interface UsePublicListingResult {
  listing: VehicleListing | null;
  loading: boolean;
  notFound: boolean;
  /**
   * The shopper tripped `public-listing-view`'s per-IP throttle. This is NOT a
   * missing vehicle, and must never render as one — browsing a lot's inventory
   * legitimately crosses the anon threshold, and telling that shopper the car
   * was sold loses the sale.
   */
  rateLimited: boolean;
  /**
   * The claim decision this listing was governed by.
   *
   * Surfaces need it for one thing only: choosing the neutral sentence. A
   * vehicle with no advertised price must not be told "dealer pricing remains
   * available", and the page cannot know that from the suppressed listing —
   * every field that would have said so is already null by then.
   */
  marketClaim: PublicClaimDecision;
}

interface Fetched {
  listing: VehicleListing | null;
  rateLimited?: boolean;
}

export function usePublicListing(
  slug: string | undefined,
  opts?: { preview?: boolean; previewData?: VehicleListing | null },
): UsePublicListingResult {
  const key = (slug || "").trim();
  const query = useQuery({
    queryKey: publicListingKey(key),
    enabled: !!key && !opts?.preview,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: (count, err) => !(err as { rateLimited?: boolean })?.rateLimited && count < 1,
    queryFn: async (): Promise<Fetched> => {
      const session = (() => { try { return passportSessionId(); } catch { return undefined; } })();
      const { data, error } = await supabase.functions.invoke("public-listing-view", { body: { slug: key, session } });
      // A 404 from the edge function means the slug isn't a real listing — surface
      // that as a clean not-found sentinel instead of throwing (throwing bubbles up
      // as an unhandled runtime error in project monitoring / blank-screen alerts).
      if (error) {
        const ctx = (error as { context?: { status?: number } }).context;
        if (ctx?.status === 404) return { listing: null };
        if (ctx?.status === 429) return { listing: null, rateLimited: true };
        throw error;
      }
      const row = (data as { listing?: VehicleListing } | null)?.listing ?? null;
      return { listing: row };
    },
  });

  // ── The one public market-claim boundary ──────────────────────────────
  //
  // Every `/v/:slug…` surface reads the vehicle through this hook, so
  // governing it here governs them all — including the sibling sections that
  // derive their own passport data and the nested panels that read
  // `listing.market_meta` and `listing.market_payload` directly, neither of
  // which a page-level suppression would have reached. Preview fixtures go
  // through it too: a preview that renders a claim the live page suppresses
  // is a preview of the wrong product.
  const fetched = opts?.preview ? (opts.previewData ?? null) : (query.data?.listing ?? null);
  const governed = useMemo(() => governPublicListing(fetched), [fetched]);
  const listing = governed.listing;

  if (opts?.preview) {
    return { listing, loading: false, notFound: !opts.previewData, rateLimited: false, marketClaim: governed.claim };
  }
  const rateLimited = !!query.data?.rateLimited;
  return {
    listing,
    loading: query.isLoading,
    notFound: !query.isLoading && !rateLimited && (query.isError || query.data?.listing == null),
    rateLimited,
    marketClaim: governed.claim,
  };
}
