// ─────────────────────────────────────────────────────────────────────
// Prompt Registry — server-controlled, versioned, platform-global.
//
// Every instruction the model receives is a registered component with a
// version, a status and an owner. Nothing that shapes generated copy is
// allowed to live as a literal inside a request handler, because a prompt
// that is edited in place cannot be audited: a description generated last
// month would be attributed to text that no longer exists.
//
// Two rules make that audit trail real, and both are enforced here rather
// than by convention:
//
//   1. An active component is NEVER edited. A change is a NEW immutable
//      version; the previous one is retained with status "superseded".
//      Every component object and the registry array itself are frozen, so
//      an in-place edit fails at runtime as well as at compile time.
//   2. Compilation order is fixed by this file, not by the caller. Two
//      callers asking for the same components in different orders must
//      produce byte-identical text and the same checksum — otherwise the
//      checksum records the caller's argument order instead of the prompt
//      that was actually sent.
//
// This registry is platform-global. It carries no credentials and no
// tenant-private language: dealership wording lives on the voice profile
// (description-voice.ts), channel wording on the channel policy
// (description-channel-policy.ts).
// ─────────────────────────────────────────────────────────────────────

export type PromptComponentKey =
  | "global_safety"
  | "vehicle_truth_policy"
  | "description_task"
  | "channel_policy"
  | "tone_policy"
  | "voice_policy"
  | "local_seo_policy"
  | "approved_language_policy"
  | "cta_policy"
  | "disclosure_policy"
  | "structured_output"
  | "validation_feedback"
  | "repair_policy"
  | "preview_policy";

export type PromptStatus =
  | "draft"
  | "testing"
  | "approved"
  | "active"
  | "superseded"
  | "archived"
  | "emergency_disabled";

export interface PromptComponent {
  readonly key: PromptComponentKey;
  readonly displayName: string;
  readonly purpose: string;
  readonly version: string;
  readonly status: PromptStatus;
  readonly content: string;
  readonly effectiveFrom: string;
  readonly supersededAt: string | null;
  readonly changeReason: string;
  readonly owner: string;
}

export const PROMPT_SCHEMA_VERSION = "prompt_schema_1";

const OWNER = "autolabels_platform";

/**
 * Operational kill switch. There is deliberately no `emergencyDisable(key)`
 * mutator: the registry is immutable, so a disable is either a new published
 * version carrying status "emergency_disabled" or an environment deny-list
 * that takes effect without a deploy. Both are read-only from this module's
 * point of view.
 */
const EMERGENCY_DISABLE_ENV = "AUTOLABELS_PROMPT_EMERGENCY_DISABLED";

const COMPONENTS: PromptComponent[] = [
  {
    key: "global_safety",
    displayName: "Global Safety",
    purpose: "The non-negotiable floor applied to every generation, repair and preview request.",
    version: "1.0.0",
    status: "superseded",
    content: `GLOBAL SAFETY
- Only state vehicle facts that were supplied to you.
- Do not exaggerate.
- No exclamation marks.`,
    effectiveFrom: "2026-05-01",
    supersededAt: "2026-07-20",
    changeReason: "Initial release. Too terse to constrain omission-by-inference or numeric restatement.",
    owner: OWNER,
  },
  {
    key: "global_safety",
    displayName: "Global Safety",
    purpose: "The non-negotiable floor applied to every generation, repair and preview request.",
    version: "2.0.0",
    status: "active",
    content: `GLOBAL SAFETY
- You decide HOW a verified fact is expressed. You never decide WHETHER it is true.
- Every vehicle fact you state must appear in the verified facts supplied with this request. If a fact is absent, omit the subject entirely. Do not infer it from the model year, the trim name, the brand, the segment or what vehicles like this usually have.
- Never invent equipment, packages, trim, warranty coverage, certification status, ownership history, accident history, service history, recall completion, fuel economy, electric range, horsepower, torque, towing capacity, payload, seating capacity, safety ratings or pricing.
- Never restate a supplied number as a rounder number, a stronger number, an estimate or a range.
- A missing fact is never a gap to fill and never a defect to explain. Write less instead.
- No exclamation marks. No superlative that the verified facts do not support.
- Where two instructions in this prompt conflict, obey the stricter one.`,
    effectiveFrom: "2026-07-20",
    supersededAt: null,
    changeReason: "Names the how-versus-whether rule explicitly and enumerates the invented-claim categories that reviewers caught most often.",
    owner: OWNER,
  },
  {
    key: "vehicle_truth_policy",
    displayName: "Vehicle Truth Policy",
    purpose: "How to read the verified fact set: source, status, origin and conflicts.",
    version: "1.0.0",
    status: "active",
    content: `VEHICLE TRUTH
- Each verified fact carries a source and a status. A fact whose status is pending, unconfirmed or conflicted is NOT verified: do not state it, do not hint at it, do not work around it.
- Factory equipment and dealer-installed product are different claims. Never describe a dealer-installed accessory as factory equipment, and never describe an accessory as installed unless it is listed as installed.
- Equipment that is available on the model but not listed for this vehicle does not exist for the purposes of this description.
- Use one canonical name per physical feature. Do not restate the same feature under a second name to add length.
- State a price, payment, rebate or saving only when a price fact is supplied and pricing is permitted for this destination.
- Certification, warranty coverage and recall status are legal claims. Use only the supplied wording and only when supplied.`,
    effectiveFrom: "2026-06-05",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "description_task",
    displayName: "Description Task",
    purpose: "States the job: canonical merchandising copy for one vehicle at one dealership.",
    version: "1.1.0",
    status: "active",
    content: `TASK
You are writing merchandising copy for one specific vehicle at one franchise dealership.
- Open by naming the vehicle, then the qualities that matter most to a shopper, then the prioritized equipment grouped sensibly, then practical ownership detail, then the close.
- Write connected prose a person would read aloud. Do not produce a specification dump, a bullet list rendered as sentences, or a paragraph that names equipment without saying what it does for the owner.
- Respect the supplied length range. Reaching the minimum by repeating yourself is a failure, not a save.`,
    effectiveFrom: "2026-07-02",
    supersededAt: null,
    changeReason: "Added the anti-padding rule after short fact sets produced repetitive filler.",
    owner: OWNER,
  },
  {
    key: "channel_policy",
    displayName: "Channel Policy",
    purpose: "Frames the destination rules injected from the channel policy registry.",
    version: "1.0.0",
    status: "active",
    content: `DESTINATION
- The destination rules supplied below govern length, structure, formatting, pricing, keywords and the close.
- Changing the destination changes the presentation and never the vehicle. Every factual statement must remain identical in meaning to the master description.
- Do not add a fact, a feature, a benefit or a number that is not already in the master, even when the destination allows more room.
- When the destination forbids something the master contains, remove it. Do not paraphrase it back in.`,
    effectiveFrom: "2026-06-05",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "tone_policy",
    displayName: "Tone Policy",
    purpose: "Confines tone to wording so it can never move a fact.",
    version: "1.0.0",
    status: "active",
    content: `TONE
- Tone controls wording only. It must not change, add, soften or strengthen a single vehicle fact.
- A tone is not permission for a superlative. If the requested tone cannot be achieved on the verified facts, write plainly.
- Do not quantify anything the verified facts do not quantify in order to serve the tone.`,
    effectiveFrom: "2026-06-05",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "voice_policy",
    displayName: "Dealership Voice Policy",
    purpose: "Gates statements about the business behind tenant approval.",
    version: "1.0.0",
    status: "active",
    content: `DEALERSHIP VOICE
- You may state the dealership's name and location. Every other statement about the business is a claim that requires approval.
- Use only the approved dealership claims supplied with this request. If none are supplied, make none: no family ownership, no years in business, no free delivery, no lifetime warranty, no awards, no volume ranking, no price match, no financing guarantee.
- Approved differentiators are used verbatim. Do not rephrase, combine or strengthen them.
- Never speak for the dealership about what it will do for a shopper beyond the approved close.`,
    effectiveFrom: "2026-06-05",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "local_seo_policy",
    displayName: "Local Search Policy",
    purpose: "Keeps search relevance natural and blocks doorway-page behavior.",
    version: "1.0.0",
    status: "active",
    content: `SEARCH RELEVANCE
- Use the supplied search phrasing at most once, inside a sentence that would exist anyway. If it cannot be written naturally, leave it out.
- Mention the market area once, twice at the very most.
- Never enumerate nearby towns, never name a community the dealership has not approved, and never add a keyword block, a location list or a repeated model name.
- Copy that reads as though it was written for a crawler has failed even when every fact in it is true.`,
    effectiveFrom: "2026-06-18",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "local_seo_policy",
    displayName: "Local Search Policy",
    purpose: "Keeps search relevance natural and blocks doorway-page behavior.",
    version: "2.0.0",
    status: "draft",
    content: `SEARCH RELEVANCE
- Use the supplied search phrasing at most once, inside a sentence that would exist anyway.
- Mention the market area once. A second mention requires the sentence to carry information the shopper cannot get elsewhere.
- Never enumerate nearby towns, never name an unapproved community, never add a keyword block or a location list.`,
    effectiveFrom: "2026-08-15",
    supersededAt: null,
    changeReason: "Proposed tightening to a single market-area mention. Not yet measured against organic performance, so it stays a draft.",
    owner: OWNER,
  },
  {
    key: "approved_language_policy",
    displayName: "Approved Language Policy",
    purpose: "Pins the terminology a store is permitted to use for regulated subjects.",
    version: "1.0.0",
    status: "active",
    content: `APPROVED LANGUAGE
- Use the supplied terminology exactly for certification, warranty, financing, trade-in and delivery. These words carry legal weight and are chosen by the store, not by you.
- Do not upgrade terminology: remaining factory coverage is not a warranty offer, a manufacturer program is not a store guarantee, and an appraisal is not an offer.
- Prohibited phrases are prohibited in every form, including near-synonyms and rearranged wording.`,
    effectiveFrom: "2026-06-18",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "cta_policy",
    displayName: "Call To Action Policy",
    purpose: "Controls the close so it never becomes an unapproved promise.",
    version: "1.0.0",
    status: "active",
    content: `CLOSE
- Close with the supplied call to action. Where the exact wording is supplied, use it verbatim.
- Where the destination permits no call to action, end on the vehicle and add nothing.
- A close never introduces urgency, scarcity, a deadline, an incentive, an approval promise or a price claim.`,
    effectiveFrom: "2026-06-18",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "disclosure_policy",
    displayName: "Disclosure Policy",
    purpose: "Guarantees required legal text survives generation and rewriting intact.",
    version: "1.0.0",
    status: "active",
    content: `DISCLOSURES
- Required disclosure text is reproduced verbatim. Do not shorten it, reword it, translate it, split it across paragraphs or fold it into a sentence of your own.
- A disclosure is never trimmed to meet a length limit. Cut merchandising copy instead.
- Never write a disclosure that was not supplied to you.`,
    effectiveFrom: "2026-06-18",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "structured_output",
    displayName: "Structured Output",
    purpose: "Defines the response envelope so the handler never parses prose it did not expect.",
    version: "1.0.0",
    status: "active",
    content: `OUTPUT
- Return only what is requested. No preamble, no explanation, no headings, no markdown, no code fence.
- When strict JSON is requested, return one JSON object and nothing else, with every requested field present and no additional field.
- Never annotate the copy with notes about what you omitted or why.`,
    effectiveFrom: "2026-06-05",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "validation_feedback",
    displayName: "Validation Feedback",
    purpose: "Frames validator findings handed back to the model.",
    version: "1.0.0",
    status: "active",
    content: `VALIDATION FINDINGS
- The findings below were produced by a deterministic validator against copy you generated. Each one names a specific span of text and the rule it broke.
- Treat every finding as correct. Do not argue with it, do not explain it, do not restate the same claim in different words to evade it.
- A finding about an unverifiable claim is resolved by removing the claim, never by qualifying it with "may", "should" or "approximately".`,
    effectiveFrom: "2026-07-02",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "repair_policy",
    displayName: "Repair Policy",
    purpose: "Constrains a repair pass to the smallest edit that clears the findings.",
    version: "1.0.0",
    status: "active",
    content: `REPAIR
- Make the smallest edit that clears every finding. Preserve the sentences and the ordering that were not flagged.
- Do not rewrite the whole description, do not change the tone, do not re-open the structure and do not restyle sentences you were not asked to touch.
- Never resolve a finding by introducing a new fact, a new feature, a new claim or a new number.
- If clearing a finding drops the copy below the length minimum, return the shorter copy. Short and true beats long and unverifiable.`,
    effectiveFrom: "2026-07-02",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
  {
    key: "preview_policy",
    displayName: "Preview Policy",
    purpose: "Governs sample output rendered in the app before any dealer approval exists.",
    version: "1.0.0",
    status: "active",
    content: `PREVIEW
- This output is a preview shown inside the AutoLabels workspace. It is not approved copy and it will not be published from this request.
- A preview obeys every rule that governs published copy. Sample data is not permission to invent: if the fact set is thin, the preview is thin.
- Never fill a preview with placeholder equipment, sample pricing or example dealership claims. A reviewer must be able to trust that what they see is what the vehicle supports.`,
    effectiveFrom: "2026-07-14",
    supersededAt: null,
    changeReason: "Initial release.",
    owner: OWNER,
  },
];

// The frozen array of frozen objects is the structural half of "an active
// prompt is never edited in place"; `readonly` on PromptComponent is the
// compile-time half. A change must be appended as a new version.
export const PROMPT_REGISTRY: readonly PromptComponent[] =
  Object.freeze(COMPONENTS.map((c) => Object.freeze(c)));

export const activeComponent = (key: PromptComponentKey): PromptComponent | undefined =>
  PROMPT_REGISTRY.find((c) => c.key === key && c.status === "active");

/** Active components for the requested keys, always in registry order. */
export const componentsFor = (keys: PromptComponentKey[]): PromptComponent[] => {
  const wanted = new Set<PromptComponentKey>(keys);
  return PROMPT_REGISTRY.filter((c) => c.status === "active" && wanted.has(c.key));
};

export const isEmergencyDisabled = (key: PromptComponentKey): boolean =>
  PROMPT_REGISTRY.some((c) => c.key === key && c.status === "emergency_disabled") ||
  envDisabledKeys().has(key);

export interface CompiledPrompt {
  text: string;
  componentKeys: PromptComponentKey[];
  componentVersions: Record<string, string>;
  checksum: string;
  schemaVersion: string;
}

export interface DynamicSection {
  label: string;
  body: string;
}

/**
 * Deterministic assembly. The requested keys are resolved against the registry
 * and emitted in REGISTRY order, so the same component set plus the same
 * dynamic sections always yields the same text and the same checksum no matter
 * how the caller ordered its arguments.
 */
export async function compilePrompt(
  keys: PromptComponentKey[],
  dynamicSections: DynamicSection[] = [],
): Promise<CompiledPrompt> {
  const wanted = new Set<PromptComponentKey>(keys);
  for (const key of wanted) {
    if (isEmergencyDisabled(key)) {
      throw new Error(`Prompt component "${key}" is emergency-disabled and cannot be compiled.`);
    }
    if (!activeComponent(key)) {
      throw new Error(`Prompt component "${key}" has no active version in the registry.`);
    }
  }

  const resolved = PROMPT_REGISTRY.filter((c) => c.status === "active" && wanted.has(c.key));
  const componentVersions: Record<string, string> = {};
  for (const c of resolved) componentVersions[c.key] = c.version;

  const blocks = resolved.map(
    (c) => `[${c.displayName} · ${c.key} · v${c.version}]\n${c.content}`,
  );
  for (const s of dynamicSections) {
    blocks.push(`[${s.label}]\n${s.body}`);
  }

  return {
    text: blocks.join("\n\n"),
    componentKeys: resolved.map((c) => c.key),
    componentVersions,
    checksum: await promptChecksum(resolved, dynamicSections),
    schemaVersion: PROMPT_SCHEMA_VERSION,
  };
}

/**
 * Checksum material is the schema version, the ordered key/version pairs and
 * the dynamic sections. Component CONTENT is not hashed directly: content is
 * immutable per version, so the version identifies it, and hashing both would
 * hide an accidental in-place edit behind a matching checksum.
 */
export async function promptChecksum(
  components: ReadonlyArray<Pick<PromptComponent, "key" | "version">>,
  dynamicSections: ReadonlyArray<DynamicSection> = [],
): Promise<string> {
  const material = [
    PROMPT_SCHEMA_VERSION,
    ...components.map((c) => `${c.key}@${c.version}`),
    ...dynamicSections.map((s) => `${s.label}=${s.body}`),
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return "pr_" + Array.from(new Uint8Array(digest)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

function envDisabledKeys(): Set<string> {
  const env = globalThis as {
    Deno?: { env?: { get(name: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  const raw = env.Deno?.env?.get?.(EMERGENCY_DISABLE_ENV) ?? env.process?.env?.[EMERGENCY_DISABLE_ENV] ?? "";
  return new Set(String(raw).split(",").map((s) => s.trim()).filter(Boolean));
}
