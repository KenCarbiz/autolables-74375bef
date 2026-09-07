import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Home is now role-resolved. These pin the two properties that make that safe:
// no role loses a landing page, and no role silently lands on another's board.

const SRC = readFileSync(join(__dirname, "RoleHome.tsx"), "utf8");
const APP = readFileSync(join(__dirname, "../App.tsx"), "utf8");

describe("role-resolved home (R1)", () => {
  it("maps every role that has a dedicated board", () => {
    for (const role of [
      "owner", "general_manager", "gsm", "admin",
      "sales_manager", "salesperson",
      "used_car_manager", "inventory_manager",
      "service_manager", "service_advisor",
    ]) {
      expect(SRC).toContain(`${role}:`);
    }
  });

  it("falls back to the existing dashboard rather than guessing", () => {
    // office, finance, compliance, biller and readonly have no dedicated board.
    // Sending them to a manager's screen would be worse than the general one.
    expect(SRC).toContain("|| (isAdmin ? GmHome : ProcessDashboard)");
  });

  it("renders nothing while the membership loads, so no board flashes first", () => {
    expect(SRC).toContain("if (loading) return null;");
  });

  it("lower-cases the stored role before matching", () => {
    expect(SRC).toContain('String(member?.role || "").trim().toLowerCase()');
  });
});

describe("routing (R2)", () => {
  it("points /dashboard at the resolver", () => {
    expect(APP).toContain('<Route path="/dashboard" element={<RoleHome />} />');
  });

  it("keeps every board directly reachable", () => {
    for (const path of ["/home/gm", "/home/sales", "/home/used-cars", "/home/service"]) {
      expect(APP).toContain(`path="${path}"`);
    }
  });

  it("does not strand the previous dashboard", () => {
    // It is still the fallback for unmapped roles, so it must stay routable.
    expect(APP).toContain('<Route path="/dashboard/classic" element={<ProcessDashboard />} />');
  });
});
