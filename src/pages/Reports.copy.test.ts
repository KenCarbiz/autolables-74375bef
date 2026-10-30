import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// F29: dealer-facing report copy never names internal tables, milestones or
// scheduled jobs.
describe("Reports dealer copy", () => {
  const src = readFileSync(join(__dirname, "Reports.tsx"), "utf8");
  const quoted = src.match(/"[^"\n]{12,}"|`[^`\n]{12,}`/g) ?? [];
  it("has no raw table names, wave/milestone labels or cron text in visible strings", () => {
    const text = quoted.join("\n");
    expect(text).not.toMatch(/generated_documents|vehicle_lifecycle|audit_log/);
    expect(text).not.toMatch(/\bWave \d+|\bmilestone\b|\bcron\b/i);
    expect(text).not.toMatch(/Population:/);
  });
});
