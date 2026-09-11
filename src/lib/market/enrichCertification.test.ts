// ── The nightly sweep is where the regression has to be refused ────────────
//
// Gate 14F-A added and tested `certificationTruth.ts`, and wired it to
// nothing. A pure helper with no production caller does not stop a nightly
// job from writing `is_certified: false` onto a CPO INFINITI — it only proves
// that, had anyone called it, it would have said no.
//
// This file is the proof that the call exists. It has two halves:
//
//   1. A SOURCE-BOUNDARY scan of the real `vehicle-enrich/index.ts`, because
//      the only thing that makes the helper matter is that this specific file
//      calls it. `vehicle-enrich` is a `Deno.serve` module holding a live
//      Supabase client, so it cannot be imported and executed under vitest;
//      what can be asserted is the shape of the production path.
//   2. An EXECUTED replay of that path's logic against the QX50's stored row,
//      running the same three functions in the same order with the same
//      inputs, so the outcome is computed rather than asserted about.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  resolveCertification, internalCertificationFromRow, mergeResolvedCertification,
  isCertificationRegression, authorityForStoredSource,
  type StoredCertification,
} from "./certificationTruth.ts";

const ENRICH = "supabase/functions/vehicle-enrich/index.ts";
const src = readFileSync(ENRICH, "utf8");
/** Comments stripped: this file's own header describes the removed behaviour. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const NOW = "2026-09-11T03:15:00.000Z";

// ── 1. The production path exists ──────────────────────────────────────────

describe("vehicle-enrich calls the certification resolver", () => {
  it("imports the resolver from the edge mirror", () => {
    expect(src).toContain('from "../_shared/factorySticker/lib/market/certificationTruth.ts"');
    for (const fn of ["resolveCertification", "internalCertificationFromRow", "mergeResolvedCertification"]) {
      expect(code, fn).toContain(fn);
    }
  });

  it("calls all three, in the production path, in order", () => {
    const internalAt = code.indexOf("internalCertificationFromRow({");
    const resolveAt = code.indexOf("resolveCertification({");
    const mergeAt = code.indexOf("mergeResolvedCertification(");
    const writeAt = code.indexOf('from("vehicle_listings").update(patch)');
    for (const [name, at] of [["internal", internalAt], ["resolve", resolveAt], ["merge", mergeAt], ["write", writeAt]] as const) {
      expect(at, name).toBeGreaterThan(-1);
    }
    // Resolution happens BEFORE the row is written, or it is decoration.
    expect(resolveAt).toBeLessThan(writeAt);
    expect(mergeAt).toBeGreaterThan(resolveAt);
    expect(mergeAt).toBeLessThan(writeAt);
  });

  it("reads the provider echo from the raw feed, not from a derived column", () => {
    expect(code).toMatch(/providerValue:\s*\(row\.mc_raw as [^)]*\)\?\.is_certified/);
  });

  it("selects the stored certification record it must not downgrade", () => {
    expect(code).toMatch(/\.select\("[^"]*\bcertification\b[^"]*"\)/);
  });

  it("writes only through the merge, never the provider value directly", () => {
    // The defect shape: assigning the provider's answer onto the column.
    expect(code).not.toMatch(/patch\.certification\s*=\s*[^;]*is_certified/);
    expect(code).not.toMatch(/certified:\s*[^;,}]*\bis_certified\b/);
    expect(code).toContain("if (certificationPatch) patch.certification = certificationPatch;");
  });

  it("guards the write behind a merge that can decline", () => {
    // `mergeResolvedCertification` returns null to mean "write nothing". An
    // unconditional assignment would discard that refusal.
    expect(code).toMatch(/if \(certificationPatch\) patch\.certification/);
    expect(code).not.toMatch(/patch\.certification = mergeResolvedCertification/);
  });
});

describe("the single-writer boundary survives the change", () => {
  it("restores no writer for the four protected market columns", () => {
    for (const column of ["market_value", "market_position", "market_checked_at", "market_payload"]) {
      // Reading, and writing an explicit null, are both fine. Deciding the
      // number is what only market-valuation-write may do.
      const writes = new RegExp(`(patch\\.${column}\\s*=(?!\\s*null\\b)|["']?${column}["']?\\s*:(?!\\s*null\\b)(?!\\s*[A-Za-z_$][\\w$]*[.?]))`);
      expect(code, column).not.toMatch(writes);
    }
  });

  it("adds no provider call, retry, schedule or timer", () => {
    // Exactly the block this gate added: from reading the stored record to
    // the guarded assignment, and not the persist call that follows it.
    const END = "if (certificationPatch) patch.certification = certificationPatch;";
    const start = code.indexOf("const priorCertification");
    const block = code.slice(start, code.indexOf(END, start) + END.length);
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("resolveCertification({");
    expect(block.length).toBeGreaterThan(100);
    for (const banned of ["fetch(", "mcFetch(", "setTimeout", "setInterval", "cron", "retry", "await admin"]) {
      expect(block, banned).not.toContain(banned);
    }
  });

  it("leaves the comparable search geometry untouched", () => {
    // carType still collapses cpo to used. Sending is_certified to the
    // provider would change which comparables come back — a change to
    // enrichment behaviour, and a separate priced decision.
    expect(code).toContain('const carType = condition === "new" ? "new" : "used";');
    expect(code).not.toMatch(/set\("is_certified"/);
  });

  it("keeps every other enrichment field assigned exactly as before", () => {
    for (const field of [
      "patch.comparables", "patch.group_similar", "patch.market_meta",
      "patch.history_payload", "patch.in_service_date", "patch.blackbook",
    ]) {
      expect(code, field).toContain(field);
    }
  });
});

// ── 2. The QX50 replay ─────────────────────────────────────────────────────

/**
 * The mandated regression, run rather than asserted.
 *
 * `replay` performs exactly what the production path performs: the same three
 * calls, same order, same arguments. If the production path is edited to skip
 * one, the boundary tests above fail; if the logic is edited to permit a
 * downgrade, this fails.
 */
const replay = (row: { certification: StoredCertification | null; condition: unknown; mc_raw: Record<string, unknown> | null }) => {
  const resolution = resolveCertification({
    internal: internalCertificationFromRow({ certification: row.certification, condition: row.condition }),
    providerValue: row.mc_raw?.is_certified,
  });
  return { resolution, patch: mergeResolvedCertification(row.certification, resolution, NOW) };
};

const QX50 = {
  condition: "cpo",
  certification: { certified: true, source: "dealer_vdp", verified_at: "2026-08-02T11:04:00.000Z" } as StoredCertification,
  mc_raw: { is_certified: false, vin: "3PCAJ5FB1SF109708" },
};

describe("the QX50 regression, replayed through the production path", () => {
  const { resolution, patch } = replay(QX50);

  it("treats the dealer VDP record as authoritative", () => {
    expect(authorityForStoredSource("dealer_vdp")).toBe("dealer_confirmed");
    expect(resolution.authority).toBe("dealer_confirmed");
  });

  it("resolves certified TRUE despite the provider's false", () => {
    expect(resolution.certified).toBe("certified");
    expect(isCertificationRegression("certified", resolution.certified)).toBe(false);
  });

  it("records the conflict", () => {
    expect(resolution.conflict).toBe(true);
    expect(resolution.reasons).toContain("provider_certification_conflicts_with_authoritative_record");
    expect(patch?.provider_conflict).toBe(true);
  });

  it("quarantines the provider false, retaining it only as raw evidence", () => {
    expect(resolution.providerEcho).toBe(false);
    expect(resolution.quarantineProviderAttribute).toBe(true);
    expect(patch?.provider_quarantined).toBe(true);
    // Raw evidence and resolved truth, on the same row, disagreeing openly.
    expect(patch?.certified).toBe(true);
    expect(patch?.provider_echo).toBe(false);
  });

  it("preserves the original provenance rather than reattributing it", () => {
    expect(patch?.source).toBe("dealer_vdp");
    expect(patch?.verified_at).toBe("2026-08-02T11:04:00.000Z");
  });

  it("changes no legacy market column", () => {
    const keys = Object.keys(patch ?? {});
    for (const column of ["market_value", "market_position", "market_checked_at", "market_payload"]) {
      expect(keys, column).not.toContain(column);
    }
  });

  it("is idempotent: the second nightly pass writes nothing", () => {
    const second = replay({ ...QX50, certification: patch as StoredCertification });
    expect(second.resolution.certified).toBe("certified");
    expect(second.patch).toBeNull();
  });
});

describe("what the nightly sweep may and may not do to the column", () => {
  it("refuses every downgrade of a stored certified: true", () => {
    for (const providerValue of [false, 0, "false", "maybe", null, undefined, {}, []]) {
      const { patch } = replay({ ...QX50, mc_raw: { is_certified: providerValue } });
      // Either no write at all, or a write that keeps certified true.
      if (patch) expect(patch.certified, JSON.stringify(providerValue)).toBe(true);
    }
  });

  it("never converts a missing provider field into false", () => {
    const { resolution, patch } = replay({ condition: "used", certification: null, mc_raw: {} });
    expect(resolution.providerEcho).toBeNull();
    expect(resolution.reasons).toContain("provider_certification_missing");
    expect(patch?.certified).not.toBe(false);
  });

  it("invents no record for a vehicle nobody has an answer about", () => {
    const { patch } = replay({ condition: "", certification: null, mc_raw: null });
    expect(patch).toBeNull();
  });

  it("does not let condition='cpo' alone certify a car", () => {
    // `condition` is marketcheck-sync's derivation of the feed's is_certified.
    // Promoting it would let the provider corroborate itself.
    const { resolution } = replay({ condition: "cpo", certification: null, mc_raw: { is_certified: true } });
    expect(resolution.authority).toBe("provider_derived");
    expect(resolution.certified).toBe("unknown");
  });

  it("does not let a provider true certify a car the dealer called ordinary", () => {
    const { resolution, patch } = replay({
      condition: "used",
      certification: { certified: false, source: "dealer_vdp" },
      mc_raw: { is_certified: true },
    });
    expect(resolution.certified).toBe("not_certified");
    expect(resolution.conflict).toBe(true);
    expect(patch?.certified).toBe(false);
    expect(patch?.provider_echo).toBe(true);
  });
});
