import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { oemDocKeyFromYmm, pickOemDocRow, OEM_DOC_TABLE } from "./resolveOemDocLink";

// Ingest harvests the OEM brochure and owner's manual on every intake path and
// caches them by make/model/year. The Vehicle File used to ignore that cache
// and ask the operator to press "Find OEM brochure" — while the harvester
// refused to look again precisely BECAUSE the link was cached. Neither side was
// wrong on its own terms, and the document never appeared.
//
// These tests hold the reader and the harvester to the same rule.

describe("the harvest key is only built from a usable year/make/model", () => {
  it("splits a stored ymm", () => {
    expect(oemDocKeyFromYmm("2027 INFINITI QX60 LUXE")).toEqual({ make: "INFINITI", model: "QX60 LUXE", year: 2027 });
  });

  it("accepts a ymm with no leading year", () => {
    expect(oemDocKeyFromYmm("INFINITI QX60")).toEqual({ make: "INFINITI", model: "QX60", year: null });
  });

  it("refuses anything that cannot identify a model", () => {
    // A lookup with no model matches the first row of some other model line,
    // which would put another vehicle's brochure on this car.
    for (const v of ["", "   ", "INFINITI", "2027", null, undefined]) {
      expect(oemDocKeyFromYmm(v), `${JSON.stringify(v)} must not produce a key`).toBeNull();
    }
  });

  it("does not mistake a model number for a model year", () => {
    expect(oemDocKeyFromYmm("911 Porsche Carrera")?.year).toBeNull();
  });
});

describe("the row picked is the row the harvester considers cached", () => {
  const rows = [
    { year: 2027, url: "u27" },
    { year: 2025, url: "u25" },
    { year: null, url: "uNull" },
  ];

  it("prefers the exact model year", () => {
    expect(pickOemDocRow(rows, 2025)?.url).toBe("u25");
  });

  it("falls back to within two model years", () => {
    // Manufacturers routinely publish one brochure across a generation.
    expect(pickOemDocRow([{ year: 2027, url: "u27" }], 2026)?.url).toBe("u27");
    expect(pickOemDocRow([{ year: 2027, url: "u27" }], 2025)?.url).toBe("u27");
  });

  it("does not reach beyond two model years", () => {
    expect(pickOemDocRow([{ year: 2027, url: "u27" }], 2020)).toBeNull();
  });

  it("falls back to a year-less row, which is what the portal fallback stores", () => {
    expect(pickOemDocRow([{ year: null, url: "uNull" }], 2020)?.url).toBe("uNull");
  });

  it("takes the newest row when the vehicle has no year", () => {
    expect(pickOemDocRow(rows, null)?.url).toBe("u27");
  });

  it("returns null rather than guessing when nothing is cached", () => {
    expect(pickOemDocRow([], 2027)).toBeNull();
  });
});

describe("reader and harvester agree", () => {
  const harvester = readFileSync(
    join(__dirname, "../../../supabase/functions/_shared/intake-autoprovision.ts"),
    "utf8",
  );

  it("reads the same two tables the harvester writes", () => {
    expect(harvester).toContain(`table: "${OEM_DOC_TABLE.brochure}"`);
    expect(harvester).toContain(`table: "${OEM_DOC_TABLE.owners_manual}"`);
  });

  it("uses the harvester's ordering and window", () => {
    // hasCachedOemLink orders newest-first, takes 6, and applies the same
    // exact / within-two / year-less ladder.
    expect(harvester).toMatch(/order\("year",\s*\{\s*ascending:\s*false,\s*nullsFirst:\s*false\s*\}\)/);
    expect(harvester).toMatch(/Math\.abs\(r\.year - yr\) <= 2/);
    expect(harvester).toMatch(/rows\.find\(\(r\) => r\.year == null\)/);
  });

  it("still runs on every intake path", () => {
    // If any of these stops calling autoPreload, documents quietly stop being
    // harvested and the card goes back to looking empty.
    for (const fn of ["marketcheck-sync", "dms-webhook", "autocurb-sync"]) {
      const src = readFileSync(join(__dirname, `../../../supabase/functions/${fn}/index.ts`), "utf8");
      expect(src, `${fn} must call autoPreload`).toMatch(/autoPreload\(/);
    }
    expect(harvester).toMatch(/await ensureOemDocLinks\(/);
  });
});


describe("ingest keeps the dealer's own copy", () => {
  const harvester = readFileSync(
    join(__dirname, "../../../supabase/functions/_shared/intake-autoprovision.ts"),
    "utf8",
  );
  const store = readFileSync(
    join(__dirname, "../../../supabase/functions/oem-document-store/index.ts"),
    "utf8",
  );

  it("runs on every intake, after the link step", () => {
    expect(harvester).toMatch(/export async function ensureOemDocCopies\(/);
    expect(harvester).toMatch(/await ensureOemDocCopies\(/);
    // The copy reads the link cache, so it has to come second or it finds
    // nothing on the very first vehicle of a model.
    expect(harvester.indexOf("await ensureOemDocLinks("))
      .toBeLessThan(harvester.indexOf("await ensureOemDocCopies("));
  });

  it("calls the one function allowed to fetch manufacturer bytes", () => {
    expect(harvester).toContain("functions/v1/oem-document-store");
    // Anything else fetching OEM bytes would bypass the claim/evidence chain.
    expect(harvester).not.toMatch(/fetch\(\s*sourceUrl/);
  });

  it("does not re-implement the franchise gate", () => {
    // oem-document-store claims BEFORE it fetches and the stored row cites the
    // decision, so a second copy of that check here could only drift from it.
    expect(store).toContain("claim_oem_document_hosting");
    expect(store).toMatch(/decision !== "host"/);
    expect(harvester).not.toContain("claim_oem_document_hosting");
    expect(harvester).not.toContain("tenant_may_host_oem_documents");
  });

  it("bounds what one run may download and dedupes per model-year", () => {
    expect(harvester).toMatch(/OEM_COPY_DISPATCH_CAP\s*=\s*\d+/);
    expect(harvester).toMatch(/oemCopyDispatched >= OEM_COPY_DISPATCH_CAP/);
    // Keyed by tenant too: storage is tenant-scoped, so one dealer's copy
    // says nothing about another's.
    expect(harvester).toMatch(/`copy:\$\{spec\.kind\}:\$\{tenantId\}:/);
  });

  it("never retries a download and never throws into ingest", () => {
    const body = harvester.slice(
      harvester.indexOf("export async function ensureOemDocCopies("),
      harvester.indexOf("Ensure the passport's Documents page"),
    );
    expect(body).toMatch(/maxRetries:\s*0/);       // a retry re-downloads tens of MB
    expect(body).toMatch(/catch\s*\{[^}]*\}/);      // swallows, per the surrounding doctrine
  });

  it("only stores a real PDF, under the tenant's own folder", () => {
    // A manufacturer bot-wall answers 200 with HTML; storing that as "the
    // owner's manual" is worse than storing nothing.
    expect(store).toMatch(/0x25 && bytes\[1\] === 0x50/);
    expect(store).toMatch(/const path = `\$\{tenantId\}\//);
  });
});
