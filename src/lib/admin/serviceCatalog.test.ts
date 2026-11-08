import { describe, expect, it } from "vitest";
import type { GetReadyService } from "@/contexts/DealerSettingsContext";
import { addService, emptyServiceDraft, formatCost, normalizeCost, removeService, replaceService, requiresPhotoProof, toEntry, validateService } from "./serviceCatalog";

const svc = (name: string, extra: Partial<GetReadyService> = {}): GetReadyService => ({ name, responsible_name: "Team", responsible_email: "", cost: "", ...extra });
const draft = (p: Partial<ReturnType<typeof emptyServiceDraft>> = {}) => ({ ...emptyServiceDraft(), name: "Example service", ...p });

describe("service catalog validation", () => {
  it("requires a name", () => {
    expect(validateService(draft({ name: "  " }), [], null).name).toBe("Enter the service name.");
  });

  it("rejects a duplicate name ignoring case, but not the entry being edited", () => {
    const all = [svc("Key cut"), svc("Detail")];
    expect(validateService(draft({ name: "key CUT" }), all, null).name).toMatch(/already exists/);
    expect(validateService(draft({ name: "key CUT" }), all, "Key cut").name).toBeUndefined();
    expect(validateService(draft({ name: "Detail" }), all, "Key cut").name).toMatch(/already exists/);
  });

  it("accepts blank cost and money with up to two decimals in the supported currency", () => {
    for (const cost of ["", "150", "149.95", "$1,250.50", " 0 "]) expect(validateService(draft({ cost }), [], null).cost).toBeUndefined();
  });

  it("rejects malformed or oversize cost", () => {
    for (const cost of ["12.345", "abc", "-5", "12,5x", "1000000"]) expect(validateService(draft({ cost }), [], null).cost).toBeTruthy();
    expect(validateService(draft({ cost: "100001" }), [], null).cost).toMatch(/USD/);
  });

  it("validates the email only when given", () => {
    expect(validateService(draft({ responsible_email: "" }), [], null).responsible_email).toBeUndefined();
    expect(validateService(draft({ responsible_email: "not-an-email" }), [], null).responsible_email).toBeTruthy();
    expect(validateService(draft({ responsible_email: "a@example.com, b@example.com" }), [], null).responsible_email).toBeTruthy();
    expect(validateService(draft({ responsible_email: "a@example.com" }), [], null).responsible_email).toBeUndefined();
  });

  it("stores a normalized entry", () => {
    expect(toEntry(draft({ name: "  Key cut ", cost: "$1,250.50 ", responsible_email: " a@example.com " }))).toEqual({ name: "Key cut", responsible_name: "", responsible_email: "a@example.com", cost: "1250.50" });
    expect(normalizeCost("$ 12")).toBe("12");
    expect(formatCost("1250.5")).toBe("$1,250.50");
    expect(formatCost("")).toBe("Not set");
  });
});

describe("service catalog edits", () => {
  it("edits one entry and leaves the others as they were", () => {
    const all = [svc("A"), svc("B"), svc("C")];
    const next = replaceService(all, "b", svc("B2", { cost: "5" }));
    expect(next[0]).toBe(all[0]);
    expect(next[2]).toBe(all[2]);
    expect(next[1].name).toBe("B2");
    expect(removeService(all, "A").map((s) => s.name)).toEqual(["B", "C"]);
    expect(addService(all, svc("D")).length).toBe(4);
  });

  it("matches photo proof by task label, not by id", () => {
    expect(requiresPhotoProof(svc("Mud flaps installed"), "Mud flaps installed, Running boards installed")).toBe(true);
    expect(requiresPhotoProof(svc("mud flaps INSTALLED"), "Mud flaps installed")).toBe(true);
    expect(requiresPhotoProof(svc("Key cut"), "Mud flaps installed")).toBe(false);
    expect(requiresPhotoProof(svc("Key cut"), undefined)).toBe(false);
  });
});
