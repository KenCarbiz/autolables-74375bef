// ── Customer payment preferences (per-vehicle, per-session) ─────────────────
// When a shopper customizes the payment on the Today's Price ladder (down / term
// / example APR), we remember it for THIS vehicle for the rest of the browsing
// session so the passport's estimate reflects what they just entered instead of
// snapping back to the dealer default. It is deliberately sessionStorage (not
// localStorage): a transient "your scenario", cleared when the tab closes and
// resettable on demand. It stores only illustrative assumptions — never an
// approved rate or an offer.

import type { VehicleListing } from "@/hooks/useVehicleListing";

export interface PaymentPrefs {
  down: number;
  term: number;
  apr: number;
  savedAt: number;
}

const KEY_PREFIX = "al_pay_prefs:";

type VehicleKeyFields = Pick<VehicleListing, "vin" | "slug" | "id"> | null | undefined;

const keyFor = (l: VehicleKeyFields): string | null => {
  const id = l?.vin || l?.slug || l?.id;
  return id ? `${KEY_PREFIX}${id}` : null;
};

export function savePaymentPrefs(l: VehicleKeyFields, prefs: Omit<PaymentPrefs, "savedAt">): void {
  const k = keyFor(l);
  if (!k || typeof sessionStorage === "undefined") return;
  if (![prefs.down, prefs.term, prefs.apr].every((n) => typeof n === "number" && Number.isFinite(n))) return;
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
    if (typeof p?.down === "number" && typeof p?.term === "number" && typeof p?.apr === "number"
        && Number.isFinite(p.down) && Number.isFinite(p.term) && Number.isFinite(p.apr)) {
      return { down: p.down, term: p.term, apr: p.apr, savedAt: typeof p.savedAt === "number" ? p.savedAt : 0 };
    }
    return null;
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
