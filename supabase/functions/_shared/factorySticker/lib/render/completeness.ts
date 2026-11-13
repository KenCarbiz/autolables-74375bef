// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/completeness.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { equipmentBase, selectedEquipmentLines, type FactoryStickerRenderData } from "./contract.ts";
import { sanitize, type EquipmentScope, type LayoutModel } from "./layout.ts";
export type ManifestCategory = "identity" | "pricing" | "option" | "package_member" | "standard_equipment" | "regulatory" | "disclosure";
export interface ManifestItem {
    category: ManifestCategory;
    label: string;
    expected: string;
}
export interface CompletenessReport {
    pass: boolean;
    code: "OK" | "LAYOUT_OVERFLOW" | "PDF_VALIDATION_FAILED";
    missing: ManifestItem[];
    miscounted: Array<{
        label: string;
        expected: string;
        expectedCount: number;
        actualCount: number;
    }>;
    checked: number;
}
const money = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
export function expectedStandardEquipment(data: FactoryStickerRenderData, scope: EquipmentScope = "full", lineCount = 0): string[] {
    if (scope === "selected") {
        return selectedEquipmentLines(data, lineCount).map((l) => sanitize(l.text)).filter(Boolean);
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const source of [data.standardEquipment, data.keyFeatures]) {
        for (const items of Object.values(source ?? {})) {
            for (const raw of items) {
                const item = sanitize(raw);
                if (!item || seen.has(item.toUpperCase()))
                    continue;
                seen.add(item.toUpperCase());
                out.push(item);
            }
        }
    }
    return out;
}
const verifiedLineSources = (data: FactoryStickerRenderData): Set<string> => new Set(equipmentBase(data).lines.flatMap((l) => l.sources.map((x) => sanitize(x).toUpperCase())));
export function buildContentManifest(data: FactoryStickerRenderData, scope: EquipmentScope = "full", optionCodes = true, lineCount = 0): ManifestItem[] {
    const items: ManifestItem[] = [];
    const push = (category: ManifestCategory, label: string, expected: string | null | undefined) => {
        const value = clean(String(expected ?? ""));
        if (value)
            items.push({ category, label, expected: value });
    };
    push("identity", "VIN", data.vin);
    push("identity", "Model year", data.identity.year);
    push("identity", "Make", data.identity.make.toUpperCase());
    push("identity", "Model", data.identity.model.toUpperCase());
    if (data.pricing.baseMsrp !== null) {
        push("pricing", "Base MSRP", `$${money(data.pricing.baseMsrp)}`);
    }
    if (data.pricing.totalMsrp !== null) {
        push("pricing", "Total MSRP", `$${money(data.pricing.totalMsrp)}`);
    }
    for (const opt of data.options) {
        push("option", `Option ${opt.code ?? opt.name}`, opt.name);
        if (opt.code && optionCodes)
            push("option", `Option code ${opt.code}`, opt.code);
        for (const member of opt.contents ?? []) {
            push("package_member", `${opt.name} — ${member}`, member);
        }
    }
    for (const pkg of data.packages) {
        push("option", `Package ${pkg.code ?? pkg.name}`, pkg.name);
        for (const member of pkg.contents ?? []) {
            push("package_member", `${pkg.name} — ${member}`, member);
        }
    }
    for (const item of expectedStandardEquipment(data, scope, lineCount)) {
        push("standard_equipment", `Standard equipment — ${item}`, item);
    }
    for (const row of data.partsContent ?? []) {
        push("regulatory", `Parts content — ${row.label}`, row.value.toUpperCase());
    }
    if (data.disclaimers?.length) {
        push("disclosure", "Reproduction disclosure", data.disclaimers[0]);
    }
    return items;
}
export function buildSingletonExpectations(data: FactoryStickerRenderData): Array<{
    label: string;
    expected: string;
    expectedCount: number;
}> {
    const out: Array<{
        label: string;
        expected: string;
        expectedCount: number;
    }> = [];
    const priced = data.options.filter((o) => (o.contents?.length ?? 0) > 0 && o.msrp !== null && o.msrp > 0);
    for (const pkg of priced) {
        out.push({ label: `Package ${pkg.name} listed once`, expected: clean(pkg.name), expectedCount: 1 });
    }
    return out;
}
export function checkRenderedCompleteness(data: FactoryStickerRenderData, model: LayoutModel): CompletenessReport {
    const drawn = model.drawnStrings.map(clean);
    const haystack = drawn.join(" ");
    const scope = model.fit.ok ? model.fit.equipmentScope ?? "full" : "full";
    const lineCount = model.fit.ok ? model.fit.equipmentCounts?.lines ?? 0 : 0;
    const manifest = buildContentManifest(data, scope, !(model.fit.ok && model.fit.figmaMaster), lineCount);
    const printedCounts = new Map<string, number>();
    for (const item of model.printedEquipment ?? []) {
        printedCounts.set(item.toUpperCase(), (printedCounts.get(item.toUpperCase()) ?? 0) + 1);
    }
    const missing = manifest.filter((item) => {
        if (item.category === "standard_equipment" && !printedCounts.has(item.expected.toUpperCase()))
            return true;
        if (drawn.includes(item.expected))
            return false;
        return !haystack.includes(item.expected);
    });
    const miscounted: CompletenessReport["miscounted"] = [];
    for (const expectation of buildSingletonExpectations(data)) {
        const actualCount = drawn.filter((s) => s === expectation.expected).length;
        if (actualCount !== expectation.expectedCount) {
            miscounted.push({ ...expectation, actualCount });
        }
    }
    for (const item of expectedStandardEquipment(data, scope, lineCount)) {
        const actualCount = printedCounts.get(item.toUpperCase()) ?? 0;
        if (actualCount > 1) {
            miscounted.push({ label: `Standard equipment ${item} listed once`, expected: item, expectedCount: 1, actualCount });
        }
    }
    if (scope === "selected") {
        const expected = new Set(expectedStandardEquipment(data, scope, lineCount).map((x) => x.toUpperCase()));
        for (const item of model.printedEquipment ?? []) {
            if (!expected.has(item.toUpperCase())) {
                miscounted.push({ label: `Printed equipment ${item} is not a selected verified line`, expected: item, expectedCount: 0, actualCount: 1 });
            }
        }
        const verified = verifiedLineSources(data);
        for (const line of selectedEquipmentLines(data, lineCount)) {
            for (const source of line.sources) {
                if (!verified.has(sanitize(source).toUpperCase())) {
                    miscounted.push({ label: `Selected line source ${source} is not verified`, expected: source, expectedCount: 0, actualCount: 1 });
                }
            }
        }
    }
    const pass = missing.length === 0 && miscounted.length === 0;
    return {
        pass,
        code: pass ? "OK" : missing.length ? "LAYOUT_OVERFLOW" : "PDF_VALIDATION_FAILED",
        missing,
        miscounted,
        checked: manifest.length,
    };
}
