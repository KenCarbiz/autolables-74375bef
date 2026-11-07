// Evidence-integrity rules for the VIN, odometer and report-fingerprint checks
// (Ken, Nov 7 2026). Title rules live in verificationReport.test.ts.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  deriveVerificationReport, resolveVinDecode, resolveOdometer, decodedIdentityMatches,
  verificationEvidenceFingerprint, verificationSnapshotKey, VERIFICATION_REPORT_VERSION,
} from "./verificationSummary";
import { canonicalJson, sha256Hex } from "./evidenceFingerprint";
import type { PassportData } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

const VIN = "5N1AL1F83VC332076";
const dOf = (o: Partial<PassportData> = {}): PassportData => ({
  accidentCount: null, ownerCount: null, cleanTitle: false, titleStatus: "unknown",
  marketAvg: null, belowMarket: null, warrantyStr: null, warrantyExpired: false, marketCheckedAt: null,
  ...(o as object),
} as PassportData);
const L = (o: Record<string, unknown>): VehicleListing =>
  ({ vin: VIN, ymm: "2025 INFINITI QX50", trim: "LUXE", mileage: 12000, condition: "used", ...o } as unknown as VehicleListing);
const receipt = (o: Record<string, unknown> = {}) =>
  ({ vin: VIN, provider: "neovin", http_status: 200, fetched_at: "2026-10-01T00:00:00.000Z", year: "2025", make: "INFINITI", model: "QX50", trim: "LUXE", payload_hash: "abc", ...o });
const check = (l: VehicleListing, key: string, d: PassportData = dOf()) =>
  deriveVerificationReport(d, l).checks.find((c) => c.key === key)!;

describe("VIN decode evidence", () => {
  it("a valid VIN with no provider response is on record, not verified", () => {
    const c = check(L({}), "vin");
    expect(resolveVinDecode(L({})).state).toBe("not_attempted");
    expect(c.status).toBe("unavailable");
    expect(c.finding).toBe("VIN on record. Identity decode not verified.");
    expect(c.evidence.find((e) => e.label === "Format check")!.value).toBe("Valid 17-character VIN");
  });

  it("dealer-entered year/make/model alone does not verify identity", () => {
    expect(check(L({ ymm: "2025 INFINITI QX50", mc_attributes: { year: 2025, make: "INFINITI", model: "QX50" } }), "vin").status).toBe("unavailable");
  });

  it("non-empty specifications or a build sheet without an exact-VIN receipt do not verify identity", () => {
    const l = L({ key_specs: { engine: "2.0L" }, mc_attributes: { specs_decoded_at: "2026-10-01T00:00:00Z", specs_source: "neovin", build_sheet: { source: "neovin" } } });
    expect(resolveVinDecode(l).state).toBe("unlinked");
    expect(check(l, "vin").status).toBe("unavailable");
  });

  it("a successful exact-VIN provider decode verifies identity", () => {
    const c = check(L({ vin_decode_receipts: [receipt()] }), "vin");
    expect(c.status).toBe("verified");
    expect(c.finding).toBe("VIN and vehicle identity verified: MarketCheck NeoVIN decodes this VIN to the listed 2025 INFINITI QX50 LUXE.");
    expect(c.evidence.find((e) => e.label === "Source")!.value).toBe("MarketCheck NeoVIN");
  });

  it("allows controlled make-name normalization", () => {
    expect(check(L({ ymm: "2024 Mercedes-Benz GLE", vin_decode_receipts: [receipt({ year: "2024", make: "Mercedes Benz", model: "GLE" })] }), "vin").status).toBe("verified");
    expect(check(L({ ymm: "2024 Infiniti QX50", vin_decode_receipts: [receipt({ year: "2024" })] }), "vin").status).toBe("verified");
  });

  it("a decode for a different VIN needs confirmation", () => {
    const c = check(L({ vin_decode_receipts: [receipt({ vin: "JN1EV7CR5PM543599" })] }), "vin");
    expect(c.status).toBe("needs_confirmation");
    expect(c.finding).toMatch(/saved decode is for VIN JN1EV7CR5PM543599/);
  });

  it("a decode whose model disagrees with the listing needs confirmation", () => {
    const c = check(L({ vin_decode_receipts: [receipt({ model: "QX60" })] }), "vin");
    expect(c.status).toBe("needs_confirmation");
    expect(c.finding).toMatch(/decodes to a 2025 INFINITI QX60/);
  });

  it("a decode that failed after retries is unavailable, and in progress is pending", () => {
    expect(check(L({ mc_attributes: { specs_attempts: 3, specs_attempted_at: "2026-11-07T08:50:14Z" } }), "vin").status).toBe("unavailable");
    expect(check(L({ mc_attributes: { specs_attempts: 1, specs_attempted_at: "2026-11-07T08:50:14Z" } }), "vin").status).toBe("pending");
  });

  it("a failed provider request or an unnamed decoder is not a decode", () => {
    expect(check(L({ vin_decode_receipts: [receipt({ http_status: 422 })] }), "vin").status).toBe("unavailable");
    expect(check(L({ vin_decode_receipts: [receipt({ provider: "dealer_upload" })] }), "vin").status).toBe("unavailable");
    expect(check(L({ vin_decode_receipts: [receipt({ model: null })] }), "vin").status).toBe("unavailable");
  });

  it("conflicting provider results need confirmation", () => {
    const c = check(L({ vin_decode_receipts: [receipt(), receipt({ provider: "nhtsa_vpic", model: "QX55", fetched_at: "2026-09-01T00:00:00.000Z" })] }), "vin");
    expect(c.status).toBe("needs_confirmation");
    expect(c.finding).toMatch(/different vehicles/);
  });

  it("a listing record that disagrees with the decode needs confirmation", () => {
    const c = check(L({ vin_decode_receipts: [receipt()], mc_attributes: { year: 2025, make: "INFINITI", model: "QX60" } }), "vin");
    expect(c.status).toBe("needs_confirmation");
  });

  it("an invalid VIN format needs confirmation and is never decoded", () => {
    const c = check(L({ vin: "5N1AL1F83VC33207", vin_decode_receipts: [receipt()] }), "vin");
    expect(c.status).toBe("needs_confirmation");
  });
});

describe("odometer evidence", () => {
  const odo = (hp: Record<string, unknown> | null, mileage: number | null = 28397) => check(L({ mileage, history_payload: hp }), "odometer");

  it("dealer-reported mileage only: shown, not verified", () => {
    const c = odo(null);
    expect(c.status).toBe("unavailable");
    expect(c.finding).toBe("Reported mileage: 28,397 miles. Odometer history not independently verified.");
    expect(c.evidence.find((e) => e.label === "Reported mileage")!.value).toBe("28,397 mi (dealer reported)");
  });

  it("an ownership or title record without mileage history does not verify the odometer", () => {
    const d = dOf({ ownerCount: 1, accidentCount: 0, titleStatus: "clean", cleanTitle: true });
    expect(check(L({ mileage: 28397, mc_attributes: { owner_count: 1, carfax_clean_title: true } }), "odometer", d).status).toBe("unavailable");
  });

  it("advertised listing mileage is not odometer history", () => {
    const hp = { entries: [{ miles: 7315, first_seen: "2026-08-29T00:00:00Z" }, { miles: 7315, first_seen: "2026-09-16T00:00:00Z" }] };
    const c = odo(hp, 7315);
    expect(c.status).toBe("unavailable");
    expect(c.evidence.find((e) => e.label === "Advertised mileage records")!.value).toMatch(/2 dealer listing records/);
  });

  it("a single historical reading is not enough to compare", () => {
    const c = odo({ odometer_readings: [{ date: "2025-01-01", miles: 20000, source: "AutoCheck" }] });
    expect(resolveOdometer(L({ mileage: 28397, history_payload: { odometer_readings: [{ date: "2025-01-01", miles: 20000, source: "AutoCheck" }] } })).state).toBe("single_reading");
    expect(c.status).toBe("unavailable");
  });

  it("multiple consistent dated readings verify no rollback indicators", () => {
    const c = odo({ odometer_readings: [{ date: "2024-01-01", miles: 9000, source: "AutoCheck" }, { date: "2025-06-01", miles: 21000, source: "AutoCheck" }] });
    expect(c.status).toBe("verified");
    expect(c.finding).toBe("Reported mileage: 28,397 miles. No rollback indicators found in the available mileage records.");
  });

  it("dealer-sourced readings never count as independent history", () => {
    expect(odo({ odometer_readings: [{ date: "2024-01-01", miles: 9000, source: "dealer" }, { date: "2025-06-01", miles: 21000, source: "listing feed" }] }).status).toBe("unavailable");
  });

  it("an explicit verified odometer outcome verifies", () => {
    expect(odo({ odometer_check: { outcome: "consistent", source: "AutoCheck", checked_at: "2026-10-01T00:00:00Z" } }).status).toBe("verified");
  });

  it("an odometer outcome for another VIN is ignored", () => {
    expect(odo({ odometer_check: { outcome: "consistent", source: "AutoCheck", vin: "JN1EV7CR5PM543599" } }).status).toBe("unavailable");
  });

  it("reported mileage below a recorded reading requires review", () => {
    const c = odo({ odometer_readings: [{ date: "2024-01-01", miles: 9000, source: "AutoCheck" }, { date: "2025-06-01", miles: 31000, source: "AutoCheck" }] });
    expect(c.status).toBe("needs_confirmation");
    expect(c.finding).toMatch(/^Reported mileage: 28,397 miles\. Mileage records require review\./);
  });

  it("advertised mileage that falls between listings requires review", () => {
    const c = odo({ entries: [{ miles: 30100, first_seen: "2026-01-01T00:00:00Z" }, { miles: 28397, first_seen: "2026-05-01T00:00:00Z" }] });
    expect(c.status).toBe("needs_confirmation");
  });

  it("readings that go backwards are a possible rollback", () => {
    const c = odo({ odometer_readings: [{ date: "2024-01-01", miles: 40000, source: "AutoCheck" }, { date: "2025-06-01", miles: 21000, source: "AutoCheck" }] });
    expect(c.status).toBe("needs_attention");
    expect(c.evidence.find((e) => e.label === "Rollback indicators")!.value).toBe("Possible rollback reported");
  });

  it("an explicit rollback outcome needs attention, and the mileage is still shown", () => {
    const c = odo({ odometer_check: { outcome: "rollback", source: "AutoCheck" } });
    expect(c.status).toBe("needs_attention");
    expect(c.finding).toMatch(/^Reported mileage: 28,397 miles\./);
  });

  it("no mileage at all is unavailable with nothing invented", () => {
    const c = odo(null, null);
    expect(c.status).toBe("unavailable");
    expect(c.finding).toBeNull();
  });
});

describe("report fingerprint", () => {
  const base = () => L({ vin_decode_receipts: [receipt()], mc_attributes: { owner_count: 1 } });
  const d = () => dOf({ ownerCount: 1 });
  const fp = (l: VehicleListing, dd: PassportData = d()) => verificationEvidenceFingerprint(deriveVerificationReport(dd, l), l.vin);

  it("the SHA-256 implementation matches node:crypto", () => {
    for (const s of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "VIN é ü 漢", canonicalJson({ b: 1, a: [1, "2"] })]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });

  it("identical snapshots produce identical fingerprints", () => {
    expect(fp(base())).toBe(fp(base()));
    expect(fp(base())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a changed provider outcome produces a new fingerprint", () => {
    const l = base();
    (l as unknown as Record<string, unknown>).vin_decode_receipts = [receipt({ payload_hash: "def", fetched_at: "2026-11-01T00:00:00.000Z" })];
    expect(fp(l)).not.toBe(fp(base()));
  });

  it("changed material evidence produces a new fingerprint even when the counts stay the same", () => {
    const a = deriveVerificationReport(dOf({ ownerCount: 1 }), base());
    const b = deriveVerificationReport(dOf({ ownerCount: 2 }), base());
    expect(b.verifiedChecks).toBe(a.verifiedChecks);
    expect(b.checks.map((c) => c.status)).toEqual(a.checks.map((c) => c.status));
    expect(verificationEvidenceFingerprint(b, VIN)).not.toBe(verificationEvidenceFingerprint(a, VIN));
  });

  it("unrelated listing and display changes do not change the fingerprint", () => {
    const l = base();
    Object.assign(l as object, { updated_at: "2026-12-01T00:00:00Z", hero_image_url: "https://example.com/new.jpg", description: "New copy", price: 1 });
    expect(fp(l)).toBe(fp(base()));
  });

  it("the displayed key carries the methodology version, the VIN and the fingerprint prefix", () => {
    const r = deriveVerificationReport(d(), base());
    const key = verificationSnapshotKey(r, VIN);
    expect(key).toBe(`${VERIFICATION_REPORT_VERSION}/${VIN}/${verificationEvidenceFingerprint(r, VIN).slice(0, 16)}`);
  });

  it("no report URL, credential or reviewer identity is hashed", () => {
    const l = L({ history_report_url: "https://www.carfax.com/vehiclehistory/secret", title_verification: { status: "clean", verified_at: "2026-10-01T00:00:00Z", verified_by: "Jane Doe", source: "nmvtis" } });
    const r = deriveVerificationReport(d(), l);
    const serialized = JSON.stringify(r.checks.map((c) => c.facts));
    expect(serialized).not.toMatch(/carfax\.com|Jane Doe|api_key/);
  });
});

describe("decoded model names: body styles normalize, different models do not", () => {
  // The four live published cars whose decoder appends a body style.
  it.each([
    ["2023 Jeep Wrangler", "2023", "Jeep", "Wrangler 4-Door"],
    ["2022 Ram 1500", "2022", "RAM", "Ram 1500 Pickup"],
    ["2021 Audi A5", "2021", "Audi", "A5 Sportback"],
    ["2021 Mercedes-Benz C-Class", "2021", "Mercedes-Benz", "C-Class Sedan"],
    ["2022 INFINITI QX55", "2022", "INFINITI", "QX55"],
  ])("%s matches a decode of %s %s %s", (ymm, year, make, model) => {
    expect(decodedIdentityMatches(ymm, { year, make, model })).toBe(true);
  });

  it.each([
    ["2022 INFINITI QX5", "2022", "INFINITI", "QX55"],
    ["2022 INFINITI QX50", "2022", "INFINITI", "QX55"],
    ["2021 INFINITI QX55", "2022", "INFINITI", "QX55"],
    ["2022 Nissan QX55", "2022", "INFINITI", "QX55"],
    ["2021 Audi A5", "2021", "Audi", "A5 Sport"],
  ])("%s does not match %s %s %s", (ymm, year, make, model) => {
    expect(decodedIdentityMatches(ymm, { year, make, model })).toBe(false);
  });
});
