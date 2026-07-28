// Provider payload shape drift detection.
//
// Every paid decode is already captured verbatim to neovin_snapshots, so we
// have the evidence to notice the day a provider changes its response shape —
// we just never looked at it. This is the alarm.
//
// It exists because of a real, expensive failure: NeoVIN returns `features`
// and `high_value_features` EITHER as a {category: [...]} map OR as a flat
// array. The parser accepted only the map form and silently discarded the
// array form, so `structuredSheet` returned null, `build_sheet` was written
// null, and the window sticker reported "no factory build data for this VIN"
// about vehicles the provider had answered 200 for. Nothing surfaced it,
// because a shape mismatch and a genuine coverage gap were indistinguishable
// downstream. Both burned paid decode attempts until the VIN was retired.
//
// Two questions are asked of every payload, and they need opposite responses:
//   * Did the provider send us nothing?      → a coverage gap. Stop retrying.
//   * Did the provider send us something we
//     failed to read?                        → OUR bug. Page us; never re-buy.

export type JsonType = "array" | "object" | "string" | "number" | "boolean" | "null" | "absent";

export interface PayloadShape {
  /** Sorted top-level key names — the stable identity of a response shape. */
  keys: string[];
  /** JSON type of each key the parser depends on. */
  dependencyTypes: Record<string, JsonType>;
  /** Rough size, used to tell a thin response from a rich one. */
  byteLength: number;
  keyCount: number;
}

export interface DriftFinding {
  kind: "parse_failure" | "dependency_missing" | "dependency_retyped" | "shape_changed";
  detail: string;
}

/**
 * Keys `structuredSheet` reads, and the types it can handle for each.
 * `features` / `high_value_features` accept both forms since the fix; listing
 * both here documents the contract rather than re-asserting one shape.
 */
export const NEOVIN_DEPENDENCIES: Record<string, JsonType[]> = {
  options_packages: ["array", "absent"],
  installed_options_details: ["array", "absent"],
  installed_options: ["array", "absent"],
  high_value_features: ["array", "object", "absent"],
  features: ["array", "object", "absent"],
  msrp: ["number", "string", "absent"],
  delivery_charges: ["number", "string", "absent"],
  combined_msrp: ["number", "string", "absent"],
};

const jsonType = (v: unknown): JsonType =>
  v === undefined ? "absent"
  : v === null ? "null"
  : Array.isArray(v) ? "array"
  : typeof v === "object" ? "object"
  : (typeof v as JsonType);

export function describeShape(
  payload: unknown,
  dependencies: Record<string, JsonType[]> = NEOVIN_DEPENDENCIES,
): PayloadShape {
  const obj = (payload && typeof payload === "object" && !Array.isArray(payload))
    ? payload as Record<string, unknown>
    : {};
  const keys = Object.keys(obj).sort();
  const dependencyTypes: Record<string, JsonType> = {};
  for (const k of Object.keys(dependencies)) dependencyTypes[k] = jsonType(obj[k]);
  let byteLength = 0;
  try { byteLength = JSON.stringify(payload ?? null).length; } catch { byteLength = 0; }
  return { keys, dependencyTypes, byteLength, keyCount: keys.length };
}

/** Stable identity for a response shape, so repeat observations collapse. */
export async function shapeHash(shape: PayloadShape): Promise<string> {
  const canonical = shape.keys.join(",") + "|" +
    Object.entries(shape.dependencyTypes).sort(([a], [b]) => a < b ? -1 : 1)
      .map(([k, t]) => `${k}:${t}`).join(",");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * A payload rich enough to contain equipment, from which we extracted none, is
 * our parser failing — not the provider having nothing. That distinction is
 * the whole point: one is a coverage gap to report to the dealer, the other is
 * a bug to fix, and they must never be reported as the same thing.
 */
const RICH_PAYLOAD_KEY_COUNT = 12;
const RICH_PAYLOAD_BYTES = 2_000;

export function detectDrift(
  shape: PayloadShape,
  opts: {
    /** Did structuredSheet produce a usable sheet from this payload? */
    parsedSheet: boolean;
    /** Top-level keys of the last shape we accepted for this endpoint. */
    priorKeys?: string[] | null;
    dependencies?: Record<string, JsonType[]>;
  },
): DriftFinding[] {
  const deps = opts.dependencies ?? NEOVIN_DEPENDENCIES;
  const out: DriftFinding[] = [];

  for (const [key, allowed] of Object.entries(deps)) {
    const actual = shape.dependencyTypes[key] ?? "absent";
    if (allowed.includes(actual)) continue;
    out.push({
      kind: actual === "absent" ? "dependency_missing" : "dependency_retyped",
      detail: actual === "absent"
        ? `${key} is absent; expected one of ${allowed.join("|")}`
        : `${key} arrived as ${actual}; the parser handles ${allowed.filter((a) => a !== "absent").join("|")}`,
    });
  }

  const rich = shape.keyCount >= RICH_PAYLOAD_KEY_COUNT || shape.byteLength >= RICH_PAYLOAD_BYTES;
  if (!opts.parsedSheet && rich) {
    out.push({
      kind: "parse_failure",
      detail: `provider returned ${shape.keyCount} keys / ${shape.byteLength} bytes and nothing was extracted — ` +
        `this is a parser gap, not a provider coverage gap`,
    });
  }

  if (opts.priorKeys?.length) {
    const prior = new Set(opts.priorKeys);
    const now = new Set(shape.keys);
    const removed = opts.priorKeys.filter((k) => !now.has(k));
    const added = shape.keys.filter((k) => !prior.has(k));
    if (removed.length || added.length) {
      out.push({
        kind: "shape_changed",
        detail: `top-level keys changed${removed.length ? `; removed: ${removed.slice(0, 8).join(", ")}` : ""}` +
          `${added.length ? `; added: ${added.slice(0, 8).join(", ")}` : ""}`,
      });
    }
  }

  return out;
}
