import { describe, it, expect } from "vitest";
import {
  ERROR_TAXONOMY,
  NON_RETRYABLE,
  classifyProviderError,
  errorFor,
  isRetryable,
  redactForAudit,
  toSafeError,
} from "../../../supabase/functions/_shared/description-errors";
import type { ErrorCategory } from "../../../supabase/functions/_shared/description-errors";

const ALL_CATEGORIES: ErrorCategory[] = [
  "authentication", "authorization", "tenant_isolation", "vehicle_not_found",
  "vehicle_truth", "configuration", "channel_policy", "voice_profile",
  "local_seo", "cta", "disclosure", "budget", "idempotency_conflict", "queue",
  "provider_rate_limit", "provider_timeout", "provider_authentication",
  "provider_unavailable", "provider_malformed_response", "structured_output",
  "validation_blocked", "repair_exhausted", "persistence", "unknown_internal",
];

describe("taxonomy completeness", () => {
  it("defines every category exactly once, self-keyed", () => {
    for (const category of ALL_CATEGORIES) {
      const def = ERROR_TAXONOMY[category];
      expect(def, `missing definition for ${category}`).toBeTruthy();
      expect(def.category).toBe(category);
    }
    expect(Object.keys(ERROR_TAXONOMY).sort()).toEqual([...ALL_CATEGORIES].sort());
  });

  it("gives every category a non-empty user message and a unique diagnostic code", () => {
    const codes = new Set<string>();
    for (const category of ALL_CATEGORIES) {
      const def = errorFor(category);
      expect(def.userMessage.trim().length).toBeGreaterThan(0);
      expect(def.diagnosticCode).toMatch(/^AL-DESC-\d{4}$/);
      expect(codes.has(def.diagnosticCode)).toBe(false);
      codes.add(def.diagnosticCode);
    }
  });
});

describe("provider status classification", () => {
  it("maps rate limiting, outages, auth, timeouts and bad requests", () => {
    expect(classifyProviderError(429)).toBe("provider_rate_limit");
    expect(classifyProviderError(500)).toBe("provider_unavailable");
    expect(classifyProviderError(503)).toBe("provider_unavailable");
    expect(classifyProviderError(401)).toBe("provider_authentication");
    expect(classifyProviderError(403)).toBe("provider_authentication");
    expect(classifyProviderError(408)).toBe("provider_timeout");
    expect(classifyProviderError(504)).toBe("provider_timeout");
    expect(classifyProviderError(400)).toBe("configuration");
  });

  it("treats a schema complaint on a 400 as a structured-output failure", () => {
    expect(classifyProviderError(400, '{"error":{"message":"response_format schema invalid"}}'))
      .toBe("structured_output");
    expect(classifyProviderError(422, "failed to parse tool_use block")).toBe("structured_output");
  });

  it("treats a dropped connection as a timeout", () => {
    expect(classifyProviderError(0)).toBe("provider_timeout");
  });
});

describe("retry policy", () => {
  it("never retries the categories that would fail identically every time", () => {
    for (const category of NON_RETRYABLE) {
      expect(errorFor(category).retryable, `${category} must not be retryable`).toBe(false);
    }
    expect([...NON_RETRYABLE].sort()).toEqual([
      "authentication", "authorization", "budget", "configuration",
      "tenant_isolation", "validation_blocked", "vehicle_not_found",
    ]);
  });

  it("retries only transient faults", () => {
    const retryable = ALL_CATEGORIES.filter((c) => isRetryable(c)).sort();
    expect(retryable).toEqual([
      "persistence", "provider_malformed_response", "provider_rate_limit",
      "provider_timeout", "provider_unavailable", "queue", "structured_output",
    ]);
  });
});

describe("costMayHaveOccurred honesty", () => {
  it("admits a timeout may already have been billed", () => {
    // We stopped waiting; the provider may have completed the inference.
    expect(errorFor("provider_timeout").costMayHaveOccurred).toBe(true);
    expect(errorFor(classifyProviderError(504)).costMayHaveOccurred).toBe(true);
  });

  it("claims no cost only for failures that provably preceded the request", () => {
    expect(errorFor("authentication").costMayHaveOccurred).toBe(false);
    expect(errorFor("authorization").costMayHaveOccurred).toBe(false);
    expect(errorFor("tenant_isolation").costMayHaveOccurred).toBe(false);
    expect(errorFor("provider_authentication").costMayHaveOccurred).toBe(false);
    expect(errorFor("budget").costMayHaveOccurred).toBe(false);
    expect(errorFor("vehicle_not_found").costMayHaveOccurred).toBe(false);
  });

  it("admits cost for every post-response failure", () => {
    for (const category of [
      "provider_malformed_response", "structured_output", "validation_blocked",
      "repair_exhausted", "persistence", "unknown_internal",
    ] as ErrorCategory[]) {
      expect(errorFor(category).costMayHaveOccurred, category).toBe(true);
    }
  });
});

describe("toSafeError", () => {
  it("returns only the five user-safe fields", () => {
    const safe = toSafeError("provider_timeout");
    expect(Object.keys(safe).sort()).toEqual([
      "category", "costMayHaveOccurred", "diagnosticCode", "retryable", "userMessage",
    ]);
    expect(safe.category).toBe("provider_timeout");
    expect(safe.costMayHaveOccurred).toBe(true);
  });

  it("never leaks a planted secret from the internal detail", () => {
    const planted = "sk-live-7f3a9d2b4c6e8a0f1b3d5f7a9c1e3d5f Bearer eyJhbGciOiJIUzI1NiJ9.leak "
      + "at generateDescription (/srv/functions/generate.ts:214:11) "
      + 'PG: duplicate key value violates unique constraint "descriptions_pkey" '
      + "tenant_id=00000000-dead-beef-0000-000000000999";
    const safe = toSafeError("persistence", planted);
    const serialized = JSON.stringify(safe);

    expect(serialized).not.toContain("sk-live");
    expect(serialized).not.toContain("eyJhbGci");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("generate.ts");
    expect(serialized).not.toContain("descriptions_pkey");
    expect(serialized).not.toContain("dead-beef");
    expect(serialized).not.toMatch(/at \w+ \(/);
  });

  it("falls back to the internal category for an unrecognized input", () => {
    const safe = toSafeError("not_a_real_category" as ErrorCategory);
    expect(safe.category).toBe("unknown_internal");
    expect(safe.costMayHaveOccurred).toBe(true);
  });
});

describe("redactForAudit", () => {
  it("strips credential-shaped keys and preserves benign ones", () => {
    const redacted = redactForAudit({
      api_key: "sk-live-abc123",
      apiKey: "sk-live-abc123",
      ANTHROPIC_API_KEY: "sk-ant-abc123",
      access_token: "abc123",
      refresh_token: "abc123",
      secret: "hunter2",
      password: "hunter2",
      Authorization: "Bearer abc123",
      service_role_key: "abc123",
      vehicle_id: "veh_42",
      vin: "JN8AZ2NE7L9250001",
      channel: "vdp",
      attempt: 2,
      tenant_id: "11111111-2222-3333-4444-555555555555",
    });

    for (const key of [
      "api_key", "apiKey", "ANTHROPIC_API_KEY", "access_token", "refresh_token",
      "secret", "password", "Authorization", "service_role_key",
    ]) {
      expect(redacted[key], key).toBe("[redacted]");
    }

    expect(redacted.vehicle_id).toBe("veh_42");
    expect(redacted.vin).toBe("JN8AZ2NE7L9250001");
    expect(redacted.channel).toBe("vdp");
    expect(redacted.attempt).toBe(2);
    expect(redacted.tenant_id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("redacts bearer-like values even under an innocent key name", () => {
    const redacted = redactForAudit({
      note: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      blob: "A".repeat(64),
      short: "ok",
    });
    expect(redacted.note).toBe("[redacted]");
    expect(redacted.blob).toBe("[redacted]");
    expect(redacted.short).toBe("ok");
  });

  it("recurses into nested objects and arrays", () => {
    const redacted = redactForAudit({
      provider: { name: "anthropic", api_key: "sk-live-abc123" },
      headers: [{ authorization: "Bearer abc" }, { "content-type": "application/json" }],
    });
    const provider = redacted.provider as Record<string, unknown>;
    expect(provider.name).toBe("anthropic");
    expect(provider.api_key).toBe("[redacted]");

    const headers = redacted.headers as Record<string, unknown>[];
    expect(headers[0].authorization).toBe("[redacted]");
    expect(headers[1]["content-type"]).toBe("application/json");
  });
});
