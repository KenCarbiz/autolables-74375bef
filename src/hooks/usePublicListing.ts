import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { passportSessionId } from "@/lib/passportEngagement";
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

  if (opts?.preview) {
    return { listing: opts.previewData ?? null, loading: false, notFound: !opts.previewData, rateLimited: false };
  }
  const rateLimited = !!query.data?.rateLimited;
  return {
    listing: query.data?.listing ?? null,
    loading: query.isLoading,
    notFound: !query.isLoading && !rateLimited && (query.isError || query.data?.listing == null),
    rateLimited,
  };
}
