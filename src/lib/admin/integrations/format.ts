// Date formatting for the health center. Times render in the dealership's
// time zone when one is configured, otherwise the viewer's. The zone is named
// on the run detail so a timestamp is never ambiguous.

export interface DateTimeOptions {
  timeZone?: string | null;
  withYear?: boolean;
  withZone?: boolean;
  withSeconds?: boolean;
}

const zoneOf = (tz: string | null | undefined): string | undefined => (tz && tz.trim() ? tz.trim() : undefined);

const safeDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
};

export function formatDateTime(iso: string | null | undefined, opts: DateTimeOptions = {}): string {
  const d = safeDate(iso);
  if (!d) return "—";
  let timeZone = zoneOf(opts.timeZone);
  const build = (tz: string | undefined) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(opts.withYear ? { year: "numeric" } : {}),
      hour: "numeric",
      minute: "2-digit",
      ...(opts.withSeconds ? { second: "2-digit" } : {}),
      ...(opts.withZone ? { timeZoneName: "short" } : {}),
      ...(tz ? { timeZone: tz } : {}),
    }).formatToParts(d);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = build(timeZone);
  } catch {
    timeZone = undefined;
    parts = build(undefined);
  }
  const get = (type: Intl.DateTimeFormatPart["type"]) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("month")} ${get("day")}${opts.withYear ? `, ${get("year")}` : ""}`;
  const time = `${get("hour")}:${get("minute")}${opts.withSeconds ? `:${get("second")}` : ""} ${get("dayPeriod")}`.trim();
  const zone = opts.withZone ? ` ${get("timeZoneName")}` : "";
  return opts.withYear ? `${date} at ${time}${zone}` : `${date}, ${time}${zone}`;
}

export function formatTime(iso: string | null | undefined, timeZone?: string | null): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const tz = zoneOf(timeZone);
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", ...(tz ? { timeZone: tz } : {}) }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(d);
  }
}

/** Short zone name for a column heading, e.g. "EDT" or "UTC". */
export function zoneLabel(timeZone: string | null | undefined, at: number): string {
  const tz = zoneOf(timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short", ...(tz ? { timeZone: tz } : {}) }).formatToParts(new Date(at));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
