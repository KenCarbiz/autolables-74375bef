// rtgip/2 durable delivery model: outbox, Gateway admission, target inbox, acknowledgments,
// revision ordering, retry/dead-letter and reconciliation. Shared byte-for-byte across apps.
// The in-memory stores mirror the proposed SQL (rtgip_v2_delivery.proposed.sql); they are the
// executable specification, not a substitute for the database transaction.

import {
  authorize,
  canonicalize,
  hmacHex,
  sha256Hex,
  timingSafeEqual,
  MAX_SKEW_SECONDS,
  PROTOCOL,
  type AppId,
  type EnvelopeV2,
  type Registry,
  type ServiceKey,
  type Signer,
  type VerifiedDelivery,
} from "./protocol.ts";

// ---------------------------------------------------------------------------
// Acknowledgments. Each level is a separately signed receipt; an HTTP 2xx alone
// never advances delivery state.
// ---------------------------------------------------------------------------

export type ReceiptKind = "gateway_admission" | "target_inbox" | "consumer_commit";
export type InboxOutcome = "applied" | "duplicate" | "stale_ignored" | "held" | "quarantined";
/** Outcomes that mean the consumer effect (or its deliberate no-op) is durably committed. */
export type CommittedOutcome = "applied" | "stale_ignored";
export const COMMITTED_OUTCOMES: ReadonlySet<string> = new Set(["applied", "stale_ignored"]);

/** Outcomes each receipt kind may carry. A consumer_commit can only state a committed effect. */
export const RECEIPT_OUTCOMES: Record<ReceiptKind, ReadonlySet<string>> = {
  gateway_admission: new Set(["admitted"]),
  target_inbox: new Set(["applied", "duplicate", "stale_ignored", "held", "quarantined"]),
  consumer_commit: COMMITTED_OUTCOMES,
};

export interface Receipt {
  protocol: typeof PROTOCOL;
  kind: ReceiptKind;
  event_id: string;
  route: string;
  source_app: AppId;
  target_app: AppId;
  tenant_id: string;
  rooftop_id: string;
  connection_id: string;
  payload_sha256: string;
  issuer: Signer;
  outcome: InboxOutcome | "admitted";
  issued_at: number;
  key_id: string;
  signature: string;
}

type Unsigned = Omit<Receipt, "signature" | "key_id">;

/** Everything a receipt must match: the exact delivery, its connection and its issuer. */
export interface ReceiptExpectation {
  kind: ReceiptKind;
  event_id: string;
  route: string;
  source_app: AppId;
  target_app: AppId;
  tenant_id: string;
  rooftop_id: string;
  connection_id: string;
  payload_sha256: string;
  issuer: Signer;
}

export function expectReceipt(
  e: EnvelopeV2,
  connection_id: string,
  kind: ReceiptKind,
): ReceiptExpectation {
  return {
    kind,
    event_id: e.event_id,
    route: e.route,
    source_app: e.source_app,
    target_app: e.target_app,
    tenant_id: e.tenant_id,
    rooftop_id: e.rooftop_id,
    connection_id,
    payload_sha256: e.payload_sha256,
    issuer: kind === "gateway_admission" ? "gateway" : e.target_app,
  };
}

/** The exact bytes a receipt signature covers (also what the SQL verifier recomputes). */
export const receiptSigningJson = (r: Omit<Receipt, "signature">): string => canonicalize(r);
const RECEIPT_DOMAIN = "rtgip/2-receipt\n";

export async function signReceipt(r: Unsigned, key: ServiceKey): Promise<Receipt> {
  if (key.owner !== r.issuer) throw new Error("receipt_issuer_key_mismatch");
  if (key.dialect !== PROTOCOL) throw new Error("receipt_key_dialect_mismatch");
  if (!key.connection_ids.includes(r.connection_id)) throw new Error("receipt_key_not_bound");
  if (!RECEIPT_OUTCOMES[r.kind].has(r.outcome)) throw new Error("receipt_outcome_not_allowed");
  const withKey = { ...r, key_id: key.key_id };
  return {
    ...withKey,
    signature: await hmacHex(key.secret, RECEIPT_DOMAIN + receiptSigningJson(withKey)),
  };
}

const BOUND_FIELDS = [
  "event_id",
  "route",
  "source_app",
  "target_app",
  "tenant_id",
  "rooftop_id",
  "connection_id",
  "payload_sha256",
] as const;

/**
 * Verify a receipt against the delivery it claims to acknowledge. Fails closed on any
 * difference in event, route, tenant, rooftop, connection or payload hash, on an outcome
 * the receipt kind may not carry, and on a key that is unknown, of another dialect,
 * revoked, outside its validity window, not owned by the issuer or not bound to the
 * connection. The connection itself must still be active and grant the rooftop.
 */
export async function verifyReceipt(
  r: Receipt | undefined,
  expect: ReceiptExpectation,
  reg: Registry,
  nowSec: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!r) return { ok: false, reason: "ack_missing" };
  if (r.protocol !== PROTOCOL || r.kind !== expect.kind)
    return { ok: false, reason: "ack_wrong_kind" };
  for (const f of BOUND_FIELDS)
    if (r[f] !== expect[f]) return { ok: false, reason: `ack_wrong_${f}` };
  if (r.issuer !== expect.issuer) return { ok: false, reason: "ack_wrong_issuer" };
  if (!RECEIPT_OUTCOMES[r.kind].has(r.outcome))
    return { ok: false, reason: "ack_outcome_not_allowed" };
  if (!Number.isSafeInteger(r.issued_at) || r.issued_at > nowSec + MAX_SKEW_SECONDS)
    return { ok: false, reason: "ack_issued_in_future" };
  const key = reg.keys.find((k) => k.key_id === r.key_id);
  if (!key || key.owner !== r.issuer) return { ok: false, reason: "ack_bad_key" };
  if (key.dialect !== PROTOCOL) return { ok: false, reason: "ack_key_dialect_mismatch" };
  if (key.status === "revoked") return { ok: false, reason: "ack_key_revoked" };
  if (r.issued_at < key.not_before || r.issued_at > key.not_after)
    return { ok: false, reason: "ack_key_outside_validity" };
  if (!key.connection_ids.includes(r.connection_id))
    return { ok: false, reason: "ack_key_not_bound_to_connection" };
  const conn = reg.connections.find((c) => c.connection_id === r.connection_id);
  if (
    !conn ||
    conn.source_app !== r.source_app ||
    conn.target_app !== r.target_app ||
    conn.tenant_id !== r.tenant_id ||
    !conn.rooftop_ids.includes(r.rooftop_id)
  )
    return { ok: false, reason: "ack_connection_mismatch" };
  if (conn.status !== "active") return { ok: false, reason: "ack_connection_inactive" };
  const { signature, ...rest } = r;
  if (typeof signature !== "string") return { ok: false, reason: "ack_bad_signature" };
  const expected = await hmacHex(key.secret, RECEIPT_DOMAIN + receiptSigningJson(rest));
  if (!timingSafeEqual(expected, signature)) return { ok: false, reason: "ack_bad_signature" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Retry policy: bounded exponential backoff with injectable jitter.
// ---------------------------------------------------------------------------

export const RETRY = { baseSec: 5, capSec: 900, maxAttempts: 10 } as const;

export function backoffSeconds(attempt: number, rand: () => number = Math.random): number {
  const ceiling = Math.min(RETRY.capSec, RETRY.baseSec * 2 ** Math.max(0, attempt - 1));
  return Math.max(1, Math.floor(ceiling / 2 + rand() * (ceiling / 2)));
}

// ---------------------------------------------------------------------------
// Source outbox. Rows are created in the same transaction as the business change
// (see transaction()). State only advances on a verified receipt of the next level.
// ---------------------------------------------------------------------------

export type OutboxState =
  | "pending"
  | "in_flight"
  | "retry_wait"
  | "gateway_admitted"
  | "target_persisted"
  | "consumer_committed"
  | "target_quarantined"
  | "dead_letter";

export interface OutboxRow {
  event_id: string;
  route: string;
  envelope: EnvelopeV2;
  body: string;
  body_sha256: string;
  state: OutboxState;
  attempts: number;
  next_attempt_at: number;
  lease_owner: string | null;
  lease_until: number;
  last_error: string | null;
  receipts: Receipt[];
}

export class OutboxConflictError extends Error {
  constructor() {
    super("event_id_conflict");
  }
}

export interface TransportResult {
  http_status: number;
  receipts?: Receipt[];
}
export type Transport = (row: OutboxRow) => Promise<TransportResult>;

export class MemoryOutbox<S> {
  rows = new Map<string, OutboxRow>();
  audit: {
    at: number;
    event_id: string;
    from: OutboxState | null;
    to: OutboxState;
    detail: string;
  }[] = [];
  constructor(public state: S) {}

  /** Business mutation + outbox rows commit together or not at all. */
  async transaction(
    fn: (draft: S, enqueue: (e: EnvelopeV2, body: string) => Promise<void>) => Promise<void> | void,
    now = 0,
  ): Promise<void> {
    const draft = structuredClone(this.state);
    const staged = new Map(this.rows);
    const log: typeof this.audit = [];
    const enqueue = async (e: EnvelopeV2, body: string) => {
      const sha = await sha256Hex(body);
      const prior = staged.get(e.event_id);
      if (prior) {
        if (prior.body_sha256 === sha) return;
        throw new OutboxConflictError();
      }
      staged.set(e.event_id, {
        event_id: e.event_id,
        route: e.route,
        envelope: e,
        body,
        body_sha256: sha,
        state: "pending",
        attempts: 0,
        next_attempt_at: now,
        lease_owner: null,
        lease_until: 0,
        last_error: null,
        receipts: [],
      });
      log.push({ at: now, event_id: e.event_id, from: null, to: "pending", detail: "enqueued" });
    };
    await fn(draft, enqueue);
    this.state = draft;
    this.rows = staged;
    this.audit.push(...log);
  }

  private move(r: OutboxRow, to: OutboxState, now: number, detail: string) {
    this.audit.push({ at: now, event_id: r.event_id, from: r.state, to, detail });
    r.state = to;
  }

  /** Lease due rows to one worker. Mirrors SELECT ... FOR UPDATE SKIP LOCKED. */
  claim(worker: string, now: number, limit: number, leaseSec = 60): OutboxRow[] {
    const out: OutboxRow[] = [];
    for (const r of this.rows.values()) {
      if (out.length >= limit) break;
      const due = (r.state === "pending" || r.state === "retry_wait") && r.next_attempt_at <= now;
      const expired = r.state === "in_flight" && r.lease_until <= now;
      if (!due && !expired) continue;
      r.lease_owner = worker;
      r.lease_until = now + leaseSec;
      r.attempts += 1;
      this.move(r, "in_flight", now, `claimed_by:${worker}`);
      out.push(r);
    }
    return out;
  }

  /**
   * Process one leased row. The connection is re-authorized at send time (a revoked or
   * suspended connection fails closed), and the row only advances on receipts that verify
   * against the exact delivery: admission, then the target inbox, then a consumer commit
   * whose outcome states a committed effect consistent with the inbox outcome.
   */
  async deliver(
    r: OutboxRow,
    worker: string,
    transport: Transport,
    reg: Registry,
    now: number,
    rand?: () => number,
  ): Promise<OutboxState> {
    if (r.lease_owner !== worker || r.state !== "in_flight") return r.state;
    const az = authorize(r.envelope, reg);
    if ("reason" in az) return this.fail(r, `authorization:${az.reason}`, now, rand);
    const conn = az.connection.connection_id;
    let res: TransportResult;
    try {
      res = await transport(r);
    } catch (err) {
      return this.fail(r, `transport:${(err as Error).message}`, now, rand);
    }
    if (res.http_status < 200 || res.http_status >= 300)
      return this.fail(r, `http_${res.http_status}`, now, rand);
    const find = (k: ReceiptKind) => res.receipts?.find((x) => x.kind === k);
    const check = (k: ReceiptKind) =>
      verifyReceipt(find(k), expectReceipt(r.envelope, conn, k), reg, now);
    const adm = await check("gateway_admission");
    if ("reason" in adm) return this.fail(r, adm.reason, now, rand);
    r.receipts.push(find("gateway_admission")!);
    this.move(r, "gateway_admitted", now, "admission_verified");
    const inbox = find("target_inbox");
    const inboxOk = await check("target_inbox");
    if ("reason" in inboxOk) return this.fail(r, inboxOk.reason, now, rand);
    r.receipts.push(inbox!);
    const commit = find("consumer_commit");
    if (inbox!.outcome === "quarantined") {
      if (commit) return this.fail(r, "ack_commit_contradicts_inbox", now, rand);
      this.release(r);
      this.move(r, "target_quarantined", now, "target_quarantined");
      return r.state;
    }
    this.move(r, "target_persisted", now, `inbox:${inbox!.outcome}`);
    if (inbox!.outcome === "held") {
      // Held at target: no effect exists yet, so no commit may be accepted. Retry later.
      if (commit) return this.fail(r, "ack_commit_contradicts_inbox", now, rand);
      return this.fail(r, "target_held_awaiting_predecessor", now, rand);
    }
    const commitOk = await check("consumer_commit");
    if ("reason" in commitOk) return this.fail(r, commitOk.reason, now, rand);
    if (inbox!.outcome !== "duplicate" && commit!.outcome !== inbox!.outcome)
      return this.fail(r, "ack_commit_contradicts_inbox", now, rand);
    r.receipts.push(commit!);
    this.release(r);
    this.move(r, "consumer_committed", now, `commit:${commit!.outcome}`);
    return r.state;
  }

  private release(r: OutboxRow) {
    r.lease_owner = null;
    r.lease_until = 0;
  }

  private fail(r: OutboxRow, reason: string, now: number, rand?: () => number): OutboxState {
    r.last_error = reason;
    this.release(r);
    if (r.attempts >= RETRY.maxAttempts) {
      this.move(r, "dead_letter", now, reason);
      return r.state;
    }
    r.next_attempt_at = now + backoffSeconds(r.attempts, rand);
    this.move(r, "retry_wait", now, reason);
    return r.state;
  }

  /** Operator re-drive from dead letter. Never deletes; always audited. */
  redrive(eventId: string, actor: string, now: number): boolean {
    const r = this.rows.get(eventId);
    if (!r || r.state !== "dead_letter") return false;
    r.attempts = 0;
    r.next_attempt_at = now;
    this.move(r, "retry_wait", now, `redrive_by:${actor}`);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Target inbox with per-aggregate revision ordering, held queue and quarantine.
// ---------------------------------------------------------------------------

export interface InboxRow {
  key: string;
  event_id: string;
  origin_app: AppId;
  payload_sha256: string;
  outcome: InboxOutcome;
  reason: string | null;
  envelope: EnvelopeV2;
  received_at: number;
  committed_at: number | null;
}

export type ConsumerEffect<P> = (
  draft: P,
  e: EnvelopeV2,
) => { ok: true } | { ok: false; reason: string };

export const inboxKey = (e: EnvelopeV2) => `${e.tenant_id}|${e.origin.app}|${e.event_id}`;
export const watermarkKey = (e: EnvelopeV2) =>
  [
    e.tenant_id,
    e.rooftop_id,
    e.route,
    e.origin.app,
    e.aggregate.domain,
    e.aggregate.type,
    e.aggregate.id,
    e.vehicle.instance_id,
    // Instance-level identity spans episodes; every other chain is scoped to its episode so
    // a returning vehicle's new episode can never be suppressed by its prior episode.
    e.aggregate.type === "vehicle_instance" ? "*" : e.vehicle.episode_id,
  ].join("|");

export interface ReceiveResult {
  outcome: InboxOutcome;
  reason: string | null;
  committed: boolean;
  /** The committed outcome a consumer_commit receipt may state, or null when none may be sent. */
  committed_outcome: CommittedOutcome | null;
}

export class MemoryInbox<P> {
  rows = new Map<string, InboxRow>();
  watermarks = new Map<string, number>();
  effectsApplied = new Map<string, number>();
  constructor(
    public app: AppId,
    public projection: P,
    private effect: ConsumerEffect<P>,
  ) {}

  /**
   * Receive one verified delivery. Everything below happens in a single transaction:
   * inbox row, watermark, consumer effect, and draining of held successors. Any throw
   * leaves the inbox, watermark and projection exactly as they were.
   */
  receive(d: VerifiedDelivery, now: number, crashAfterEffect = false): ReceiveResult {
    const e = d.envelope;
    if (e.target_app !== this.app) throw new Error("wrong_destination");
    const key = inboxKey(e);
    const prior = this.rows.get(key);
    if (prior) {
      if (prior.payload_sha256 !== e.payload_sha256) {
        const qkey = `${key}|conflict|${e.payload_sha256}`;
        if (!this.rows.has(qkey))
          this.rows.set(qkey, this.row(qkey, e, "quarantined", "conflicting_duplicate", now));
        return {
          outcome: "quarantined",
          reason: "conflicting_duplicate",
          committed: false,
          committed_outcome: null,
        };
      }
      // A redelivery repeats the original decision. Only a committed original (applied or
      // stale_ignored) may be acknowledged as committed; a held or quarantined original
      // stays uncommitted however many times it is redelivered.
      if (prior.committed_at !== null && COMMITTED_OUTCOMES.has(prior.outcome))
        return {
          outcome: "duplicate",
          reason: `duplicate_of:${prior.outcome}`,
          committed: true,
          committed_outcome: prior.outcome as CommittedOutcome,
        };
      return {
        outcome: prior.outcome,
        reason: `duplicate_of:${prior.outcome}`,
        committed: false,
        committed_outcome: null,
      };
    }
    const draftRows = new Map(this.rows);
    const draftWm = new Map(this.watermarks);
    const draftProj = structuredClone(this.projection);
    const draftFx = new Map(this.effectsApplied);
    const result = this.applyInto(e, key, now, draftRows, draftWm, draftProj, draftFx);
    if (crashAfterEffect) throw new Error("simulated_crash_before_commit");
    this.rows = draftRows;
    this.watermarks = draftWm;
    this.projection = draftProj;
    this.effectsApplied = draftFx;
    return result;
  }

  private row(
    key: string,
    e: EnvelopeV2,
    outcome: InboxOutcome,
    reason: string | null,
    now: number,
  ): InboxRow {
    return {
      key,
      event_id: e.event_id,
      origin_app: e.origin.app,
      payload_sha256: e.payload_sha256,
      outcome,
      reason,
      envelope: e,
      received_at: now,
      committed_at: outcome === "applied" || outcome === "stale_ignored" ? now : null,
    };
  }

  private applyInto(
    e: EnvelopeV2,
    key: string,
    now: number,
    rows: Map<string, InboxRow>,
    wm: Map<string, number>,
    proj: P,
    fx: Map<string, number>,
  ): ReceiveResult {
    const wk = watermarkKey(e);
    const mark = wm.get(wk) ?? null;
    if (mark !== null && e.aggregate.revision <= mark) {
      rows.set(key, this.row(key, e, "stale_ignored", `watermark:${mark}`, now));
      return {
        outcome: "stale_ignored" as const,
        reason: `watermark:${mark}`,
        committed: true,
        committed_outcome: "stale_ignored" as const,
      };
    }
    if (e.aggregate.prev_revision !== mark) {
      rows.set(
        key,
        this.row(key, e, "held", `awaiting_revision:${e.aggregate.prev_revision}`, now),
      );
      return {
        outcome: "held" as const,
        reason: `awaiting_revision:${e.aggregate.prev_revision}`,
        committed: false,
        committed_outcome: null,
      };
    }
    const res = this.effect(proj, e);
    if ("reason" in res) {
      rows.set(key, this.row(key, e, "quarantined", res.reason, now));
      return {
        outcome: "quarantined" as const,
        reason: res.reason,
        committed: false,
        committed_outcome: null,
      };
    }
    rows.set(key, this.row(key, e, "applied", null, now));
    wm.set(wk, e.aggregate.revision);
    fx.set(e.event_id, (fx.get(e.event_id) ?? 0) + 1);
    // Drain any held successor that now lines up with the new watermark.
    for (const r of [...rows.values()]) {
      if (r.outcome !== "held" || watermarkKey(r.envelope) !== wk) continue;
      if (r.envelope.aggregate.prev_revision !== e.aggregate.revision) continue;
      rows.delete(r.key);
      this.applyInto(r.envelope, r.key, now, rows, wm, proj, fx);
      break;
    }
    return {
      outcome: "applied" as const,
      reason: null,
      committed: true,
      committed_outcome: "applied" as const,
    };
  }

  /** Release a quarantined row for re-application after an operator fix (audited by caller). */
  heldCount(): number {
    return [...this.rows.values()].filter((r) => r.outcome === "held").length;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation. Reports only; it never deletes, rewrites or discards evidence.
// ---------------------------------------------------------------------------

export interface ReconReport {
  checked: number;
  missing_at_target: string[];
  hash_mismatch: string[];
  duplicate_effects: string[];
  invalid_ack: string[];
  revision_gaps: string[];
  quarantined: string[];
  stale_ignored: string[];
  unacked_but_committed: string[];
}

export function reconcile(
  outbox: Iterable<OutboxRow>,
  inbox: MemoryInbox<unknown>,
  target: AppId,
): ReconReport {
  const rep: ReconReport = {
    checked: 0,
    missing_at_target: [],
    hash_mismatch: [],
    duplicate_effects: [],
    invalid_ack: [],
    revision_gaps: [],
    quarantined: [],
    stale_ignored: [],
    unacked_but_committed: [],
  };
  for (const r of outbox) {
    if (r.envelope.target_app !== target) continue;
    rep.checked += 1;
    const t = inbox.rows.get(inboxKey(r.envelope));
    const committedAtSource = r.state === "consumer_committed";
    if (!t) {
      if (r.state !== "pending") rep.missing_at_target.push(r.event_id);
      if (committedAtSource) rep.invalid_ack.push(r.event_id);
      continue;
    }
    if (t.payload_sha256 !== r.envelope.payload_sha256) rep.hash_mismatch.push(r.event_id);
    if ((inbox.effectsApplied.get(r.event_id) ?? 0) > 1) rep.duplicate_effects.push(r.event_id);
    if (t.outcome === "held") rep.revision_gaps.push(r.event_id);
    if (t.outcome === "quarantined") rep.quarantined.push(r.event_id);
    if (t.outcome === "stale_ignored") rep.stale_ignored.push(r.event_id);
    if (committedAtSource && t.outcome !== "applied" && t.outcome !== "stale_ignored")
      rep.invalid_ack.push(r.event_id);
    if (!committedAtSource && (t.outcome === "applied" || t.outcome === "stale_ignored"))
      rep.unacked_but_committed.push(r.event_id);
  }
  for (const t of inbox.rows.values()) {
    if (
      t.outcome === "quarantined" &&
      t.reason === "conflicting_duplicate" &&
      !rep.hash_mismatch.includes(t.event_id)
    )
      rep.hash_mismatch.push(t.event_id);
  }
  return rep;
}
