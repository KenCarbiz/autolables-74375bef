// GENERATED — do not edit.
// Mirror of src/lib/intelligence/marketPass/publicContract.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { findForbiddenKey, MARKETPASS_DEALER_CONTRACT_VERSION, MARKETPASS_PUBLIC_CONTRACT_VERSION, type EvidenceProvenance, type GaugeSegment, type MarketPassAssessment, type MarketPassDealerContract, type MarketPassPublicContract, type PublicEvidence, type PublicPriceFairness, type PublicVehicleConfidence, } from "./contracts.ts";
export class PublicContractLeakError extends Error {
    readonly path: string;
    constructor(path: string) {
        super(`public MarketPass contract carries a private key at ${path}`);
        this.name = "PublicContractLeakError";
        this.path = path;
    }
}
const publicEvidence = (list: EvidenceProvenance[]): PublicEvidence[] => list.map((e) => ({
    key: e.key,
    label: e.label,
    source: e.source,
    retrievedAt: e.retrievedAt,
    observedAt: e.observedAt,
    freshness: e.freshness,
}));
const segmentsCopy = (s: GaugeSegment[]): GaugeSegment[] => s.map((x) => ({ index: x.index, label: x.label, color: x.color }));
export function gaugeAriaLabel(name: string, label: string, segmentIndex: number | null, segmentCount: number, explanation: string): string {
    const position = segmentIndex != null ? `, segment ${segmentIndex + 1} of ${segmentCount}` : ", not rated";
    return `${name}: ${label}${position}. ${explanation}`;
}
export function toPublicContract(a: MarketPassAssessment): MarketPassPublicContract {
    const pf = a.priceFairness;
    const vc = a.vehicleConfidence;
    const priceFairness: PublicPriceFairness = {
        version: pf.version,
        state: pf.state,
        label: pf.label,
        explanation: pf.explanation,
        explanationWithoutPrice: pf.explanationWithoutPrice,
        segments: segmentsCopy(pf.segments),
        segmentIndex: pf.segmentIndex,
        ariaLabel: gaugeAriaLabel("Price Fairness", pf.label, pf.segmentIndex, pf.segments.length, pf.explanation),
        evidence: publicEvidence(pf.evidence),
        basis: pf.basis,
        benchmarkLabel: pf.benchmarkLabel,
        benchmarkIsEstimate: pf.benchmarkIsEstimate,
        deltaDollars: pf.state === "assessed" ? pf.deltaDollars : null,
        deltaPct: pf.state === "assessed" ? pf.deltaPct : null,
        deltaDenominator: pf.state === "assessed" ? pf.deltaDenominator : null,
        comparables: pf.comparables ? {
            analyzedCount: pf.comparables.analyzedCount,
            totalSearchMatches: pf.comparables.totalSearchMatches,
            geographyScope: pf.comparables.geography.scope,
            radiusMiles: pf.comparables.geography.radiusMiles,
            selection: pf.comparables.selection,
            description: pf.comparables.description,
        } : null,
    };
    const vehicleConfidence: PublicVehicleConfidence = {
        version: vc.version,
        state: vc.state,
        label: vc.label,
        explanation: vc.explanation,
        segments: segmentsCopy(vc.segments),
        segmentIndex: vc.segmentIndex,
        ariaLabel: gaugeAriaLabel("Vehicle Confidence", vc.label, vc.segmentIndex, vc.segments.length, vc.explanation),
        evidence: publicEvidence(vc.evidence),
        findings: [...vc.findings],
        gaps: [...vc.gaps],
    };
    const contract: MarketPassPublicContract = {
        contractVersion: MARKETPASS_PUBLIC_CONTRACT_VERSION,
        audience: "public",
        assessmentVersion: a.assessmentVersion,
        rulesStatus: a.rulesStatus,
        computedAt: a.computedAt,
        inputsHash: a.inputsHash,
        vehicle: { vin: a.vehicle.vin, vehicleType: a.vehicle.vehicleType },
        priceFairness,
        vehicleConfidence,
    };
    assertPublicContractClean(contract);
    return contract;
}
export function assertPublicContractClean(contract: unknown): void {
    const hit = findForbiddenKey(contract);
    if (hit)
        throw new PublicContractLeakError(hit);
}
export function toDealerContract(a: MarketPassAssessment): MarketPassDealerContract {
    return { contractVersion: MARKETPASS_DEALER_CONTRACT_VERSION, audience: "dealer", assessment: a };
}
