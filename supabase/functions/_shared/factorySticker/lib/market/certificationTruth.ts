// GENERATED — do not edit.
// Mirror of src/lib/market/certificationTruth.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type CertificationState = "certified" | "not_certified" | "unknown";
export type CertificationAuthority = "manufacturer" | "dealer_confirmed" | "provider_derived" | "none";
const AUTHORITATIVE: CertificationAuthority[] = ["manufacturer", "dealer_confirmed"];
export const isAuthoritativeCertificationSource = (a: CertificationAuthority): boolean => AUTHORITATIVE.includes(a);
export interface InternalCertificationRecord {
    state?: CertificationState | null;
    authority?: CertificationAuthority | null;
    program?: string | null;
}
export interface ProviderCertificationRead {
    value: boolean | null;
    malformed: boolean;
}
export interface CertificationResolution {
    certified: CertificationState;
    authority: CertificationAuthority;
    program: string | null;
    providerEcho: boolean | null;
    providerMalformed: boolean;
    conflict: boolean;
    quarantineProviderAttribute: boolean;
    reasons: string[];
}
export function readProviderCertification(value: unknown): ProviderCertificationRead {
    if (value === null || value === undefined)
        return { value: null, malformed: false };
    if (typeof value === "boolean")
        return { value, malformed: false };
    if (typeof value === "number") {
        if (value === 1)
            return { value: true, malformed: false };
        if (value === 0)
            return { value: false, malformed: false };
        return { value: null, malformed: true };
    }
    if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (s === "true" || s === "1")
            return { value: true, malformed: false };
        if (s === "false" || s === "0")
            return { value: false, malformed: false };
        return { value: null, malformed: true };
    }
    return { value: null, malformed: true };
}
const normalizeState = (s: unknown): CertificationState => s === "certified" || s === "not_certified" ? s : "unknown";
export function resolveCertification(input: {
    internal?: InternalCertificationRecord | null;
    providerValue?: unknown;
}): CertificationResolution {
    const reasons: string[] = [];
    const internalState = normalizeState(input.internal?.state);
    const internalAuthority: CertificationAuthority = input.internal?.authority ?? "none";
    const authoritative = internalState !== "unknown" && isAuthoritativeCertificationSource(internalAuthority);
    const read = readProviderCertification(input.providerValue);
    if (read.malformed)
        reasons.push("provider_certification_malformed");
    else if (read.value === null)
        reasons.push("provider_certification_missing");
    else
        reasons.push(`provider_certification_${read.value}`);
    const program = authoritative && internalState === "certified"
        ? (typeof input.internal?.program === "string" && input.internal.program.trim() !== ""
            ? input.internal.program.trim()
            : null)
        : null;
    if (!authoritative) {
        if (internalState !== "unknown") {
            reasons.push(`internal_certification_${internalState}_not_authoritative`);
        }
        else {
            reasons.push("internal_certification_unknown");
        }
        if (read.value !== null)
            reasons.push("provider_certification_recorded_as_claim_only");
        return {
            certified: internalState !== "unknown" && internalAuthority === "provider_derived"
                ? "unknown"
                : internalState,
            authority: internalAuthority,
            program: null,
            providerEcho: read.value,
            providerMalformed: read.malformed,
            conflict: false,
            quarantineProviderAttribute: read.malformed,
            reasons,
        };
    }
    reasons.push(`internal_certification_${internalState}_by_${internalAuthority}`);
    const contradicts = read.value !== null
        && ((internalState === "certified" && read.value === false)
            || (internalState === "not_certified" && read.value === true));
    if (contradicts) {
        reasons.push("provider_certification_conflicts_with_authoritative_record");
        reasons.push("provider_certification_quarantined");
    }
    else if (read.value !== null) {
        reasons.push("provider_certification_corroborates");
    }
    return {
        certified: internalState,
        authority: internalAuthority,
        program,
        providerEcho: read.value,
        providerMalformed: read.malformed,
        conflict: contradicts,
        quarantineProviderAttribute: contradicts || read.malformed,
        reasons,
    };
}
export function isCertificationRegression(before: CertificationState, after: CertificationState): boolean {
    return before === "certified" && after !== "certified";
}
export interface StoredCertification {
    certified?: unknown;
    source?: unknown;
    program_name?: unknown;
    verified_at?: unknown;
    provider_echo?: unknown;
    provider_conflict?: unknown;
    provider_quarantined?: unknown;
    resolved_at?: unknown;
    [key: string]: unknown;
}
export function authorityForStoredSource(source: unknown): CertificationAuthority {
    const s = typeof source === "string" ? source.trim().toLowerCase() : "";
    if (s === "manufacturer" || s === "oem")
        return "manufacturer";
    if (s === "dealer_vdp" || s === "dealer" || s === "dealer_confirmed")
        return "dealer_confirmed";
    if (s === "marketcheck" || s === "feed" || s === "provider")
        return "provider_derived";
    return "none";
}
export function internalCertificationFromRow(row: {
    certification?: StoredCertification | null;
    condition?: unknown;
}): InternalCertificationRecord {
    const stored = row.certification ?? null;
    const storedFlag = stored ? readProviderCertification(stored.certified) : { value: null, malformed: false };
    if (stored && storedFlag.value !== null) {
        return {
            state: storedFlag.value ? "certified" : "not_certified",
            authority: authorityForStoredSource(stored.source),
            program: typeof stored.program_name === "string" ? stored.program_name : null,
        };
    }
    const condition = typeof row.condition === "string" ? row.condition.trim().toLowerCase() : "";
    if (condition === "cpo")
        return { state: "certified", authority: "provider_derived", program: null };
    if (condition === "new" || condition === "used") {
        return { state: "not_certified", authority: "provider_derived", program: null };
    }
    return { state: "unknown", authority: "none", program: null };
}
const sameValue = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);
export function mergeResolvedCertification(prior: StoredCertification | null | undefined, resolution: CertificationResolution, now: string): StoredCertification | null {
    const before = prior ?? null;
    const priorFlag = before ? readProviderCertification(before.certified) : { value: null, malformed: false };
    const priorState: CertificationState = priorFlag.value === null
        ? "unknown"
        : priorFlag.value ? "certified" : "not_certified";
    if (isCertificationRegression(priorState, resolution.certified))
        return null;
    if (!before && resolution.certified === "unknown" && resolution.providerEcho === null)
        return null;
    const next: StoredCertification = {
        ...(before ?? {}),
        certified: resolution.certified === "unknown" ? (before?.certified ?? null) : resolution.certified === "certified",
        provider_echo: resolution.providerEcho,
        provider_conflict: resolution.conflict,
        provider_quarantined: resolution.quarantineProviderAttribute,
        resolved_at: now,
    };
    if (before?.source)
        next.source = before.source;
    else if (resolution.authority !== "none")
        next.source = resolution.authority;
    if (resolution.program && !before?.program_name)
        next.program_name = resolution.program;
    if (before && ["certified", "provider_echo", "provider_conflict", "provider_quarantined", "source", "program_name"]
        .every((k) => sameValue(before[k], next[k]))) {
        return null;
    }
    return next;
}
