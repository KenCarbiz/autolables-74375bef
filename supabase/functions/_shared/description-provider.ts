// Provider-neutral generation.
//
// The writer used to be a hard-coded fetch to one vendor inside
// ai-description/index.ts, which meant the choice of model was a code change
// and the choice of vendor was a rewrite. Generation is now a capability with
// a normalized contract: the pipeline asks for copy and gets back text plus
// the accounting an audit needs, and neither the pipeline nor the domain model
// knows which vendor answered.
//
// Two things are deliberately separated here. Building a request and reading a
// response are PURE functions, unit-tested against fixtures. Only send() does
// I/O. A provider's wire format is the part most likely to drift, and it must
// be verifiable without a network or a key.
//
// Credentials are read from the environment at call time and never travel
// through the domain model, a database row, or a client bundle.

import type { DescriptionModelOutput } from "./description-evidence.ts";

export type ProviderKey = "anthropic" | "openai";

export interface GenerationRequest {
  /** Byte-stable across every vehicle. Kept first so a provider can cache it. */
  systemPrompt: string;
  /** The per-vehicle fact packet. The only part that varies. */
  userContent: string;
  model: string;
  maxOutputTokens?: number;
  /** When set, the provider is asked to ENFORCE this schema, not hope for it. */
  schema?: Record<string, unknown>;
  schemaName?: string;
}

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prefix served from the provider's cache. The point of a stable prompt. */
  cachedInputTokens: number;
  reasoningTokens: number;
}

export interface GenerationResult {
  provider: ProviderKey;
  model: string;
  /** Raw text returned. For a structured call this is the JSON document. */
  text: string;
  /** Present only when a schema was requested AND the response parsed. */
  parsed: DescriptionModelOutput | null;
  usage: GenerationUsage;
  latencyMs: number;
  finishReason: string | null;
}

export interface DescriptionGenerationProvider {
  readonly key: ProviderKey;
  generate(req: GenerationRequest): Promise<GenerationResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: "RATE_LIMIT" | "PROVIDER_ERROR" | "INVALID_INPUT" | "NO_CREDENTIAL",
    readonly status?: number,
    readonly detail?: string,
  ) { super(message); }
}

const EMPTY_USAGE: GenerationUsage = {
  inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0,
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** HTTP status to a category the retry policy understands. */
export function classifyStatus(status: number): ProviderError["code"] {
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "PROVIDER_ERROR";
  return "INVALID_INPUT";
}

// ── OpenAI ───────────────────────────────────────────────────────────

export function buildOpenAIRequest(req: GenerationRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    // The stable instruction block goes in its own field, ahead of anything
    // per-vehicle, so an unchanged ruleset can be served from cache rather
    // than re-billed in full on every VIN.
    instructions: req.systemPrompt,
    input: req.userContent,
  };
  if (req.maxOutputTokens) body.max_output_tokens = req.maxOutputTokens;
  if (req.schema) {
    body.text = {
      format: {
        type: "json_schema",
        name: req.schemaName || "vehicle_description",
        schema: req.schema,
        strict: true,
      },
    };
  }
  return body;
}

/** Text can arrive as a convenience field or nested in the output items. */
function openAIText(body: Record<string, any>): string {
  if (typeof body?.output_text === "string" && body.output_text) return body.output_text;
  const parts: string[] = [];
  for (const item of body?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("").trim();
}

export function normalizeOpenAIResponse(
  body: Record<string, any>, model: string, latencyMs: number,
): GenerationResult {
  const u = body?.usage || {};
  return {
    provider: "openai",
    model: String(body?.model || model),
    text: openAIText(body),
    parsed: null,
    usage: {
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cachedInputTokens: num(u.input_tokens_details?.cached_tokens),
      reasoningTokens: num(u.output_tokens_details?.reasoning_tokens),
    },
    latencyMs,
    finishReason: body?.status ?? body?.incomplete_details?.reason ?? null,
  };
}

// ── Anthropic ────────────────────────────────────────────────────────

export function buildAnthropicRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    model: req.model,
    system: req.systemPrompt,
    max_tokens: req.maxOutputTokens || 4096,
    messages: [{ role: "user", content: req.userContent }],
  };
}

export function normalizeAnthropicResponse(
  body: Record<string, any>, model: string, latencyMs: number,
): GenerationResult {
  const u = body?.usage || {};
  return {
    provider: "anthropic",
    model: String(body?.model || model),
    text: (body?.content || [])
      .filter((c: any) => c?.type === "text").map((c: any) => c.text).join("").trim(),
    parsed: null,
    usage: {
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cachedInputTokens: num(u.cache_read_input_tokens),
      reasoningTokens: 0,
    },
    latencyMs,
    finishReason: body?.stop_reason ?? null,
  };
}

// ── Structured output ────────────────────────────────────────────────

/**
 * A schema-enforced response still has to survive the trip. Enforcement is the
 * provider's promise about SHAPE; it says nothing about whether the fields are
 * true, and a provider that silently degrades to prose must not be read as a
 * successful structured call.
 */
export function parseStructured(text: string): DescriptionModelOutput | null {
  if (!text) return null;
  let doc: any;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== "object") return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const headline = typeof doc.headline === "string" ? doc.headline : "";
  const master = typeof doc.master_description === "string" ? doc.master_description : "";
  if (!headline || !master) return null;
  return {
    headline, master_description: master,
    used_fact_ids: arr(doc.used_fact_ids),
    hero_fact_ids: arr(doc.hero_fact_ids),
    warranty_fact_ids: arr(doc.warranty_fact_ids),
    history_fact_ids: arr(doc.history_fact_ids),
  };
}

// ── The providers ────────────────────────────────────────────────────

type Env = { get(k: string): string | undefined };

interface ProviderSpec {
  url: string;
  credentialEnv: string;
  headers(key: string): Record<string, string>;
  build(req: GenerationRequest): Record<string, unknown>;
  normalize(body: Record<string, any>, model: string, ms: number): GenerationResult;
}

const SPECS: Record<ProviderKey, ProviderSpec> = {
  openai: {
    url: "https://api.openai.com/v1/responses",
    credentialEnv: "OPENAI_API_KEY",
    headers: (k) => ({ Authorization: `Bearer ${k}`, "Content-Type": "application/json" }),
    build: buildOpenAIRequest,
    normalize: normalizeOpenAIResponse,
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    credentialEnv: "ANTHROPIC_API_KEY",
    headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01",
                       "Content-Type": "application/json" }),
    build: buildAnthropicRequest,
    normalize: normalizeAnthropicResponse,
  },
};

export function createProvider(
  key: ProviderKey, env: Env, fetchImpl: typeof fetch = fetch,
): DescriptionGenerationProvider {
  const spec = SPECS[key];
  if (!spec) throw new ProviderError(`unknown provider: ${key}`, "INVALID_INPUT");
  return {
    key,
    async generate(req: GenerationRequest): Promise<GenerationResult> {
      const credential = env.get(spec.credentialEnv);
      if (!credential) {
        throw new ProviderError(
          `${key} is configured but ${spec.credentialEnv} is not set`, "NO_CREDENTIAL");
      }
      const started = Date.now();
      const res = await fetchImpl(spec.url, {
        method: "POST",
        headers: spec.headers(credential),
        body: JSON.stringify(spec.build(req)),
      });
      const ms = Date.now() - started;
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ProviderError(`${key}_failed:${res.status}`,
          classifyStatus(res.status), res.status, detail.slice(0, 400));
      }
      const result = spec.normalize(await res.json(), req.model, ms);
      if (req.schema) result.parsed = parseStructured(result.text);
      return result;
    },
  };
}
