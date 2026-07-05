import { useMemo } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useShopperActivity } from "@/hooks/useShopperActivity";
import {
  RANGE_LABEL,
  mmss,
  type BehaviorTrigger,
  type SectionEngagement,
  type SessionSummary,
  type ShopperActivityRange,
  type ShopperActivitySummary,
  type TriggerState,
} from "@/lib/shopperActivity";
import {
  Activity,
  AlertTriangle,
  Car,
  CheckCircle2,
  Clock,
  Eye,
  Flame,
  Info,
  MapPin,
  MousePointerClick,
  RefreshCw,
  Repeat,
  ScanLine,
  Shield,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// ShopperActivityDrawer — internal intelligence slide-out for dealership
// managers + the product team. Answers "how are shoppers interacting with
// this passport, and where does attention drop before a CTA?" — NOT a
// salesperson call-sheet. Every number is real; anything uncaptured shows
// an honest "Not tracked yet".
// ──────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vin: string | null;
  tenantId: string | null;
  vehicleId: string | null;
  viewCount?: number | null;
  title: string;
  trim?: string | null;
  stock?: string | null;
  thumbnailUrl?: string | null;
}

const RANGES: ShopperActivityRange[] = ["all", "24h", "7d", "30d"];

const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export const ShopperActivityDrawer = ({ open, onOpenChange, vin, tenantId, vehicleId, viewCount, title, trim, stock, thumbnailUrl }: Props) => {
  const { summary, loading, error, range, setRange, refresh } = useShopperActivity({ vin, tenantId, vehicleId, viewCount, enabled: open });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 gap-0 w-full sm:w-[620px] sm:max-w-[94vw] flex flex-col bg-slate-50 [&>button]:hidden"
      >
        <SheetTitle className="sr-only">Shopper Activity for {title}</SheetTitle>
        <SheetDescription className="sr-only">Internal engagement intelligence for this vehicle passport.</SheetDescription>
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center">
                {thumbnailUrl ? <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" /> : <Car className="w-6 h-6 text-slate-400" />}
              </div>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold text-slate-900 leading-tight">Shopper Activity</h2>
                <p className="text-[13px] text-slate-600 truncate">
                  {title}
                  {trim ? ` ${trim}` : ""}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {stock ? `Stock ${stock} · ` : ""}
                  VIN {vin || "—"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={refresh} title="Refresh" className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button onClick={() => onOpenChange(false)} aria-label="Close" className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 text-lg font-medium">
                ✕
              </button>
            </div>
          </div>

          {/* Summary line + range filter */}
          <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[12px] text-slate-500 inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {(summary.totals.views ?? 0).toLocaleString()} views</span>
              <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {summary.totals.sessions} sessions</span>
              <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {mmss(summary.totals.totalSeconds)}</span>
            </p>
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-2.5 h-6 rounded-md text-[11px] font-semibold transition-colors ${range === r ? "bg-blue-600 text-white" : "text-slate-500 hover:text-slate-900"}`}
                >
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Scroll body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {loading && !summary.hasAnyData ? (
            <LoadingSkeleton />
          ) : error && !summary.hasAnyData ? (
            <ErrorState message={error} onRetry={refresh} />
          ) : !summary.hasAnyData ? (
            <EmptyState />
          ) : (
            <Body summary={summary} error={error} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

const Body = ({ summary, error }: { summary: ShopperActivitySummary; error: string | null }) => (
  <>
    {error && (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" /> Some data couldn't load ({error}). Showing what's available.
      </div>
    )}
    <ScoreCard summary={summary} />
    <MetricsGrid summary={summary} />
    <SectionEngagementCard sections={summary.sectionEngagement} />
    <SessionsCard sessions={summary.sessions} />
    <ClickstreamCard summary={summary} />
    <ShopperContextCard summary={summary} />
    <SimilarVehiclesCard summary={summary} />
    <TriggersCard triggers={summary.behaviorTriggers} />
    <InsightCard insights={summary.insights} />
    <p className="text-[11px] text-slate-400 text-center pt-1 pb-4">
      Aggregated, privacy-safe engagement signals. Shoppers are anonymous; location is estimated and coarse. Internal use only.
    </p>
  </>
);

// ── Section shell ────────────────────────────────────────────────────────

const Card = ({ title, icon: Icon, action, children }: { title: string; icon: typeof Eye; action?: React.ReactNode; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 inline-flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-slate-400" /> {title}
      </h3>
      {action}
    </div>
    {children}
  </section>
);

// ── b. Engagement score ──────────────────────────────────────────────────

const LEVEL_STYLE: Record<string, { bar: string; chip: string; ring: string }> = {
  Low: { bar: "bg-slate-300", chip: "bg-slate-100 text-slate-600", ring: "#94a3b8" },
  Browsing: { bar: "bg-sky-400", chip: "bg-sky-50 text-sky-700", ring: "#38bdf8" },
  Moderate: { bar: "bg-blue-500", chip: "bg-blue-50 text-blue-700", ring: "#3b82f6" },
  High: { bar: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", ring: "#10b981" },
  Hot: { bar: "bg-orange-500", chip: "bg-orange-50 text-orange-700", ring: "#f97316" },
};

const ScoreCard = ({ summary }: { summary: ShopperActivitySummary }) => {
  const { score, level, factors } = summary.score;
  const st = LEVEL_STYLE[level];
  return (
    <Card
      title="Engagement Score"
      icon={level === "Hot" ? Flame : Activity}
      action={<span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.chip}`}>{level}</span>}
    >
      <div className="flex items-center gap-4">
        <div className="relative w-[84px] h-[84px] shrink-0">
          <svg className="w-[84px] h-[84px] -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#e2e8f0" strokeWidth="12" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={st.ring} strokeWidth="12" strokeLinecap="round" strokeDasharray={2 * Math.PI * 52} strokeDashoffset={2 * Math.PI * 52 * (1 - score / 100)} className="transition-[stroke-dashoffset] duration-700" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[24px] font-black tabular-nums text-slate-900 leading-none">{score}</span>
            <span className="text-[9px] font-semibold text-slate-400">/ 100</span>
          </div>
        </div>
        <p className="text-[12px] text-slate-500 flex-1">An internal 0–100 signal blending reach, dwell, return visits and CTA/lead events. Not a black box — the exact factors are below.</p>
      </div>
      <ul className="mt-3 space-y-2">
        {factors.map((f) => (
          <li key={f.key}>
            <div className="flex items-center justify-between text-[12px] mb-0.5">
              <span className="text-slate-600">{f.label}</span>
              <span className="tabular-nums text-slate-400">{f.points}/{f.max}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${f.max ? Math.round((f.points / f.max) * 100) : 0}%` }} />
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">{f.detail}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
};

// ── c. Quick metrics grid ────────────────────────────────────────────────

const MetricsGrid = ({ summary }: { summary: ShopperActivitySummary }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
    {summary.metrics.map((m) => (
      <div key={m.key} className={`rounded-xl border p-3 ${m.tracked ? "border-slate-200 bg-white" : "border-dashed border-slate-200 bg-slate-50"}`}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 truncate">{m.label}</p>
        <p className={`text-[18px] font-bold tabular-nums mt-0.5 ${!m.tracked ? "text-slate-300 text-[12px] font-medium normal-case pt-1" : m.tone === "positive" ? "text-emerald-600" : m.tone === "watching" ? "text-amber-600" : "text-slate-900"}`}>
          {m.display}
        </p>
      </div>
    ))}
  </div>
);

// ── d. Section engagement (strongest signal) ─────────────────────────────

const SectionEngagementCard = ({ sections }: { sections: SectionEngagement[] }) => (
  <Card title="Attention by Section" icon={Eye} action={<span className="text-[10px] text-slate-400">from passport dwell time</span>}>
    {sections.length === 0 ? (
      <p className="text-[12px] text-slate-400 py-2">No section dwell recorded yet.</p>
    ) : (
      <>
        <div className="space-y-2.5 mb-4">
          {sections.slice(0, 8).map((s) => (
            <div key={s.module}>
              <div className="flex items-center justify-between text-[12px] mb-1">
                <span className="font-semibold text-slate-800 truncate pr-2">{s.label}</span>
                <span className="text-slate-400 tabular-nums shrink-0">{mmss(s.seconds)} · {Math.round(s.pct)}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(3, Math.round(s.pct))}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[11px] min-w-[360px]">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="font-semibold pb-1.5 px-1">Section</th>
                <th className="font-semibold pb-1.5 px-1 text-right">Time</th>
                <th className="font-semibold pb-1.5 px-1 text-right">Sessions</th>
                <th className="font-semibold pb-1.5 px-1 text-right">Last viewed</th>
              </tr>
            </thead>
            <tbody className="text-slate-600">
              {sections.map((s) => (
                <tr key={s.module} className="border-t border-slate-100">
                  <td className="py-1.5 px-1 font-medium text-slate-800">{s.label}</td>
                  <td className="py-1.5 px-1 text-right tabular-nums">{mmss(s.seconds)}</td>
                  <td className="py-1.5 px-1 text-right tabular-nums">{s.sessions}</td>
                  <td className="py-1.5 px-1 text-right whitespace-nowrap">{fmtWhen(s.lastViewedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )}
  </Card>
);

// ── e. Session timeline ──────────────────────────────────────────────────

const SessionsCard = ({ sessions }: { sessions: SessionSummary[] }) => (
  <Card title="Session Timeline" icon={Users}>
    {sessions.length === 0 ? (
      <p className="text-[12px] text-slate-400 py-2">No sessions recorded yet.</p>
    ) : (
      <div className="space-y-3">
        {sessions.slice(0, 10).map((s) => (
          <div key={s.sessionId} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 flex-wrap">
                {s.returning && <span className="inline-flex items-center gap-1 text-blue-700 font-semibold"><Repeat className="w-3 h-3" /> Returning</span>}
                {s.device && <span className="inline-flex items-center gap-1"><Smartphone className="w-3 h-3" /> {s.device}</span>}
                {s.browser && <span>{s.browser}</span>}
                {s.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {s.location}</span>}
              </div>
              <span className="text-[10px] text-slate-400 tabular-nums">{fmtWhen(s.firstAt)} · {mmss(s.totalSeconds)}</span>
            </div>
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              {s.entries.slice(0, 12).map((e, i) => (
                <span key={i} className="inline-flex items-center text-[10px] text-slate-500">
                  {i > 0 && <span className="text-slate-300 mx-0.5">›</span>}
                  <span className={`px-1.5 py-0.5 rounded ${e.kind === "section" ? "bg-white border border-slate-200" : "bg-blue-50 text-blue-700"}`}>{e.label}{e.seconds ? ` ${mmss(e.seconds)}` : ""}</span>
                </span>
              ))}
              {s.entries.length === 0 && <span className="text-[10px] text-slate-400">No ordered events for this session.</span>}
            </div>
            {!s.hasCta && (
              <p className="mt-2 text-[10px] font-semibold text-amber-600 inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {s.leadFormAbandoned ? "Opened lead form, no submit" : "No CTA reached"}
              </p>
            )}
          </div>
        ))}
        {sessions.length > 10 && <p className="text-[11px] text-slate-400 text-center">+{sessions.length - 10} more session(s)</p>}
      </div>
    )}
  </Card>
);

// ── f. Clickstream ───────────────────────────────────────────────────────

const ClickstreamCard = ({ summary }: { summary: ShopperActivitySummary }) => {
  const rows = summary.clickstream.slice(0, 40);
  return (
    <Card title="Clickstream" icon={MousePointerClick} action={rows.length > 0 ? <span className="text-[10px] text-slate-400">latest {rows.length}</span> : undefined}>
      {rows.length === 0 ? (
        <p className="text-[12px] text-slate-400 py-2">No interaction events captured yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((c) => (
            <li key={c.id} className="grid grid-cols-[16px_1fr_auto] items-center gap-2 text-[12px]">
              <span className="w-2 h-2 rounded-full bg-blue-500 justify-self-center" />
              <span className="text-slate-700 truncate">
                {c.label}
                {c.section && <span className="text-slate-400"> · {c.section}</span>}
                {c.device && <span className="text-slate-300"> · {c.device}</span>}
              </span>
              <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">{fmtWhen(c.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

// ── g. Shopper context ───────────────────────────────────────────────────

const ContextRow = ({ label, values }: { label: string; values: string[] }) => (
  <div className="flex items-start justify-between gap-3 text-[12px] py-1.5 border-b border-slate-100 last:border-0">
    <span className="text-slate-400 shrink-0">{label}</span>
    <span className="text-slate-700 text-right font-medium">{values.length ? values.slice(0, 4).join(", ") : "Not tracked yet"}</span>
  </div>
);

const ShopperContextCard = ({ summary }: { summary: ShopperActivitySummary }) => {
  const c = summary.shopperContext;
  return (
    <Card title="Shopper Context" icon={Shield} action={<span className="text-[10px] text-slate-400">estimated · anonymous</span>}>
      {!c.hasAny ? (
        <p className="text-[12px] text-slate-400 py-2">No contextual signals captured yet.</p>
      ) : (
        <div>
          <ContextRow label="Location" values={c.locations} />
          <ContextRow label="Device" values={c.devices} />
          <ContextRow label="Browser" values={c.browsers} />
          <ContextRow label="OS" values={c.oses} />
          <ContextRow label="Traffic source" values={c.sources} />
          <ContextRow label="Referrer" values={c.referrers} />
          <div className="flex items-center justify-between gap-3 text-[12px] py-1.5 border-b border-slate-100">
            <span className="text-slate-400">Returning / new</span>
            <span className="text-slate-700 font-medium tabular-nums">{c.returningVisitors} returning · {c.newVisitors} new</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[12px] py-1.5">
            <span className="text-slate-400">First / last seen</span>
            <span className="text-slate-700 font-medium text-right">{fmtWhen(c.firstSeen)} → {fmtWhen(c.lastSeen)}</span>
          </div>
        </div>
      )}
    </Card>
  );
};

// ── h. Similar vehicles (render only when data exists) ───────────────────

const SimilarVehiclesCard = ({ summary }: { summary: ShopperActivitySummary }) => {
  if (!summary.similarVehicles.length) return null;
  return (
    <Card title="Also Cross-Shopped" icon={Car} action={<span className="text-[10px] text-slate-400">same visitors, other vehicles</span>}>
      <ul className="space-y-1.5">
        {summary.similarVehicles.slice(0, 8).map((v) => (
          <li key={v.vin} className="flex items-center justify-between gap-2 text-[12px] py-1 border-b border-slate-100 last:border-0">
            <span className="font-mono text-slate-700 truncate">{v.vin}</span>
            <span className="text-slate-400 tabular-nums whitespace-nowrap">{v.visitors} shopper(s) · {v.events} event(s)</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

// ── i. Behavior triggers ─────────────────────────────────────────────────

const TRIGGER_STYLE: Record<TriggerState, { chip: string; label: string; icon: typeof CheckCircle2 }> = {
  active: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Active", icon: CheckCircle2 },
  watching: { chip: "bg-amber-50 text-amber-700 border-amber-200", label: "Watching", icon: Eye },
  inactive: { chip: "bg-slate-50 text-slate-400 border-slate-200", label: "Not triggered", icon: Info },
};

const TriggersCard = ({ triggers }: { triggers: BehaviorTrigger[] }) => (
  <Card title="Behavior Triggers" icon={ScanLine}>
    <ul className="space-y-2">
      {triggers.map((t) => {
        const st = TRIGGER_STYLE[t.state];
        const Icon = st.icon;
        return (
          <li key={t.key} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-800">{t.label}</p>
              <p className="text-[11px] text-slate-400">{t.detail}</p>
            </div>
            <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.chip}`}>
              <Icon className="w-3 h-3" /> {st.label}
            </span>
          </li>
        );
      })}
    </ul>
  </Card>
);

// ── j. What this tells us (manager/dev insight) ──────────────────────────

const InsightCard = ({ insights }: { insights: string[] }) => (
  <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
    <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-blue-700 inline-flex items-center gap-1.5 mb-2">
      <Sparkles className="w-3.5 h-3.5" /> What this tells us
    </h3>
    <ul className="space-y-1.5">
      {insights.map((t, i) => (
        <li key={i} className="text-[13px] text-slate-700 leading-snug flex gap-2">
          <span className="text-blue-500 mt-0.5">•</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  </section>
);

// ── States ───────────────────────────────────────────────────────────────

const LoadingSkeleton = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-40 rounded-2xl bg-slate-200/70" />
    <div className="grid grid-cols-3 gap-2.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-slate-200/70" />
      ))}
    </div>
    <div className="h-48 rounded-2xl bg-slate-200/70" />
    <div className="h-32 rounded-2xl bg-slate-200/70" />
  </div>
);

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center text-center py-16 px-6">
    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
      <Activity className="w-7 h-7 text-slate-400" />
    </div>
    <h3 className="text-[15px] font-bold text-slate-800">No shopper activity yet</h3>
    <p className="text-[13px] text-slate-500 mt-1 max-w-xs">
      Once a shopper opens this vehicle's passport, section dwell time, sessions and interactions will appear here.
    </p>
  </div>
);

const ErrorState = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div className="flex flex-col items-center justify-center text-center py-16 px-6">
    <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
      <AlertTriangle className="w-7 h-7 text-red-500" />
    </div>
    <h3 className="text-[15px] font-bold text-slate-800">Couldn't load activity</h3>
    <p className="text-[13px] text-slate-500 mt-1 max-w-xs">{message}</p>
    <button onClick={onRetry} className="mt-4 h-9 px-4 rounded-lg bg-blue-600 text-white text-[13px] font-semibold inline-flex items-center gap-1.5">
      <RefreshCw className="w-3.5 h-3.5" /> Retry
    </button>
  </div>
);

export default ShopperActivityDrawer;
