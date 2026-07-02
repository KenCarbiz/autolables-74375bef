// Session breadcrumb for cross-listing browsing. When a shopper clicks
// through to a sibling listing (a dealer-alternative card), the vehicle they
// STARTED on is remembered so every subsequent passport can offer a way back.
// First vehicle wins — hopping A > B > C still returns to A. Cleared when the
// shopper returns to it or after 30 minutes.

const KEY = "al_passport_origin_v1";
const TTL_MS = 30 * 60 * 1000;

export interface PassportOrigin { slug: string; ymm: string; ts: number }

export const rememberPassportOrigin = (slug: string | null | undefined, ymm: string | null | undefined): void => {
  try {
    if (!slug || readPassportOrigin()) return;
    sessionStorage.setItem(KEY, JSON.stringify({ slug, ymm: ymm || "", ts: Date.now() }));
  } catch { /* storage unavailable — the bar simply never shows */ }
};

export const readPassportOrigin = (): PassportOrigin | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as PassportOrigin;
    if (!o?.slug || typeof o.ts !== "number" || Date.now() - o.ts > TTL_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return o;
  } catch { return null; }
};

export const clearPassportOrigin = (): void => {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};
