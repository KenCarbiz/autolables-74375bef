import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  documentDeliveryFor, grantBrandKey, hostableBrands, mayHostOemDocuments,
  type OemFranchiseBrand,
} from "./distributionGrants";

const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const infiniti: OemFranchiseBrand[] = [{ brand: "infiniti", new_units: 12 }];

describe("hosting follows the franchise, and nothing else", () => {
  it("hosts the dealer's own franchised brand", () => {
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: TENANT, franchises: infiniti })).toBe("host");
  });

  it("links the off-brand used car on the same lot", () => {
    // The INFINITI store has no Honda franchise. This is the whole rule.
    expect(documentDeliveryFor({ make: "Honda", tenantId: TENANT, franchises: infiniti })).toBe("link");
  });

  it("links a used INFINITI sitting on a Honda lot", () => {
    expect(documentDeliveryFor({
      make: "INFINITI", tenantId: TENANT, franchises: [{ brand: "honda", new_units: 40 }],
    })).toBe("link");
  });

  it("does not let one tenant's franchise cover another", () => {
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: "other", franchises: [] })).toBe("link");
  });
});

describe("possession is not permission", () => {
  // We may already hold this exact PDF because a franchised dealer hosts it.
  // That must change nothing for a dealer without the franchise -- enforced
  // structurally: the decision takes no "do we have the file" input at all,
  // so there is nothing to accidentally consult.
  it("ignores any stored-file hint that reaches it", () => {
    const base = { make: "INFINITI", tenantId: TENANT, franchises: [] as OemFranchiseBrand[] };
    expect(documentDeliveryFor({ ...base, hostedCopyExists: true } as never)).toBe("link");
    expect(documentDeliveryFor({ ...base, storedPdfUrl: "https://cdn/x.pdf" } as never)).toBe("link");
  });
});

describe("an unknown answer is a denial", () => {
  it("links when the franchise derivation could not be loaded", () => {
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: TENANT, franchises: null })).toBe("link");
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: TENANT })).toBe("link");
  });

  it("links when there is no tenant", () => {
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: null, franchises: infiniti })).toBe("link");
  });

  it("links when the make is missing or blank", () => {
    for (const make of [null, undefined, "", "   "]) {
      expect(documentDeliveryFor({ make, tenantId: TENANT, franchises: infiniti })).toBe("link");
    }
  });
});

describe("a takedown wins over the franchise", () => {
  it("links when the brand is blocked for this tenant", () => {
    expect(documentDeliveryFor({
      make: "INFINITI", tenantId: TENANT, franchises: infiniti,
      blocks: [{ tenant_id: TENANT, brand: "infiniti" }],
    })).toBe("link");
  });

  it("links when the brand is blocked platform-wide", () => {
    expect(documentDeliveryFor({
      make: "INFINITI", tenantId: TENANT, franchises: infiniti,
      blocks: [{ tenant_id: null, brand: "INFINITI" }],
    })).toBe("link");
  });

  it("ignores a block aimed at a different tenant", () => {
    expect(documentDeliveryFor({
      make: "INFINITI", tenantId: TENANT, franchises: infiniti,
      blocks: [{ tenant_id: "someone-else", brand: "infiniti" }],
    })).toBe("host");
  });
});

describe("brand matching survives how the make is really written", () => {
  it("normalizes case, aliases and multi-word makes", () => {
    expect(grantBrandKey("INFINITI")).toBe("infiniti");
    expect(grantBrandKey("chevy")).toBe("chevrolet");
    expect(grantBrandKey("Mercedes")).toBe("mercedes-benz");
    expect(grantBrandKey("Land Rover")).toBe("land rover");
  });

  it("still keys a marque outside the registry", () => {
    expect(grantBrandKey("Koenigsegg")).toBe("koenigsegg");
  });

  it("matches a derivation written in any case", () => {
    expect(mayHostOemDocuments({
      make: "infiniti", tenantId: TENANT, franchises: [{ brand: "INFINITI" }],
    })).toBe(true);
  });
});

describe("hostableBrands", () => {
  it("lists derived brands once, sorted, minus takedowns", () => {
    expect(hostableBrands(
      [{ brand: "INFINITI" }, { brand: "nissan" }, { brand: "nissan" }],
      [{ tenant_id: null, brand: "nissan" }],
      TENANT,
    )).toEqual(["infiniti"]);
  });

  it("is empty when the derivation did not load", () => {
    expect(hostableBrands(null)).toEqual([]);
  });
});

describe("the database gate is the same rule, derived and default-deny", () => {
  const sql = readFileSync(
    join(__dirname, "..", "..", "..", "supabase/migrations/20260729140000_oem_franchise_derived_gate.sql"),
    "utf8",
  );

  it("derives the franchise from new inventory rather than a checkbox", () => {
    const derive = sql.slice(sql.indexOf("FUNCTION public.derive_oem_franchise_brands"));
    expect(derive).toMatch(/lower\(coalesce\(vl\.condition, ''\)\) = 'new'/);
    expect(derive).toMatch(/HAVING count\(\*\) >= public\.oem_franchise_min_new_units\(\)/);
  });

  it("asks for more than one new unit, because the failure directions differ", () => {
    // A false positive hosts documents we had no right to; a false negative
    // just links. One mis-keyed condition must not confer a franchise.
    expect(sql).toMatch(/SELECT 3 \$\$/);
  });

  it("creates no dealer-facing grant or revoke, and retires the ones that were", () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.grant_oem_distribution/);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.revoke_oem_distribution/);
    // A dead SECURITY DEFINER function still granted to authenticated is worse
    // than dead: it can still be called and will write rows nothing reads.
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.grant_oem_distribution/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.revoke_oem_distribution/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.oem_attestation_text/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.oem_distribution_grants/);
  });

  it("keeps a platform takedown as the one override", () => {
    const gate = sql.slice(sql.indexOf("FUNCTION public.tenant_may_host_oem_documents"));
    expect(gate).toMatch(/oem_distribution_blocks/);
    expect(gate).toMatch(/b\.tenant_id IS NULL OR b\.tenant_id = _tenant_id/);
  });

  it("refuses a blank brand or a missing tenant", () => {
    const gate = sql.slice(sql.indexOf("FUNCTION public.tenant_may_host_oem_documents"));
    expect(gate).toMatch(/coalesce\(btrim\(_brand\), ''\) <> ''/);
    expect(gate).toMatch(/_tenant_id IS NOT NULL/);
  });

  it("parses a multi-word make instead of taking the second token", () => {
    // "2024 Land Rover Defender" must not derive a franchise for "Land".
    const parser = sql.slice(sql.indexOf("FUNCTION public.oem_make_from_ymm"));
    expect(parser).toMatch(/'land rover'/);
    expect(parser).toMatch(/'mercedes-benz'/);
    expect(parser).toMatch(/IF v_multi = 'range rover' THEN RETURN 'land rover'/);
  });

  it("wraps auth.uid() and scopes the read policy to authenticated", () => {
    expect(sql).toMatch(/FOR SELECT\s*\n\s*TO authenticated/);
    expect(sql).toMatch(/\(SELECT auth\.uid\(\)\)/);
    expect(sql).not.toMatch(/WHERE user_id = auth\.uid\(\)/);
  });
});
