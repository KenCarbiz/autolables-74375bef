// GENERATED — do not edit.
// Mirror of src/lib/documents/inventoryIntelligence.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Inventory Intelligence row model.
//
// One inventory vehicle produces several independent document outcomes.
// A vehicle can hold an approved Buyers Guide and a blocked OEM
// reproduction at the same time, so this model deliberately refuses to
// collapse them into a single score — the pure logic lives here so the
// screen cannot invent a friendlier summary than the data supports.

import {
  applicableFamilies,
  classifyCondition,
  DOCUMENT_FAMILIES,
  type DocumentFamilyId,
  type VehicleConditionClass,
} from "./families.ts";

export type PipelineStage =
  | "Imported"
  | "Enrichment Pending"
  | "NeoVIN Complete"
  | "OEM Resolved"
  | "Template Selected"
  | "Draft Ready"
  | "Needs Review"
  | "Blocked"
  | "Approved"
  | "Published"
  | "Failed"
  | "Not Applicable";

export const STAGE_TONE: Record<PipelineStage, "good" | "warn" | "bad" | "info" | "muted"> = {
  Imported: "info",
  "Enrichment Pending": "info",
  "NeoVIN Complete": "info",
  "OEM Resolved": "info",
  "Template Selected": "info",
  "Draft Ready": "info",
  "Needs Review": "warn",
  Blocked: "bad",
  Approved: "good",
  Published: "good",
  Failed: "bad",
  "Not Applicable": "muted",
};

export interface VehicleIntelligenceInput {
  condition: string | null | undefined;
  /** Whether MarketCheck has ever imported this vehicle. */
  imported: boolean;
  /** Whether a raw provider decode is stored for this VIN. */
  hasStoredSourceData: boolean;
  /** Whether a normalized build sheet exists. */
  hasBuildSheet: boolean;
  /** factory_sticker_records.generation_status, if any. */
  oemRecordStatus?: string | null;
  oemReviewReason?: string | null;
  /** Document statuses keyed by family, from generated_documents. */
  documentStatuses?: Partial<Record<DocumentFamilyId, string | null>>;
}

export interface FamilyStatus {
  family: DocumentFamilyId;
  label: string;
  applicability: string;
  stage: PipelineStage;
  detail: string | null;
}

export interface VehicleIntelligenceRow {
  conditionClass: VehicleConditionClass;
  sourceStage: PipelineStage;
  families: FamilyStatus[];
  /** The single most urgent thing stopping this vehicle, or null. */
  blocker: string | null;
}

const OEM_STAGE: Record<string, PipelineStage> = {
  PENDING_DATA: "Enrichment Pending",
  NORMALIZING: "Enrichment Pending",
  VALIDATING: "Draft Ready",
  READY_TO_GENERATE: "Draft Ready",
  GENERATING: "Draft Ready",
  RUNNING_QA: "Draft Ready",
  REVIEW_REQUIRED: "Needs Review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  FAILED_RETRYABLE: "Failed",
  FAILED_PERMANENT: "Failed",
  SUPERSEDED: "Not Applicable",
  ARCHIVED: "Not Applicable",
};

const DOC_STAGE: Record<string, PipelineStage> = {
  draft: "Draft Ready",
  pending_approval: "Needs Review",
  approved: "Approved",
  published: "Published",
  printed: "Published",
  rejected: "Blocked",
  superseded: "Not Applicable",
  archived: "Not Applicable",
};

function sourceStage(input: VehicleIntelligenceInput): PipelineStage {
  if (!input.imported) return "Not Applicable";
  if (!input.hasStoredSourceData) return "Enrichment Pending";
  if (!input.hasBuildSheet) return "NeoVIN Complete";
  return "OEM Resolved";
}

export function buildIntelligenceRow(input: VehicleIntelligenceInput): VehicleIntelligenceRow {
  const conditionClass = classifyCondition(input.condition);
  const applicability = applicableFamilies(input.condition);

  const families: FamilyStatus[] = applicability.map((entry) => {
    const meta = DOCUMENT_FAMILIES[entry.family];
    if (entry.applicability === "not_applicable") {
      return {
        family: entry.family,
        label: meta.adminTitle,
        applicability: entry.applicability,
        stage: "Not Applicable",
        detail: entry.reason,
      };
    }

    if (entry.family === "oem_window_sticker_reproduction") {
      const status = String(input.oemRecordStatus ?? "").toUpperCase();
      const stage = status ? (OEM_STAGE[status] ?? "Needs Review") : sourceStage(input);
      return {
        family: entry.family,
        label: meta.adminTitle,
        applicability: entry.applicability,
        stage,
        // Internal pipeline codes are dealer-facing here on purpose: this
        // screen exists to say exactly what is wrong.
        detail: stage === "Needs Review" || stage === "Failed" || stage === "Blocked"
          ? input.oemReviewReason ?? null
          : null,
      };
    }

    const docStatus = String(input.documentStatuses?.[entry.family] ?? "").toLowerCase();
    return {
      family: entry.family,
      label: meta.adminTitle,
      applicability: entry.applicability,
      stage: docStatus ? (DOC_STAGE[docStatus] ?? "Needs Review") : "Draft Ready",
      detail: docStatus ? null : "not generated yet",
    };
  });

  // The blocker is the most urgent single problem, and a REQUIRED family
  // outranks an eligible one: a missing Buyers Guide matters more than an
  // unpublished merchandising sticker.
  const urgency: PipelineStage[] = ["Failed", "Blocked", "Needs Review"];
  let blocker: string | null = null;
  for (const stage of urgency) {
    const required = families.find((f) => f.stage === stage && f.applicability === "required");
    const any = families.find((f) => f.stage === stage);
    const hit = required ?? any;
    if (hit) {
      blocker = `${hit.label}: ${hit.stage}${hit.detail ? ` — ${hit.detail}` : ""}`;
      break;
    }
  }

  return { conditionClass, sourceStage: sourceStage(input), families, blocker };
}
