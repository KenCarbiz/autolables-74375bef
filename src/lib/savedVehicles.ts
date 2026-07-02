// ── Saved vehicles — real on-device persistence ──────────────────────────────
// The passport's Save action previously fired a success toast and stored
// nothing. This keeps an honest localStorage shortlist so a lot shopper who
// scans several stickers can get back to the cars they liked. No identity,
// nothing leaves the device.

export interface SavedVehicle {
  slug: string;
  ymm: string | null;
  trim: string | null;
  price: number | null;
  image: string | null;
  savedAt: string;
}

const KEY = "al_saved_vehicles_v1";
const MAX = 30;

export const listSavedVehicles = (): SavedVehicle[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((v) => v && typeof v.slug === "string") : [];
  } catch {
    return [];
  }
};

export const isVehicleSaved = (slug: string | null | undefined): boolean =>
  !!slug && listSavedVehicles().some((v) => v.slug === slug);

// Returns the new saved state (true = now saved).
export const toggleSavedVehicle = (v: Omit<SavedVehicle, "savedAt">): boolean => {
  try {
    const list = listSavedVehicles();
    const existing = list.findIndex((x) => x.slug === v.slug);
    if (existing >= 0) {
      list.splice(existing, 1);
      localStorage.setItem(KEY, JSON.stringify(list));
      return false;
    }
    list.unshift({ ...v, savedAt: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    return true;
  } catch {
    return false; // storage unavailable (private mode)
  }
};
