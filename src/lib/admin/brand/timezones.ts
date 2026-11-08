import { US_TIME_ZONES } from "@/pages/admin/views/brand/brandModel";

export function isValidTimeZone(id: string): boolean {
  if (!id || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(id)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/** United States zones first, then every other IANA zone the runtime knows, plus the saved value if it is neither. */
export function timeZoneGroups(current: string): { us: Array<{ id: string; label: string }>; other: string[]; unknownCurrent: string | null } {
  const usIds = new Set(US_TIME_ZONES.map((z) => z.id));
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  const other = all.filter((z) => !usIds.has(z) && z.includes("/"));
  const known = usIds.has(current) || other.includes(current);
  return { us: [...US_TIME_ZONES], other, unknownCurrent: current && !known ? current : null };
}
