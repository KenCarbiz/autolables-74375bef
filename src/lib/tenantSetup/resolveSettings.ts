// ──────────────────────────────────────────────────────────────────────
// Which layer supplied each dealer setting, and can we trust the answer.
//
// DealerSettingsContext merges five sources with a spread. That produces the
// right value but destroys the reason: once `settings.dealer_phone` is read,
// nothing can say whether it came from the dealer's own save, an Autocurb
// mirror, or a compiled default. A dealer looking at a wrong phone number on a
// printed document has no way to find out where it came from, and neither do
// we.
//
// Two distinctions this exists to preserve:
//
//   unsaved      — the effective value lives only in the browser cache. The
//                  cache is written BEFORE the server round-trip and is not
//                  rolled back when the save fails, so a value that never
//                  reached Postgres looks correct on every reload of that one
//                  browser. This is the flag that catches it.
//
//   indeterminate — a layer above the winner could not be read. The Autocurb
//                  mirror read is wrapped in a bare catch, so an RLS denial is
//                  indistinguishable from "no mirror exists" and the field
//                  quietly falls to a default. A field in this state must never
//                  be reported as "Default": we do not know that.
// ──────────────────────────────────────────────────────────────────────

/** Lowest to highest precedence. The order is load-bearing. */
export const SETTINGS_LAYERS = [
  "default",
  "tenant_profile",
  "autocurb_mirror",
  "onboarding_profile",
  "local_cache",
  "saved",
] as const;

export type SettingsLayer = (typeof SETTINGS_LAYERS)[number];

export interface LayerInput<T> {
  layer: SettingsLayer;
  /** Only the keys this layer actually supplies. Mappers must drop empties. */
  values: Partial<T>;
  /** false when the layer could not be read at all — not the same as empty. */
  readable?: boolean;
}

export interface FieldProvenance<K> {
  key: K;
  /** The layer whose value is in effect. */
  layer: SettingsLayer;
  /** Every layer that offered a value, lowest to highest. */
  contributors: SettingsLayer[];
  /** Effective value came from the browser cache and is not in the DB row. */
  unsaved: boolean;
  /** From settings_meta. Null means saved before stamping existed. */
  savedBy: string | null;
  savedAt: string | null;
  /** A higher layer was unreadable, so `layer` is a floor rather than a fact. */
  indeterminate: boolean;
}

export interface ResolvedSettings<T> {
  settings: T;
  provenance: Record<string, FieldProvenance<keyof T>>;
  /** True when any layer was unreadable. Readiness must refuse to report ready. */
  anyLayerIndeterminate: boolean;
  /** Keys whose effective value never reached the server. */
  unsavedKeys: Array<keyof T>;
}

const rank = (l: SettingsLayer) => SETTINGS_LAYERS.indexOf(l);

/**
 * Merge the layers and record where every key came from.
 *
 * The merged object is byte-identical to the plain spread for the same inputs —
 * provenance is added alongside, never at the cost of changing a rendered value.
 */
export function resolveDealerSettings<T extends Record<string, unknown>>(
  layers: Array<LayerInput<T>>,
  meta?: Record<string, { by?: string | null; at?: string | null }>,
): ResolvedSettings<T> {
  const ordered = [...layers].sort((a, b) => rank(a.layer) - rank(b.layer));

  const settings = {} as T;
  const contributors = new Map<string, SettingsLayer[]>();
  const winner = new Map<string, SettingsLayer>();

  // The highest unreadable layer. Anything winning below it is a floor, not a
  // fact — the unreadable layer may have held the real value.
  let highestUnreadable = -1;
  let anyLayerIndeterminate = false;
  for (const l of ordered) {
    if (l.readable === false) {
      anyLayerIndeterminate = true;
      highestUnreadable = Math.max(highestUnreadable, rank(l.layer));
    }
  }

  for (const l of ordered) {
    if (l.readable === false) continue;
    for (const [k, v] of Object.entries(l.values ?? {})) {
      if (v === undefined) continue;
      (settings as Record<string, unknown>)[k] = v;
      const seen = contributors.get(k) ?? [];
      seen.push(l.layer);
      contributors.set(k, seen);
      winner.set(k, l.layer);
    }
  }

  const provenance: Record<string, FieldProvenance<keyof T>> = {};
  const unsavedKeys: Array<keyof T> = [];

  for (const [k, layer] of winner) {
    const stamp = meta?.[k];
    const unsaved = layer === "local_cache";
    if (unsaved) unsavedKeys.push(k as keyof T);
    provenance[k] = {
      key: k as keyof T,
      layer,
      contributors: contributors.get(k) ?? [],
      unsaved,
      // A key present in `saved` with no stamp predates the meta column. Report
      // that honestly as unknown rather than attributing it to whoever last
      // touched the row.
      savedBy: layer === "saved" ? (stamp?.by ?? null) : null,
      savedAt: layer === "saved" ? (stamp?.at ?? null) : null,
      indeterminate: rank(layer) < highestUnreadable,
    };
  }

  // A key no readable layer supplied, but which an unreadable layer might have.
  // It has no value and no honest origin, so it is indeterminate too.
  if (highestUnreadable >= 0) {
    for (const l of ordered) {
      if (l.readable !== false) continue;
      for (const k of Object.keys(l.values ?? {})) {
        if (provenance[k]) continue;
        provenance[k] = {
          key: k as keyof T, layer: "default", contributors: [],
          unsaved: false, savedBy: null, savedAt: null, indeterminate: true,
        };
      }
    }
  }

  return { settings, provenance, anyLayerIndeterminate, unsavedKeys };
}
