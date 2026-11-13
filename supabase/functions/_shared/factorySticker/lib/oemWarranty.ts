// GENERATED — do not edit.
// Mirror of src/lib/oemWarranty.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export interface OemFactoryWarranty {
    brand: string;
    basic_months: number;
    basic_miles: number;
    powertrain_months: number;
    powertrain_miles: number;
    corrosion_months?: number;
    corrosion_miles?: number;
    roadside_months?: number;
    roadside_miles?: number;
    ev_battery_months?: number;
    ev_battery_miles?: number;
    maintenance_months?: number;
    maintenance_miles?: number;
    powertrain_transfer_months?: number;
    powertrain_transfer_miles?: number;
    basic_transfer_months?: number;
    basic_transfer_miles?: number;
    notes?: string;
    verified: boolean;
    verified_at?: string;
    verified_by?: string;
}
export interface CpoProgram {
    id: string;
    name: string;
    kind: "oem" | "dealer";
    brand?: string;
    enabled: boolean;
    basic_months?: number;
    basic_miles?: number;
    powertrain_months?: number;
    powertrain_miles?: number;
    coverage_from: "in_service" | "purchase";
    deductible?: number;
    transferable?: boolean;
    max_age_years?: number;
    max_mileage?: number;
    inspection_points?: string;
    benefits?: string;
    disclosure?: string;
    show_on_passport: boolean;
}
export const UNLIMITED_MILES = -1;
export const isUnlimitedMiles = (n?: number): boolean => n === UNLIMITED_MILES;
export const finiteMiles = (n?: number): number | undefined => (n && n > 0 ? n : undefined);
export const milesLabel = (n?: number): string | null => n === UNLIMITED_MILES ? "Unlimited" : n && n > 0 ? `${(n / 1000).toFixed(0)}K mi` : null;
export const emptyOemWarranty = (brand = ""): OemFactoryWarranty => ({
    brand,
    basic_months: 36,
    basic_miles: 36000,
    powertrain_months: 60,
    powertrain_miles: 60000,
    verified: false,
});
export const emptyCpoProgram = (kind: "oem" | "dealer" = "oem"): CpoProgram => ({
    id: `cpo_${Math.abs(hashStr(kind + Date.now().toString())).toString(36)}`,
    name: kind === "oem" ? "Certified Pre-Owned" : "Dealer Certified",
    kind,
    enabled: true,
    coverage_from: "in_service",
    transferable: true,
    show_on_passport: true,
});
export const resolveFactoryWarranty = (warranties: OemFactoryWarranty[] | undefined, ymmOrMake: string | null | undefined, onlyVerified = true): OemFactoryWarranty | null => {
    const hay = `${ymmOrMake || ""}`.toUpperCase();
    if (!hay || !warranties?.length)
        return null;
    const candidates = warranties.filter((w) => {
        const b = `${w.brand || ""}`.trim().toUpperCase();
        return b.length > 1 && hay.includes(b);
    });
    if (!candidates.length)
        return null;
    const verified = candidates.find((w) => w.verified);
    return onlyVerified ? (verified ?? null) : (verified ?? candidates[0]);
};
export const factoryWarrantyToInfo = (w: OemFactoryWarranty, inServiceDate?: string, subsequentOwner = false) => {
    const basicMonths = subsequentOwner && w.basic_transfer_months ? w.basic_transfer_months : w.basic_months;
    const basicMiles = subsequentOwner && w.basic_transfer_miles ? w.basic_transfer_miles : w.basic_miles;
    const ptMonths = subsequentOwner && w.powertrain_transfer_months ? w.powertrain_transfer_months : w.powertrain_months;
    const ptMiles = subsequentOwner && w.powertrain_transfer_miles ? w.powertrain_transfer_miles : w.powertrain_miles;
    return {
        factory_months: basicMonths || undefined,
        factory_miles: finiteMiles(basicMiles),
        powertrain_months: ptMonths || undefined,
        powertrain_miles: finiteMiles(ptMiles),
        in_service_date: inServiceDate,
    };
};
export const matchCpoPrograms = (programs: CpoProgram[] | undefined, ymmOrMake: string | null | undefined): CpoProgram[] => {
    const hay = `${ymmOrMake || ""}`.toUpperCase();
    return (programs || []).filter((p) => {
        if (!p.enabled)
            return false;
        if (p.kind === "dealer")
            return true;
        const b = `${p.brand || ""}`.trim().toUpperCase();
        return b.length > 1 && hay.includes(b);
    });
};
export const warrantyHeadline = (w: OemFactoryWarranty): string => {
    const yr = (mo?: number) => (mo ? `${Math.round(mo / 12)} yr` : null);
    const basic = [yr(w.basic_months), milesLabel(w.basic_miles)].filter(Boolean).join(" / ");
    return basic || "Factory warranty";
};
export const formatCoverageTerm = (months?: number, miles?: number): string => {
    const time = months ? (months % 12 === 0 ? `${months / 12} yr` : `${months} mo`) : null;
    const mi = milesLabel(miles);
    return [time, mi].filter(Boolean).join(" / ") || "Included";
};
export type CoverageKey = "basic" | "powertrain" | "corrosion" | "roadside" | "ev_battery" | "maintenance";
export interface OemCoverageRow {
    key: CoverageKey;
    label: string;
    sub: string;
    term: string;
}
export const oemCoverageRows = (w: Partial<OemFactoryWarranty>): OemCoverageRow[] => {
    const rows: OemCoverageRow[] = [];
    const add = (key: CoverageKey, label: string, sub: string, mo?: number, mi?: number) => {
        if (mo || mi)
            rows.push({ key, label, sub, term: formatCoverageTerm(mo, mi) });
    };
    add("basic", "Bumper-to-Bumper", "Most vehicle components", w.basic_months, w.basic_miles);
    add("powertrain", "Powertrain", "Engine, transmission, drivetrain", w.powertrain_months, w.powertrain_miles);
    add("corrosion", "Corrosion / Rust-Through", "Body-panel perforation", w.corrosion_months, w.corrosion_miles);
    add("roadside", "Roadside Assistance", "Towing, lockout, jump-start", w.roadside_months, w.roadside_miles);
    add("ev_battery", "Hybrid / EV Battery", "High-voltage battery & components", w.ev_battery_months, w.ev_battery_miles);
    add("maintenance", "Complimentary Maintenance", "Factory scheduled service", w.maintenance_months, w.maintenance_miles);
    return rows;
};
function hashStr(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++)
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h;
}
