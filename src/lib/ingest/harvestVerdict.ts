// ──────────────────────────────────────────────────────────────────────
// One reading of an OEM link-harvest response, used for BOTH the toast the
// operator sees and the reason string filed in vehicle_ingest_ledger.
//
// Deriving them from the same verdict is the point. The recurring failure in
// this codebase is a step failing while the UI says it worked; when the toast
// and the ledger row are two independent hand-written strings, they drift,
// and the ledger stops being a check on the toast.
//
// Response codes come from supabase/functions/oem-brochure and
// supabase/functions/oem-owners-manual.
// ──────────────────────────────────────────────────────────────────────

import type { IngestStep } from "./ingestOutcome";
import type { RecordableStatus } from "./recordIngestStep";

export type HarvestKind = "brochure" | "owners_manual";

export interface HarvestResponse {
  ok?: boolean;
  cached?: boolean;
  url?: string | null;
  year?: number | null;
  title?: string | null;
  error?: string | null;
  detail?: string | null;
}

export interface HarvestVerdict {
  step: IngestStep;
  status: RecordableStatus;
  /** Filed verbatim as vehicle_ingest_ledger.reason. Never empty. */
  reason: string;
  /** What the operator is told. Only "success" when the link truly landed. */
  toastKind: "success" | "error";
  toastMessage: string;
}

const NOUN: Record<HarvestKind, string> = {
  brochure: "brochure",
  owners_manual: "owner's manual",
};

const STEP: Record<HarvestKind, IngestStep> = {
  brochure: "oem_brochure",
  owners_manual: "owners_manual",
};

const clean = (v: unknown): string => String(v ?? "").trim();

export function harvestVerdict(
  kind: HarvestKind,
  res: HarvestResponse | null | undefined,
  invokeError: string | null | undefined,
  make: string,
): HarvestVerdict {
  const step = STEP[kind];
  const noun = NOUN[kind];
  const brand = clean(make) || "this make";
  const code = clean(res?.error);
  const transport = clean(invokeError);

  if (res?.ok === true && clean(res.url)) {
    const url = clean(res.url);
    const year = res.year ?? null;
    const via = res.cached ? "from the shared OEM link cache" : "newly harvested from the manufacturer's site";
    return {
      step,
      status: "succeeded",
      reason: `Linked to the official ${brand} ${noun}${year ? ` (${year})` : ""} at ${url} — ${via}.`,
      toastKind: "success",
      toastMessage: `Official ${noun} linked${res.cached ? "" : " (newly harvested)"} — it now shows in the shopper packet.`,
    };
  }

  // ok:true with no url is the shape of a success that produced nothing. It
  // must never read as linked.
  if (res?.ok === true) {
    return {
      step,
      status: "failed",
      reason: `The ${noun} harvester answered ok but returned no link, so nothing reaches the shopper packet.`,
      toastKind: "error",
      toastMessage: `The ${noun} search reported success but returned no link. Nothing was linked.`,
    };
  }

  if (transport) {
    return {
      step,
      status: "failed",
      reason: `The ${noun} harvester could not be reached: ${transport}`,
      toastKind: "error",
      toastMessage: `Couldn't reach the ${noun} search: ${transport}`,
    };
  }

  if (code === "make_not_supported") {
    return {
      step,
      status: "skipped",
      reason: `No official ${noun} source is configured for ${brand}, so no harvest was attempted.`,
      toastKind: "error",
      toastMessage: `No official ${noun} source configured for ${brand}.`,
    };
  }

  if (code === "not_configured") {
    return {
      step,
      status: "skipped",
      reason: `Not attempted: the ${noun} harvester has no search API key configured on this project.`,
      toastKind: "error",
      toastMessage: `The ${noun} search is not configured on this project — nothing was searched.`,
    };
  }

  if (code === "brochure_link_not_saved" || code === "manual_link_not_saved") {
    const url = clean(res?.url);
    const detail = clean(res?.detail);
    return {
      step,
      status: "failed",
      reason: `Found ${url || `a ${noun}`} but the link did not persist${detail ? ` (${detail})` : ""}, so the shopper packet has nothing to show.`,
      toastKind: "error",
      toastMessage: `Found the ${noun} but couldn't save the link — it won't show on the packet.`,
    };
  }

  if (code === "brochure_unreachable" || code === "manual_unreachable") {
    const url = clean(res?.url);
    return {
      step,
      status: "failed",
      reason: `The best ${noun} candidate${url ? ` (${url})` : ""} answered as a dead link, so it was not saved.`,
      toastKind: "error",
      toastMessage: `The ${noun} link found for this vehicle is dead — nothing was linked.`,
    };
  }

  if (code === "brochure_not_found" || code === "manual_not_found" || !code) {
    return {
      step,
      status: "failed",
      reason: `No official ${brand} ${noun} was found on the manufacturer's own site for this model${code ? "" : " (the harvester returned no result code)"}.`,
      toastKind: "error",
      toastMessage: `No official ${brand} ${noun} found for this model.`,
    };
  }

  return {
    step,
    status: "failed",
    reason: `The ${noun} harvest failed with "${code}".`,
    toastKind: "error",
    toastMessage: `The ${noun} search failed (${code}).`,
  };
}
