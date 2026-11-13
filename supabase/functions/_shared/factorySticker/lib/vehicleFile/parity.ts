// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/parity.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { currentDisplayedValues, type CurrentValue } from "./currentValues.ts";
import { CRITICAL_FIELDS, MUST_BE_FULLY_EXPLAINED, type CriticalField, type ParityClass, type ParityRow, type ParitySummary, type ResolvedField, type VehicleFileReadModel, } from "./readModelTypes.ts";
import { classifyParity } from "./resolveField.ts";
import { iso, str, type Row, type VehicleFileSources } from "./sources.ts";
export interface CompareVehicleOptions {
    current?: Record<CriticalField, CurrentValue> | null;
}
const RESOLVED_FIELD: Record<CriticalField, (model: VehicleFileReadModel) => ResolvedField<unknown>> = {
    vin: (m) => m.identity.vin,
    year: (m) => m.identity.year,
    make: (m) => m.identity.make,
    model: (m) => m.identity.model,
    trim: (m) => m.identity.trim,
    stock: (m) => m.dealerState.stock,
    mileage: (m) => m.dealerState.mileage,
    advertised_retail: (m) => m.pricing.advertisedRetail,
    msrp: (m) => m.pricing.msrpFactory,
    engine: (m) => m.identity.engine,
    drivetrain: (m) => m.identity.drivetrain,
    condition: (m) => m.dealerState.condition,
};
const normalise = (value: unknown): string => String(value ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/[^a-z0-9. ]/g, "")
    .trim();
const words = (value: unknown): string[] => normalise(value).split(" ").filter(Boolean);
const numberOf = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const describesSame = (a: unknown, b: unknown): boolean => {
    const na = normalise(a);
    const nb = normalise(b);
    if (!na || !nb)
        return false;
    return ` ${na} `.includes(` ${nb} `) || ` ${nb} `.includes(` ${na} `);
};
const DRIVETRAIN_WORDS: Record<string, string> = {
    awd: "all wheel drive",
    fwd: "front wheel drive",
    rwd: "rear wheel drive",
    "4wd": "four wheel drive",
    "4x4": "four wheel drive",
    "2wd": "two wheel drive",
    "4x2": "two wheel drive",
};
const expandDrivetrain = (value: unknown): string => words(value).map((word) => DRIVETRAIN_WORDS[word] ?? word).join(" ");
const CPO_WORDS = new Set(["cpo", "certified", "certified preowned", "certified pre owned"]);
const heldFact = (sources: VehicleFileSources, factKey: string): Row | null => {
    let held: Row | null = null;
    for (const fact of sources.facts) {
        if (str(fact.fact_key) !== factKey)
            continue;
        if (!held || (str(held.confidence) !== "VERIFIED" && str(fact.confidence) === "VERIFIED")) {
            held = fact;
        }
    }
    return held;
};
interface RuleContext {
    field: CriticalField;
    current: CurrentValue;
    currentAll: Record<CriticalField, CurrentValue>;
    resolved: ResolvedField<unknown>;
    model: VehicleFileReadModel;
    sources: VehicleFileSources;
}
interface Extras {
    expectedDifference?: string | null;
    currentKnownWrong?: string | null;
    resolvedKnownWrong?: string | null;
}
const olderLedgerCopy = (ctx: RuleContext, factKey: string): string | null => {
    if (!ctx.current.origin.includes("vehicle_facts"))
        return null;
    const fact = heldFact(ctx.sources, factKey);
    const wrote = fact ? iso(fact.observed_at) : null;
    const chosen = ctx.resolved.chosen;
    const observed = chosen?.observedAt ?? null;
    if (!wrote || !observed || observed <= wrote)
        return null;
    return `The Vehicle Truth card renders vehicle_facts fact_key='${factKey}' (${str(fact?.source_kind) ?? "source_kind unrecorded"}), `
        + `written by the orchestrator at ${wrote}. ${chosen?.provider ?? "The winning source"} observed `
        + `${JSON.stringify(ctx.resolved.value)} at ${observed}, after that write, so the card is showing an older copy. `
        + "vehicle_facts.observed_at is orchestration time and facts are never refreshed once the sticker is published "
        + "(SOURCE_TO_FACT_MATRIX \u00A75, \u00A76), so this comparison understates the copy's age.";
};
const RULES: Record<CriticalField, (ctx: RuleContext) => Extras> = {
    vin: () => ({}),
    year: () => ({}),
    make: () => ({}),
    model: () => ({}),
    trim: (ctx) => {
        const chosen = ctx.resolved.chosen;
        if (!chosen || chosen.source !== "neovin")
            return {};
        if (ctx.current.origin !== "vehicle_listings.trim")
            return {};
        if (!str(ctx.current.value) || !str(ctx.resolved.value))
            return {};
        return {
            expectedDifference: `The page prints the feed's trim from vehicle_listings.trim; the read model resolves ${chosen.provider} `
                + `(${chosen.origin}), which names the same trim in the manufacturer's own words. SOURCE_TO_FACT_MATRIX §8 `
                + "records a NeoVIN trim naming difference as an expected source difference, not a wrong value.",
        };
    },
    stock: (ctx) => {
        const chosen = ctx.resolved.chosen;
        if (!chosen || chosen.origin !== "vehicle_files.stock_number")
            return {};
        if (!ctx.current.origin.startsWith("vehicle_listings.mc_attributes"))
            return {};
        return {
            currentKnownWrong: `The client precedence reads mc_attributes.stock_no before the dealer's own record `
                + `(vehicleStockNumber.ts:32-47), so the page shows the feed echo ${JSON.stringify(ctx.current.value)} while `
                + `vehicle_files.stock_number — the only durable home of stock (SOURCE_TO_FACT_MATRIX §5 row 6) — says `
                + `${JSON.stringify(ctx.resolved.value)}.`,
        };
    },
    mileage: (ctx) => {
        const condition = str(ctx.model.dealerState.condition.value) ?? str(ctx.currentAll.condition.value);
        if (normalise(condition) !== "new")
            return {};
        const current = numberOf(ctx.current.value);
        const resolved = numberOf(ctx.resolved.value);
        const zeroAgainstNothing = (current === 0 && resolved === null) || (resolved === 0 && current === null);
        if (!zeroAgainstNothing)
            return {};
        return {
            expectedDifference: "On a new car the sync refuses to store a feed zero (marketcheck-sync/index.ts:1054) while "
                + "vehicle_files.mileage keeps 0 as a placeholder, so one side reports no reading and the other reports "
                + "zero miles. The Gate 1 maps classify the new-car 0-vs-null split as an expected source difference.",
        };
    },
    advertised_retail: (ctx) => {
        const current = numberOf(ctx.current.value);
        const resolved = numberOf(ctx.resolved.value);
        const fee = ctx.model.pricing.docFee.value;
        if (current !== null && resolved !== null && fee !== null && fee > 0) {
            if (Math.abs(current - resolved - fee) < 1) {
                return {
                    expectedDifference: `The page prints vehicle_listings.price (${current}), the fee-inclusive total this tenant advertises; `
                        + `the read model resolved ${resolved}, the same price before the ${fee} doc fee. Gate 1 owner decision 2: `
                        + "current retail is the fee-inclusive claim and the fee-exclusive ladder is a separate question, so the "
                        + "difference is the doc fee and nothing else.",
                };
            }
            if (Math.abs(resolved - current - fee) < 1) {
                return {
                    expectedDifference: `The page prints vehicle_listings.price (${current}) fee-exclusive while the read model resolved `
                        + `${resolved}, the same price with the ${fee} doc fee added. The difference is the doc fee and nothing `
                        + "else (Gate 1 owner decision 2).",
                };
            }
        }
        const chosen = ctx.resolved.chosen;
        const fromLedger = chosen
            ? chosen.origin.startsWith("vehicle_facts") || chosen.origin.startsWith("vehicle_snapshots")
            : false;
        if (fromLedger && current !== null && resolved !== null) {
            return {
                resolvedKnownWrong: `The winning candidate is the derived ledger copy at ${chosen?.origin}, which SOURCE_TO_FACT_MATRIX §5 `
                    + "row 8 shows disagreeing with vehicle_listings.price on 99 of 118 pilot vehicles and never refreshing "
                    + `once the sticker is published. The live column says ${current}.`,
            };
        }
        return {};
    },
    msrp: (ctx) => {
        const older = olderLedgerCopy(ctx, "total_msrp");
        return older ? { currentKnownWrong: older } : {};
    },
    engine: (ctx) => {
        const older = olderLedgerCopy(ctx, "engine");
        if (older)
            return { currentKnownWrong: older };
        if (!describesSame(ctx.current.value, ctx.resolved.value))
            return {};
        return {
            expectedDifference: `${ctx.resolved.chosen?.provider ?? "The winning source"} describes the same engine at a different length `
                + `than the value on the card: ${JSON.stringify(ctx.current.value)} against `
                + `${JSON.stringify(ctx.resolved.value)}. One string contains the other whole, so the two name one engine `
                + "(SOURCE_TO_FACT_MATRIX \u00A78: a NeoVIN/feed phrasing difference is not a wrong value).",
        };
    },
    drivetrain: (ctx) => {
        const older = olderLedgerCopy(ctx, "drivetrain");
        if (older)
            return { currentKnownWrong: older };
        const currentWords = expandDrivetrain(ctx.current.value);
        const resolvedWords = expandDrivetrain(ctx.resolved.value);
        if (currentWords && resolvedWords && currentWords === resolvedWords) {
            return {
                expectedDifference: `${JSON.stringify(ctx.current.value)} and ${JSON.stringify(ctx.resolved.value)} are the same drivetrain `
                    + "written two ways. SOURCE_TO_FACT_MATRIX \u00A78 calls this a semantic match; the contract's "
                    + "semanticallySame does not expand drive abbreviations, so it is reported here as a source difference.",
            };
        }
        if (!describesSame(ctx.current.value, ctx.resolved.value))
            return {};
        return {
            expectedDifference: `${ctx.resolved.chosen?.provider ?? "The winning source"} describes the same drivetrain at a different `
                + `length: ${JSON.stringify(ctx.current.value)} against ${JSON.stringify(ctx.resolved.value)}.`,
        };
    },
    condition: (ctx) => {
        const current = normalise(ctx.current.value);
        const resolved = normalise(ctx.resolved.value);
        if (!current || !resolved)
            return {};
        if (!CPO_WORDS.has(current) || !CPO_WORDS.has(resolved))
            return {};
        return {
            expectedDifference: `"${str(ctx.current.value)}" and "${str(ctx.resolved.value)}" are the same certified-pre-owned state under `
                + "two names; the listing column and the feed's is_certified flag use different vocabulary for it.",
        };
    },
};
const NEITHER = "Neither surface shows a value.";
export function compareVehicle(sources: VehicleFileSources, model: VehicleFileReadModel, opts: CompareVehicleOptions = {}): ParityRow[] {
    const currentAll = opts.current ?? currentDisplayedValues(sources);
    const rows: ParityRow[] = [];
    for (const field of CRITICAL_FIELDS) {
        const current = currentAll[field];
        const resolved = RESOLVED_FIELD[field](model);
        const chosen = resolved.chosen;
        let verdict: ParityClass;
        let explanation: string;
        try {
            const extras = RULES[field]({ field, current, currentAll, resolved, model, sources });
            const classified = classifyParity({
                currentValue: current.value,
                resolved,
                ...extras,
            });
            verdict = classified.verdict;
            explanation = classified.explanation;
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            verdict = "UNEXPLAINED";
            explanation = `The comparison for ${field} could not be completed (${detail}).`;
        }
        if (current.value == null && resolved.value == null) {
            explanation = `${NEITHER} Current path: ${current.origin}. Read model: ${resolved.reason}`;
        }
        rows.push({
            vin: model.vin,
            vehicleId: model.vehicleId,
            tenantId: model.tenantId,
            field,
            currentValue: current.value,
            currentOrigin: current.origin,
            resolvedValue: resolved.value,
            resolvedOrigin: chosen?.origin ?? null,
            resolvedProvider: chosen?.provider ?? null,
            freshness: resolved.freshness,
            observedAt: chosen?.observedAt ?? null,
            verdict,
            explanation: explanation || `No explanation was produced for ${field}.`,
        });
    }
    return rows;
}
export const PARITY_CLASSES: ParityClass[] = [
    "MATCH",
    "SEMANTIC_MATCH",
    "CURRENT_OLD_VALUE_WRONG",
    "NEW_VALUE_WRONG",
    "EXPECTED_SOURCE_DIFFERENCE",
    "UNEXPLAINED",
];
const zeroCounts = (): Record<ParityClass, number> => ({
    MATCH: 0,
    SEMANTIC_MATCH: 0,
    CURRENT_OLD_VALUE_WRONG: 0,
    NEW_VALUE_WRONG: 0,
    EXPECTED_SOURCE_DIFFERENCE: 0,
    UNEXPLAINED: 0,
});
export function summariseParity(rows: ParityRow[], activeVins: number, missingSources: string[] = []): ParitySummary {
    const byField: Record<string, Record<ParityClass, number>> = {};
    for (const field of CRITICAL_FIELDS)
        byField[field] = zeroCounts();
    const totals = zeroCounts();
    const unexplained: ParityRow[] = [];
    const vins = new Set<string>();
    let staleValues = 0;
    let conflicts = 0;
    for (const row of rows) {
        const key = row.vehicleId || row.vin;
        if (key)
            vins.add(key);
        if (!byField[row.field])
            byField[row.field] = zeroCounts();
        byField[row.field][row.verdict] += 1;
        totals[row.verdict] += 1;
        if (row.verdict === "UNEXPLAINED")
            unexplained.push(row);
        if (row.freshness === "STALE")
            staleValues += 1;
        if (row.freshness === "CONFLICTED")
            conflicts += 1;
    }
    const fullyExplained: Record<string, boolean> = {};
    for (const field of MUST_BE_FULLY_EXPLAINED) {
        fullyExplained[field] = (byField[field]?.UNEXPLAINED ?? 0) === 0;
    }
    const missing: Record<string, number> = {};
    for (const line of missingSources)
        missing[line] = (missing[line] ?? 0) + 1;
    return {
        activeVins,
        comparedVins: vins.size,
        byField,
        totals,
        unexplained,
        fullyExplained,
        staleValues,
        conflicts,
        missingSources: missing,
    };
}
