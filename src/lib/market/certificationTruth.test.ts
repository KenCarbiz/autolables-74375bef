// ── A provider cannot decertify a car ──────────────────────────────────────
//
// The QX50 is a CPO INFINITI whose stored customer payload says
// `"is_certified": false`. That value is regenerated nightly and it is wrong.
//
// Two mistakes produce it, and the rules below refuse both symmetrically:
// reading a MISSING field as a denial, and letting a downstream feed outrank
// the dealer who certified the car. The reverse — a provider CONFERRING
// certification — is refused just as firmly, because "certified" is a warranty
// claim with a manufacturer program behind it.

import { describe, it, expect } from "vitest";
import {
  resolveCertification, readProviderCertification, isCertificationRegression,
  isAuthoritativeCertificationSource,
  type CertificationState,
} from "./certificationTruth.ts";

const cpo = { state: "certified" as CertificationState, authority: "dealer_confirmed" as const };
const notCpo = { state: "not_certified" as CertificationState, authority: "dealer_confirmed" as const };

describe("readProviderCertification", () => {
  it("reads the documented spellings of each answer", () => {
    for (const yes of [true, 1, "true", "TRUE", " 1 "]) {
      expect(readProviderCertification(yes), String(yes)).toEqual({ value: true, malformed: false });
    }
    for (const no of [false, 0, "false", "FALSE", " 0 "]) {
      expect(readProviderCertification(no), String(no)).toEqual({ value: false, malformed: false });
    }
  });

  it("reads absence as missing, not as false", () => {
    for (const v of [null, undefined]) {
      expect(readProviderCertification(v)).toEqual({ value: null, malformed: false });
    }
  });

  it("reads anything unreadable as malformed, never as false", () => {
    for (const v of ["maybe", "", "  ", 2, -1, NaN, {}, [], ["true"]]) {
      const read = readProviderCertification(v);
      expect(read.value, JSON.stringify(v)).toBeNull();
      expect(read.malformed, JSON.stringify(v)).toBe(true);
    }
  });
});

describe("authority", () => {
  it("counts only the dealer and the manufacturer as authoritative", () => {
    expect(isAuthoritativeCertificationSource("dealer_confirmed")).toBe(true);
    expect(isAuthoritativeCertificationSource("manufacturer")).toBe(true);
    // Both of these are downstream of MarketCheck, so neither can corroborate
    // the other and neither can outrank the dealer.
    expect(isAuthoritativeCertificationSource("provider_derived")).toBe(false);
    expect(isAuthoritativeCertificationSource("none")).toBe(false);
  });
});

describe("resolveCertification", () => {
  it("known CPO + provider false → stays certified, and the conflict is recorded", () => {
    const r = resolveCertification({ internal: cpo, providerValue: false });
    expect(r.certified).toBe("certified");
    expect(r.conflict).toBe(true);
    expect(r.quarantineProviderAttribute).toBe(true);
    expect(r.providerEcho).toBe(false);
    expect(r.reasons).toContain("provider_certification_conflicts_with_authoritative_record");
  });

  it("known CPO + provider missing → stays certified, no conflict", () => {
    const r = resolveCertification({ internal: cpo, providerValue: undefined });
    expect(r.certified).toBe("certified");
    expect(r.conflict).toBe(false);
    expect(r.providerEcho).toBeNull();
    expect(r.reasons).toContain("provider_certification_missing");
  });

  it("known CPO + provider true → stays certified, and corroboration is noted", () => {
    const r = resolveCertification({ internal: cpo, providerValue: true });
    expect(r.certified).toBe("certified");
    expect(r.conflict).toBe(false);
    expect(r.quarantineProviderAttribute).toBe(false);
    expect(r.reasons).toContain("provider_certification_corroborates");
  });

  it("non-CPO + provider false → stays non-CPO", () => {
    const r = resolveCertification({ internal: notCpo, providerValue: false });
    expect(r.certified).toBe("not_certified");
    expect(r.conflict).toBe(false);
  });

  it("non-CPO + provider true → does NOT become certified", () => {
    // The symmetric rule. A feed cannot confer a manufacturer program.
    const r = resolveCertification({ internal: notCpo, providerValue: true });
    expect(r.certified).toBe("not_certified");
    expect(r.conflict).toBe(true);
    expect(r.quarantineProviderAttribute).toBe(true);
  });

  it("unknown internal + missing provider value → stays unknown", () => {
    const r = resolveCertification({ internal: null, providerValue: null });
    expect(r.certified).toBe("unknown");
    expect(r.conflict).toBe(false);
    expect(r.program).toBeNull();
  });

  it("unknown internal + a provider answer → still unknown, recorded as a claim", () => {
    for (const v of [true, false]) {
      const r = resolveCertification({ internal: null, providerValue: v });
      expect(r.certified, String(v)).toBe("unknown");
      expect(r.providerEcho).toBe(v);
      expect(r.reasons).toContain("provider_certification_recorded_as_claim_only");
    }
  });

  it("a provider-derived internal value is not promoted to an answer", () => {
    const r = resolveCertification({
      internal: { state: "not_certified", authority: "provider_derived" },
      providerValue: false,
    });
    // Two copies of the same provider opinion are still one provider opinion.
    expect(r.certified).toBe("unknown");
  });

  it("a malformed provider value is quarantined, never read as false", () => {
    const r = resolveCertification({ internal: cpo, providerValue: "maybe" });
    expect(r.certified).toBe("certified");
    expect(r.providerEcho).toBeNull();
    expect(r.providerMalformed).toBe(true);
    expect(r.quarantineProviderAttribute).toBe(true);
    expect(r.reasons).toContain("provider_certification_malformed");
  });

  it("keeps the raw provider evidence distinguishable from the resolved value", () => {
    const r = resolveCertification({ internal: cpo, providerValue: false });
    expect(r.certified).toBe("certified");
    expect(r.providerEcho).toBe(false);
    // Two fields, two meanings. Collapsing them is the bug.
    expect(r.certified === "certified" && r.providerEcho === false).toBe(true);
  });

  it("echoes a program only from an authoritative certified record, never invents one", () => {
    expect(resolveCertification({
      internal: { ...cpo, program: "INFINITI Certified Pre-Owned" }, providerValue: true,
    }).program).toBe("INFINITI Certified Pre-Owned");

    // No program on the record, and a provider that says "certified", is still
    // no program.
    expect(resolveCertification({ internal: cpo, providerValue: true }).program).toBeNull();
    expect(resolveCertification({ internal: null, providerValue: true }).program).toBeNull();
    expect(resolveCertification({
      internal: { ...cpo, program: "   " }, providerValue: true,
    }).program).toBeNull();
  });
});

describe("the nightly regression guard", () => {
  it("names the one transition a sweep may never perform", () => {
    expect(isCertificationRegression("certified", "not_certified")).toBe(true);
    expect(isCertificationRegression("certified", "unknown")).toBe(true);
    expect(isCertificationRegression("certified", "certified")).toBe(false);
    expect(isCertificationRegression("unknown", "certified")).toBe(false);
    expect(isCertificationRegression("not_certified", "unknown")).toBe(false);
  });

  it("no provider answer can drive a known-CPO listing into a regression", () => {
    // The whole point, stated as an exhaustive sweep over what a provider can
    // send — including the malformed values that used to land as false.
    const everything = [true, false, 1, 0, "true", "false", "maybe", "", null, undefined, {}, []];
    for (const v of everything) {
      const after = resolveCertification({ internal: cpo, providerValue: v }).certified;
      expect(isCertificationRegression("certified", after), JSON.stringify(v)).toBe(false);
    }
  });
});
