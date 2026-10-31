const zoneOf = (tz: string | null | undefined): string | undefined => (tz && tz.trim() ? tz.trim() : undefined);

const partsIn = (ms: number, timeZone: string | undefined) => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
};

const safeParts = (ms: number, tz: string | undefined) => {
  try {
    return partsIn(ms, tz);
  } catch {
    return partsIn(ms, undefined);
  }
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** ISO instant to a datetime-local value (YYYY-MM-DDTHH:mm) in the dealership zone. */
export function isoToZonedInput(iso: string | null | undefined, timeZone: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const p = safeParts(ms, zoneOf(timeZone));
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** A datetime-local value read as wall-clock time in the dealership zone, as an ISO instant. */
export function zonedInputToIso(value: string, timeZone: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const tz = zoneOf(timeZone);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = safeParts(guess, tz);
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += wall - shown;
  }
  return Number.isFinite(guess) ? new Date(guess).toISOString() : null;
}
