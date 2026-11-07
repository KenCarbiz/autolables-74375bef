// Matches a listing to one fueleconomy.gov vehicle record without guessing.
//
// The previous matcher took the first EPA model whose name started with the
// listing's model and then the highest-scoring option even when every option
// contradicted the car, so gas F-150s landed on the F-150 Lightning, a Grand
// Cherokee 4xe and a Fusion Hybrid landed on gas engines, and 4WD QX80s landed
// on the 2WD record. This version scores every (model, option) pair together
// and enforces three rules:
//   * A known fact on the listing (powertrain, drivetrain, engine liters) that
//     contradicts the candidate rejects that candidate outright.
//   * The fetched record's own atvType must agree with the listing's
//     powertrain; a name alone never decides it.
//   * When candidates that could both be this car disagree on MPG, or span
//     different powertrains while the listing's powertrain is unknown, nothing
//     is matched. No EPA data is better than another vehicle's EPA data.
// Pure apart from the injected EPA client, so tests drive it with fixtures.

export const EPA_MATCHER_VERSION = "epa-match-v2";

export type Powertrain = "ev" | "phev" | "hybrid" | "mild_hybrid" | "gas" | "diesel";
export type Drive = "4" | "2";

export interface ListingFacts {
  year: string;
  make: string;
  model: string;
  trim: string | null;
  liters: string | null;
  drive: Drive | null;
  powertrain: Powertrain | null;
}

export interface MenuItem { text: string; value: string }

export interface EpaVehicle {
  id: number | string;
  atvType?: string | null;
  fuelType?: string | null;
  fuelType1?: string | null;
  city08?: unknown;
  highway08?: unknown;
  comb08?: unknown;
  [k: string]: unknown;
}

export interface EpaClient {
  models(year: string, make: string): Promise<MenuItem[]>;
  options(year: string, make: string, model: string): Promise<MenuItem[]>;
  vehicle(id: string): Promise<EpaVehicle | null>;
}

export type MatchRefusal =
  | "missing_ymm"
  | "no_model_match"
  | "no_option_match"
  | "ambiguous_powertrain"
  | "ambiguous_option"
  | "powertrain_unverified";

export interface MatchResult {
  vehicle: EpaVehicle;
  model: string;
  option: string;
  basis: {
    matcher_version: string;
    powertrain: Powertrain | null;
    record_powertrain: Powertrain;
    drive: Drive | null;
    liters: string | null;
    candidates: number;
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);

export function litersOf(s: string | null | undefined): string | null {
  const m = String(s ?? "").match(/(\d\.\d)\s*-?\s*l(?![a-z])/i);
  return m ? m[1] : null;
}

export function driveOf(s: string | null | undefined): Drive | null {
  const t = String(s ?? "").toLowerCase();
  if (/\b(awd|4wd|4x4|all.?wheel|four.?wheel|quattro|xdrive|4matic|4motion|sh-awd)\b/.test(t)) return "4";
  if (/\b(fwd|rwd|2wd|4x2|front.?wheel|rear.?wheel|two.?wheel)\b/.test(t)) return "2";
  return null;
}

/** Powertrain as the listing's own decode states it; null when it says nothing. */
export function listingPowertrain(input: { powertrainType?: unknown; fuelType?: unknown; trim?: unknown; model?: unknown }): Powertrain | null {
  const pt = String(input.powertrainType ?? "").trim().toUpperCase();
  const fuel = String(input.fuelType ?? "").trim().toLowerCase();
  const text = `${input.model ?? ""} ${input.trim ?? ""}`.toLowerCase();
  if (pt === "BEV" || pt === "EV" || fuel === "electric") return "ev";
  if (pt === "PHEV" || /\b(4xe|plug-?in|phev|energi|prime)\b/.test(text)) return "phev";
  if (pt === "HEV" || pt === "FHEV" || /\bhybrid\b/.test(text)) return "hybrid";
  if (pt === "MHEV") return "mild_hybrid";
  if (/diesel/.test(fuel) || pt === "DIESEL") return "diesel";
  if (pt === "COMBUSTION" || pt === "ICE") return "gas";
  return null;
}

/** Powertrain an EPA model/option name claims, or null when the name says nothing. */
export function namedPowertrain(text: string): Powertrain | null {
  const t = text.toLowerCase();
  if (/\b(4xe|plug-?in|phev|energi)\b/.test(t) || /\bprime\b/.test(t)) return "phev";
  if (/\b(lightning|electric|ev|bev|e-tron|ioniq [56]|bolt)\b/.test(t)) return "ev";
  if (/\b(hybrid|hev)\b/.test(t)) return "hybrid";
  if (/\bdiesel\b/.test(t)) return "diesel";
  return null;
}

/** Powertrain the fetched record itself states. */
export function recordPowertrain(v: EpaVehicle): Powertrain {
  const atv = String(v.atvType ?? "").toLowerCase();
  const fuel = `${v.fuelType ?? ""} ${v.fuelType1 ?? ""}`.toLowerCase();
  if (atv === "ev" || String(v.fuelType1 ?? "").toLowerCase() === "electricity") return "ev";
  if (atv.includes("plug-in") || fuel.includes("or electricity")) return "phev";
  if (atv === "hybrid") return "hybrid";
  if (atv === "diesel" || fuel.includes("diesel")) return "diesel";
  return "gas";
}

const compatible = (listing: Powertrain, record: Powertrain): boolean =>
  listing === record || (listing === "mild_hybrid" && (record === "gas" || record === "hybrid"));

const mpgKey = (v: EpaVehicle) => `${v.city08 ?? ""}/${v.highway08 ?? ""}/${v.comb08 ?? ""}`;

interface Candidate { model: string; option: MenuItem; score: number; named: Powertrain | null }

export async function matchEpa(f: ListingFacts, api: EpaClient, maxFetches = 6): Promise<MatchResult | { refused: MatchRefusal }> {
  if (!/^\d{4}$/.test(f.year) || !f.make || !f.model) return { refused: "missing_ymm" };
  const target = norm(f.model);
  const all = (await api.models(f.year, f.make)).map((m) => m.text);
  let models = all.filter((m) => norm(m).startsWith(target) || (target.startsWith(norm(m)) && norm(m).length >= 3));
  if (!models.length) {
    const first = norm(f.model.split(/\s+/)[0] ?? "");
    models = first ? all.filter((m) => norm(m.split(/\s+/)[0] ?? "") === first) : [];
  }
  if (!models.length) return { refused: "no_model_match" };

  const trimWords = new Set(words(f.trim ?? ""));
  const candidates: Candidate[] = [];
  for (const m of models) {
    for (const o of await api.options(f.year, f.make, m)) {
      const text = `${m} ${o.text}`;
      const named = namedPowertrain(text);
      const drive = driveOf(text);
      const liters = litersOf(o.text);
      if (f.powertrain && named && !compatible(f.powertrain, named)) continue;
      if (f.drive && drive && drive !== f.drive) continue;
      if (f.liters && liters && liters !== f.liters) continue;
      let score = 0;
      if (f.powertrain && named && compatible(f.powertrain, named)) score += 3;
      if (f.drive && drive === f.drive) score += 2;
      if (f.liters && liters === f.liters) score += 2;
      for (const w of words(m)) {
        if (target.includes(norm(w)) || driveOf(w)) continue;
        if (namedPowertrain(w) && f.powertrain && named && compatible(f.powertrain, named)) continue;
        score += trimWords.has(w) ? 2 : -1;
      }
      candidates.push({ model: m, option: o, score, named });
    }
  }
  if (!candidates.length) return { refused: "no_option_match" };

  // Without a stated powertrain, a model line that also comes as a hybrid,
  // plug-in or EV cannot be told apart by name, and the MPG differs by a lot.
  if (!f.powertrain && new Set(candidates.map((c) => c.named ?? "gas")).size > 1) return { refused: "ambiguous_powertrain" };
  // A hybrid, plug-in or EV listing whose line has an explicitly named
  // variant uses that variant; an unnamed one is checked against its record.
  let pool = candidates;
  if (f.powertrain && f.powertrain !== "gas" && f.powertrain !== "mild_hybrid") {
    const named = candidates.filter((c) => c.named === f.powertrain);
    if (named.length) pool = named;
  }

  pool.sort((a, b) => b.score - a.score || (a.model + a.option.text < b.model + b.option.text ? -1 : 1));
  const top = pool.filter((c) => c.score === pool[0].score);

  const verified: { c: Candidate; v: EpaVehicle; rp: Powertrain }[] = [];
  let fetches = 0;
  for (const c of top) {
    if (fetches >= maxFetches) return { refused: "ambiguous_option" };
    fetches++;
    const v = await api.vehicle(c.option.value);
    if (!v || v.id == null) continue;
    const rp = recordPowertrain(v);
    if (f.powertrain ? !compatible(f.powertrain, rp) : rp !== (c.named ?? "gas")) continue;
    verified.push({ c, v, rp });
  }
  if (!verified.length) return { refused: "powertrain_unverified" };
  if (new Set(verified.map((x) => mpgKey(x.v))).size > 1) return { refused: "ambiguous_option" };
  if (!f.powertrain && new Set(verified.map((x) => x.rp)).size > 1) return { refused: "ambiguous_powertrain" };

  const best = verified[0];
  return {
    vehicle: best.v,
    model: best.c.model,
    option: best.c.option.text,
    basis: {
      matcher_version: EPA_MATCHER_VERSION,
      powertrain: f.powertrain,
      record_powertrain: best.rp,
      drive: f.drive,
      liters: f.liters,
      candidates: candidates.length,
    },
  };
}

/**
 * Whether a stored EPA record contradicts the car it is attached to. Used by
 * readers so a record written by the earlier matcher is not shown when the
 * listing's own decode disagrees with it.
 */
export function storedEpaConflict(
  record: { matchedOption?: unknown; fuelType?: unknown } | null | undefined,
  facts: { powertrain: Powertrain | null; drive: Drive | null; liters: string | null; text?: string | null },
): string | null {
  if (!record) return null;
  const option = String(record.matchedOption ?? "");
  const fuel = String(record.fuelType ?? "").toLowerCase();
  const stored: Powertrain | null =
    fuel === "electricity" ? "ev"
      : fuel.includes("or electricity") ? "phev"
        : namedPowertrain(option);
  // Older records do not keep atvType, and some hybrid-only lines (Venza) are
  // named without "Hybrid"; an unnamed gasoline record on a hybrid listing is
  // left to the engine and drivetrain checks rather than called a conflict.
  const unnamedOnHybrid = stored === null && facts.powertrain === "hybrid";
  if (facts.powertrain && !unnamedOnHybrid && !compatible(facts.powertrain, stored ?? "gas")) return "powertrain";
  // An electric or plug-in record needs the car itself to say so; a listing
  // whose decode is silent (a gas F-150 Lariat) is never shown EV figures.
  if (!facts.powertrain && (stored === "ev" || stored === "phev") && namedPowertrain(facts.text ?? "") !== stored) return "powertrain";
  const sd = driveOf(option);
  if (facts.drive && sd && sd !== facts.drive) return "drivetrain";
  const sl = litersOf(option.split("—")[1] ?? option);
  if (facts.liters && sl && sl !== facts.liters) return "engine";
  return null;
}
