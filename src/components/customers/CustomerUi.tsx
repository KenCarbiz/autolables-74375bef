import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { DealEntry, EngagementRollup, NextAction } from "./customerBook";
import { dwellLabel, money, relativeTime } from "./customerBook";

export type Tone = "neutral" | "good" | "waiting" | "attention";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-teal/10 text-teal",
  waiting: "bg-gold/15 text-gold",
  attention: "bg-destructive/10 text-destructive",
};

export const Chip = ({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-al-meta font-semibold ${TONE_CLASS[tone]}`}>
    {children}
  </span>
);

export const TabStrip = <T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: T; label: string; count: number }[];
  active: T;
  onSelect: (key: T) => void;
}) => (
  <div className="overflow-x-auto no-print">
    <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/60 p-1">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            aria-pressed={on}
            className={`h-8 px-3.5 rounded-lg text-al-meta font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
              on ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            <span className={`text-al-meta font-bold tabular-nums px-1.5 rounded-full ${on ? "bg-primary/10 text-primary" : "bg-muted-foreground/15"}`}>
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

export const SectionCard = ({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) => (
  <section className="bg-card rounded-2xl border border-border shadow-premium">
    <header className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-border">
      <div className="min-w-0">
        <h2 className="text-al-card font-display text-foreground">{title}</h2>
        {subtitle && <p className="text-al-meta text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </header>
    <div className="p-5">{children}</div>
  </section>
);

export const EmptyBlock = ({ title, body }: { title: string; body: string }) => (
  <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
    <p className="text-al-card text-foreground">{title}</p>
    <p className="text-al-body text-muted-foreground mt-1.5 max-w-xl mx-auto">{body}</p>
  </div>
);

export const priceTone = (state: DealEntry["priceIntegrity"]["state"]): Tone =>
  state === "verified" ? "good" : state === "mismatch" ? "attention" : "waiting";

export const PriceIntegrityChip = ({ integrity }: { integrity: DealEntry["priceIntegrity"] }) => (
  <Chip tone={priceTone(integrity.state)}>
    {integrity.label}
    {integrity.state === "mismatch" && integrity.delta != null ? ` ${money(Math.abs(integrity.delta))}` : ""}
  </Chip>
);

export const dealStateTone = (state: DealEntry["state"]): Tone =>
  state === "delivered" ? "good" : state === "signed" ? "good" : state === "out_for_signature" ? "waiting" : "neutral";

export const NextActionCell = ({ action }: { action: NextAction }) => (
  <div className="min-w-0">
    <p className="text-al-body font-semibold text-foreground">{action.headline}</p>
    <p className="text-al-meta text-muted-foreground mt-0.5">{action.detail}</p>
  </div>
);

// Engagement is only ever rendered as facts that happened. When nothing links a
// person to the clickstream we say so rather than borrowing another shopper's
// activity.
export const EngagementCell = ({ engagement }: { engagement: EngagementRollup }) => {
  if (!engagement.linked || (!engagement.facts.length && !engagement.sessions)) {
    return <p className="text-al-meta text-muted-foreground">No passport activity linked to this customer.</p>;
  }
  const shown = engagement.facts.slice(0, 3);
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-al-meta text-muted-foreground tabular-nums">
        {engagement.sessions} {engagement.sessions === 1 ? "visit" : "visits"} · {engagement.visitDays} {engagement.visitDays === 1 ? "day" : "days"}
        {engagement.dwellSeconds > 0 ? ` · ${dwellLabel(engagement.dwellSeconds)}` : ""}
      </p>
      <div className="flex flex-wrap gap-1">
        {shown.map((f) => (
          <Chip key={f.key} tone="neutral">
            {f.label}
            {f.count > 1 ? ` x${f.count}` : ""}
          </Chip>
        ))}
        {engagement.facts.length > shown.length && (
          <span className="text-al-meta text-muted-foreground self-center">+{engagement.facts.length - shown.length} more</span>
        )}
      </div>
    </div>
  );
};

export const VehicleCell = ({ label, stock, vin, slug }: { label: string; stock: string | null; vin: string | null; slug: string | null }) => (
  <div className="min-w-0">
    <p className="text-al-body font-semibold text-foreground truncate">{label}</p>
    <p className="text-al-meta text-muted-foreground truncate">
      {stock ? `Stock ${stock}` : vin ? `VIN ${vin.slice(-8)}` : "No stock number"}
      {slug ? (
        <>
          {" · "}
          <Link to={`/v/${slug}`} className="underline underline-offset-2 hover:text-foreground">
            Passport
          </Link>
        </>
      ) : null}
    </p>
  </div>
);

export const TimeCell = ({ at }: { at: string | null }) => (
  <span className="text-al-meta text-muted-foreground tabular-nums whitespace-nowrap">{relativeTime(at)}</span>
);
