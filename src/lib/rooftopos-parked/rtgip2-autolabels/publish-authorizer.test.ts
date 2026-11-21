// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ReadDb } from "../rtgip2-runtime/runtime.ts";
import { PUBLISH_KINDS, PUBLISH_REF_KEYS, PUBLISH_ROLES, labelsPublishAuthorizer as authorize } from "./publish-authorizer.ts";
import { PRODUCE_KINDS } from "./staging-adapter.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const req = { kind: "identity_registered", tenant_id: TENANT, rooftop_id: "rf-1", ref: { episode_id: "e" } };

function db(members: { role: string }[], stores: unknown[]): ReadDb & { seen: { text: string; params: readonly unknown[] }[] } {
  const seen: { text: string; params: readonly unknown[] }[] = [];
  return {
    seen,
    query: async (text, params = []) => {
      seen.push({ text, params });
      return (text.includes("tenant_members") ? members : stores) as Record<string, unknown>[];
    },
  };
}

describe("AutoLabels publish authorizer", () => {
  it("allows an accepted tenant manager on a mapped rooftop", async () => {
    const d = db([{ role: "manager" }], [{ store_id: "s" }]);
    expect(await authorize(d, USER, req)).toEqual({ ok: true });
    expect(d.seen[0]!.params).toEqual([USER, TENANT]);
    expect(d.seen[0]!.text).toContain("accepted_at IS NOT NULL");
    expect(d.seen[1]!.text).toContain("r.status = 'active'");
    expect(d.seen[1]!.text).toContain("d.tenant_id = r.tenant_id");
  });

  it("refuses a user with no accepted membership in the tenant before looking at the rooftop", async () => {
    const d = db([], [{ store_id: "s" }]);
    expect(await authorize(d, USER, req)).toEqual({ ok: false, reason: "not_a_member" });
    expect(d.seen).toHaveLength(1);
  });

  it("refuses malformed ids without querying", async () => {
    const d = db([{ role: "owner" }], [{ store_id: "s" }]);
    expect(await authorize(d, "not-a-uuid", req)).toEqual({ ok: false, reason: "not_a_member" });
    expect(await authorize(d, USER, { ...req, tenant_id: "tnt-1" })).toEqual({ ok: false, reason: "not_a_member" });
    expect(d.seen).toHaveLength(0);
  });

  it("refuses staff-level members", async () => {
    expect(await authorize(db([{ role: "staff" }], [{ store_id: "s" }]), USER, req)).toEqual({ ok: false, reason: "role_not_permitted" });
    for (const role of PUBLISH_ROLES) expect(await authorize(db([{ role }], [{ store_id: "s" }]), USER, req)).toEqual({ ok: true });
  });

  it("refuses a rooftop that is not mapped to exactly one of the tenant's stores", async () => {
    expect(await authorize(db([{ role: "admin" }], []), USER, req)).toEqual({ ok: false, reason: "rooftop_unmapped" });
    expect(await authorize(db([{ role: "admin" }], [{ store_id: "a" }, { store_id: "b" }]), USER, req)).toEqual({ ok: false, reason: "rooftop_unmapped" });
  });

  it("exposes only the adapter's kinds and the record-id refs", () => {
    expect([...PUBLISH_KINDS]).toEqual([...PRODUCE_KINDS]);
    expect([...PUBLISH_REF_KEYS]).toEqual(["episode_id", "milestone_id"]);
  });
});
