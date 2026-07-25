import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  k208SignerAllowedClient,
  K208_COMPAT_SIGNER_ROLES,
  K208_LEGACY_SERVICE_EXPANSION,
} from "./signerAuthority";

const sql = readFileSync(
  join(__dirname, "../../../supabase/migrations/20260726105000_k208_execution_authority.sql"),
  "utf8",
);

const base = {
  isPlatformAdmin: false,
  userId: "u-1",
  role: "service_advisor",
  authorizedUsers: [] as string[],
  authorityRoles: [] as string[],
};

describe("k208SignerAllowedClient — mirror of k208_signer_allowed (S7)", () => {
  it("platform admin always allowed; a non-member never is", () => {
    expect(k208SignerAllowedClient({ ...base, isPlatformAdmin: true, role: null })).toBe(true);
    expect(k208SignerAllowedClient({ ...base, role: null })).toBe(false);
    expect(k208SignerAllowedClient({ ...base, userId: null })).toBe(false);
  });

  it("a per-user grant allows regardless of role", () => {
    expect(k208SignerAllowedClient({ ...base, role: "detail", authorizedUsers: ["u-1"] })).toBe(true);
    expect(k208SignerAllowedClient({ ...base, role: "detail", authorizedUsers: ["u-2"] })).toBe(false);
  });

  it("a configured role list allows exactly those roles", () => {
    expect(k208SignerAllowedClient({ ...base, authorityRoles: ["service_advisor"] })).toBe(true);
    expect(k208SignerAllowedClient({ ...base, role: "service_manager", authorityRoles: ["service_advisor"] })).toBe(false);
  });

  it("configuring EITHER list turns the compat rule off — a manager not on the lists is refused", () => {
    expect(k208SignerAllowedClient({ ...base, role: "service_manager", authorizedUsers: ["u-9"] })).toBe(false);
  });

  it("with neither list configured, the historic manager-level compat set applies", () => {
    expect(k208SignerAllowedClient({ ...base, role: "service_manager" })).toBe(true);
    expect(k208SignerAllowedClient({ ...base, role: "service_advisor" })).toBe(false);
    expect(k208SignerAllowedClient({ ...base, role: "detail" })).toBe(false);
  });

  it("the legacy 'service' key expands to the real service roles, as in the SQL", () => {
    expect(k208SignerAllowedClient({ ...base, authorityRoles: ["service"] })).toBe(true);
    expect(sql).toContain("ARRAY['service_manager','service_advisor']");
    for (const r of K208_LEGACY_SERVICE_EXPANSION) expect(sql).toContain(`'${r}'`);
  });

  it("the compat role set matches the migration verbatim", () => {
    const m = sql.match(/RETURN v_member_role IN \(([\s\S]*?)\);/);
    expect(m).toBeTruthy();
    const sqlRoles = Array.from((m as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]);
    expect(sqlRoles.sort()).toEqual([...K208_COMPAT_SIGNER_ROLES].sort());
  });
});
