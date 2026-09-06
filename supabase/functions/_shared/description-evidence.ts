// The response contract a description writer must satisfy, and the audit of
// what it claims against what it was actually given.
//
// OpenAI Structured Outputs will enforce the SHAPE of a response — that
// used_fact_ids is an array of strings and that it is present. It cannot
// enforce that those ids are true. A model that invents a Bose system can
// equally invent the fact key it cites for it. So the writer's account of its
// own reasoning is treated here as testimony, not evidence: useful, recorded,
// and checked against the snapshot we supplied.
//
// This audit never replaces validateContent. That reads the prose and blocks
// unsupported claims, and remains the safeguard. This catches a different
// failure the prose scan cannot: a writer citing evidence it was never handed.

export interface DescriptionModelOutput {
  headline: string;
  master_description: string;
  used_fact_ids: string[];
  hero_fact_ids: string[];
  warranty_fact_ids: string[];
  history_fact_ids: string[];
}

/** Strict JSON schema for a provider that supports enforced structured output. */
export const DESCRIPTION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "master_description", "used_fact_ids",
             "hero_fact_ids", "warranty_fact_ids", "history_fact_ids"],
  properties: {
    headline: { type: "string" },
    master_description: { type: "string" },
    used_fact_ids: { type: "array", items: { type: "string" } },
    hero_fact_ids: { type: "array", items: { type: "string" } },
    warranty_fact_ids: { type: "array", items: { type: "string" } },
    history_fact_ids: { type: "array", items: { type: "string" } },
  },
} as const;

export interface EvidenceAudit {
  ok: boolean;
  claimed: string[];
  supplied: string[];
  /** Cited but never supplied in the snapshot. The writer invented a source. */
  fabricated_ids: string[];
  /** Supplied but not usable in copy — excluded, unverified or review-gated. */
  unusable_ids: string[];
  /** Supplied and usable, but the writer did not use it. Informational. */
  unclaimed_supplied: string[];
}

const norm = (v: unknown) => String(v ?? "").toLowerCase().trim();
const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];

/** Fact keys a writer is permitted to cite: present in the snapshot AND usable. */
export function suppliedFactIds(snap: {
  facts?: Record<string, { usable_in_copy?: boolean } | undefined>;
}): string[] {
  return uniq(Object.entries(snap?.facts || {})
    .filter(([, f]) => f?.usable_in_copy !== false)
    .map(([k]) => norm(k)));
}

export function auditEvidence(
  output: Pick<DescriptionModelOutput, "used_fact_ids" | "hero_fact_ids"
    | "warranty_fact_ids" | "history_fact_ids">,
  snap: { facts?: Record<string, { usable_in_copy?: boolean } | undefined> },
): EvidenceAudit {
  const all = Object.keys(snap?.facts || {}).map(norm);
  const supplied = suppliedFactIds(snap);
  const claimed = uniq([
    ...(output.used_fact_ids || []), ...(output.hero_fact_ids || []),
    ...(output.warranty_fact_ids || []), ...(output.history_fact_ids || []),
  ].map(norm));

  // Cited and unknown to the snapshot entirely: the writer produced a source.
  const fabricated_ids = claimed.filter((c) => !all.includes(c));
  // Cited, known, but withheld from copy — an excluded claim reached the page.
  const unusable_ids = claimed.filter((c) => all.includes(c) && !supplied.includes(c));
  const unclaimed_supplied = supplied.filter((s) => !claimed.includes(s));

  return {
    ok: fabricated_ids.length === 0 && unusable_ids.length === 0,
    claimed, supplied, fabricated_ids, unusable_ids, unclaimed_supplied,
  };
}

export function factRoles(output: Pick<DescriptionModelOutput,
  "hero_fact_ids" | "warranty_fact_ids" | "history_fact_ids">) {
  return {
    hero: uniq((output.hero_fact_ids || []).map(norm)),
    warranty: uniq((output.warranty_fact_ids || []).map(norm)),
    history: uniq((output.history_fact_ids || []).map(norm)),
  };
}
