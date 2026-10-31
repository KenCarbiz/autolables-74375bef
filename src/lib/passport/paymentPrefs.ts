// ── Customer payment preferences (per-vehicle, per-session) ─────────────────
// When a shopper adjusts the payment on the Today's Price calculator (down,
// term, or their own assumed APR), we remember it for THIS vehicle for the rest
// of the browsing session so the passport's estimate reflects what they just
// entered instead of snapping back to the store default. It is deliberately
// sessionStorage (not localStorage): a transient "your scenario", cleared when
// the tab closes and resettable on demand. Each field is null until the shopper
// changes it, so the store's own rule supplies everything they did not touch.
// It stores only illustrative assumptions — never an approved rate or an offer.

import type { VehicleListing } from "@/hooks/useVehicleListing";

export interface PaymentPrefs {
  down: number | null;
  term: number | null;
  /** The shopper's own assumed APR. Null means the store's APR for the term. */
  apr: number | null;
  savedAt: number;
}

// v2: fields became nullable overrides. Earlier entries (always-filled example
// APR) are ignored rather than read as a shopper's chosen rate.
const KEY_PREFIX = "al_pay_prefs2:";

type VehicleKeyFields = Pick<VehicleListing, "vin" | "slug" | "id"> | null | undefined;

const keyFor = (l: VehicleKeyFields): string | null => {
  const id = l?.vin || l?.slug || l?.id;
  return id ? `${KEY_PREFIX}${id}` : null;
};

const okField = (n: unknown): n is number | null => n === null || (typeof n === "number" && Number.isFinite(n) && n >= 0);

export function savePaymentPrefs(l: VehicleKeyFields, prefs: Omit<PaymentPrefs, "savedAt">): void {
  const k = keyFor(l);
  if (!k || typeof sessionStorage === "undefined") return;
  if (![prefs.down, prefs.term, prefs.apr].every(okField)) return;
  try {
    sessionStorage.setItem(k, JSON.stringify({ ...prefs, savedAt: Date.now() }));
  } catch {
    // storage full / unavailable — a non-fatal best-effort persistence
  }
}

export function readPaymentPrefs(l: VehicleKeyFields): PaymentPrefs | null {
  const k = keyFor(l);
  if (!k || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(k);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PaymentPrefs>;
    const down = p?.down ?? null, term = p?.term ?? null, apr = p?.apr ?? null;
    if (![down, term, apr].every(okField)) return null;
    if (down === null && term === null && apr === null) return null;
    return { down, term, apr, savedAt: typeof p.savedAt === "number" ? p.savedAt : 0 };
  } catch {
    return null;
  }
}

export function clearPaymentPrefs(l: VehicleKeyFields): void {
  const k = keyFor(l);
  if (!k || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}
