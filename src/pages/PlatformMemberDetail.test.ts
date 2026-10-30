import { describe, it, expect } from "vitest";
import { getDealerCapabilities } from "@/lib/permissions/dealerRoleCapabilities";
import { levelFor } from "./PlatformMemberDetail";

const reports = { label: "Reports", view: "can_view_reports" } as const;
const vehicles = { label: "Vehicles", view: "can_view_inventory", manage: "can_edit_inventory" } as const;

describe("levelFor", () => {
  it("reads Allow, Read only and Deny from the role's capabilities", () => {
    expect(levelFor(getDealerCapabilities("admin"), vehicles)).toBe("Allow");
    expect(levelFor(getDealerCapabilities("readonly"), vehicles)).toBe("Read only");
    expect(levelFor(getDealerCapabilities("third_party_vendor"), vehicles)).toBe("Deny");
    expect(levelFor(getDealerCapabilities("readonly"), reports)).toBe("Allow");
  });
});
