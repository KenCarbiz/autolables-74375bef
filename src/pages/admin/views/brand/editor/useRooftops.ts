import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BrandEditorContext } from "./useBrandEditor";

export interface Rooftop { id: string; displayName: string; legalName: string | null; city: string | null; state: string | null }

type Rows = { data: Array<{ id: string; display_name: string; legal_name: string | null; city: string | null; state: string | null }> | null; error: { message?: string } | null };

/**
 * Rooftop display and legal names from dealer_stores. The table may be readable by platform admins only, so a
 * refused or empty read reports "unavailable" instead of a made-up list.
 */
export function useRooftops(ctx: BrandEditorContext): { rooftops: Rooftop[]; state: "loading" | "ready" | "unavailable" } {
  const tenantId = ctx.source.tenantId;
  const fixtureRooftops = ctx.fixture ? ctx.fixture.variants?.[ctx.fixtureState]?.rooftops ?? ctx.fixture.rooftops : undefined;
  const q = useQuery({
    queryKey: ["admin-brand", "rooftops", tenantId],
    enabled: !ctx.fixture && !!tenantId,
    retry: false,
    queryFn: async (): Promise<Rooftop[]> => {
      const res = (await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { order: (c: string) => PromiseLike<Rows> } } } })
        .from("dealer_stores").select("id,display_name,legal_name,city,state").eq("tenant_id", tenantId as string).order("display_name")) as Rows;
      if (res.error) throw new Error(res.error.message || "unreadable");
      return (res.data ?? []).map((r) => ({ id: r.id, displayName: r.display_name, legalName: r.legal_name, city: r.city, state: r.state }));
    },
  });
  if (ctx.fixture) return fixtureRooftops?.length ? { rooftops: fixtureRooftops, state: "ready" } : { rooftops: [], state: "unavailable" };
  if (!tenantId) return { rooftops: [], state: "unavailable" };
  if (q.isLoading) return { rooftops: [], state: "loading" };
  if (q.isError || !q.data?.length) return { rooftops: [], state: "unavailable" };
  return { rooftops: q.data, state: "ready" };
}
