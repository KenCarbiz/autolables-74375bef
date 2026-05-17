import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// useRealtimeInvalidate — generic Supabase Realtime ->
// TanStack Query bridge (Wave 14.6).
//
// Subscribes to postgres_changes on a single table (optionally
// scoped to a tenant_id or store_id) and, on any INSERT /
// UPDATE / DELETE event, invalidates the supplied query key.
// The originating mutation already invalidates locally via
// onSuccess; this is the cross-device path.
//
// The channel + subscription are torn down when the consuming
// hook unmounts. Multiple consumers of the same data set will
// each open a channel — Supabase Realtime handles fan-out, and
// the cost per channel is small. If we hit the channel ceiling
// later, hoist this into a single root-level subscription with
// fan-out into the cache.
//
// Migration 20260518200000_realtime_publications.sql opts the
// affected tables into the supabase_realtime publication.
// ──────────────────────────────────────────────────────────────

interface Args {
  table: string;
  queryKey: QueryKey;
  // Optional postgres_changes filter, e.g. "tenant_id=eq.<uuid>".
  // Skip when RLS already scopes the subscription on the
  // backend (the realtime backend respects RLS).
  filter?: string;
  // Disable the subscription when the underlying query isn't
  // ready yet (e.g. tenant_id not loaded). Avoids a channel
  // open + immediate close on mount.
  enabled?: boolean;
}

export function useRealtimeInvalidate({ table, queryKey, filter, enabled = true }: Args): void {
  const qc = useQueryClient();
  // Stringify the queryKey for the dep array — array identity
  // changes every render otherwise, churning the subscription.
  const queryKeyJson = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled) return;

    const channelName = `rt-${table}-${filter ?? "all"}`;
    const channel = supabase
      .channel(channelName)
      .on(
        // The Supabase JS client types postgres_changes loosely;
        // cast to any to avoid a generics dance for a stable
        // payload shape.
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table,
          ...(filter ? { filter } : {}),
        },
        () => {
          qc.invalidateQueries({ queryKey });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // queryKeyJson captures the queryKey for deps without
    // tripping the array-identity churn problem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, enabled, queryKeyJson]);
}
