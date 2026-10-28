import { describe, it, expect } from "vitest";
import { ENFORCEMENT_FACTS, enforcementRows, factsFor, policyFullyEnforced, worstStatus } from "./enforcementMap";

describe("enforcement map", () => {
  it("covers every policy area at every enforcement point exactly once", () => {
    const areas = ["customers", "vehicles", "sharing", "dealer_policy", "team"] as const;
    const points = ["interface", "direct_url", "api", "database"] as const;
    for (const a of areas) for (const p of points) {
      expect(ENFORCEMENT_FACTS.filter((f) => f.area === a && f.point === p), `${a}/${p}`).toHaveLength(1);
    }
  });

  it("never claims the interface or a deep link is permission", () => {
    for (const f of ENFORCEMENT_FACTS.filter((f) => f.point === "interface" || f.point === "direct_url")) {
      expect(f.status, `${f.area}/${f.point}`).not.toBe("enforced");
    }
  });

  it("records the member-wide settings and products writes as gaps, not guarantees", () => {
    expect(factsFor("dealer_policy").find((f) => f.point === "database")?.status).toBe("must_match");
    expect(factsFor("dealer_policy").find((f) => f.point === "api")?.status).toBe("must_match");
    expect(factsFor("vehicles").find((f) => f.point === "database")?.status).toBe("must_match");
  });

  it("credits the team procedures and table policy that the server does enforce", () => {
    expect(factsFor("team").find((f) => f.point === "api")?.status).toBe("enforced");
    expect(factsFor("team").find((f) => f.point === "database")?.status).toBe("enforced");
  });

  it("rolls the four rows up to the most severe status and orders evidence most severe first", () => {
    const rows = enforcementRows();
    expect(rows.map((r) => r.point)).toEqual(["interface", "direct_url", "api", "database"]);
    expect(rows.every((r) => r.status === "must_match")).toBe(true);
    const api = rows.find((r) => r.point === "api")!;
    expect(api.evidence[0].status).toBe("must_match");
    expect(api.evidence[api.evidence.length - 1]).toMatchObject({ area: "sharing", status: "enforced" });
    expect(policyFullyEnforced(rows)).toBe(false);
    expect(enforcementRows(["team"]).map((r) => r.status)).toEqual(["must_match", "must_match", "enforced", "enforced"]);
    expect(worstStatus(["enforced", "must_match"])).toBe("must_match");
    expect(worstStatus([])).toBe("enforced");
  });
});
