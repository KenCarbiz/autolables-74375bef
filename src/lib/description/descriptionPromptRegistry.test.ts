import { describe, it, expect, afterEach } from "vitest";
import {
  PROMPT_REGISTRY, PROMPT_SCHEMA_VERSION, activeComponent, componentsFor,
  compilePrompt, promptChecksum, isEmergencyDisabled,
} from "../../../supabase/functions/_shared/description-prompt-registry";
import type { PromptComponentKey } from "../../../supabase/functions/_shared/description-prompt-registry";

const ALL_KEYS: PromptComponentKey[] = [
  "global_safety", "vehicle_truth_policy", "description_task", "channel_policy",
  "tone_policy", "voice_policy", "local_seo_policy", "approved_language_policy",
  "cta_policy", "disclosure_policy", "structured_output", "validation_feedback",
  "repair_policy", "preview_policy",
];

const ENV_KEY = "AUTOLABELS_PROMPT_EMERGENCY_DISABLED";

const DYNAMIC = [
  { label: "VERIFIED FACTS", body: "- ymm: 2025 INFINITI QX80  [source: decode; status: verified]" },
  { label: "DESTINATION RULES", body: "- Length: 700-1300 characters." },
];

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("prompt registry shape", () => {
  it("has exactly one active component per key", () => {
    for (const key of ALL_KEYS) {
      const active = PROMPT_REGISTRY.filter((c) => c.key === key && c.status === "active");
      expect(active, key).toHaveLength(1);
      expect(activeComponent(key)?.version).toBe(active[0].version);
    }
  });

  it("covers every declared key and declares no key outside the union", () => {
    const keys = new Set(PROMPT_REGISTRY.map((c) => c.key));
    expect([...keys].sort()).toEqual([...ALL_KEYS].sort());
  });

  it("retains superseded and draft history instead of editing in place", () => {
    const safety = PROMPT_REGISTRY.filter((c) => c.key === "global_safety");
    expect(safety.length).toBeGreaterThan(1);
    const superseded = safety.find((c) => c.status === "superseded");
    expect(superseded).toBeDefined();
    expect(superseded?.supersededAt).toBeTruthy();
    expect(superseded?.changeReason).not.toBe("");
    expect(PROMPT_REGISTRY.some((c) => c.status === "draft")).toBe(true);
  });

  it("is frozen so an active component cannot be edited in place", () => {
    expect(Object.isFrozen(PROMPT_REGISTRY)).toBe(true);
    const safety = activeComponent("global_safety");
    expect(safety).toBeDefined();
    expect(Object.isFrozen(safety)).toBe(true);
    const mutable = safety as unknown as Record<string, string>;
    expect(() => { mutable.content = "anything goes"; }).toThrow();
    expect(activeComponent("global_safety")?.content).toBe(safety?.content);
  });

  it("only returns active components from componentsFor", () => {
    const got = componentsFor(["local_seo_policy", "global_safety"]);
    expect(got).toHaveLength(2);
    expect(got.every((c) => c.status === "active")).toBe(true);
    expect(got.find((c) => c.key === "global_safety")?.version).toBe("2.0.0");
    expect(got.find((c) => c.key === "local_seo_policy")?.version).toBe("1.0.0");
  });
});

describe("compilePrompt", () => {
  it("is deterministic for the same input", async () => {
    const a = await compilePrompt(["global_safety", "tone_policy", "cta_policy"], DYNAMIC);
    const b = await compilePrompt(["global_safety", "tone_policy", "cta_policy"], DYNAMIC);
    expect(a.text).toBe(b.text);
    expect(a.checksum).toBe(b.checksum);
    expect(a.schemaVersion).toBe(PROMPT_SCHEMA_VERSION);
  });

  it("ignores caller order for text, keys and checksum", async () => {
    const forward = await compilePrompt(
      ["global_safety", "vehicle_truth_policy", "tone_policy", "cta_policy"], DYNAMIC,
    );
    const reversed = await compilePrompt(
      ["cta_policy", "tone_policy", "vehicle_truth_policy", "global_safety"], DYNAMIC,
    );
    expect(reversed.text).toBe(forward.text);
    expect(reversed.checksum).toBe(forward.checksum);
    expect(reversed.componentKeys).toEqual(forward.componentKeys);
  });

  it("emits components in registry order, not requested order", async () => {
    const compiled = await compilePrompt(["structured_output", "global_safety"], []);
    expect(compiled.componentKeys).toEqual(["global_safety", "structured_output"]);
    expect(compiled.text.indexOf("GLOBAL SAFETY"))
      .toBeLessThan(compiled.text.indexOf("OUTPUT"));
  });

  it("collapses duplicate keys", async () => {
    const once = await compilePrompt(["tone_policy"], []);
    const twice = await compilePrompt(["tone_policy", "tone_policy"], []);
    expect(twice.text).toBe(once.text);
    expect(twice.checksum).toBe(once.checksum);
    expect(twice.componentKeys).toEqual(["tone_policy"]);
  });

  it("stamps the active version of every compiled component", async () => {
    const compiled = await compilePrompt(["global_safety", "local_seo_policy"], []);
    expect(compiled.componentVersions).toEqual({
      global_safety: "2.0.0",
      local_seo_policy: "1.0.0",
    });
  });

  it("never compiles superseded or draft content", async () => {
    const compiled = await compilePrompt(ALL_KEYS, DYNAMIC);
    const superseded = PROMPT_REGISTRY.find(
      (c) => c.key === "global_safety" && c.status === "superseded",
    );
    const draft = PROMPT_REGISTRY.find(
      (c) => c.key === "local_seo_policy" && c.status === "draft",
    );
    expect(superseded && compiled.text.includes(superseded.content)).toBe(false);
    expect(draft && compiled.text.includes(draft.content)).toBe(false);
    expect(compiled.text).toContain(`v${activeComponent("global_safety")?.version}`);
    expect(compiled.componentKeys).toHaveLength(ALL_KEYS.length);
  });

  it("appends dynamic sections after the components, in caller order", async () => {
    const compiled = await compilePrompt(["global_safety"], DYNAMIC);
    expect(compiled.text).toContain(DYNAMIC[0].body);
    expect(compiled.text).toContain(DYNAMIC[1].body);
    expect(compiled.text.indexOf("GLOBAL SAFETY"))
      .toBeLessThan(compiled.text.indexOf(DYNAMIC[0].body));
    expect(compiled.text.indexOf(DYNAMIC[0].body))
      .toBeLessThan(compiled.text.indexOf(DYNAMIC[1].body));
  });

  it("changes the checksum when a dynamic body changes", async () => {
    const a = await compilePrompt(["global_safety"], DYNAMIC);
    const b = await compilePrompt(["global_safety"], [
      DYNAMIC[0], { label: DYNAMIC[1].label, body: "- Length: 350-800 characters." },
    ]);
    expect(b.checksum).not.toBe(a.checksum);
  });

  it("changes the checksum when a component version changes", async () => {
    const before = await promptChecksum([{ key: "global_safety", version: "1.0.0" }], DYNAMIC);
    const after = await promptChecksum([{ key: "global_safety", version: "2.0.0" }], DYNAMIC);
    expect(after).not.toBe(before);
  });

  it("throws for a key with no active version", async () => {
    await expect(compilePrompt(["not_a_component" as PromptComponentKey], []))
      .rejects.toThrow(/no active version/);
  });
});

describe("emergency disable", () => {
  it("reports and refuses to compile a disabled component", async () => {
    expect(isEmergencyDisabled("cta_policy")).toBe(false);
    process.env[ENV_KEY] = "cta_policy";
    expect(isEmergencyDisabled("cta_policy")).toBe(true);
    expect(isEmergencyDisabled("tone_policy")).toBe(false);
    await expect(compilePrompt(["tone_policy", "cta_policy"], []))
      .rejects.toThrow(/emergency-disabled/);
    await expect(compilePrompt(["tone_policy"], [])).resolves.toBeDefined();
  });

  it("clears once the deny-list is removed", async () => {
    process.env[ENV_KEY] = "cta_policy,voice_policy";
    expect(isEmergencyDisabled("voice_policy")).toBe(true);
    delete process.env[ENV_KEY];
    expect(isEmergencyDisabled("voice_policy")).toBe(false);
    await expect(compilePrompt(["voice_policy"], [])).resolves.toBeDefined();
  });
});

describe("registry content", () => {
  it("contains no credential-shaped strings", () => {
    const patterns = [
      /api[_-]?key/i, /secret/i, /password/i, /\bbearer\b/i, /authorization:/i,
      /service[_-]?role/i, /\bsk-[A-Za-z0-9]{8,}/, /-----BEGIN/, /eyJ[A-Za-z0-9_-]{10,}/,
    ];
    for (const c of PROMPT_REGISTRY) {
      const material = [c.key, c.displayName, c.purpose, c.content, c.changeReason, c.owner].join("\n");
      for (const p of patterns) {
        expect(p.test(material), `${c.key}@${c.version} matched ${p}`).toBe(false);
      }
    }
  });

  it("carries no tenant-private identifiers", () => {
    for (const c of PROMPT_REGISTRY) {
      expect(c.owner).toBe("autolabels_platform");
      expect(/tenant_id|tenant-[0-9a-f]{8}/i.test(c.content)).toBe(false);
    }
  });

  it("states the no-invention rule in the safety component", () => {
    const safety = activeComponent("global_safety");
    expect(safety).toBeDefined();
    const content = safety?.content ?? "";
    expect(content).toMatch(/never invent/i);
    expect(content).toMatch(/HOW a verified fact is expressed/);
    expect(content).toMatch(/never .* WHETHER it is true/i);
    for (const subject of [
      "equipment", "warranty", "ownership history", "accident history",
      "fuel economy", "horsepower", "towing capacity", "pricing",
    ]) {
      expect(content.toLowerCase(), subject).toContain(subject);
    }
  });

  it("states the truth-over-fluency rule in the vehicle truth component", () => {
    const truth = activeComponent("vehicle_truth_policy")?.content ?? "";
    expect(truth).toMatch(/pending/i);
    expect(truth).toMatch(/dealer-installed/i);
    expect(truth).toMatch(/factory equipment/i);
  });

  it("gives every component an owner, a change reason and an effective date", () => {
    for (const c of PROMPT_REGISTRY) {
      expect(c.owner).not.toBe("");
      expect(c.changeReason).not.toBe("");
      expect(c.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.content.trim().length).toBeGreaterThan(80);
      if (c.status === "active") expect(c.supersededAt).toBeNull();
    }
  });
});
