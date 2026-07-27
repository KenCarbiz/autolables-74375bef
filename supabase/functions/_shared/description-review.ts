// ─────────────────────────────────────────────────────────────────────
// Human review (§5, §6, §15) — the state machine and the version diff.
//
// Two invariants drive every decision in this file.
//
// First, the transition is decided on the server. The client renders whatever
// buttons it likes; nothing here trusts that rendering. Every rejection names
// a specific errorCode so the operator learns which precondition failed —
// a bare `false` would tell a reviewer only that the button did nothing.
//
// Second, a review verdict is a statement about ONE version of the copy. A
// reviewer who left a tab open while the writer pushed a revision is looking
// at text that no longer exists. Approving from that tab would attach a human
// sign-off to content nobody read, so `versionUnchanged: false` blocks the
// verdict actions outright. This is the optimistic-concurrency rule and it is
// the reason the review record is worth anything at all.
// ─────────────────────────────────────────────────────────────────────

export type ReviewState =
  | "not_submitted"
  | "ready_for_review"
  | "in_review"
  | "changes_requested"
  | "revised"
  | "review_completed"
  | "review_blocked"
  | "withdrawn";

export type ReviewAction =
  | "submit"
  | "assign"
  | "start"
  | "request_changes"
  | "submit_revision"
  | "complete"
  | "withdraw"
  | "block";

export interface TransitionContext {
  hasPermission: boolean;
  versionExists: boolean;
  sameTenant: boolean;
  validationComplete: boolean;
  hasBlockingFindings: boolean;
  scoreComplete: boolean;
  isSuperseded: boolean;
  versionUnchanged: boolean;
  hasActionableRequest: boolean;
  reasonProvided: boolean;
  checklistComplete: boolean;
  requiredReviewsMet: boolean;
  creatorIsActor: boolean;
  policyAllowsSelfReview: boolean;
}

export interface TransitionResult {
  allowed: boolean;
  nextState: ReviewState | null;
  errorCode: string | null;
  reason: string | null;
}

export const REVIEW_TRANSITIONS: Record<ReviewState, ReviewAction[]> = {
  not_submitted: ["submit", "block"],
  ready_for_review: ["assign", "start", "withdraw", "block"],
  in_review: ["request_changes", "complete", "withdraw", "block"],
  changes_requested: ["submit_revision", "withdraw", "block"],
  revised: ["assign", "start", "withdraw", "block"],
  review_completed: [],
  review_blocked: ["submit", "withdraw"],
  withdrawn: ["submit"],
};

const NEXT_STATE: Record<ReviewAction, ReviewState> = {
  submit: "ready_for_review",
  assign: "ready_for_review",
  start: "in_review",
  request_changes: "changes_requested",
  submit_revision: "revised",
  complete: "review_completed",
  withdraw: "withdrawn",
  block: "review_blocked",
};

// Actions a reviewer takes on someone else's work. A single-employee store is
// a real dealership, so self-review is a tenant policy switch rather than a
// hard prohibition — but it must be switched ON deliberately.
const REVIEWER_ACTIONS: ReviewAction[] = ["assign", "start", "request_changes", "complete"];

// Verdicts bind to the exact version they were rendered against.
const VERDICT_ACTIONS: ReviewAction[] = ["request_changes", "complete"];

const deny = (errorCode: string, reason: string): TransitionResult =>
  ({ allowed: false, nextState: null, errorCode, reason });

export function canTransition(
  from: ReviewState,
  action: ReviewAction,
  ctx: TransitionContext,
): TransitionResult {
  if (!ctx.versionExists) {
    return deny("VERSION_NOT_FOUND", "The description version this action targets no longer exists.");
  }
  if (!ctx.sameTenant) {
    return deny("REVIEW_TENANT_MISMATCH", "This description belongs to another dealership.");
  }
  if (!ctx.hasPermission) {
    return deny("REVIEW_UNAUTHORIZED", `You do not have permission to ${action.replace(/_/g, " ")} this description.`);
  }
  // A superseded version is not actionable in any direction: acting on it would
  // write review history against copy that a newer version already replaced.
  if (ctx.isSuperseded) {
    return deny("VERSION_SUPERSEDED", "A newer version of this description exists. Reopen the current version.");
  }

  const legal = REVIEW_TRANSITIONS[from];
  if (!legal || !legal.includes(action)) {
    return deny(
      "REVIEW_STATE_CONFLICT",
      `"${action}" is not available from state "${from}".`,
    );
  }

  if (REVIEWER_ACTIONS.includes(action) && ctx.creatorIsActor && !ctx.policyAllowsSelfReview) {
    return deny("SELF_REVIEW_FORBIDDEN", "You wrote this description and this store has not enabled self-review.");
  }

  if (VERDICT_ACTIONS.includes(action) && !ctx.versionUnchanged) {
    return deny("VERSION_CHANGED", "This description changed while you were reviewing it. Reload before deciding.");
  }

  switch (action) {
    case "submit":
    case "submit_revision": {
      if (!ctx.validationComplete) {
        return deny("VALIDATION_INCOMPLETE", "Validation has not finished for this version.");
      }
      if (ctx.hasBlockingFindings) {
        return deny("BLOCKING_FINDING_UNRESOLVED", "Resolve the blocking findings before requesting review.");
      }
      break;
    }
    case "request_changes": {
      if (!ctx.hasActionableRequest) {
        return deny("NO_ACTIONABLE_REQUEST", "Requesting changes needs at least one specific, actionable request.");
      }
      if (!ctx.reasonProvided) {
        return deny("REASON_REQUIRED", "Requesting changes needs a written reason the writer can act on.");
      }
      break;
    }
    case "complete": {
      if (!ctx.checklistComplete) {
        return deny("CHECKLIST_INCOMPLETE", "Every review checklist item must be answered before completing.");
      }
      if (ctx.hasBlockingFindings) {
        return deny("BLOCKING_FINDING_UNRESOLVED", "A blocking finding is still open on this version.");
      }
      if (!ctx.scoreComplete) {
        return deny("SCORE_INCOMPLETE", "Scoring has not finished for this version.");
      }
      if (!ctx.requiredReviewsMet) {
        return deny("REQUIRED_REVIEWS_UNMET", "This description still needs another reviewer.");
      }
      break;
    }
    case "block": {
      if (!ctx.reasonProvided) {
        return deny("REASON_REQUIRED", "Blocking a review needs a recorded reason.");
      }
      break;
    }
    default:
      break;
  }

  return { allowed: true, nextState: NEXT_STATE[action], errorCode: null, reason: null };
}

// ─────────────────────────────────────────────────────────────────────
// Version comparison (§15)
// ─────────────────────────────────────────────────────────────────────

export interface DiffSegment {
  type: "added" | "removed" | "unchanged";
  text: string;
}

export interface ConfigDiff {
  field: string;
  before: string | null;
  after: string | null;
}

export interface VersionComparison {
  textSegments: DiffSegment[];
  configChanges: ConfigDiff[];
  addedWordCount: number;
  removedWordCount: number;
  unchangedWordCount: number;
  changeRatio: number;
}

// The LCS table is quadratic. Description copy runs a few hundred words, so
// this ceiling is only ever hit by pasted-in garbage, where a word-level diff
// has no reader value anyway.
const MAX_DIFF_CELLS = 4_000_000;

function tokenize(text: string): string[] {
  return String(text ?? "").split(/\s+/).filter((t) => t.length > 0);
}

function push(out: DiffSegment[], type: DiffSegment["type"], word: string): void {
  const last = out[out.length - 1];
  if (last && last.type === type) last.text += " " + word;
  else out.push({ type, text: word });
}

export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) end++;

  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);

  const out: DiffSegment[] = [];
  for (let i = 0; i < start; i++) push(out, "unchanged", a[i]);

  if (midA.length * midB.length > MAX_DIFF_CELLS) {
    for (const w of midA) push(out, "removed", w);
    for (const w of midB) push(out, "added", w);
  } else {
    const m = midA.length;
    const n = midB.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midA[i] === midB[j]) { push(out, "unchanged", midA[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push(out, "removed", midA[i]); i++; }
      else { push(out, "added", midB[j]); j++; }
    }
    while (i < m) { push(out, "removed", midA[i]); i++; }
    while (j < n) { push(out, "added", midB[j]); j++; }
  }

  for (let k = a.length - end; k < a.length; k++) push(out, "unchanged", a[k]);
  return out;
}

function normalize(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function diffConfiguration(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ConfigDiff[] {
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).sort();
  const out: ConfigDiff[] = [];
  for (const field of keys) {
    const b = normalize((before ?? {})[field]);
    const a = normalize((after ?? {})[field]);
    if (b === a) continue;
    out.push({ field, before: b, after: a });
  }
  return out;
}

export function compareVersions(
  a: { content: string; config: Record<string, unknown> },
  b: { content: string; config: Record<string, unknown> },
): VersionComparison {
  const textSegments = diffWords(a.content, b.content);
  const configChanges = diffConfiguration(a.config, b.config);

  let addedWordCount = 0;
  let removedWordCount = 0;
  let unchangedWordCount = 0;
  for (const seg of textSegments) {
    const words = tokenize(seg.text).length;
    if (seg.type === "added") addedWordCount += words;
    else if (seg.type === "removed") removedWordCount += words;
    else unchangedWordCount += words;
  }

  const total = addedWordCount + removedWordCount + unchangedWordCount;
  const changeRatio = total === 0 ? 0 : (addedWordCount + removedWordCount) / total;

  return {
    textSegments,
    configChanges,
    addedWordCount,
    removedWordCount,
    unchangedWordCount,
    changeRatio,
  };
}
