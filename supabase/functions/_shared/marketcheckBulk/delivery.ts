// Pure decisions about whether a MarketCheck bulk delivery may be committed.
// A delivery is never trusted as a complete snapshot unless every expected
// part arrived, checksums match and completion evidence exists. Removals
// (sold / delisted vehicles) are inferred only from a complete full snapshot.

export type DeliveryPart = {
  partNo: number; path: string; size: number;
  expectedChecksum?: string | null; actualChecksum?: string | null;
  rowCount?: number | null; receivedAt?: string | null;
};

export type Delivery = {
  feedKey: string;
  environment: "production" | "release_test";
  deliveryKey: string;
  scope: "full" | "delta";
  expectedParts: number | null;
  parts: DeliveryPart[];
  completionEvidence: "notification" | "success_metadata" | "manifest" | "none";
  expectedRowCount?: number | null;
  schemaVersion?: string | null;
};

export type DeliveryOptions = { activeSchemaVersions: string[]; previousRowCount?: number | null; maxRowDropPct?: number };
export type DeliveryDecision = { complete: boolean; canCommitSnapshot: boolean; canInferRemovals: boolean; reasons: string[] };

export function evaluateDelivery(d: Delivery, opts: DeliveryOptions): DeliveryDecision {
  const reasons: string[] = [];
  const maxDrop = opts.maxRowDropPct ?? 30;

  // --- completeness
  let complete = true;
  if (d.completionEvidence === "none") { complete = false; reasons.push("no_completion_evidence"); }
  if (d.expectedParts === null || d.expectedParts < 1) {
    complete = false; reasons.push("expected_parts_unknown");
  } else {
    const counts = new Map<number, number>();
    for (const p of d.parts) counts.set(p.partNo, (counts.get(p.partNo) ?? 0) + 1);
    const dup = [...counts].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b);
    if (dup.length) { complete = false; reasons.push(`duplicate_parts:${dup.join(",")}`); }
    const missing: number[] = [];
    for (let n = 1; n <= d.expectedParts; n++) if (!counts.has(n)) missing.push(n);
    if (missing.length) { complete = false; reasons.push(`missing_parts:${missing.join(",")}`); }
    const extra = [...counts.keys()].filter((n) => n < 1 || n > (d.expectedParts as number)).sort((a, b) => a - b);
    if (extra.length) { complete = false; reasons.push(`unexpected_parts:${extra.join(",")}`); }
  }
  for (const p of d.parts) {
    if (p.expectedChecksum) {
      if (!p.actualChecksum) { complete = false; reasons.push(`checksum_unverified:${p.partNo}`); }
      else if (p.expectedChecksum.toLowerCase() !== p.actualChecksum.toLowerCase()) { complete = false; reasons.push(`checksum_mismatch:${p.partNo}`); }
    }
  }

  // --- commit eligibility
  let canCommit = complete;
  if (d.environment !== "production") { canCommit = false; reasons.push("release_test_never_commits"); }
  if (!d.schemaVersion || !opts.activeSchemaVersions.includes(d.schemaVersion)) {
    canCommit = false; reasons.push(`schema_version_not_active:${d.schemaVersion ?? "unknown"}`);
  }
  const partRows = d.parts.every((p) => typeof p.rowCount === "number")
    ? d.parts.reduce((s, p) => s + (p.rowCount as number), 0) : null;
  if (d.expectedRowCount != null) {
    if (partRows === null) { canCommit = false; reasons.push("row_count_unverified"); }
    else if (partRows !== d.expectedRowCount) { canCommit = false; reasons.push(`row_count_mismatch:${partRows}/${d.expectedRowCount}`); }
  }

  // --- removal inference
  let canInfer = canCommit;
  if (d.scope !== "full") { canInfer = false; reasons.push("delta_cannot_infer_removals"); }
  if (opts.previousRowCount != null && opts.previousRowCount > 0) {
    const current = partRows ?? d.expectedRowCount ?? null;
    if (current === null) { canInfer = false; reasons.push("row_count_unknown_for_drop_check"); }
    else {
      const dropPct = ((opts.previousRowCount - current) / opts.previousRowCount) * 100;
      if (dropPct > maxDrop) { canInfer = false; reasons.push(`suspicious_row_drop:${dropPct.toFixed(1)}pct`); }
    }
  }
  return { complete, canCommitSnapshot: canCommit, canInferRemovals: canInfer, reasons };
}

export type TimelineStageName = "expected" | "received" | "complete" | "validated" | "imported" | "enriched";
export type StageStatus = "done" | "pending" | "late" | "failed";
export type TimelineInput = {
  expectedAt?: string | null; receivedAt?: string | null; completedAt?: string | null;
  validatedAt?: string | null; importedAt?: string | null; enrichedAt?: string | null;
  // Optional per-stage deadlines (ISO). "received" defaults to expectedAt.
  deadlines?: Partial<Record<TimelineStageName, string | null>>;
  // Stage -> failure reason.
  failures?: Partial<Record<TimelineStageName, string>>;
};
export type TimelineStage = { stage: TimelineStageName; at: string | null; status: StageStatus; deadline: string | null; detail?: string };

const ORDER: [TimelineStageName, keyof TimelineInput][] = [
  ["expected", "expectedAt"], ["received", "receivedAt"], ["complete", "completedAt"],
  ["validated", "validatedAt"], ["imported", "importedAt"], ["enriched", "enrichedAt"],
];

// Each stage keeps its own timestamp; nothing is inferred from a neighbour.
// "late" = not done and its deadline plus grace has passed.
export function deliveryTimeline(t: TimelineInput, now: Date | string | number = Date.now(), graceMinutes = 0): TimelineStage[] {
  const nowMs = new Date(now).getTime();
  const graceMs = graceMinutes * 60_000;
  return ORDER.map(([stage, key]) => {
    const at = (t[key] as string | null | undefined) ?? null;
    const deadline = t.deadlines?.[stage] ?? (stage === "received" ? t.expectedAt ?? null : null);
    const failure = t.failures?.[stage];
    let status: StageStatus = "pending";
    if (failure) status = "failed";
    else if (at) status = "done";
    else if (deadline && nowMs > new Date(deadline).getTime() + graceMs) status = "late";
    return { stage, at, status, deadline, ...(failure ? { detail: failure } : {}) };
  });
}
