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
    retry: 1,
    queryFn: async () => {
      const session = (() => { try { return passportSessionId(); } catch { return undefined; } })();
      const { data, error } = await supabase.functions.invoke("public-listing-view", { body: { slug: key, session } });
      // A 404 from the edge function means the slug isn't a real listing — surface
      // that as a clean not-found sentinel instead of throwing (throwing bubbles up
      // as an unhandled runtime error in project monitoring / blank-screen alerts).
      if (error) {
        const ctx = (error as { context?: { status?: number } }).context;
        if (ctx?.status === 404) return null;
        throw error;
      }
      const row = (data as { listing?: VehicleListing } | null)?.listing ?? null;
      return row;
    },
  });

  if (opts?.preview) {
    return { listing: opts.previewData ?? null, loading: false, notFound: !opts.previewData };
  }
  return { listing: query.data ?? null, loading: query.isLoading, notFound: !query.isLoading && (query.isError || query.data === null) };
}
