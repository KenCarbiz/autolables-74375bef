// GENERATED — do not edit.
// Mirror of src/lib/warranty/inServiceEvidence.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
const day = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim().slice(0, 10) : null;
export function listingHistoryProxyDates(history: unknown): Set<string> {
    const h = (history && typeof history === "object" ? history : {}) as Record<string, unknown>;
    const out = new Set<string>();
    for (const v of [h.inServiceDate, h.firstSeen, h.firstNewListingSeen]) {
        const d = day(v);
        if (d)
            out.add(d);
    }
    for (const e of Array.isArray(h.entries) ? (h.entries as unknown[]) : []) {
        const d = day((e as Record<string, unknown> | null)?.first_seen);
        if (d)
            out.add(d);
    }
    return out;
}
export function verifiedInServiceDate(stored: unknown, history: unknown): string | null {
    const d = day(stored);
    if (!d)
        return null;
    return listingHistoryProxyDates(history).has(d) ? null : d;
}
