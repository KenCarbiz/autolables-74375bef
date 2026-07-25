import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSPECTION_STATES,
  INSPECTION_TRANSITIONS,
  canTransitionInspection,
  SIGNATURE_ONLY_STATE,
  REPAIR_STATES,
  isFailureResolved,
} from "./transitions";

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");

describe("inspection state machine (S2)", () => {
  it("matches the SQL transition map literal exactly — one machine, two runtimes", () => {
    const sql = readFileSync(join(MIGRATIONS, "20260726102000_inspection_state.sql"), "utf8");
    const m = sql.match(/v_allowed jsonb := '(\{[\s\S]*?\})'::jsonb/);
    expect(m).toBeTruthy();
    expect(JSON.parse((m as RegExpMatchArray)[1])).toEqual(INSPECTION_TRANSITIONS);
  });

  it("every state is covered and every target is a known state", () => {
    for (const s of INSPECTION_STATES) expect(INSPECTION_TRANSITIONS[s]).toBeDefined();
    for (const targets of Object.values(INSPECTION_TRANSITIONS)) {
      for (const t of targets) expect(INSPECTION_STATES).toContain(t);
    }
  });

  it("'passed' is unreachable through the workflow RPC — only a signature enters it", () => {
    for (const from of INSPECTION_STATES) {
      expect(canTransitionInspection(from, SIGNATURE_ONLY_STATE)).toBe(false);
    }
  });

  it("failed_items_open is only re-enterable from inside the failure loop", () => {
    for (const from of INSPECTION_STATES) {
      expect(canTransitionInspection(from, "failed_items_open")).toBe(from === "repairs_in_progress");
    }
  });

  it("voided is terminal", () => {
    expect(INSPECTION_TRANSITIONS.voided).toEqual([]);
  });

  it("the repair loop routes failed items to reinspection, never straight to passed", () => {
    expect(canTransitionInspection("failed_items_open", "repairs_in_progress")).toBe(true);
    expect(canTransitionInspection("repairs_in_progress", "ready_for_reinspection")).toBe(true);
    expect(canTransitionInspection("ready_for_reinspection", "repairs_in_progress")).toBe(true);
    expect(canTransitionInspection("failed_items_open", "passed")).toBe(false);
  });

  it("the CHECK constraint enumerates the same states", () => {
    const sql = readFileSync(join(MIGRATIONS, "20260726102000_inspection_state.sql"), "utf8");
    for (const s of INSPECTION_STATES) expect(sql).toContain(`'${s}'`);
  });
});

describe("failed-item repair states (S3)", () => {
  it("only passed_on_reinspection resolves a failure — repair complete is not passed", () => {
    expect(isFailureResolved("repair_completed")).toBe(false);
    expect(isFailureResolved("ready_for_reinspection")).toBe(false);
    expect(isFailureResolved("passed_on_reinspection")).toBe(true);
    expect(isFailureResolved(null)).toBe(false);
  });

  it("the item-failures migration CHECK carries the same six states", () => {
    const sql = readFileSync(join(MIGRATIONS, "20260726103000_inspection_item_failures.sql"), "utf8");
    for (const s of REPAIR_STATES) expect(sql).toContain(`'${s}'`);
  });
});
