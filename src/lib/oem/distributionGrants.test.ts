import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  documentDeliveryFor, grantBrandKey, grantedBrands, mayHostOemDocuments,
  type OemDistributionGrant,
} from "./distributionGrants";

const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";

const grant = (over: Partial<OemDistributionGrant> = {}): OemDistributionGrant => ({
  id: "g1", tenant_id: TENANT, store_id: null, brand: "infiniti", status: "active", ...over,
});

describe("hosting requires an explicit live grant for that brand", () => {
  it("hosts the dealer's own franchised brand", () => {
    expect(documentDeliveryFor({
      make: "INFINITI", tenantId: TENANT, grants: [grant()],
    })).toBe("host");
  });

  it("links the off-brand used car on the same lot", () => {
    // The INFINITI store has no Honda agreement. This is the whole point.
    expect(documentDeliveryFor({
      make: "Honda", tenantId: TENANT, grants: [grant()],
    })).toBe("link");
  });

  it("links once the grant is revoked", () => {
    expect(documentDeliveryFor({
      make: "INFINITI", tenantId: TENANT, grants: [grant({ status: "revoked" })],
    })).toBe("link");
  });

  it("does not let one tenant's grant cover another", () => {
    expect(documentDeliveryFor({
      make: "INFINITI", tenantId: "other-tenant", grants: [grant()],
    })).toBe("link");
  });
});

describe("an unknown answer is a denial", () => {
  // "We could not check" and "we are allowed" are not the same sentence.
  it("links when the grants could not be loaded", () => {
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: TENANT, grants: null })).toBe("link");
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: TENANT })).toBe("link");
  });

  it("links when there is no tenant", () => {
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: null, grants: [grant()] })).toBe("link");
  });

  it("links when the make is missing or blank", () => {
    for (const make of [null, undefined, "", "   "]) {
      expect(documentDeliveryFor({ make, tenantId: TENANT, grants: [grant()] })).toBe("link");
    }
  });

  it("links on an empty grant list", () => {
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: TENANT, grants: [] })).toBe("link");
  });
});

describe("store scope", () => {
  it("a tenant-wide grant covers every store", () => {
    expect(documentDeliveryFor({
      make: "INFINITI", tenantId: TENANT, storeId: "store-7", grants: [grant({ store_id: null }),],
    })).toBe("host");
  });

  it("a store-scoped grant covers only its own store", () => {
    const g = [grant({ store_id: "store-7" })];
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: TENANT, storeId: "store-7", grants: g })).toBe("host");
    expect(documentDeliveryFor({ make: "INFINITI", tenantId: TENANT, storeId: "store-9", grants: g })).toBe("link");
  });
});

describe("brand matching survives how the make is really written", () => {
  it("normalizes case, aliases and multi-word makes", () => {
    expect(grantBrandKey("INFINITI")).toBe("infiniti");
    expect(grantBrandKey("chevy")).toBe("chevrolet");
    expect(grantBrandKey("Mercedes")).toBe("mercedes-benz");
    expect(grantBrandKey("Land Rover")).toBe("land rover");
  });

  it("still keys a marque outside the registry, so it can be granted", () => {
    expect(grantBrandKey("Koenigsegg")).toBe("koenigsegg");
  });

  it("matches a grant written in any case", () => {
    expect(mayHostOemDocuments({
      make: "infiniti", tenantId: TENANT, grants: [grant({ brand: "INFINITI" })],
    })).toBe(true);
  });
});

describe("grantedBrands", () => {
  it("lists live brands once, sorted, ignoring revoked", () => {
    expect(grantedBrands([
      grant({ brand: "INFINITI" }),
      grant({ id: "g2", brand: "nissan" }),
      grant({ id: "g3", brand: "honda", status: "revoked" }),
      grant({ id: "g4", brand: "nissan" }),
    ])).toEqual(["infiniti", "nissan"]);
  });

  it("is empty when nothing loaded", () => {
    expect(grantedBrands(null)).toEqual([]);
  });
});

describe("the database gate is the same policy, and defaults to deny", () => {
  // The client policy is advisory. Anything that actually stores or serves
  // manufacturer bytes has to ask the database, so these assert the SQL.
  const sql = readFileSync(
    join(__dirname, "..", "..", "..", "supabase/migrations/20260729040000_oem_distribution_grants.sql"),
    "utf8",
  );
  const gate = sql.slice(sql.indexOf("FUNCTION public.tenant_may_host_oem_documents"));

  it("answers true only from an EXISTS over active grants", () => {
    expect(gate).toMatch(/SELECT EXISTS/);
    expect(gate).toMatch(/g\.status = 'active'/);
  });

  it("matches the brand case-insensitively and refuses a blank one", () => {
    expect(gate).toMatch(/lower\(g\.brand\) = lower\(btrim\(coalesce\(_brand, ''\)\)\)/);
    expect(gate).toMatch(/coalesce\(btrim\(_brand\), ''\) <> ''/);
  });

  it("lets a tenant-wide grant cover any store, and scopes a narrow one", () => {
    expect(gate).toMatch(/g\.store_id IS NULL OR g\.store_id = _store_id/);
  });

  it("writes the attestation server-side, never from the caller", () => {
    // A client-supplied string would be worthless as a record of what was
    // agreed to, so grant_oem_distribution takes no attestation parameter.
    const grantFn = sql.slice(
      sql.indexOf("FUNCTION public.grant_oem_distribution"),
      sql.indexOf("FUNCTION public.revoke_oem_distribution"),
    );
    expect(grantFn).toMatch(/SELECT version, body INTO v_version, v_body FROM public\.oem_attestation_text\(\)/);
    // The signature is the guarantee: no parameter can carry wording in.
    const signature = grantFn.slice(0, grantFn.indexOf(")"));
    expect(signature).not.toMatch(/attestation/i);
    expect(signature).toMatch(/_tenant_id UUID/);
  });

  it("requires an owner or admin of that tenant to attest", () => {
    const grantFn = sql.slice(sql.indexOf("FUNCTION public.grant_oem_distribution"));
    expect(grantFn).toMatch(/role IN \('owner', 'admin'\)/);
    expect(grantFn).toMatch(/not authorized to attest for this tenant/);
  });

  it("keeps a revoked grant as history rather than deleting it", () => {
    const revokeFn = sql.slice(
      sql.indexOf("FUNCTION public.revoke_oem_distribution"),
      sql.indexOf("FUNCTION public.tenant_may_host_oem_documents"),
    );
    expect(revokeFn).toMatch(/SET status = 'revoked'/);
    expect(revokeFn).not.toMatch(/DELETE\s+FROM/i);
  });

  it("wraps auth.uid() and scopes the read policy to authenticated", () => {
    expect(sql).toMatch(/FOR SELECT\s*\n\s*TO authenticated/);
    expect(sql).toMatch(/\(SELECT auth\.uid\(\)\)/);
    expect(sql).not.toMatch(/WHERE user_id = auth\.uid\(\)/);
  });
});
