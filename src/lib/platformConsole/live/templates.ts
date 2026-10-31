import type { StageModel, Tone } from "../types";
import { consolePath } from "../sections";
import { readRows, settle } from "./read";

export interface TemplateRow {
  id: string;
  name: string;
  version: string;
  validation: { label: string; tone: Tone };
  failures: string;
  actionLabel: string;
  href: string;
}

export interface TemplatesModel {
  rows: TemplateRow[];
  rowsNote: string;
  safeguardsHelper: string;
  stages: StageModel[];
}

interface TemplateDbRow { id: string; template_key: string; name: string; type: string; current_version: number; is_active: boolean; deleted_at: string | null }

const STAGES: StageModel[] = [
  { key: "draft", label: "Draft", value: "Edit", tone: "neutral" },
  { key: "validate", label: "Validate", value: "Required fields", tone: "neutral" },
  { key: "preview", label: "Preview", value: "PDF / QR", tone: "neutral" },
  { key: "review", label: "Review", value: "Store impact", tone: "neutral" },
  { key: "publish", label: "Publish", value: "Version retained", tone: "neutral" },
];

/**
 * Template names and published versions come from sticker_templates. No
 * output-validation or QR-destination checks are recorded anywhere, so those
 * columns say Not monitored instead of Passed.
 */
export async function loadTemplates(): Promise<TemplatesModel> {
  const templates = await settle(readRows<TemplateDbRow>("sticker_templates", "id,template_key,name,type,current_version,is_active,deleted_at", { order: "name", ascending: true, limit: 200 }));
  const notMonitored = { label: "Not monitored", tone: "neutral" as Tone };
  const rows: TemplateRow[] = templates.ok
    ? templates.value.filter((t) => t.is_active && !t.deleted_at).slice(0, 8).map((t) => ({
        id: t.id,
        name: t.name,
        version: `v${t.current_version}`,
        validation: notMonitored,
        failures: "No validation runs recorded",
        actionLabel: "Open template",
        href: consolePath.templates(),
      }))
    : [];
  rows.push({ id: "qr", name: "Passport QR destination", version: "Current", validation: notMonitored, failures: "No destination checks recorded", actionLabel: "Open incident", href: consolePath.reliability() });
  return {
    rows,
    rowsNote: templates.ok ? "No active templates are recorded." : "Templates are not readable, so versions and validation are unknown.",
    safeguardsHelper: "Validate a synthetic output before publishing a new version.",
    stages: STAGES,
  };
}
