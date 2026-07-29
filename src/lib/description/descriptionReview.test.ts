import { describe, it, expect } from "vitest";
import {
  canTransition,
  compareVersions,
  diffConfiguration,
  diffWords,
  REVIEW_TRANSITIONS,
  type ReviewAction,
  type ReviewState,
  type TransitionContext,
} from "../../../supabase/functions/_shared/description-review";

// The review record is only worth something if it proves a human read the exact
// text that shipped. These tests pin the two things that guarantee that: the
// server decides every transition, and a verdict cannot attach to a version
// that moved underneath the reviewer.

const ok = (over: Partial<TransitionContext> = {}): TransitionContext => ({
  hasPermission: true,
  versionExists: true,
  sameTenant: true,
  validationComplete: true,
  hasBlockingFindings: false,
  scoreComplete: true,
  isSuperseded: false,
  versionUnchanged: true,
  hasActionableRequest: true,
  reasonProvided: true,
  checklistComplete: true,
  requiredReviewsMet: true,
  creatorIsActor: false,
  policyAllowsSelfReview: false,
  ...over,
});

const ALL_ACTIONS: ReviewAction[] = [
  "submit", "assign", "start", "request_changes",
  "submit_revision", "complete", "withdraw", "block",
];

describe("review transition map", () => {
  it("moves a description through the happy path to review_completed", () => {
    const submitted = canTransition("not_submitted", "submit", ok());
    expect(submitted).toEqual({ allowed: true, nextState: "ready_for_review", errorCode: null, reason: null });

    const started = canTransition("ready_for_review", "start", ok());
    expect(started.nextState).toBe("in_review");

    const completed = canTransition("in_review", "complete", ok());
    expect(completed.allowed).toBe(true);
    expect(completed.nextState).toBe("review_completed");
  });

  it("routes a change request back through revision", () => {
    expect(canTransition("in_review", "request_changes", ok()).nextState).toBe("changes_requested");
    expect(canTransition("changes_requested", "submit_revision", ok()).nextState).toBe("revised");
    expect(canTransition("revised", "start", ok()).nextState).toBe("in_review");
  });

  it("treats review_completed as terminal", () => {
    expect(REVIEW_TRANSITIONS.review_completed).toEqual([]);
    for (const action of ALL_ACTIONS) {
      const result = canTransition("review_completed", action, ok());
      expect(result.allowed).toBe(false);
      expect(result.errorCode).toBe("REVIEW_STATE_CONFLICT");
    }
  });

  it("rejects any action not listed in the map with a state conflict", () => {
    const states = Object.keys(REVIEW_TRANSITIONS) as ReviewState[];
    for (const state of states) {
      for (const action of ALL_ACTIONS) {
        const result = canTransition(state, action, ok());
        if (REVIEW_TRANSITIONS[state].includes(action)) {
          expect(result.errorCode).not.toBe("REVIEW_STATE_CONFLICT");
        } else {
          expect(result.allowed).toBe(false);
          expect(result.errorCode).toBe("REVIEW_STATE_CONFLICT");
          expect(result.nextState).toBeNull();
        }
      }
    }
  });

  it("never returns a bare false without an error code and reason", () => {
    const result = canTransition("in_review", "complete", ok({ checklistComplete: false }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBeTruthy();
    expect(result.reason).toBeTruthy();
  });
});

describe("submit guards", () => {
  it("blocks submit while a blocking finding is unresolved", () => {
    const result = canTransition("not_submitted", "submit", ok({ hasBlockingFindings: true }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("BLOCKING_FINDING_UNRESOLVED");
  });

  it("blocks submit before validation has finished", () => {
    const result = canTransition("not_submitted", "submit", ok({ validationComplete: false }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("VALIDATION_INCOMPLETE");
  });

  it("applies the same guards to a revision submit", () => {
    expect(canTransition("changes_requested", "submit_revision", ok({ hasBlockingFindings: true })).errorCode)
      .toBe("BLOCKING_FINDING_UNRESOLVED");
    expect(canTransition("changes_requested", "submit_revision", ok({ validationComplete: false })).errorCode)
      .toBe("VALIDATION_INCOMPLETE");
  });
});

describe("authorization and tenant isolation", () => {
  it("blocks starting a review on another dealership's description", () => {
    const result = canTransition("ready_for_review", "start", ok({ sameTenant: false }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("REVIEW_TENANT_MISMATCH");
  });

  it("blocks an actor without review permission", () => {
    const result = canTransition("ready_for_review", "start", ok({ hasPermission: false }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("REVIEW_UNAUTHORIZED");
  });

  it("checks tenant isolation before permission", () => {
    const result = canTransition("ready_for_review", "start", ok({ sameTenant: false, hasPermission: false }));
    expect(result.errorCode).toBe("REVIEW_TENANT_MISMATCH");
  });

  it("blocks an action targeting a version that does not exist", () => {
    expect(canTransition("in_review", "complete", ok({ versionExists: false })).errorCode)
      .toBe("VERSION_NOT_FOUND");
  });
});

describe("request_changes guards", () => {
  it("requires an actionable request", () => {
    const result = canTransition("in_review", "request_changes", ok({ hasActionableRequest: false }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("NO_ACTIONABLE_REQUEST");
  });

  it("requires a written reason", () => {
    const result = canTransition("in_review", "request_changes", ok({ reasonProvided: false }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("REASON_REQUIRED");
  });

  it("allows the change request when both are present", () => {
    expect(canTransition("in_review", "request_changes", ok()).allowed).toBe(true);
  });
});

describe("complete guards", () => {
  it("blocks completion while the checklist is unanswered", () => {
    const result = canTransition("in_review", "complete", ok({ checklistComplete: false }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("CHECKLIST_INCOMPLETE");
  });

  it("blocks completion when the version moved under a stale tab", () => {
    const result = canTransition("in_review", "complete", ok({ versionUnchanged: false }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("VERSION_CHANGED");
    expect(result.nextState).toBeNull();
  });

  it("blocks a change request on a stale version too", () => {
    expect(canTransition("in_review", "request_changes", ok({ versionUnchanged: false })).errorCode)
      .toBe("VERSION_CHANGED");
  });

  it("blocks completion on an open blocking finding, missing score, or missing reviewer", () => {
    expect(canTransition("in_review", "complete", ok({ hasBlockingFindings: true })).errorCode)
      .toBe("BLOCKING_FINDING_UNRESOLVED");
    expect(canTransition("in_review", "complete", ok({ scoreComplete: false })).errorCode)
      .toBe("SCORE_INCOMPLETE");
    expect(canTransition("in_review", "complete", ok({ requiredReviewsMet: false })).errorCode)
      .toBe("REQUIRED_REVIEWS_UNMET");
  });
});

describe("self-review policy", () => {
  it("blocks the writer from reviewing their own copy by default", () => {
    const result = canTransition("in_review", "complete", ok({ creatorIsActor: true }));
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("SELF_REVIEW_FORBIDDEN");
  });

  it("permits self-review for a single-employee store that enabled it", () => {
    const ctx = ok({ creatorIsActor: true, policyAllowsSelfReview: true });
    expect(canTransition("ready_for_review", "start", ctx).allowed).toBe(true);
    expect(canTransition("in_review", "complete", ctx).allowed).toBe(true);
  });

  it("never blocks the writer from submitting or withdrawing their own work", () => {
    const ctx = ok({ creatorIsActor: true });
    expect(canTransition("not_submitted", "submit", ctx).allowed).toBe(true);
    expect(canTransition("in_review", "withdraw", ctx).allowed).toBe(true);
  });
});

describe("withdraw and block", () => {
  it("allows withdraw from every active review state", () => {
    for (const state of ["ready_for_review", "in_review", "changes_requested", "revised"] as ReviewState[]) {
      const result = canTransition(state, "withdraw", ok());
      expect(result.allowed).toBe(true);
      expect(result.nextState).toBe("withdrawn");
    }
  });

  it("allows resubmission after a withdrawal", () => {
    expect(canTransition("withdrawn", "submit", ok()).nextState).toBe("ready_for_review");
  });

  it("requires a reason to block a review", () => {
    expect(canTransition("in_review", "block", ok({ reasonProvided: false })).errorCode).toBe("REASON_REQUIRED");
    expect(canTransition("in_review", "block", ok()).nextState).toBe("review_blocked");
  });
});

describe("superseded versions", () => {
  it("blocks every action once a newer version exists", () => {
    const ctx = ok({ isSuperseded: true });
    const states = Object.keys(REVIEW_TRANSITIONS) as ReviewState[];
    for (const state of states) {
      for (const action of ALL_ACTIONS) {
        const result = canTransition(state, action, ctx);
        expect(result.allowed).toBe(false);
        expect(result.errorCode).toBe("VERSION_SUPERSEDED");
      }
    }
  });
});

describe("diffWords", () => {
  it("isolates a single changed word inside a long sentence", () => {
    const before = "This one owner 2025 INFINITI QX80 Sensory arrives with a clean history report and remaining factory coverage";
    const after = "This one owner 2025 INFINITI QX60 Sensory arrives with a clean history report and remaining factory coverage";
    const segments = diffWords(before, after);

    expect(segments.filter((s) => s.type === "removed")).toEqual([{ type: "removed", text: "QX80" }]);
    expect(segments.filter((s) => s.type === "added")).toEqual([{ type: "added", text: "QX60" }]);
    expect(segments.length).toBeGreaterThan(2);
    expect(segments.map((s) => s.text).join(" ").includes("QX80")).toBe(true);
  });

  it("marks a pure addition without touching the surrounding words", () => {
    const segments = diffWords("heated seats and navigation", "heated ventilated seats and navigation");
    expect(segments).toEqual([
      { type: "unchanged", text: "heated" },
      { type: "added", text: "ventilated" },
      { type: "unchanged", text: "seats and navigation" },
    ]);
  });

  it("marks a pure removal without touching the surrounding words", () => {
    const segments = diffWords("heated ventilated seats and navigation", "heated seats and navigation");
    expect(segments).toEqual([
      { type: "unchanged", text: "heated" },
      { type: "removed", text: "ventilated" },
      { type: "unchanged", text: "seats and navigation" },
    ]);
  });

  it("interleaves rather than returning two whole blobs", () => {
    const segments = diffWords("alpha bravo charlie delta echo", "alpha bravo golf delta hotel");
    const types = segments.map((s) => s.type);
    expect(types.filter((t) => t === "unchanged").length).toBeGreaterThanOrEqual(2);
    expect(segments.length).toBeGreaterThanOrEqual(4);
  });

  it("returns all unchanged for identical text", () => {
    const segments = diffWords("clean two owner sedan", "clean two owner sedan");
    expect(segments).toEqual([{ type: "unchanged", text: "clean two owner sedan" }]);
  });

  it("handles empty sides", () => {
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("", "brand new copy")).toEqual([{ type: "added", text: "brand new copy" }]);
    expect(diffWords("old copy", "")).toEqual([{ type: "removed", text: "old copy" }]);
  });
});

describe("diffConfiguration", () => {
  it("reports only the keys that changed", () => {
    const changes = diffConfiguration(
      { tone: "professional", channel: "autotrader", maxLength: 2400 },
      { tone: "enthusiastic", channel: "autotrader", maxLength: 2400 },
    );
    expect(changes).toEqual([{ field: "tone", before: "professional", after: "enthusiastic" }]);
  });

  it("reports added and removed keys with a null on the missing side", () => {
    const changes = diffConfiguration({ tone: "professional" }, { channel: "cars_com" });
    expect(changes).toEqual([
      { field: "channel", before: null, after: "cars_com" },
      { field: "tone", before: "professional", after: null },
    ]);
  });

  it("compares structured values by content, not identity", () => {
    expect(diffConfiguration({ areas: ["Manchester"] }, { areas: ["Manchester"] })).toEqual([]);
    expect(diffConfiguration({ areas: ["Manchester"] }, { areas: ["Hartford"] })).toHaveLength(1);
  });

  it("returns nothing for identical configuration", () => {
    expect(diffConfiguration({ tone: "professional", enabled: true }, { tone: "professional", enabled: true }))
      .toEqual([]);
  });
});

describe("compareVersions", () => {
  it("counts added, removed and unchanged words", () => {
    const result = compareVersions(
      { content: "alpha bravo charlie delta", config: { tone: "professional" } },
      { content: "alpha bravo echo foxtrot delta", config: { tone: "enthusiastic" } },
    );
    expect(result.removedWordCount).toBe(1);
    expect(result.addedWordCount).toBe(2);
    expect(result.unchangedWordCount).toBe(3);
    expect(result.configChanges).toEqual([{ field: "tone", before: "professional", after: "enthusiastic" }]);
    expect(result.changeRatio).toBeCloseTo(3 / 6, 10);
  });

  it("reports a change ratio of 0 for an identical version", () => {
    const result = compareVersions(
      { content: "clean two owner sedan", config: { tone: "professional" } },
      { content: "clean two owner sedan", config: { tone: "professional" } },
    );
    expect(result.addedWordCount).toBe(0);
    expect(result.removedWordCount).toBe(0);
    expect(result.unchangedWordCount).toBe(4);
    expect(result.changeRatio).toBe(0);
    expect(result.textSegments).toEqual([{ type: "unchanged", text: "clean two owner sedan" }]);
  });

  it("reports a change ratio of 1 for a full rewrite", () => {
    const result = compareVersions(
      { content: "alpha bravo", config: {} },
      { content: "charlie delta", config: {} },
    );
    expect(result.unchangedWordCount).toBe(0);
    expect(result.changeRatio).toBe(1);
  });

  it("reports a change ratio of 0 for two empty versions", () => {
    const result = compareVersions({ content: "", config: {} }, { content: "", config: {} });
    expect(result.changeRatio).toBe(0);
    expect(result.textSegments).toEqual([]);
  });
});
