// Cut the DriveSignal V3 Operations Manual into governed knowledge modules.
//
// Every module is composed of WHOLE numbered subsections copied verbatim. The
// map below is the only editorial act, and it is reviewable: nothing is
// summarized, reworded or authored here. Re-running this against the same
// manual must produce a byte-identical file, which is what makes the emitted
// checksum meaningful.
//
//   node scripts/build-knowledge-modules.mjs <manual.txt>
//
// The manual is a controlled publication owned outside this repo. Only the
// generated modules are committed, so a revision is a re-run plus a review of
// the diff.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const KNOWLEDGE_REVISION = "3.0";

// subsection ranges → module. "9.1-9.8" is inclusive; single ids allowed.
export const MODULE_MAP = [
  { key: "core_writing", title: "Core Writing", kind: "generation",
    ranges: ["1.1-1.7", "2.7-2.15", "3.1-3.19", "AppC"] },
  { key: "used_vehicle", title: "Used Vehicle Intelligence", kind: "generation",
    ranges: ["9.1-9.8", "9.10-9.14"] },
  { key: "cpo_warranty", title: "CPO and Warranty", kind: "generation",
    ranges: ["9.9", "10.6", "10.7"] },
  { key: "adas_safety", title: "ADAS and Safety", kind: "generation",
    ranges: ["6.1-6.8"] },
  { key: "oem_terminology", title: "OEM Terminology", kind: "generation",
    ranges: ["5.1-5.12"] },
  { key: "ev_hybrid", title: "EV and Hybrid", kind: "generation",
    ranges: ["8.7-8.10"] },
  { key: "truck_towing", title: "Truck and Towing", kind: "generation",
    ranges: ["8.11", "8.12", "8.14"] },
  { key: "luxury", title: "Luxury and Performance", kind: "generation",
    ranges: ["7.11", "8.13"] },
  { key: "seo_ai_search", title: "SEO and AI Search", kind: "generation",
    ranges: ["4.1-4.12"] },
  { key: "marketplace_profiles", title: "Marketplace Profiles", kind: "generation",
    ranges: ["13.1-13.19"] },
  { key: "compliance", title: "Compliance", kind: "generation",
    ranges: ["2.1-2.6", "10.1-10.5", "10.8-10.16", "AppB", "AppE", "AppF"] },
  { key: "feature_benefit", title: "Feature to Benefit Library", kind: "generation",
    ranges: ["7.1-7.10", "7.12-7.14", "8.1-8.6", "8.15-8.17", "AppD"] },
  // Operational modules govern OUR software and are never sent to a writer.
  // A model does not need to be told how its own prompt is assembled, and the
  // QA gates are code, not instructions the model is asked to self-apply.
  { key: "quality_assurance", title: "Quality Assurance", kind: "operational",
    ranges: ["11.1-11.12", "AppA"] },
  { key: "prompt_architecture", title: "Prompt Architecture", kind: "operational",
    ranges: ["12.1-12.11"] },
  // How the manual itself is versioned and changed. It governs the corpus, not
  // any vehicle, so it is retained rather than dropped but never sent.
  { key: "governance", title: "Governance and Version Control", kind: "operational",
    ranges: ["14.1-14.16"] },
];

const HEADING = /^(\d{1,2})\.(\d{1,2}) (.+?)\s*$/;
// The appendices carry the approved and prohibited language libraries and are
// not numbered like the sections, so they need their own recogniser or they
// drop out of the corpus without anyone noticing.
const APPENDIX = /^Appendix ([A-F]) [–-] (.+?)\s*$/;

export function indexSubsections(text) {
  const lines = text.split("\n");
  const found = [];
  lines.forEach((line, i) => {
    const m = HEADING.exec(line);
    if (m) { found.push({ id: `${m[1]}.${m[2]}`, title: m[3], line: i }); return; }
    const a = APPENDIX.exec(line);
    if (a) found.push({ id: `App${a[1]}`, title: a[2], line: i });
  });
  const out = new Map();
  found.forEach((s, i) => {
    const end = i + 1 < found.length ? found[i + 1].line : lines.length;
    out.set(s.id, { ...s, body: lines.slice(s.line, end).join("\n").trimEnd() });
  });
  return out;
}

export function expand(ranges, index) {
  const ids = [];
  for (const r of ranges) {
    if (!r.includes("-")) { ids.push(r); continue; }
    const [a, b] = r.split("-");
    const [maj, lo] = a.split(".").map(Number);
    const hi = Number(b.split(".")[1]);
    for (let n = lo; n <= hi; n++) {
      const id = `${maj}.${n}`;
      if (index.has(id)) ids.push(id);
    }
  }
  return ids;
}

function esc(s) { return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${"); }

export function build(manualText) {
  const index = indexSubsections(manualText);
  const modules = MODULE_MAP.map((m) => {
    const ids = expand(m.ranges, index);
    const missing = ids.filter((id) => !index.has(id));
    if (missing.length) throw new Error(`${m.key}: manual has no ${missing.join(", ")}`);
    const content = ids.map((id) => index.get(id).body).join("\n\n");
    return { ...m, sourceSections: ids, content,
      checksum: createHash("sha256").update(content).digest("hex").slice(0, 16) };
  });
  const claimed = new Set(modules.flatMap((m) => m.sourceSections));
  const unclaimed = [...index.keys()].filter((id) => !claimed.has(id));
  return { modules, unclaimed, total: index.size };
}

function emit({ modules }) {
  const body = modules.map((m) => `  {
    key: "${m.key}",
    title: ${JSON.stringify(m.title)},
    kind: "${m.kind}",
    sourceSections: ${JSON.stringify(m.sourceSections)},
    checksum: "${m.checksum}",
    content: \`${esc(m.content)}\`,
  },`).join("\n");
  return `// GENERATED by scripts/build-knowledge-modules.mjs. Do not edit by hand.
//
// The DriveSignal V3 Operations Manual, partitioned into governed modules.
// Content is copied verbatim from whole numbered subsections; the partition is
// the only editorial act and it lives in the generator, where it is reviewable.
//
// "generation" modules may be sent to a writer. "operational" modules govern
// this platform's own software and must never reach a model.
//
// This corpus is REFERENCE KNOWLEDGE, not vehicle evidence. It may explain a
// feature the fact snapshot has already verified. It may never establish that
// a VIN has one.

export const KNOWLEDGE_REVISION = "${KNOWLEDGE_REVISION}";

export interface KnowledgeModule {
  readonly key: string;
  readonly title: string;
  readonly kind: "generation" | "operational";
  readonly sourceSections: readonly string[];
  readonly checksum: string;
  readonly content: string;
}

export const KNOWLEDGE_MODULES: readonly KnowledgeModule[] = Object.freeze([
${body}
] as KnowledgeModule[]);

export const moduleByKey = (k: string): KnowledgeModule | undefined =>
  KNOWLEDGE_MODULES.find((m) => m.key === k);
`;
}

const manualPath = process.argv[2];
if (manualPath) {
  const result = build(readFileSync(manualPath, "utf8"));
  const out = "supabase/functions/_shared/knowledge/drivesignal-v3-modules.ts";
  writeFileSync(out, emit(result));
  const gen = result.modules.filter((m) => m.kind === "generation");
  console.log(`${result.modules.length} modules from ${result.total} subsections`);
  for (const m of result.modules) {
    console.log(`  ${m.kind === "operational" ? "[op] " : "     "}${m.key.padEnd(22)} ${String(m.content.length).padStart(6)} chars  ${m.sourceSections.length} subsections`);
  }
  console.log(`generation corpus: ${gen.reduce((n, m) => n + m.content.length, 0)} chars`);
  console.log(`unclaimed subsections (${result.unclaimed.length}): ${result.unclaimed.join(", ")}`);
}
