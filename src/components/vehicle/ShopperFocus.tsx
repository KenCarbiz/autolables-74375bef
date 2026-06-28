import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Eye, Clock, Users, RefreshCw } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// ShopperFocus — the dealer-facing "Shopper Focus Breakdown": how long
// shoppers spent on each module of this vehicle's customer passport, summed
// across visit sessions. Reads passport_engagement (tenant RLS).
// ──────────────────────────────────────────────────────────────────────

const MODULE_LABEL: Record<string, string> = {
  "vehicle-details": "Vehicle Details",
  market: "Market Intelligence",
  highlights: "Vehicle Highlights",
  overview: "Vehicle Overview",
  recon: "Reconditioning & Inspection",
  warranty: "Warranty",
  dealer: "Why Buy Here",
  "market-price": "Market Price",
  "price-history": "Price History",
  "key-specs": "Specifications",
  equipment: "Equipment & Options",
  "great-buy": "Why It's a Great Buy",
  "vehicle-history": "Vehicle History",
  "factory-warranty": "Warranty Detail",
  "owner-reviews": "Reviews",
  gallery: "Photo Gallery",
};
const label = (k: string) => MODULE_LABEL[k] || k.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

interface Props { vin: string | null; tenantId: string | null; }

export const ShopperFocus = ({ vin, tenantId }: Props) => {
  const [rows, setRows] = useState<{ module: string; seconds: number }[] | null>(null);
  const [sessions, setSessions] = useState(0);

  const load = useCallback(async () => {
    if (!vin || !tenantId) return;
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as unknown as { from: (t: string) => any })
      .from("passport_engagement")
      .select("module, seconds, session_id")
      .eq("tenant_id", tenantId).eq("vin", vin.toUpperCase()).limit(5000);
    const recs = (data || []) as { module: string; seconds: number; session_id: string }[];
    const by = new Map<string, number>();
    const sess = new Set<string>();
    for (const r of recs) { by.set(r.module, (by.get(r.module) || 0) + (r.seconds || 0)); sess.add(r.session_id); }
    setSessions(sess.size);
    setRows([...by.entries()].map(([module, seconds]) => ({ module, seconds })).sort((a, b) => b.seconds - a.seconds));
  }, [vin, tenantId]);

  useEffect(() => { load(); }, [load]);

  if (!rows) return null;
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  const max = rows[0]?.seconds || 1;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5"><Eye className="w-4 h-4" /> Shopper Focus</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Where shoppers spend their time on this vehicle's packet.</p>
        </div>
        <button onClick={load} title="Refresh" className="w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>

      {total === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No shopper sessions recorded yet. Engagement appears here once a customer opens the packet.</p>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-3 text-[12px]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-foreground"><Clock className="w-3.5 h-3.5 text-blue-600" /> {mmss(total)} total</span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-foreground"><Users className="w-3.5 h-3.5 text-blue-600" /> {sessions} session{sessions === 1 ? "" : "s"}</span>
          </div>
          <div className="space-y-2.5">
            {rows.map((r) => (
              <div key={r.module}>
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="font-semibold text-foreground truncate pr-2">{label(r.module)}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">{mmss(r.seconds)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, Math.round((r.seconds / max) * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ShopperFocus;
