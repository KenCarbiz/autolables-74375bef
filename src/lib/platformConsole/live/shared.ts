import type { MetricModel, Provenance, TelemetryState, Tone } from "../types";

// Small helpers shared by the store, connection and data loaders.

export const provenance = (source: string, state: TelemetryState, scope: string, asOf: string | null): Provenance => ({ source, asOf, state, scope });

export interface ToneLabel { tone: Tone; label: string }

const pad = (n: number) => String(n).padStart(2, "0");

/** "08:14" in the viewer's local time. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "9m", "1h", "3d" style short age. */
export function agoShort(iso: string | null, now: number): string {
  if (!iso) return "Unknown";
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today 08:14", "Yesterday 22:00" or "Oct 29 08:14". */
export function dayTime(iso: string, now: number): string {
  const d = new Date(iso);
  const n = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(n) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return `Today ${clockTime(iso)}`;
  if (diffDays === 1) return `Yesterday ${clockTime(iso)}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${clockTime(iso)}`;
}

export const whenWithAge = (iso: string | null, now: number, none: string) => (iso ? `${dayTime(iso, now)} · ${agoShort(iso, now)} ago` : none);

export const unknownMetric = (m: Pick<MetricModel, "key" | "icon" | "label">, source: string, scope: string, why: string): MetricModel => ({
  ...m,
  value: "Unknown",
  tone: "neutral",
  helper: why,
  provenance: provenance(source, "unknown", scope, null),
});

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export const SUCCESS_STATUSES = new Set(["succeeded", "completed", "applied", "success", "passed"]);
