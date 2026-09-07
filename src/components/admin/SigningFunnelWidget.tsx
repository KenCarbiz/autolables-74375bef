import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, MousePointerClick, Pencil, CheckCircle2 } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// SigningFunnelWidget — tenant-scoped conversion funnel for the
// shopper signing flow.
//
// Stages:
//   Leads captured \u2192 Signing links opened \u2192 Signing started
//     \u2192 Addendums signed
//
// Counts come from public.signing_funnel_summary(since_days).
// The widget shows drop-off as a percentage between adjacent
// stages so the dealer sees where buyers are falling out.
// ──────────────────────────────────────────────────────────────

interface FunnelRow {
  leads_captured: number;
  links_opened: number;
  signing_started: number;
  addendums_signed: number;
}

const WINDOW_CHOICES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

const SigningFunnelWidget = () => {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [data, setData] = useState<FunnelRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: rows, error } = await (supabase as any)
        .rpc("signing_funnel_summary", { _since_days: windowDays });
      if (cancelled) return;
      setLoading(false);
      if (error) {
        setData(null);
        return;
      }
      const first = Array.isArray(rows) ? rows[0] : rows;
      setData((first as FunnelRow) || null);
    })();
    return () => { cancelled = true; };
  }, [windowDays]);

  const leads     = data?.leads_captured ?? 0;
  const opened    = data?.links_opened ?? 0;
  const started   = data?.signing_started ?? 0;
  const signed    = data?.addendums_signed ?? 0;

  const max = Math.max(leads, opened, started, signed, 1);

  const stages: {
    key: string;
    label: string;
    icon: typeof Users;
    value: number;
    prev?: number;
  }[] = [
    { key: "leads",   label: "Leads captured",      icon: Users,              value: leads },
    { key: "opened",  label: "Signing links opened", icon: MousePointerClick,  value: opened,  prev: leads },
    { key: "started", label: "Signing started",     icon: Pencil,             value: started, prev: opened },
    { key: "signed",  label: "Signed",              icon: CheckCircle2,       value: signed,  prev: started },
  ];

  const dropPct = (current: number, prev?: number): string | null => {
    if (prev == null) return null;
    if (prev === 0) return null;
    if (current >= prev) return null;
    const pct = Math.round(((prev - current) / prev) * 100);
    return pct > 0 ? `${pct}% drop` : null;
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-foreground">Signing funnel</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Where shoppers drop off between first contact and a signed addendum.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {WINDOW_CHOICES.map((w) => (
            <button
              key={w.days}
              onClick={() => setWindowDays(w.days)}
              className={`px-3 h-8 text-[11px] font-semibold transition-colors ${
                windowDays === w.days
                  ? "bg-slate-950 text-white"
                  : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && (
        <p className="text-xs text-muted-foreground">Loading funnel…</p>
      )}

      <div className="space-y-3">
        {stages.map((s) => {
          const Icon = s.icon;
          const widthPct = Math.max(6, Math.round((s.value / max) * 100));
          const drop = dropPct(s.value, s.prev);
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[12px] font-semibold text-slate-700">{s.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {drop && (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      {drop}
                    </span>
                  )}
                  <span className="text-sm font-bold tabular-nums text-foreground">{s.value}</span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-slate-950 transition-all"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {!loading && leads === 0 && opened === 0 && started === 0 && signed === 0 && (
        <p className="text-[11px] text-muted-foreground mt-3 italic">
          No activity in the last {windowDays} days. Once shoppers scan a QR or receive a signing link, counts land here automatically.
        </p>
      )}
    </section>
  );
};

export default SigningFunnelWidget;
