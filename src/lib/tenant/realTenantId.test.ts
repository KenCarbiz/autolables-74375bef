import { describe, it, expect } from "vitest";
import { realTenantId, HOUSE_TENANT_ID } from "./realTenantId";

describe("realTenantId", () => {
  it("rejects the house sentinel, which is id-shaped but not a uuid", () => {
    expect(realTenantId({ id: HOUSE_TENANT_ID })).toBeNull();
    expect(realTenantId({ id: "house" })).toBeNull();
  });

  it("returns a real tenant id", () => {
    expect(realTenantId({ id: "7f1c9d2e-4b3a-4a6f-9d21-0b2f6a1c8e55" }))
      .toBe("7f1c9d2e-4b3a-4a6f-9d21-0b2f6a1c8e55");
  });

  it("treats absent, null and empty ids as no tenant", () => {
    expect(realTenantId(null)).toBeNull();
    expect(realTenantId(undefined)).toBeNull();
    expect(realTenantId({})).toBeNull();
    expect(realTenantId({ id: "" })).toBeNull();
  });
});
