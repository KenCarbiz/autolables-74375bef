import { describe, it, expect } from "vitest";
import {
  createProvider, buildOpenAIRequest, buildAnthropicRequest,
  normalizeOpenAIResponse, normalizeAnthropicResponse, parseStructured,
  classifyStatus, ProviderError,
} from "../../../supabase/functions/_shared/description-provider.ts";
import { DESCRIPTION_OUTPUT_SCHEMA } from "../../../supabase/functions/_shared/description-evidence.ts";
import { DRIVESIGNAL_V3_SYSTEM } from "../../../supabase/functions/_shared/prompts/drivesignal-v3-system.ts";

const REQ = {
  systemPrompt: DRIVESIGNAL_V3_SYSTEM,
  userContent: "VIN JN8AZ3CC5T9624253 — verified facts follow.",
  model: "some-configured-model",
  schema: DESCRIPTION_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
};
const envWith = (v: Record<string, string>) => ({ get: (k: string) => v[k] });

describe("the request keeps the ruleset ahead of the vehicle", () => {
  it("sends the stable prompt in its own field, not glued to the facts", () => {
    // A prefix that varies per VIN cannot be cached, and every rooftop pays
    // full input cost for an unchanged 20,000-character ruleset on every car.
    const body = buildOpenAIRequest(REQ) as Record<string, any>;
    expect(body.instructions).toBe(DRIVESIGNAL_V3_SYSTEM);
    expect(body.input).toBe(REQ.userContent);
    expect(String(body.input)).not.toContain("DRIVESIGNAL AI DESCRIPTION ENGINE");
  });

  it("asks the provider to enforce the schema rather than hope for it", () => {
    const fmt = (buildOpenAIRequest(REQ) as any).text.format;
    expect(fmt.type).toBe("json_schema");
    expect(fmt.strict).toBe(true);
    expect(fmt.schema).toBe(REQ.schema);
  });

  it("omits the schema when none was asked for", () => {
    expect((buildOpenAIRequest({ ...REQ, schema: undefined }) as any).text).toBeUndefined();
  });

  it("sends the reasoning budget when a tenant sets one", () => {
    // Reasoning tokens bill as output, so this is the cost lever on a nightly
    // fleet-wide run — bigger than the choice of model.
    const body = buildOpenAIRequest({ ...REQ, reasoningEffort: "low" }) as any;
    expect(body.reasoning).toEqual({ effort: "low" });
  });

  it("leaves the account default alone when it is unset", () => {
    // Writing a guess into every request is worse than sending nothing.
    const body = buildOpenAIRequest({ ...REQ, reasoningEffort: null, verbosity: null }) as any;
    expect(body.reasoning).toBeUndefined();
    expect(body.text.verbosity).toBeUndefined();
  });

  it("carries verbosity beside the schema rather than replacing it", () => {
    const body = buildOpenAIRequest({ ...REQ, verbosity: "medium" }) as any;
    expect(body.text.verbosity).toBe("medium");
    expect(body.text.format.strict).toBe(true);
  });

  it("keeps the same separation on the other provider", () => {
    const body = buildAnthropicRequest(REQ) as Record<string, any>;
    expect(body.system).toBe(DRIVESIGNAL_V3_SYSTEM);
    expect(body.messages[0].content).toBe(REQ.userContent);
  });
});

describe("reading a response", () => {
  it("records cached prefix tokens so the saving is measurable", () => {
    const r = normalizeOpenAIResponse({
      model: "m", output_text: "copy",
      usage: {
        input_tokens: 6000, output_tokens: 700,
        input_tokens_details: { cached_tokens: 5200 },
        output_tokens_details: { reasoning_tokens: 120 },
      },
    }, "m", 900);
    expect(r.usage).toEqual({
      inputTokens: 6000, outputTokens: 700,
      cachedInputTokens: 5200, reasoningTokens: 120,
    });
    expect(r.latencyMs).toBe(900);
  });

  it("reads text out of the output items when there is no convenience field", () => {
    const r = normalizeOpenAIResponse({
      output: [{ content: [{ text: "part one " }, { text: "part two" }] }],
    }, "m", 1);
    expect(r.text).toBe("part one part two");
  });

  it("treats absent usage as zero rather than NaN", () => {
    // A cost ledger with NaN in it is worse than one with a zero.
    const r = normalizeOpenAIResponse({ output_text: "x" }, "m", 1);
    expect(Object.values(r.usage).every(Number.isFinite)).toBe(true);
  });

  it("reads the other provider's cache field and text blocks", () => {
    const r = normalizeAnthropicResponse({
      content: [{ type: "text", text: "copy" }, { type: "thinking", text: "ignored" }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80 },
      stop_reason: "end_turn",
    }, "m", 10);
    expect(r.text).toBe("copy");
    expect(r.usage.cachedInputTokens).toBe(80);
    expect(r.finishReason).toBe("end_turn");
  });
});

describe("a structured response still has to survive the trip", () => {
  const good = JSON.stringify({
    headline: "2027 INFINITI QX80 Sensory AWD",
    master_description: "Prose.",
    used_fact_ids: ["equipment"], hero_fact_ids: ["equipment"],
    warranty_fact_ids: [], history_fact_ids: [],
  });

  it("parses a conforming document", () => {
    expect(parseStructured(good)?.headline).toBe("2027 INFINITI QX80 Sensory AWD");
  });

  it("refuses prose that degraded out of JSON", () => {
    expect(parseStructured("Here is your description: the QX80 is...")).toBeNull();
  });

  it("refuses a document missing the copy itself", () => {
    expect(parseStructured(JSON.stringify({ headline: "x", used_fact_ids: [] }))).toBeNull();
  });

  it("never invents the id arrays when they are absent", () => {
    const p = parseStructured(JSON.stringify({ headline: "x", master_description: "y" }));
    expect(p?.used_fact_ids).toEqual([]);
  });
});

describe("credentials and failures", () => {
  const fake = (status: number, body: unknown) => (async () => ({
    ok: status < 400, status,
    json: async () => body, text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;

  it("refuses to call out when the key is not set, without leaking a name", async () => {
    const p = createProvider("openai", envWith({}), fake(200, {}));
    await expect(p.generate(REQ)).rejects.toMatchObject({ code: "NO_CREDENTIAL" });
  });

  it("never puts the credential in the body", async () => {
    let sent = "";
    const spy = (async (_u: string, init: any) => {
      sent = String(init.body);
      return { ok: true, status: 200, json: async () => ({ output_text: "copy" }) };
    }) as unknown as typeof fetch;
    await createProvider("openai", envWith({ OPENAI_API_KEY: "sk-secret" }), spy).generate(REQ);
    expect(sent).not.toContain("sk-secret");
  });

  it("separates a retryable failure from a deterministic one", () => {
    expect(classifyStatus(429)).toBe("RATE_LIMIT");
    expect(classifyStatus(503)).toBe("PROVIDER_ERROR");
    expect(classifyStatus(400)).toBe("INVALID_INPUT");
  });

  it("carries the status and a truncated detail on failure", async () => {
    const p = createProvider("openai", envWith({ OPENAI_API_KEY: "k" }), fake(429, { e: "slow down" }));
    await expect(p.generate(REQ)).rejects.toMatchObject({ code: "RATE_LIMIT", status: 429 });
  });

  it("attaches the parsed document only when a schema was requested", async () => {
    const body = { output_text: JSON.stringify({
      headline: "h", master_description: "m",
      used_fact_ids: [], hero_fact_ids: [], warranty_fact_ids: [], history_fact_ids: [] }) };
    const env = envWith({ OPENAI_API_KEY: "k" });
    expect((await createProvider("openai", env, fake(200, body)).generate(REQ)).parsed)
      .not.toBeNull();
    expect((await createProvider("openai", env, fake(200, body))
      .generate({ ...REQ, schema: undefined })).parsed).toBeNull();
  });
});

describe("the vendor stays behind the interface", () => {
  it("exposes both providers under one contract", () => {
    for (const key of ["openai", "anthropic"] as const) {
      expect(createProvider(key, envWith({}), fetch).key).toBe(key);
    }
  });

  it("rejects an unknown provider rather than defaulting to one", () => {
    expect(() => createProvider("gemini" as never, envWith({}), fetch))
      .toThrow(ProviderError);
  });
});
