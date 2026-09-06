import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Building the DriveSignal pieces and not connecting them would leave this
// codebase with a sixth tested-but-unimported module. These assert the wiring,
// not the pieces — each piece has its own suite.

const orch = readFileSync(join(__dirname,
  "../../../supabase/functions/description-orchestrate/index.ts"), "utf8");
const migration = readFileSync(join(__dirname,
  "../../../supabase/migrations/20260906130000_description_provider_config.sql"), "utf8");
// Comments carry the revert instructions, which name the very columns some of
// these assertions forbid in executable SQL. Strip them before asserting.
const executable = migration.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("the orchestrator uses the pieces", () => {
  it("generates through the provider abstraction, not a hard-coded vendor", () => {
    expect(orch).toMatch(/import \{ createProvider/);
    expect(orch).toMatch(/createProvider\(\s*\n?\s*settings\.generation_provider === "openai"/);
  });

  it("sends the pinned V3 instructions and the selected knowledge as the system slot", () => {
    expect(orch).toMatch(/systemPrompt: `\$\{DRIVESIGNAL_V3_SYSTEM\}/);
    expect(orch).toMatch(/assembleKnowledge\(vehicleSignals\(/);
  });

  it("keeps the per-vehicle packet out of the cacheable prefix", () => {
    // buildMasterPromptV3 is the varying part and must be the user content.
    expect(orch).toMatch(/userContent: buildMasterPromptV3\(packet, settings\)/);
  });

  it("asks for structured output and refuses prose that degraded out of it", () => {
    expect(orch).toMatch(/schema: DESCRIPTION_OUTPUT_SCHEMA/);
    expect(orch).toMatch(/structured_output_missing/);
  });

  it("writes the evidence ledger onto the version", () => {
    for (const col of ["prompt_profile", "knowledge_revision", "knowledge_modules",
                       "headline", "claimed_fact_ids", "fact_roles_json",
                       "evidence_audit_json"]) {
      expect(orch, col).toContain(`${col}:`);
    }
  });

  it("runs the QA gates and feeds them into the existing eligibility engine", () => {
    // Imported-but-never-called is how the five orphan modules in this
    // codebase happened; the gates were briefly the sixth.
    expect(orch).toMatch(/const gateReport = runGates\(\{/);
    expect(orch).toMatch(/findings = \[\.\.\.findings, \.\.\.gateReport\.findings/);
    expect(orch).toMatch(/\.filter\(\(g\) => g\.origin === "gate"\)/);
  });

  it("does not let the gates decide publication themselves", () => {
    // decideEligibility stays the single verdict; two authorities drift.
    const after = orch.slice(orch.indexOf("const gateReport = runGates"));
    expect(after).toMatch(/decideEligibility\(/);
    expect(orch).not.toMatch(/gateReport\.decision === "REJECT"[\s\S]{0,80}return/);
  });

  it("leaves a tenant that is not on the profile completely alone", () => {
    // The platform prompt builder path must remain reachable and unchanged.
    expect(orch).toMatch(/if \(settings\.prompt_profile !== "drivesignal-v3-system"\)/);
  });

  it("defaults a tenant with no settings row to the existing writer", () => {
    expect(orch).toMatch(/generation_provider: "anthropic", prompt_profile: "platform_v3"/);
  });
});

describe("the migration changes configuration, not behaviour", () => {
  it("defaults every tenant to the current provider", () => {
    expect(migration).toMatch(/generation_provider text NOT NULL DEFAULT 'anthropic'/);
    expect(migration).toMatch(/prompt_profile\s+text NOT NULL DEFAULT 'platform_v3'/);
  });

  it("constrains the provider to adapters that exist", () => {
    expect(migration).toMatch(/CHECK \(generation_provider IN \('anthropic', 'openai'\)\)/);
  });

  it("enrols every tenant, including ones onboarded later", () => {
    // The owner chose all tenants for the pilot, so the column default has to
    // move too or tomorrow's dealership quietly arrives on the old writer.
    expect(executable).toMatch(/ALTER COLUMN generation_provider SET DEFAULT 'openai'/);
    expect(executable).toMatch(/ALTER COLUMN prompt_profile\s+SET DEFAULT 'drivesignal-v3-system'/);
    expect(executable).toMatch(/SET generation_provider = 'openai'/);
  });

  it("keeps our spend ceiling below the provider's", () => {
    // A cap we own trips a gate and raises a retryable exception; the vendor's
    // cap hard-fails every remaining vehicle in the sweep.
    expect(executable).toMatch(/description_generation_budgets/);
    expect(executable).toMatch(/monthly_generation_budget[\s\S]{0,80}90|SELECT ds\.tenant_id, 90/);
  });

  it("stores no credential", () => {
    expect(executable).not.toMatch(/sk-|api_key|API_KEY\s*=/);
  });
});
