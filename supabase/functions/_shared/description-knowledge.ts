// Which knowledge the writer is given for a particular vehicle.
//
// Two rules govern this file.
//
// The selection is DETERMINISTIC and driven by resolved Vehicle Truth. A model
// must never choose its own reference material: one that believes a sedan is a
// pickup would load the towing module and start reasoning about payload, and
// the reference corpus would have quietly become an input to what is true.
//
// The corpus is REFERENCE KNOWLEDGE, not evidence. It may explain a feature
// the fact snapshot has already verified. That the manual knows a QX60 can
// have a Bose system is not a reason to say this QX60 does.

import {
  KNOWLEDGE_MODULES, KNOWLEDGE_REVISION, moduleByKey, type KnowledgeModule,
} from "./knowledge/drivesignal-v3-modules.ts";

export { KNOWLEDGE_REVISION };

/** Loaded for every vehicle, in this order. Together with the system prompt
 *  they form the byte-stable prefix a provider can serve from cache, so
 *  nothing vehicle-specific may join this list. */
export const ALWAYS_ON = [
  "core_writing", "compliance", "seo_ai_search", "feature_benefit",
] as const;

/** Evaluated in this fixed order, so two vehicles needing the same modules
 *  always produce byte-identical text and the same checksum. */
const CONDITIONAL: Array<{
  key: string;
  when: (v: VehicleSignals) => boolean;
}> = [
  { key: "oem_terminology", when: (v) => v.isNew || v.hasFactoryBuildData },
  { key: "adas_safety", when: (v) => v.hasAdas },
  { key: "used_vehicle", when: (v) => v.condition === "used" || v.condition === "cpo" },
  { key: "cpo_warranty", when: (v) => v.cpoVerified || v.hasRemainingCoverage },
  { key: "ev_hybrid", when: (v) => v.isElectrified },
  { key: "truck_towing", when: (v) => v.isTruck || v.hasTowEquipment },
  { key: "luxury", when: (v) => v.isLuxuryOrPerformance },
  { key: "marketplace_profiles", when: (v) => v.needsChannelDerivatives },
];

/** Everything the selector is allowed to look at. Deliberately a narrow,
 *  already-resolved shape rather than a raw listing: a selector that reaches
 *  into provider payloads would start making its own truth decisions. */
export interface VehicleSignals {
  condition: string;
  isNew: boolean;
  hasFactoryBuildData: boolean;
  hasAdas: boolean;
  cpoVerified: boolean;
  hasRemainingCoverage: boolean;
  isElectrified: boolean;
  isTruck: boolean;
  hasTowEquipment: boolean;
  isLuxuryOrPerformance: boolean;
  needsChannelDerivatives: boolean;
}

const ADAS = /\b(adaptive cruise|blind spot|lane (keep|depart|centering)|forward collision|automatic emergency brak|pre[- ]?collision|cross[- ]?traffic|driver attention|pro ?pilot|safety sense|co[- ]?pilot|eyesight|smartsense|drive wise|safety shield|iq\.drive|acurawatch|i-activsense)\b/i;
const TOW = /\b(tow(ing)?|trailer|hitch|payload|gooseneck|fifth[- ]wheel)\b/i;
const TRUCK = /\b(pickup|truck|cab[- ]?chassis|crew cab|regular cab|extended cab)\b/i;
const ELECTRIFIED = /\b(electric|ev|hybrid|phev|plug[- ]?in|bev)\b/i;
const LUXURY_MAKE = /\b(infiniti|lexus|acura|cadillac|lincoln|genesis|audi|bmw|mercedes|porsche|jaguar|land rover|range rover|maserati|bentley|volvo|alfa romeo)\b/i;
const PERFORMANCE = /\b(amg|m sport|type r|srt|hellcat|shelby|nismo|sti|type s|gt[- ]?r|trackhawk|raptor)\b/i;

const s = (v: unknown) => String(v ?? "").toLowerCase();

/** Derive the signals from a resolved fact snapshot and listing identity. */
export function vehicleSignals(input: {
  condition?: string | null;
  bodyStyle?: string | null;
  fuelType?: string | null;
  make?: string | null;
  trim?: string | null;
  equipment?: string | null;
  hasBuildSheet?: boolean;
  cpoVerified?: boolean;
  warrantyDisposition?: string | null;
  needsChannelDerivatives?: boolean;
}): VehicleSignals {
  const condition = s(input.condition);
  const equipment = s(input.equipment);
  const body = s(input.bodyStyle);
  return {
    condition,
    isNew: condition === "new",
    hasFactoryBuildData: !!input.hasBuildSheet,
    hasAdas: ADAS.test(equipment),
    cpoVerified: !!input.cpoVerified,
    hasRemainingCoverage: input.warrantyDisposition === "FACTORY_PERMITTED"
      || input.warrantyDisposition === "CPO_PERMITTED",
    isElectrified: ELECTRIFIED.test(s(input.fuelType)),
    isTruck: TRUCK.test(body),
    hasTowEquipment: TOW.test(equipment),
    isLuxuryOrPerformance: LUXURY_MAKE.test(s(input.make)) || PERFORMANCE.test(s(input.trim)),
    needsChannelDerivatives: !!input.needsChannelDerivatives,
  };
}

export function selectModuleKeys(v: VehicleSignals): string[] {
  return [...ALWAYS_ON, ...CONDITIONAL.filter((c) => c.when(v)).map((c) => c.key)];
}

export function selectModules(v: VehicleSignals): KnowledgeModule[] {
  return selectModuleKeys(v).map((k) => {
    const m = moduleByKey(k);
    // A selector naming a module the corpus does not contain would silently
    // drop a whole ruleset from generation.
    if (!m) throw new Error(`knowledge module not found: ${k}`);
    if (m.kind !== "generation") {
      throw new Error(`${k} is operational and must never be sent to a writer`);
    }
    return m;
  });
}

export interface AssembledKnowledge {
  text: string;
  moduleKeys: string[];
  revision: string;
  /** Length of the leading always-on block, which never varies by vehicle. */
  stablePrefixLength: number;
}

export function assembleKnowledge(v: VehicleSignals): AssembledKnowledge {
  const modules = selectModules(v);
  const render = (m: KnowledgeModule) =>
    `## DriveSignal Knowledge — ${m.title} (revision ${KNOWLEDGE_REVISION})\n\n${m.content}`;
  const parts = modules.map(render);
  const stable = parts.slice(0, ALWAYS_ON.length).join("\n\n");
  return {
    text: parts.join("\n\n"),
    moduleKeys: modules.map((m) => m.key),
    revision: KNOWLEDGE_REVISION,
    stablePrefixLength: stable.length,
  };
}

export const generationModules = (): KnowledgeModule[] =>
  KNOWLEDGE_MODULES.filter((m) => m.kind === "generation");
