import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LIFECYCLE_STATES, SERVICE_FLOOR_STATES, STATE_LABEL, STATE_NEXT_ACTION, STATE_OWNER,
  isLifecycleState, stateLabel,
} from "./states";

// The database, not this file, decides which states exist. Reading the CHECK
// constraint here is what makes the vocabulary one source instead of two: a
// state added to the migration fails this suite until every screen's map
// covers it.
const MIGRATION = join(__dirname, "../../../supabase/migrations/20260726220000_vehicle_lifecycle_foundation.sql");

const constraintStates = (): string[] => {
  const sql = readFileSync(MIGRATION, "utf8");
  const check = sql.match(/vehicle_lifecycle_state_check CHECK \(state IN \(([\s\S]*?)\)\)/);
  if (!check) throw new Error("vehicle_lifecycle_state_check not found in the migration");
  return Array.from(check[1].matchAll(/'([A-Z0-9_]+)'/g)).map((m) => m[1]);
};

describe("the lifecycle vocabulary matches the database", () => {
  it("covers exactly the states the CHECK constraint allows", () => {
    const fromSql = constraintStates();
    expect(fromSql).toHaveLength(22);
    expect([...LIFECYCLE_STATES].sort()).toEqual([...fromSql].sort());
  });

  it("labels, owners and next actions cover every state", () => {
    for (const state of constraintStates()) {
      expect(STATE_LABEL[state as never], `no label for ${state}`).toBeTruthy();
      expect(STATE_OWNER[state as never], `no owner for ${state}`).toBeTruthy();
      expect(STATE_NEXT_ACTION[state as never], `no next action for ${state}`).toBeTruthy();
    }
  });

  it("keeps the service floor a subset of the canonical states", () => {
    for (const state of SERVICE_FLOOR_STATES) expect(LIFECYCLE_STATES).toContain(state);
    expect(SERVICE_FLOOR_STATES).not.toContain("AWAITING_MANAGER_AUTHORIZATION");
    expect(SERVICE_FLOOR_STATES).not.toContain("RETAIL_READY");
  });

  it("recognises a stored state and refuses anything else", () => {
    expect(isLifecycleState("RETAIL_READY")).toBe(true);
    expect(isLifecycleState("retail_ready")).toBe(false);
    expect(isLifecycleState(null)).toBe(false);
    expect(stateLabel("K208_IN_PROGRESS")).toBe("Inspection in progress");
    expect(stateLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(stateLabel(null)).toBe("");
  });
});

describe("no screen keeps a second copy of the vocabulary", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

  it("reads the shared labels rather than redeclaring them", () => {
    for (const page of [
      "pages/ServiceManagerHome.tsx",
      "pages/ServiceWriterDesk.tsx",
      "pages/UsedCarManagerHome.tsx",
      "components/vehicleFile/lifecycle.ts",
    ]) {
      const src = read(page);
      expect(src, `${page} declares its own STATE_LABEL`).not.toMatch(/const STATE_LABEL\s*[:=]/);
      expect(src, `${page} does not read @/lib/lifecycle/states`).toMatch(/@\/lib\/lifecycle\/states/);
    }
  });
});

describe("ownership names the desk that must act next (L3)", () => {
  it("hands priced findings to the service writer, not back to the bench", () => {
    // The technician records findings; the writer prices them; the used car
    // manager authorises. The manager appears one state later, deliberately.
    expect(STATE_OWNER.SERVICE_FINDINGS_RECORDED).toBe("Service writer");
    expect(STATE_OWNER.WAITING_FOR_MANAGER_DECISION).toBe("Used car manager");
  });

  it("hands a finalized K-208 to detail", () => {
    expect(STATE_OWNER.K208_FINALIZED).toBe("Detail");
    expect(STATE_NEXT_ACTION.K208_FINALIZED).toContain("detail");
  });

  it("gives every state an owner, so no board can render a blank accountable desk", () => {
    for (const state of LIFECYCLE_STATES) {
      expect(STATE_OWNER[state], `no owner for ${state}`).toBeTruthy();
    }
  });
});
