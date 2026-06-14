import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// ──────────────────────────────────────────────────────────────
// LiveBadge — Wave 15.3 visible signal for the Wave 14.6
// realtime sync. Opens a single Supabase channel watching
// vehicle_listings for the current tenant. Every INSERT /
// UPDATE / DELETE event lights up the dot for ~1.5s. Tells
// dealers "your team is connected" without spamming with a
// per-event toast.
//
// Renders nothing if no tenant is loaded yet (anon / pre-login).
// ──────────────────────────────────────────────────────────────

export const LiveBadge = () => {
  const { tenant } = useTenant();
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`live-${tenant.id}`)
      .on(
        // Loose typing same as useRealtimeInvalidate — the
        // payload shape is stable across the supabase-js
        // surface but the generics aren't worth chasing.
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "vehicle_listings",
          filter: `tenant_id=eq.${tenant.id}`,
        },
        () => {
          setPulse(true);
          // Reset after 1.6s so the next event fires fresh.
          window.setTimeout(() => setPulse(false), 1600);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id]);

  if (!tenant?.id) return null;

  return (
    <span
      className="hidden md:inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-border bg-muted text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/80"
      title="Realtime sync · your team's changes appear here automatically"
    >
      <span className="relative inline-flex w-2 h-2">
        <span
          className={`absolute inset-0 rounded-full bg-emerald-500 ${pulse ? "animate-ping" : ""}`}
          aria-hidden
        />
        <span
          className={`relative inline-flex w-2 h-2 rounded-full ${pulse ? "bg-emerald-400" : "bg-emerald-500"}`}
        />
      </span>
      Live
      <Radio className={`w-2.5 h-2.5 ${pulse ? "text-emerald-600" : "text-muted-foreground"}`} strokeWidth={2.25} />
    </span>
  );
};

export default LiveBadge;
