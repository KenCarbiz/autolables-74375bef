import { describe, expect, it } from "vitest";
import {
  deriveRecallView,
  recallScopeOfSource,
  recallTone,
  vinRecallCheckComplete,
  type RecallRowInput,
} from "./recallView";

const NOW = Date.parse("2026-09-09T12:00:00Z");
const view = (row: RecallRowInput | null) => deriveRecallView(row, { now: NOW });

// The 74 pilot rows: NHTSA answered HTTP 400 with a body that says "Results
// returned successfully", the writer stored the note, left recall_status NULL,
// and left open_recall_count = 0 sitting beside it.
const UNANSWERED_400: RecallRowInput = {
  recall_status: null,
  open_recall_count: 0,
  recall_payload: {
    source: "nhtsa",
    note: "no_nhtsa_record_http_400",
    checked_at: "2026-09-08T03:00:00Z",
  },
};

// 2027 INFINITI QX60: NHTSA recognises the model and legitimately returns zero
// campaigns. A real answer — at MODEL scope.
const MODEL_CLEAR: RecallRowInput = {
  recall_status: "clear",
  open_recall_count: 0,
  recall_payload: {
    source: "nhtsa",
    checked_at: "2026-09-08T03:00:00Z",
    model_in_catalog: true,
    open_recall_count: 0,
  },
};

const VIN_CLEAR: RecallRowInput = {
  recall_status: "clear",
  open_recall_count: 0,
  recall_payload: {
    source: "marketcheck",
    scope: "vin",
    checked_at: "2026-09-08T03:00:00Z",
    open_recall_count: 0,
    campaigns: [],
  },
};

describe("recall scope", () => {
  it("knows which providers can answer which question", () => {
    expect(recallScopeOfSource("nhtsa")).toBe("model");
    expect(recallScopeOfSource("marketcheck")).toBe("vin");
    expect(recallScopeOfSource("marketcheck_autorecalls")).toBe("vin");
    expect(recallScopeOfSource("something_new")).toBeNull();
    expect(recallScopeOfSource(null)).toBeNull();
  });
});

describe("a model-level answer never becomes VIN clearance", () => {
  it("keeps NO_MODEL_CAMPAIGNS_FOUND out of the VIN scope entirely", () => {
    const v = view(MODEL_CLEAR);
    expect(v.model?.state).toBe("NO_MODEL_CAMPAIGNS_FOUND");
    expect(v.model?.campaignCount).toBe(0);
    expect(v.vin.state).toBe("UNKNOWN");
    expect(v.vin.clearClaimAllowed).toBe(false);
    expect(v.vin.checkComplete).toBe(false);
    expect(vinRecallCheckComplete(v)).toBe(false);
  });

  it("never emits a count from a model-level zero", () => {
    expect(view(MODEL_CLEAR).vin.openCount).toBeNull();
    expect(view(UNANSWERED_400).vin.openCount).toBeNull();
  });

  it("shows the model answer as model-level context, not this car's status", () => {
    const v = view(MODEL_CLEAR);
    expect(v.model?.detail).toMatch(/model-level context, not a check of this VIN/i);
    expect(v.vin.label).toBe("Recall verification unavailable");
  });

  it("is never green", () => {
    expect(recallTone(view(MODEL_CLEAR))).toBe("muted");
    expect(recallTone(view(UNANSWERED_400))).toBe("muted");
  });
});

describe("the ambiguous NHTSA 400", () => {
  it("is MODEL_NOT_FOUND without a catalogue verdict, never a clean answer", () => {
    const v = view(UNANSWERED_400);
    expect(v.model?.state).toBe("MODEL_NOT_FOUND");
    expect(v.model?.campaignCount).toBeNull();
    expect(v.vin.state).toBe("UNKNOWN");
  });

  it("becomes NO_MODEL_CAMPAIGNS_FOUND only when the catalogue confirms the model", () => {
    const v = view({
      ...UNANSWERED_400,
      recall_payload: { ...(UNANSWERED_400.recall_payload as object), model_in_catalog: true },
    });
    expect(v.model?.state).toBe("NO_MODEL_CAMPAIGNS_FOUND");
    // Still not this VIN's clearance.
    expect(v.vin.clearClaimAllowed).toBe(false);
  });
});

describe("a zero without source, scope and time is not a clean claim", () => {
  it("refuses a bare 'clear' status with no payload at all", () => {
    const v = view({ recall_status: "clear", open_recall_count: 0 });
    expect(v.vin.state).toBe("UNKNOWN");
    expect(v.vin.clearClaimAllowed).toBe(false);
    expect(v.model).toBeNull();
  });

  it("refuses a VIN-scope answer that carries no timestamp", () => {
    const v = view({
      recall_status: "clear",
      open_recall_count: 0,
      recall_payload: { source: "marketcheck", scope: "vin", open_recall_count: 0 },
    });
    expect(v.vin.clearClaimAllowed).toBe(false);
  });

  it("allows the claim only with a VIN source, a time and a live answer", () => {
    const v = view(VIN_CLEAR);
    expect(v.vin.state).toBe("VERIFIED_CLEAR");
    expect(v.vin.clearClaimAllowed).toBe(true);
    expect(v.vin.openCount).toBe(0);
    expect(v.vin.source).toBe("marketcheck");
    expect(recallTone(v)).toBe("green");
  });

  it("ages a VIN answer out of its clean claim", () => {
    const stale = deriveRecallView(VIN_CLEAR, { now: Date.parse("2026-12-01T00:00:00Z") });
    expect(stale.vin.state).toBe("STALE");
    expect(stale.vin.clearClaimAllowed).toBe(false);
    expect(stale.vin.openCount).toBeNull();
  });
});

describe("NULL and absence", () => {
  it("renders nothing at all as UNKNOWN with a null count", () => {
    const v = view(null);
    expect(v.vin.state).toBe("UNKNOWN");
    expect(v.vin.openCount).toBeNull();
    expect(v.model).toBeNull();
    expect(v.riskSignalled).toBe(false);
  });

  it("treats a NULL count as unknown rather than zero", () => {
    const v = view({ recall_status: null, open_recall_count: null });
    expect(v.vin.openCount).toBeNull();
    expect(v.vin.clearClaimAllowed).toBe(false);
  });

  it("treats a provider failure as UNKNOWN, never as clear", () => {
    const v = view({
      recall_payload: { source: "nhtsa", note: "http_503 upstream error", checked_at: "2026-09-08T03:00:00Z" },
    });
    expect(v.model?.state).toBe("LOOKUP_FAILED");
    expect(v.vin.clearClaimAllowed).toBe(false);
    expect(v.vin.openCount).toBeNull();
  });
});

describe("risk is never hidden by the correction", () => {
  it("warns from model-level campaigns while leaving the VIN unknown", () => {
    const v = view({
      recall_status: "open_recalls",
      open_recall_count: 2,
      recall_payload: {
        source: "nhtsa",
        checked_at: "2026-09-08T03:00:00Z",
        campaigns: [{ campaignNumber: "26V001", status: "open" }, { campaignNumber: "26V002", status: "open" }],
      },
    });
    expect(v.model?.state).toBe("MODEL_CAMPAIGNS_FOUND");
    expect(v.riskSignalled).toBe(true);
    expect(v.vin.state).toBe("UNKNOWN");
    expect(v.vin.clearClaimAllowed).toBe(false);
    expect(recallTone(v)).toBe("red");
  });

  it("blocks on do-not-drive language at any scope", () => {
    const v = view({
      recall_payload: {
        source: "nhtsa",
        checked_at: "2026-09-08T03:00:00Z",
        campaigns: [{ component: "Fuel pump", summary: "DO NOT DRIVE until remedied", status: "open" }],
      },
    });
    expect(v.doNotDrive).toBe(true);
    expect(v.riskSignalled).toBe(true);
    expect(recallTone(v)).toBe("red");
  });

  it("reports a disagreement as a disagreement rather than as a clean car", () => {
    const v = view({
      recall_status: "clear",
      open_recall_count: 0,
      recall_payload: { source: "marketcheck", scope: "vin", checked_at: "2026-09-08T03:00:00Z", open_recall_count: 0 },
      recall_check: { has_open: true, checked_at: "2026-09-08T04:00:00Z", source: "marketcheck", campaigns: [{ status: "open" }] },
    });
    expect(v.conflict).toBe(true);
    expect(v.vin.clearClaimAllowed).toBe(false);
  });
});

describe("a VIN-level open answer", () => {
  it("counts and labels at VIN scope", () => {
    const v = view({
      recall_status: "open_recalls",
      open_recall_count: 1,
      recall_payload: {
        source: "marketcheck", scope: "vin", checked_at: "2026-09-08T03:00:00Z",
        campaigns: [{ campaignNumber: "26V010", status: "open" }],
      },
    });
    expect(v.vin.state).toBe("OPEN");
    expect(v.vin.openCount).toBe(1);
    expect(v.vin.checkComplete).toBe(true);
    expect(v.vin.clearClaimAllowed).toBe(false);
  });
});

// ── The writer's own vocabulary, read verbatim ──────────────────────────────
//
// supabase/functions/_shared/recallState.ts stamps `state` on both stores:
// VIN_RECALL_STATUS_VALUES on `recall_check`, MODEL_RECALL_STATE_VALUES on
// `recall_payload`. These are the shapes `vinRecallColumns` and
// `modelRecallColumns` actually emit — if this reader stopped agreeing with
// them, every surface would silently fall back to the legacy heuristics.
describe("reads the writer's two scopes as written", () => {
  const written = (recall_check: unknown, recall_payload: unknown, cols: RecallRowInput = {}) =>
    view({ ...cols, recall_check, recall_payload });

  it("reads a VIN verified_clear beside a model no_model_campaigns_found", () => {
    const v = written(
      {
        scope: "vin", state: "verified_clear", source: "marketcheck",
        checked_at: "2026-09-08T03:00:00Z", vin: "5N1AL1F83VC332076",
        open_count: 0, closed_count: 2, has_open: false, do_not_drive: false, campaigns: [],
      },
      {
        scope: "model", state: "no_model_campaigns_found", source: "nhtsa",
        checked_at: "2026-09-08T03:00:00Z", campaign_count: 0, campaigns: [],
        has_open: false, do_not_drive: false,
      },
      { recall_status: "verified_clear", open_recall_count: 0 },
    );
    expect(v.vin.state).toBe("VERIFIED_CLEAR");
    expect(v.vin.clearClaimAllowed).toBe(true);
    expect(v.vin.openCount).toBe(0);
    expect(v.model?.state).toBe("NO_MODEL_CAMPAIGNS_FOUND");
    expect(v.model?.campaignCount).toBe(0);
  });

  // The unanswered VIN lookup the writer records: an attempt, never a check
  // date, with recall_status left NULL so the sweep comes back to the vehicle.
  it("reads an unanswered VIN attempt as UNKNOWN with no count", () => {
    const v = written(
      { scope: "vin", state: "unknown", source: "marketcheck", attempted_at: "2026-09-08T03:00:00Z", vin: "X", campaigns: [], note: "no_vin_source" },
      { scope: "model", state: "model_not_found", source: "nhtsa", checked_at: "2026-09-08T03:00:00Z", campaign_count: null, campaigns: [] },
      { recall_status: null, open_recall_count: null },
    );
    expect(v.vin.state).toBe("UNKNOWN");
    expect(v.vin.openCount).toBeNull();
    expect(v.vin.clearClaimAllowed).toBe(false);
    expect(v.model?.state).toBe("MODEL_NOT_FOUND");
    expect(v.model?.campaignCount).toBeNull();
  });

  it("reads a VIN open answer and its count from the writer's own keys", () => {
    const v = written(
      {
        scope: "vin", state: "open_recalls", source: "marketcheck",
        checked_at: "2026-09-08T03:00:00Z", vin: "X", open_count: 2, closed_count: 1,
        has_open: true, do_not_drive: false,
        campaigns: [{ campaign: "26V001", status: "open" }, { campaign: "26V002", status: "open" }],
      },
      null,
      { recall_status: "open_recalls", open_recall_count: 2 },
    );
    expect(v.vin.state).toBe("OPEN");
    expect(v.vin.openCount).toBe(2);
    expect(v.vin.checkComplete).toBe(true);
    expect(v.riskSignalled).toBe(true);
  });

  it("reads a model lookup_failed without inventing a campaign count", () => {
    const v = written(
      null,
      { scope: "model", state: "lookup_failed", source: "nhtsa", checked_at: "2026-09-08T03:00:00Z", campaign_count: null, campaigns: [], note: "http_503" },
    );
    expect(v.model?.state).toBe("LOOKUP_FAILED");
    expect(v.model?.campaignCount).toBeNull();
    expect(v.vin.state).toBe("UNKNOWN");
    expect(v.vin.clearClaimAllowed).toBe(false);
  });

  it("reads model_campaigns_found as a warning that never clears the VIN", () => {
    const v = written(
      { scope: "vin", state: "unknown", source: "marketcheck", attempted_at: "2026-09-08T03:00:00Z", campaigns: [] },
      {
        scope: "model", state: "model_campaigns_found", source: "nhtsa",
        checked_at: "2026-09-08T03:00:00Z", campaign_count: 3, has_open: true,
        campaigns: [{ campaign: "A", status: "open" }, { campaign: "B", status: "open" }, { campaign: "C", status: "open" }],
      },
    );
    expect(v.model?.state).toBe("MODEL_CAMPAIGNS_FOUND");
    expect(v.model?.campaignCount).toBe(3);
    expect(v.riskSignalled).toBe(true);
    expect(v.vin.state).toBe("UNKNOWN");
    expect(v.vin.checkComplete).toBe(false);
  });
});
