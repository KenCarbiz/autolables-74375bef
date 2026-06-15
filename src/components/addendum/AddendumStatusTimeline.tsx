import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, CheckCircle2, Circle } from "lucide-react";

// DocuSign-style live status for a single addendum, fed by the
// addendum_events timeline. Renders a stage stepper (Ready → Sent →
// Opened → Reviewing → Signed → Dealer signed → Executed) plus the raw
// event log with timestamps. Auto-refreshes so customer-side events
// (which arrive asynchronously over the token RPC) surface without a
// manual reload.

interface AddendumEvent {
  id: string;
  event: string;
  channel: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
}

const STAGES: { key: string; label: string; events: string[] }[] = [
  { key: "ready",    label: "Ready",        events: ["ready_for_signature"] },
  { key: "sent",     label: "Sent",         events: ["link_sent"] },
  { key: "opened",   label: "Opened",       events: ["customer_opened"] },
  { key: "review",   label: "Reviewing",    events: ["reviewing", "initials_added"] },
  { key: "signed",   label: "Signed",       events: ["customer_signed"] },
  { key: "dealer",   label: "Dealer",       events: ["dealer_signed"] },
  { key: "executed", label: "Executed",     events: ["executed", "fully_executed"] },
];

const EVENT_LABEL: Record<string, string> = {
  ready_for_signature: "Ready for signature",
  link_sent: "Link sent",
  customer_opened: "Customer opened",
  reviewing: "Customer reviewing",
  initials_added: "Initials added",
  customer_signed: "Customer signed",
  dealer_signed: "Dealer signed",
  executed: "Executed",
  fully_executed: "Executed",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

const AddendumStatusTimeline = ({
  addendumId,
  version,
  className = "",
}: {
  addendumId: string;
  version?: string;
  className?: string;
}) => {
  const [events, setEvents] = useState<AddendumEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("addendum_events")
      .select("*")
      .eq("addendum_id", addendumId)
      .order("created_at", { ascending: true });
    setEvents((data as AddendumEvent[]) || []);
    setLoading(false);
  }, [addendumId]);

  useEffect(() => {
    if (!addendumId) return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [addendumId, load]);

  const firstAt = (names: string[]) =>
    events.find((e) => names.includes(e.event))?.created_at || null;

  // Highest reached stage drives the "fill" of the stepper.
  let reachedIdx = -1;
  STAGES.forEach((s, i) => { if (firstAt(s.events)) reachedIdx = Math.max(reachedIdx, i); });

  return (
    <div className={`no-print rounded-xl border border-border bg-card ${className}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Signing status</span>
          {version && <span className="text-[10px] font-mono text-muted-foreground">{version}</span>}
        </div>
        <button onClick={load} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stage stepper */}
      <div className="px-4 py-3 flex items-center gap-1 overflow-x-auto">
        {STAGES.map((s, i) => {
          const at = firstAt(s.events);
          const done = i <= reachedIdx && !!at;
          const current = i === reachedIdx;
          return (
            <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
              <div className="flex flex-col items-center gap-1 min-w-[58px]">
                {done ? (
                  <CheckCircle2 className={`w-4 h-4 ${current ? "text-teal" : "text-emerald-500"}`} strokeWidth={2.25} />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground/30" />
                )}
                <span className={`text-[9px] font-semibold ${done ? "text-foreground" : "text-muted-foreground/50"}`}>{s.label}</span>
                <span className="text-[8px] font-mono text-muted-foreground/70 h-3">{at ? fmt(at).split(",")[1]?.trim() || "" : ""}</span>
              </div>
              {i < STAGES.length - 1 && (
                <div className={`h-0.5 w-4 rounded ${i < reachedIdx ? "bg-emerald-400" : "bg-muted"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Raw event log */}
      <div className="border-t border-border px-4 py-3">
        {events.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {loading ? "Loading activity…" : "No activity yet. Events appear here as the customer opens and signs."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {[...events].reverse().map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 text-[11px]">
                <span className="font-mono text-muted-foreground/70 tabular-nums w-28 flex-shrink-0">{fmt(e.created_at)}</span>
                <span className="font-semibold text-foreground">{EVENT_LABEL[e.event] || e.event}</span>
                {e.channel && <span className="text-[9px] uppercase tracking-wider text-muted-foreground">· {e.channel}</span>}
                {e.actor_name && <span className="text-muted-foreground">· {e.actor_name}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AddendumStatusTimeline;
