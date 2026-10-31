import { consolePath } from "../sections";
import { readRows, settle } from "./read";
import { plural } from "./shared";

// Review models for mutating actions. Loading a review only reads recorded
// rows; executing goes through useConsoleMutation, which refuses everything
// this release has not been authorized to run.

export interface ReviewRow { label: string; value: string }

export interface ActionReviewModel {
  /** Mutation kind passed to useConsoleMutation. */
  kind: string;
  actionId: string;
  title: string;
  phoneTitle: string;
  heading: string;
  subtitle: string;
  rows: ReviewRow[];
  executeLabel: string;
  /** Pre-filled only in the design fixture. */
  reasonDraft: string;
  scope: string;
  previewVersion: string;
  backHref: string;
  phone: { heading: string; subtitle: string; rows: ReviewRow[]; reasonPlaceholder: string; note: string };
  /** False when the action id is not one this console can review. */
  recognised: boolean;
}

/** "kind.target" action ids; the target may be empty. */
export const actionId = (kind: string, target = "") => (target ? `${kind}.${target}` : kind);
export function parseActionId(id: string): { kind: string; target: string } {
  const i = id.indexOf(".");
  return i === -1 ? { kind: id, target: "" } : { kind: id.slice(0, i), target: id.slice(i + 1) };
}

export const importLabel = (id: string) => (id.startsWith("IMP-") ? id : `IMP-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`);

const DUPLICATE = "Operation key required; already-applied operation refused";

function simple(id: string, kind: string, o: { title: string; phoneTitle: string; heading: string; subtitle: string; scope: string; changes: string; calls: string; pre: string; execute: string; back: string; phoneNote?: string }): ActionReviewModel {
  return {
    kind,
    actionId: id,
    title: o.title,
    phoneTitle: o.phoneTitle,
    heading: o.heading,
    subtitle: o.subtitle,
    rows: [
      { label: "Scope", value: o.scope },
      { label: "Expected changes", value: o.changes },
      { label: "Provider calls", value: o.calls },
      { label: "Preconditions", value: o.pre },
      { label: "Duplicate protection", value: DUPLICATE },
    ],
    executeLabel: o.execute,
    reasonDraft: "",
    scope: o.scope,
    previewVersion: "preview-1",
    backHref: o.back,
    phone: {
      heading: o.heading,
      subtitle: o.scope,
      rows: [
        { label: "Scope", value: o.scope },
        { label: "Expected changes", value: o.changes },
        { label: "Preconditions", value: o.pre },
        { label: "Duplicate protection", value: "Idempotency key required" },
      ],
      reasonPlaceholder: "Why is this needed?",
      note: o.phoneNote ?? "Recheck scope before applying.",
    },
    recognised: true,
  };
}

interface RunRow { id: string; path: string; status: string; kind: string; failure_reason: string | null; started_at: string; report: unknown; binding_status: string | null }
interface SnapRow { id: string; store_id: string | null; source_dealer_id: string | null; status: string; row_count: number | null }
interface StoreName { id: string; display_name: string }
interface DiffReport { partitions?: { inventoryDiff?: { compared?: boolean; additions?: number; updates?: number; absenceCandidates?: number } | null; mapping?: { status?: string } | null }[] }

async function replayReview(id: string, runId: string): Promise<ActionReviewModel> {
  const [runs, snaps] = await Promise.all([
    settle(readRows<RunRow>("inventory_feed_runs", "id,path,status,kind,failure_reason,started_at,report,binding_status", { filters: [{ col: "id", op: "eq", value: runId }], limit: 1 })),
    settle(readRows<SnapRow>("inventory_store_snapshots", "id,store_id,source_dealer_id,status,row_count", { filters: [{ col: "run_id", op: "eq", value: runId }], limit: 5 })),
  ]);
  if (!runs.ok) throw new Error(`The import run is not readable: ${runs.error}`);
  const run = runs.value[0];
  if (!run) throw new Error("This import run was not found in your authorized scope.");
  const storeIds = snaps.ok ? [...new Set(snaps.value.map((s) => s.store_id).filter((s): s is string => !!s))] : [];
  const stores = storeIds.length ? await settle(readRows<StoreName>("dealer_stores", "id,display_name", { filters: [{ col: "id", op: "in", value: storeIds }], limit: 20 })) : null;
  const storeName = stores?.ok && stores.value.length ? stores.value.map((s) => s.display_name).join(", ") : "Unresolved store";
  const part = (run.report as DiffReport | null)?.partitions?.[0];
  const diff = part?.inventoryDiff;
  const changes = diff?.compared ? `${plural(diff.additions ?? 0, "addition")} · ${plural(diff.updates ?? 0, "update")} · ${plural(diff.absenceCandidates ?? 0, "removal")}` : "Not previewed; no impact comparison is recorded for this run";
  const mapping = part?.mapping?.status === "approved" ? "Mapping approved" : part?.mapping?.status === "pending" ? "Mapping pending approval" : "Mapping status not recorded";
  const label = importLabel(runId);
  const phoneChanges = diff?.compared ? `${diff.additions ?? 0} added · ${diff.updates ?? 0} updated · ${diff.absenceCandidates ?? 0} removed` : "Not previewed";
  return {
    kind: "replay_import",
    actionId: id,
    title: "Review operational action",
    phoneTitle: "Review replay",
    heading: "Review: replay retained import",
    subtitle: `${storeName} · ${label} · this is a mutating action, not a refresh`,
    rows: [
      { label: "Scope", value: `1 retained file · ${storeName} only` },
      { label: "Expected changes", value: changes },
      { label: "Provider calls", value: "None; retained file only" },
      { label: "Preconditions", value: `${mapping} · latest inventory version rechecked at execution` },
      { label: "Duplicate protection", value: "Operation key required; already-applied run refused" },
    ],
    executeLabel: "Execute replay",
    reasonDraft: "",
    scope: `${storeName} · ${label}`,
    previewVersion: run.started_at,
    backHref: consolePath.importRun(runId),
    phone: {
      heading: "Replay retained import",
      subtitle: `${storeName} only · no provider calls`,
      rows: [
        { label: "Retained file", value: label },
        { label: "Expected changes", value: phoneChanges },
        { label: "Preconditions", value: mapping },
        { label: "Duplicate protection", value: "Idempotency key required" },
      ],
      reasonPlaceholder: "Why is this needed?",
      note: "Recheck scope before applying.",
    },
    recognised: true,
  };
}

export async function loadAction(id: string): Promise<ActionReviewModel> {
  const { kind, target } = parseActionId(id);
  switch (kind) {
    case "replay-import":
      return replayReview(id, target);
    case "add-store":
      return simple(id, "add_store", { title: "Review operational action", phoneTitle: "Review new store", heading: "Review: add store / group", subtitle: "Creates a record; this is a mutating action, not a refresh", scope: "One new store or dealer group record", changes: "1 record added; no feed, listing sync or enrichment is enabled", calls: "None", pre: "Tenant exists · identity and subscription details supplied", execute: "Add store", back: consolePath.stores() });
    case "add-connection":
      return simple(id, "add_connection", { title: "Review operational action", phoneTitle: "Review connection", heading: "Review: add connection", subtitle: "Stores a server-side credential reference; secrets are never displayed", scope: "One new integration connection", changes: "1 connection record; no data is imported until a feed is approved", calls: "None until a diagnostic is run", pre: "Credential stored server-side · owner scope chosen", execute: "Add connection", back: consolePath.connections() });
    case "review-sharing":
      return simple(id, "review_sharing", { title: "Review operational action", phoneTitle: "Review sharing", heading: "Review: sharing permissions", subtitle: "A shared vehicle stays owned by its source store; this is a mutating action", scope: target ? "Sharing rules for this store" : "Sharing rules", changes: "None until a rule is edited and approved", calls: "None; viewing never authorizes paid enrichment", pre: "Default deny · only explicitly approved relations apply", execute: "Apply sharing change", back: target ? consolePath.store(target) : consolePath.stores() });
    case "diagnostic":
      return simple(id, "run_diagnostic", { title: "Review operational action", phoneTitle: "Review diagnostic", heading: "Review: connection diagnostic", subtitle: "A scoped test; disclose cost and side effects before running", scope: "Files.com directory listing, read only", changes: "None; no inventory is imported or published", calls: "One Files.com listing request; no paid market-data calls; cost is not metered", pre: "Credential configured server-side · no secret is displayed", execute: "Run diagnostic", back: consolePath.filesCom() });
    case "validate-sample":
      return simple(id, "validate_sample", { title: "Review operational action", phoneTitle: "Review validation", heading: "Review: validate sample", subtitle: "Checks a sample file against the mapping without importing it", scope: "One sample file, validated locally", changes: "None; nothing is imported or published", calls: "None", pre: "A mapping draft exists for this source", execute: "Validate sample", back: consolePath.mapping() });
    case "mapping-draft":
      return simple(id, "review_mapping", { title: "Review operational action", phoneTitle: "Review mapping", heading: "Review: mapping draft", subtitle: "Mapping changes apply to future imports only", scope: "Source column mapping for one feed", changes: "Replaces the active mapping after approval; retained imports are unchanged", calls: "None", pre: "Sample validated · owner approval recorded", execute: "Submit mapping draft", back: consolePath.mapping() });
    default:
      return { ...simple(id, "unknown", { title: "Review operational action", phoneTitle: "Review action", heading: "Review: unrecognised action", subtitle: "This console cannot review that action", scope: "Unknown", changes: "None", calls: "None", pre: "Not available", execute: "Execute", back: consolePath.connections() }), recognised: false };
  }
}
