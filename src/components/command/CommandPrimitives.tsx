// Shared presentation primitives for the three Command surfaces (VIN Command
// Center, Get Ready Command, Documents & Print Center). Frozen contract — the
// page-level agents import these and must not redefine them.

import * as React from "react";
import { AlertTriangle, ChevronRight, Copy, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_CLASS, type Tone as DescriptionTone } from "@/lib/description/model";

export type Tone = DescriptionTone;

// TONE_CLASS is a compound bg/text/border string meant for tinted chips; a solid
// 3px accent rail needs its own single-purpose token per tone.
const TONE_ACCENT: Record<Tone, string> = {
  slate: "border-t-slate-400",
  blue: "border-t-blue-500",
  amber: "border-t-amber-500",
  red: "border-t-red-500",
  emerald: "border-t-emerald-500",
  violet: "border-t-violet-500",
};

const CARD = "rounded-2xl border border-border bg-card";
const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl min-h-[44px] px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none";
// Exported so the page agents share one recipe. Keeping these private is what
// let three parallel builders drift into three different button treatments.
export const BTN_PRIMARY = cn(BTN_BASE, "bg-primary text-primary-foreground hover:opacity-90");
export const BTN_SECONDARY = cn(BTN_BASE, "border border-border bg-card text-foreground hover:border-primary hover:bg-muted");

// One vehicle-condition casing rule for every surface, so the same car cannot
// read "Used" on one screen and "used" on the next.
export function conditionLabel(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^cpo$/i.test(v)) return "CPO";
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

/* -------------------------------------------------------------- DisabledReason */

// BTN_BASE sets `disabled:pointer-events-none`, so a `title` on a disabled
// button is never hit-tested and the operator never learns why it is dead. The
// title has to ride on a wrapper that still receives pointer events.
export function DisabledReason({
  reason,
  className,
  children,
}: {
  reason?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span title={reason ?? undefined} className={cn("inline-flex", className)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ StatusPill */

export function StatusPill({
  tone,
  Icon,
  children,
}: {
  tone: Tone;
  Icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap",
        TONE_CLASS[tone],
      )}
    >
      {Icon ? <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ CommandCard */

export function CommandCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const hasHeader = Boolean(title || subtitle || action);
  return (
    <section className={cn(CARD, "p-4", className)}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            {title ? <h2 className="text-[13px] font-bold text-foreground">{title}</h2> : null}
            {subtitle ? <p className="text-[11.5px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
          </div>
          {action ? <div className="shrink-0 flex items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* --------------------------------------------------------------- CommandStatCard */

export function CommandStatCard({
  label,
  value,
  sub,
  Icon,
  tone,
  accentTop,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  Icon: LucideIcon;
  tone: Tone;
  accentTop?: boolean;
  onClick?: () => void;
}) {
  const interactive = typeof onClick === "function";
  const Tag = (interactive ? "button" : "div") as React.ElementType;

  const iconTile = (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg border w-9 h-9 shrink-0",
        TONE_CLASS[tone],
      )}
    >
      <Icon className="w-5 h-5" aria-hidden="true" />
    </span>
  );

  return (
    <Tag
      {...(interactive ? { type: "button", onClick } : {})}
      className={cn(
        CARD,
        "p-4 min-h-[44px] w-full text-left",
        accentTop && cn("border-t-[3px]", TONE_ACCENT[tone]),
        accentTop && "flex flex-col items-center text-center gap-1",
        interactive && "hover:bg-muted/50 transition-colors",
      )}
    >
      {accentTop ? (
        <>
          <span className="text-[11.5px] text-muted-foreground">{label}</span>
          <span className="text-[26px] font-bold leading-none text-foreground">{value}</span>
          {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
          <span className="mt-1">{iconTile}</span>
        </>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11.5px] text-muted-foreground">{label}</div>
            <div className="text-[22px] font-bold leading-none text-foreground mt-1.5">{value}</div>
            {sub ? <div className="text-[11px] text-muted-foreground mt-1">{sub}</div> : null}
          </div>
          {iconTile}
        </div>
      )}
    </Tag>
  );
}

/* --------------------------------------------------------------- CommandStepper */

export function CommandStepper({
  steps,
  current,
}: {
  steps: { n: number; title: string; caption: string }[];
  current: number;
}) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <ol className="flex items-stretch gap-2 min-w-max">
        {steps.map((step, i) => {
          const isCurrent = step.n === current;
          const isDone = step.n < current;
          return (
            <li key={step.n} className="flex items-center gap-2">
              <div
                className={cn(
                  CARD,
                  "flex items-center gap-3 px-3 py-2.5 min-h-[44px]",
                  isCurrent && "border-blue-200 bg-blue-50/70",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-full border text-[12px] font-bold",
                    isCurrent
                      ? "bg-blue-600 border-blue-600 text-white"
                      : isDone
                        ? "bg-blue-50 border-blue-200 text-blue-700"
                        : "bg-card border-border text-muted-foreground",
                  )}
                >
                  {step.n}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-[12.5px] font-semibold whitespace-nowrap",
                      isCurrent ? "text-blue-700" : "text-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="block text-[10.5px] text-muted-foreground whitespace-nowrap">
                    {step.caption}
                  </span>
                </span>
              </div>
              {i < steps.length - 1 ? (
                <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------- TimelineRail */

export function TimelineRail({
  entries,
}: {
  entries: { at: string | null; title: string; detail?: string; pending?: boolean }[];
}) {
  if (entries.length === 0) {
    return <p className="text-[11.5px] text-muted-foreground">No activity recorded yet.</p>;
  }
  return (
    <ol className="relative">
      {entries.map((entry, i) => {
        const last = i === entries.length - 1;
        return (
          <li key={`${entry.title}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            <div className="flex flex-col items-center shrink-0">
              <span
                className={cn(
                  "mt-1 w-2.5 h-2.5 rounded-full border-2",
                  entry.pending
                    ? "border-slate-300 bg-card"
                    : "border-blue-600 bg-blue-600",
                )}
                aria-hidden="true"
              />
              {!last ? <span className="flex-1 w-px bg-border mt-1" aria-hidden="true" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              {entry.at ? (
                <div className="text-[11px] text-muted-foreground">{entry.at}</div>
              ) : null}
              <div className="text-[12.5px] font-medium text-foreground">{entry.title}</div>
              {entry.detail ? (
                <div className="text-[11px] text-muted-foreground">{entry.detail}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------- VehicleIdentityStrip */

export function VehicleIdentityStrip({
  imageUrl,
  ymm,
  trim,
  stockNumber,
  vin,
  conditionLabel: conditionRaw,
  meta,
  action,
  onCopyVin,
}: {
  imageUrl?: string | null;
  ymm: string;
  trim?: string | null;
  stockNumber?: string | null;
  vin: string;
  conditionLabel?: string | null;
  meta?: { label: string; value: string; sub?: string }[];
  action?: React.ReactNode;
  onCopyVin?: () => void;
}) {
  // Callers pass the raw vehicle_listings.condition, so normalize here rather
  // than trusting each page to remember.
  const condition = conditionLabel(conditionRaw);
  return (
    <section className={cn(CARD, "p-5")}>
      <div className="flex flex-col lg:flex-row lg:items-start gap-4">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={ymm}
            loading="lazy"
            className="w-full lg:w-[200px] shrink-0 aspect-[16/10] object-cover rounded-xl bg-muted"
          />
        ) : (
          <div className="w-full lg:w-[200px] shrink-0 aspect-[16/10] rounded-xl bg-muted flex items-center justify-center text-[11px] text-muted-foreground">
            No photo
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-bold leading-tight text-foreground">
            {ymm}
            {trim ? <span className="ml-2 font-normal text-muted-foreground">{trim}</span> : null}
          </h2>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-2">
            {stockNumber ? (
              <span className="text-[12.5px] whitespace-nowrap">
                <span className="text-muted-foreground">Stock #</span>{" "}
                <span className="font-semibold text-foreground">{stockNumber}</span>
              </span>
            ) : null}
            <span className="text-[12.5px] flex items-center gap-1 min-w-0">
              <span className="text-muted-foreground">VIN</span>{" "}
              <span className="font-semibold text-foreground font-mono truncate">{vin}</span>
              {onCopyVin ? (
                <button
                  type="button"
                  onClick={onCopyVin}
                  aria-label="Copy VIN"
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -my-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Copy className="w-4 h-4" aria-hidden="true" />
                </button>
              ) : null}
            </span>
            {condition ? <StatusPill tone="emerald">{condition}</StatusPill> : null}
          </div>
        </div>

        {meta && meta.length > 0 ? (
          <div className="shrink-0 flex flex-row lg:flex-col flex-wrap gap-x-6 gap-y-2 lg:text-right">
            {meta.map((m) => (
              <div key={m.label}>
                <div className="text-[11px] text-muted-foreground">{m.label}</div>
                <div className="text-[12.5px] font-semibold text-foreground">{m.value}</div>
                {m.sub ? <div className="text-[11px] text-muted-foreground">{m.sub}</div> : null}
              </div>
            ))}
          </div>
        ) : null}

        {action ? <div className="shrink-0 flex items-center gap-2">{action}</div> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ EmptyState */

export function EmptyState({
  Icon,
  title,
  detail,
  action,
}: {
  Icon: LucideIcon;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn(CARD, "p-8 flex flex-col items-center text-center gap-2")}>
      <span className={cn("inline-flex items-center justify-center w-11 h-11 rounded-full border", TONE_CLASS.slate)}>
        <Icon className="w-5 h-5" aria-hidden="true" />
      </span>
      <h3 className="text-[13px] font-bold text-foreground mt-1">{title}</h3>
      {detail ? <p className="text-[11.5px] text-muted-foreground max-w-sm">{detail}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- LoadingCard */

export function LoadingCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className={cn(CARD, "p-4")} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="animate-pulse space-y-3">
        <div className="h-3 w-32 rounded bg-muted" />
        {Array.from({ length: Math.max(1, rows) }).map((_, i) => (
          <div key={i} className="h-10 rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- ErrorCard */

export function ErrorCard({
  message, detail, onRetry,
}: { message: string; detail?: string | null; onRetry?: () => void }) {
  return (
    <div className={cn("rounded-2xl border p-4", TONE_CLASS.red)} role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-red-800">Something went wrong</p>
          <p className="text-[12.5px] text-red-700 mt-0.5 break-words">{message}</p>
          {detail ? (
            <details className="mt-2">
              <summary className="text-[11.5px] text-red-700/80 cursor-pointer">
                Details for support
              </summary>
              <p className="text-[11.5px] text-red-700/80 mt-1 break-words font-mono">{detail}</p>
            </details>
          ) : null}
        </div>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={cn(BTN_SECONDARY, "mt-3")}>
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </div>
  );
}
