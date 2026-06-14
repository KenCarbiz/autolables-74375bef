import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  Send, Clock, Copy, ShieldCheck, Search, AlertCircle, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { TableEmptyState } from "./TableEmptyState";

// ──────────────────────────────────────────────────────────────
// OpenSigningsList — Wave 29.
//
// The funnel tab shipped in Wave 26 had SigningFunnelWidget
// (aggregate drop-off math) but no per-row visibility into which
// shoppers currently hold an unsigned link. This is the missing
// table: every addendum with a signing_token issued and no
// customer_signed_at yet, sorted by oldest-first so dealers see
// the stalest links at the top.
//
// Real-time freshness: addendums is already in the Wave 14.6
// publication via earlier waves, so a sign event in another tab
// drops the row from this list within ~1s.
// ──────────────────────────────────────────────────────────────

interface OpenSigningRow {
  id: string;
  vehicle_ymm: string | null;
  vehicle_vin: string | null;
  vehicle_stock: string | null;
  signing_token: string | null;
  customer_name: string | null;
  customer_email: string | null;
  status: string;
  created_at: string;
}

const fmtRelative = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
};

const ageTone = (iso: string): { text: string; chip: string } => {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 4)  return { text: "text-emerald-700", chip: "border-emerald-200 bg-emerald-50" };
  if (hours < 24) return { text: "text-amber-700",   chip: "border-amber-200 bg-amber-50" };
  return { text: "text-rose-700",    chip: "border-rose-200 bg-rose-50" };
};

export const OpenSigningsList = () => {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const [q, setQ] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["open_signings", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async (): Promise<OpenSigningRow[]> => {
      // Out for sign = addendum has a signing_token issued but
      // the customer hasn't signed yet. RLS scopes to the tenant.
      const { data } = await (supabase as any)
        .from("addendums")
        .select("id, vehicle_ymm, vehicle_vin, vehicle_stock, signing_token, customer_name, customer_email, status, created_at")
        .not("signing_token", "is", null)
        .is("customer_signed_at", null)
        .neq("status", "signed")
        .order("created_at", { ascending: false })
        .limit(200);
      return (data as OpenSigningRow[]) || [];
    },
    staleTime: 30_000,
  });

  const filtered = rows.filter(r => {
    if (!q.trim()) return true;
    const lc = q.toLowerCase();
    return (
      (r.vehicle_ymm || "").toLowerCase().includes(lc) ||
      (r.vehicle_vin || "").toLowerCase().includes(lc) ||
      (r.vehicle_stock || "").toLowerCase().includes(lc) ||
      (r.customer_name || "").toLowerCase().includes(lc) ||
      (r.customer_email || "").toLowerCase().includes(lc)
    );
  });

  const copySigningLink = async (r: OpenSigningRow) => {
    if (!r.signing_token) return;
    const url = `${window.location.origin}/sign/${r.signing_token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Signing link copied");
    } catch {
      toast.error("Couldn't copy — see browser permissions");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
            <Send className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Out for signing · live</h3>
            <p className="text-[11px] text-muted-foreground">
              {isLoading ? "Loading…" : `${rows.length} signing link${rows.length === 1 ? "" : "s"} awaiting customer ink`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="VIN, stock, customer…"
              className="h-9 pl-7 pr-3 rounded-md border border-border bg-background text-sm w-64"
            />
          </div>
        </div>
      </div>

      {/* Age legend — explains the chip color tones so the dealer
          knows what "fresh / stale / abandoned" mean at a glance. */}
      {rows.length > 0 && (
        <div className="flex items-center gap-3 mb-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> &lt; 4h
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> 4–24h
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-400" /> &gt; 24h · candidate for re-engagement
          </span>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground py-6">Loading…</p>
      ) : filtered.length === 0 ? (
        <TableEmptyState
          icon={Send}
          title={q ? "No signings match the search" : "No signing links out right now"}
          description={
            q
              ? "Try a different VIN or customer name."
              : "When you send a customer a signing link, the row lands here until they sign. Color tone tracks how long they've held it."
          }
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-bold">Sent</th>
                <th className="text-left px-3 py-2 font-bold">Vehicle</th>
                <th className="text-left px-3 py-2 font-bold">Customer</th>
                <th className="text-right px-3 py-2 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(r => {
                const tone = ageTone(r.created_at);
                return (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${tone.chip} ${tone.text}`}>
                        <Clock className="w-2.5 h-2.5" />
                        {fmtRelative(r.created_at)}
                      </span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {format(new Date(r.created_at), "M/d/yy h:mm a")}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-sm font-semibold text-foreground">
                        {r.vehicle_ymm || "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {r.vehicle_vin || "—"}
                        {r.vehicle_stock && <span className="ml-2 not-italic">Stock: {r.vehicle_stock}</span>}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-sm text-foreground">{r.customer_name || "—"}</p>
                      {r.customer_email && (
                        <p className="text-[10px] text-muted-foreground font-mono">{r.customer_email}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => copySigningLink(r)}
                          disabled={!r.signing_token}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
                          title="Copy signing link"
                        >
                          <Copy className="w-3 h-3" /> Link
                        </button>
                        {r.vehicle_vin && (
                          <button
                            onClick={() => navigate(`/compliance?vin=${encodeURIComponent(r.vehicle_vin || "")}`)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 h-7 rounded-md text-emerald-700 hover:bg-emerald-50"
                            title="Audit-Defense Packet for this VIN"
                          >
                            <ShieldCheck className="w-3 h-3" /> Defend
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/?id=${r.id}`)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 h-7 rounded-md bg-foreground text-background hover:opacity-90"
                          title="Open the addendum"
                        >
                          Open <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Wave 11 follow-up nudge — if any row is > 24h old, the
          reengage-abandoned-signings cron (when active) re-emails
          the customer. Surface the link so dealers know the
          contract. */}
      {rows.some(r => (Date.now() - new Date(r.created_at).getTime()) > 24 * 3_600_000) && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Stale link?</strong> When the Wave 11 reengage cron is active, the system
            auto-emails customers who haven't signed within 24h. Check status at
            /platform-admin?tab=billing.
          </span>
        </div>
      )}
    </section>
  );
};

export default OpenSigningsList;
