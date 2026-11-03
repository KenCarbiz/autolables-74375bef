// rtgip/2 durable delivery model: outbox, Gateway admission, target inbox, receipts v2,
// revision ordering, retry/dead-letter and reconciliation. Shared byte-for-byte across apps.
// The in-memory stores mirror the proposed SQL (rtgip_v2_delivery.proposed.sql); they are the
// executable specification, not a substitute for the database transaction.
// Receipts are rtgip/2-receipt/2 (receipt-v2.ts). The Gateway admits synchronously and
// forwards asynchronously, so the source advances in two steps: a verified admission receipt
// (gateway_admitted), then a verified three-receipt chain fetched by receipt query.

import {
  authorize,
  canonicalize,
  sha256Hex,
  type AppId,
  type EnvelopeV2,
  type EventType,
  type Purpose,
  type Registry,
  type ServiceConnection,
  type ServiceKey,
  type VerifiedDelivery,
} from "./protocol.ts";
import {
  deliveryIdentity,
  receiptDigest,
  receiptDraft,
  signReceiptV2,
  verifyReceiptV2,
  type ReceiptV2,
} from "./receipt-v2.ts";

export type InboxOutcome = "applied" | "duplicate" | "stale_ignored" | "held" | "quarantined";
/** Outcomes that mean the consumer effect (or its deliberate no-op) is durably committed. */
export type CommittedOutcome = "applied" | "stale_ignored";
export const COMMITTED_OUTCOMES: ReadonlySet<string> = new Set(["applied", "stale_ignored"]);

/**
 * Receipt and dispatch policy (identical in rtgip_v2_delivery.proposed.sql). A connection is
 * deliverable only while it is active, both sides are enabled and it still grants the
 * rooftop, event type and purpose. Losing any of these after admission and before the
 * acknowledgment pauses the row: receipts for it are refused, it is not re-leased and its
 * attempt is not counted, so it cannot dead-letter while paused. When the grant returns, the
 * redelivery reaches the target inbox as a duplicate and the original committed outcome
 * completes it, so the consumer effect still happens exactly once.
 */
export function deliverableReason(
  conn: ServiceConnection | undefined,
  f: {
    source_app: string;
    target_app: string;
    tenant_id: string;
    rooftop_id: string;
    event_type: string;
    purpose: string;
  },
): string | null {
  if (
    !conn ||
    conn.source_app !== f.source_app ||
    conn.target_app !== f.target_app ||
    conn.tenant_id !== f.tenant_id ||
    !conn.rooftop_ids.includes(f.rooftop_id)
  )
    return "connection_mismatch";
  if (conn.status !== "active") return "connection_inactive";
  if (!conn.producer_enabled) return "producer_disabled";
  if (!conn.reader_enabled) return "reader_disabled";
  if (!(conn.event_types as readonly string[]).includes(f.event_type)) return "event_not_granted";
  if (!(conn.purposes as readonly string[]).includes(f.purpose)) return "purpose_not_granted";
  return null;
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
// (see transaction()). State only advances on verified receipts of the next level, and only
// for the worker that holds the current lease generation.
// ---------------------------------------------------------------------------

export type OutboxState =
  | "pending"
  | "in_flight"
  | "retry_wait"
  | "gateway_admitted"
  | "consumer_committed"
  | "target_quarantined"
  | "dead_letter";
export type OutboxAction = "deliver" | "confirm";

export interface OutboxRow {
  event_id: string;
  route: string;
  envelope: EnvelopeV2;
  body: string;
  body_sha256: string;
  connection_id: string;
  delivery_id: string;
  state: OutboxState;
  attempts: number;
  next_attempt_at: number;
  lease_owner: string | null;
  lease_until: number;
  /** Fencing token: incremented by every claim. A write carrying an older one is refused. */
  lease_generation: number;
  /** Which step the current lease is for; null when no lease is held. */
  lease_action: OutboxAction | null;
  attempt_started_at: number;
  last_error: string | null;
  receipts: ReceiptV2[];
}

export class OutboxConflictError extends Error {
  constructor() {
    super("event_id_conflict");
  }
}

export interface TransportResult {
  http_status: number;
  /** The Gateway's signed admission receipt (rtgip/2-receipt/2, kind gateway_admission). */
  admission?: ReceiptV2;
  reason?: string;
}
export type Transport = (row: OutboxRow) => Promise<TransportResult>;
/** rtgip/2-receipt-query/1: the stored chain for one delivery, in chain order. */
export type ReceiptQueryPort = (delivery_id: string, event_id: string) => Promise<ReceiptV2[]>;
export type StepResult = OutboxState | "lost_lease";

/** The one connection that may carry this event at the source, as outbox_enqueue resolves it. */
export function resolveConnection(e: EnvelopeV2, reg: Registry): string {
  const hits = reg.connections.filter(
    (c) =>
      c.source_app === e.source_app &&
      c.target_app === e.target_app &&
      c.tenant_id === e.tenant_id &&
      c.rooftop_ids.includes(e.rooftop_id) &&
      c.event_types.includes(e.event_type) &&
      c.producer_enabled &&
      c.status !== "revoked",
  );
  if (hits.length === 0) throw new Error("no_connection_for_event");
  if (hits.length > 1) throw new Error("ambiguous_connection");
  return hits[0]!.connection_id;
}

export class MemoryOutbox<S> {
  rows = new Map<string, OutboxRow>();
  audit: {
    at: number;
    event_id: string;
    from: OutboxState | null;
    to: OutboxState;
    detail: string;
  }[] = [];
  constructor(
    public state: S,
    private reg: Registry,
  ) {}

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
      const connection_id = resolveConnection(e, this.reg);
      staged.set(e.event_id, {
        event_id: e.event_id,
        route: e.route,
        envelope: e,
        body,
        body_sha256: sha,
        connection_id,
        delivery_id: await deliveryIdentity(e, connection_id),
        state: "pending",
        attempts: 0,
        next_attempt_at: now,
        lease_owner: null,
        lease_until: 0,
        lease_generation: 0,
        lease_action: null,
        attempt_started_at: 0,
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

  /**
   * Lease due rows to one worker. Mirrors SELECT ... FOR UPDATE SKIP LOCKED. A pending or
   * retry_wait row is leased for delivery; a due gateway_admitted row is leased for
   * confirmation (r.lease_action says which). Every claim increments the lease generation.
   * With a registry, rows whose connection is not deliverable stay paused and are not leased.
   */
  claim(worker: string, now: number, limit: number, leaseSec = 60, reg?: Registry): OutboxRow[] {
    const out: OutboxRow[] = [];
    for (const r of this.rows.values()) {
      if (out.length >= limit) break;
      const deliverDue =
        (r.state === "pending" || r.state === "retry_wait") && r.next_attempt_at <= now;
      const deliverExpired = r.state === "in_flight" && r.lease_until <= now;
      const confirmDue =
        r.state === "gateway_admitted" &&
        r.next_attempt_at <= now &&
        (r.lease_owner === null || r.lease_until <= now);
      if (!deliverDue && !deliverExpired && !confirmDue) continue;
      if (reg && !authorize(r.envelope, reg).ok) continue;
      r.lease_owner = worker;
      r.lease_until = now + leaseSec;
      r.lease_generation += 1;
      r.attempt_started_at = now;
      r.attempts += 1;
      if (confirmDue) {
        r.lease_action = "confirm";
        this.audit.push({
          at: now,
          event_id: r.event_id,
          from: r.state,
          to: r.state,
          detail: `claimed_by:${worker}:confirm:g${r.lease_generation}`,
        });
      } else {
        r.lease_action = "deliver";
        this.move(r, "in_flight", now, `claimed_by:${worker}:g${r.lease_generation}`);
      }
      out.push(r);
    }
    return out;
  }

  private holds(
    r: OutboxRow,
    worker: string,
    generation: number,
    action: OutboxAction,
    now: number,
  ) {
    const ok =
      r.lease_owner === worker &&
      r.lease_generation === generation &&
      r.lease_action === action &&
      r.state === (action === "deliver" ? "in_flight" : "gateway_admitted");
    if (!ok)
      this.audit.push({
        at: now,
        event_id: r.event_id,
        from: r.state,
        to: r.state,
        detail: `lost_lease:${worker}:g${generation}`,
      });
    return ok;
  }

  /**
   * Step one: POST to the Gateway. The row only advances to gateway_admitted on a
   * gateway_admission receipt that verifies against the exact delivery. The connection is
   * re-authorized at send time and must still be the row's pinned connection.
   */
  async deliver(
    r: OutboxRow,
    worker: string,
    generation: number,
    transport: Transport,
    reg: Registry,
    now: number,
    rand?: () => number,
  ): Promise<StepResult> {
    if (!this.holds(r, worker, generation, "deliver", now)) return "lost_lease";
    const az = authorize(r.envelope, reg);
    if ("reason" in az) return this.pause(r, `authorization:${az.reason}`, now);
    if (az.connection.connection_id !== r.connection_id)
      return this.pause(r, "authorization:connection_changed", now);
    let res: TransportResult;
    try {
      res = await transport(r);
    } catch (err) {
      return this.settle(r, reg, `transport:${(err as Error).message}`, now, rand);
    }
    if (res.http_status < 200 || res.http_status >= 300)
      return this.settle(r, reg, `http_${res.http_status}`, now, rand);
    if (!res.admission) return this.settle(r, reg, "ack_missing", now, rand);
    try {
      await verifyReceiptV2(res.admission, this.expectation(r, "gateway_admission"), reg, now, []);
    } catch (err) {
      return this.settle(r, reg, (err as Error).message, now, rand);
    }
    const stored = r.receipts[0];
    if (stored && canonicalize(stored) !== canonicalize(res.admission))
      return this.settle(r, reg, "ack_admission_mismatch", now, rand);
    if (!stored) r.receipts = [res.admission];
    this.release(r);
    r.last_error = null;
    r.next_attempt_at = now + RETRY.baseSec;
    this.move(r, "gateway_admitted", now, "admission_verified");
    return r.state;
  }

  /**
   * Step two: fetch the stored chain by receipt query and verify all of it. Only a complete,
   * verified [admission, inbox, commit] chain commits the row; [admission, inbox quarantined]
   * quarantines it; anything incomplete waits with backoff, bounded by the attempt limit.
   */
  async confirm(
    r: OutboxRow,
    worker: string,
    generation: number,
    query: ReceiptQueryPort,
    reg: Registry,
    now: number,
    rand?: () => number,
  ): Promise<StepResult> {
    if (!this.holds(r, worker, generation, "confirm", now)) return "lost_lease";
    const az = authorize(r.envelope, reg);
    if ("reason" in az) return this.pause(r, `authorization:${az.reason}`, now);
    if (az.connection.connection_id !== r.connection_id)
      return this.pause(r, "authorization:connection_changed", now);
    let chain: ReceiptV2[];
    try {
      chain = await query(r.delivery_id, r.event_id);
    } catch (err) {
      return this.settle(r, reg, `query:${(err as Error).message}`, now, rand);
    }
    if (!Array.isArray(chain) || chain.length === 0)
      return this.settle(r, reg, "ack_missing", now, rand);
    if (chain.length > 3) return this.settle(r, reg, "ack_chain_too_long", now, rand);
    const stored = r.receipts[0];
    if (!stored || canonicalize(stored) !== canonicalize(chain[0]))
      return this.settle(r, reg, "ack_admission_mismatch", now, rand);
    try {
      const kinds = ["gateway_admission", "target_inbox", "consumer_commit"] as const;
      for (let i = 0; i < chain.length; i++)
        await verifyReceiptV2(
          chain[i],
          this.expectation(r, kinds[i]!),
          reg,
          now,
          chain.slice(0, i),
        );
    } catch (err) {
      return this.settle(r, reg, (err as Error).message, now, rand);
    }
    const inbox = chain[1];
    if (!inbox) return this.wait(r, "target_inbox_pending", now, rand);
    if (inbox.outcome === "quarantined") {
      r.receipts = chain;
      this.release(r);
      r.last_error = null;
      this.move(r, "target_quarantined", now, "target_quarantined");
      return r.state;
    }
    if (inbox.outcome === "held")
      return this.wait(r, "target_held_awaiting_predecessor", now, rand);
    if (chain.length < 3) return this.wait(r, "consumer_commit_pending", now, rand);
    r.receipts = chain;
    this.release(r);
    r.last_error = null;
    this.move(r, "consumer_committed", now, `commit:${chain[2]!.outcome}`);
    return r.state;
  }

  /** Record a failed attempt, fenced by the lease generation. */
  fail(
    r: OutboxRow,
    worker: string,
    generation: number,
    reason: string,
    now: number,
    rand?: () => number,
  ): StepResult {
    if (r.lease_action === null || !this.holds(r, worker, generation, r.lease_action, now))
      return "lost_lease";
    return this.failNow(r, reason, now, rand);
  }

  private expectation(r: OutboxRow, kind: ReceiptV2["kind"]) {
    return {
      envelope: r.envelope,
      connection_id: r.connection_id,
      delivery_id: r.delivery_id,
      kind,
    };
  }

  private release(r: OutboxRow) {
    r.lease_owner = null;
    r.lease_until = 0;
    r.lease_action = null;
  }

  /** A failure while the connection is not deliverable is a pause, as in SQL outbox_fail. */
  private settle(
    r: OutboxRow,
    reg: Registry,
    reason: string,
    now: number,
    rand?: () => number,
  ): OutboxState {
    return !authorize(r.envelope, reg).ok
      ? this.pause(r, reason, now)
      : this.failNow(r, reason, now, rand);
  }

  /** Permission lost: wait without spending the attempt (SQL: claim skips the row). */
  private pause(r: OutboxRow, reason: string, now: number): OutboxState {
    r.last_error = reason;
    r.attempts = Math.max(0, r.attempts - 1);
    const admitted = r.state === "gateway_admitted";
    this.release(r);
    r.next_attempt_at = now + RETRY.baseSec;
    this.move(r, admitted ? "gateway_admitted" : "retry_wait", now, `paused:${reason}`);
    return r.state;
  }

  private failNow(r: OutboxRow, reason: string, now: number, rand?: () => number): OutboxState {
    r.last_error = reason;
    const admitted = r.state === "gateway_admitted";
    this.release(r);
    if (r.attempts >= RETRY.maxAttempts) {
      this.move(r, "dead_letter", now, reason);
      return r.state;
    }
    r.next_attempt_at = now + backoffSeconds(r.attempts, rand);
    this.move(r, admitted ? "gateway_admitted" : "retry_wait", now, reason);
    return r.state;
  }

  /** The chain is not complete yet: keep the admitted row, back off, dead-letter only on attempts. */
  private wait(r: OutboxRow, reason: string, now: number, rand?: () => number): OutboxState {
    return this.failNow(r, reason, now, rand);
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
  delivery_id: string;
  admission_digest: string;
  issued_at: number;
}

/** Per delivery_id: the stored decision and, once signed, the exact receipts returned for it. */
export interface DeliveryRecord {
  delivery_id: string;
  admission_digest: string;
  issued_at: number;
  outcome: InboxOutcome;
  reason: string | null;
  commit_outcome: CommittedOutcome | null;
  receipts: ReceiptV2[] | null;
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

export interface Decision {
  outcome: InboxOutcome;
  reason: string | null;
  committed: boolean;
  /** The committed outcome a consumer_commit receipt may state, or null when none may be sent. */
  committed_outcome: CommittedOutcome | null;
}
export interface ReceiveResult extends Decision {
  /** [target_inbox] or [target_inbox, consumer_commit], signed by the target. */
  receipts: ReceiptV2[];
}

export interface InboxSigner {
  registry: Registry;
  key: ServiceKey;
}

export class MemoryInbox<P> {
  rows = new Map<string, InboxRow>();
  watermarks = new Map<string, number>();
  effectsApplied = new Map<string, number>();
  deliveries = new Map<string, DeliveryRecord>();
  constructor(
    public app: AppId,
    public projection: P,
    private effect: ConsumerEffect<P>,
    private signer: InboxSigner,
  ) {}

  /**
   * Receive one verified delivery together with the Gateway's admission receipt. The
   * admission is verified against the exact delivery first. Everything that decides the
   * outcome happens in a single transaction: inbox row, watermark, consumer effect, delivery
   * record and draining of held successors; any throw leaves all of it as it was. The
   * receipts are signed afterwards, from the stored issued_at, so a retry that finds the
   * decision but no stored receipts re-signs byte-identical receipts.
   */
  async receive(
    d: VerifiedDelivery,
    admission: ReceiptV2,
    now: number,
    opts: { crashAfterEffect?: boolean; crashBeforeReceipts?: boolean } = {},
  ): Promise<ReceiveResult> {
    const e = d.envelope;
    if (e.target_app !== this.app) throw new Error("wrong_destination");
    const delivery_id = await deliveryIdentity(e, d.connection_id);
    await verifyReceiptV2(
      admission,
      { envelope: e, connection_id: d.connection_id, delivery_id, kind: "gateway_admission" },
      this.signer.registry,
      now,
      [],
    );
    const admission_digest = await receiptDigest(admission);
    const prior = this.deliveries.get(delivery_id);
    if (prior && prior.admission_digest !== admission_digest)
      throw new Error("admission_digest_mismatch");
    if (prior?.receipts) return this.stored(prior);
    let rec = prior;
    if (!rec || rec.outcome === "held") {
      const issued_at = rec?.issued_at ?? now;
      const dec = this.decide(
        d,
        delivery_id,
        admission_digest,
        issued_at,
        now,
        opts.crashAfterEffect === true,
      );
      rec = {
        delivery_id,
        admission_digest,
        issued_at,
        outcome: dec.outcome,
        reason: dec.reason,
        commit_outcome: dec.committed_outcome,
        receipts: null,
      };
      this.deliveries.set(delivery_id, rec);
    }
    if (opts.crashBeforeReceipts) throw new Error("simulated_crash_before_receipts");
    const exp = (kind: "target_inbox" | "consumer_commit") => ({
      envelope: e,
      connection_id: d.connection_id,
      delivery_id,
      kind,
    });
    const inbox = await signReceiptV2(
      await receiptDraft(exp("target_inbox"), rec.outcome, rec.issued_at, admission),
      this.signer.key,
    );
    const receipts = [inbox];
    if (rec.commit_outcome)
      receipts.push(
        await signReceiptV2(
          await receiptDraft(exp("consumer_commit"), rec.commit_outcome, rec.issued_at, inbox),
          this.signer.key,
        ),
      );
    if (rec.outcome !== "held") rec.receipts = receipts;
    return this.result(rec, receipts);
  }

  private stored(rec: DeliveryRecord): ReceiveResult {
    return this.result(rec, rec.receipts!);
  }

  private result(rec: DeliveryRecord, receipts: ReceiptV2[]): ReceiveResult {
    return {
      outcome: rec.outcome,
      reason: rec.reason,
      committed: rec.commit_outcome !== null,
      committed_outcome: rec.commit_outcome,
      receipts,
    };
  }

  private decide(
    d: VerifiedDelivery,
    delivery_id: string,
    admission_digest: string,
    issued_at: number,
    now: number,
    crashAfterEffect: boolean,
  ): Decision {
    const e = d.envelope;
    const key = inboxKey(e);
    const meta = { delivery_id, admission_digest, issued_at };
    const prior = this.rows.get(key);
    if (prior) {
      // The whole envelope is immutable under its event id, not just the payload: changed
      // routing, scope, revision or correlation metadata is a conflict, never a duplicate.
      if (
        prior.payload_sha256 !== e.payload_sha256 ||
        canonicalize(prior.envelope) !== canonicalize(e)
      ) {
        const qkey = `${key}|conflict|${e.payload_sha256}`;
        if (!this.rows.has(qkey))
          this.rows.set(qkey, this.row(qkey, e, "quarantined", "conflicting_duplicate", now, meta));
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
    const result = this.applyInto(e, key, now, draftRows, draftWm, draftProj, draftFx, meta);
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
    meta: { delivery_id: string; admission_digest: string; issued_at: number },
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
      ...meta,
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
    meta: { delivery_id: string; admission_digest: string; issued_at: number },
  ): Decision {
    const wk = watermarkKey(e);
    const mark = wm.get(wk) ?? null;
    if (mark !== null && e.aggregate.revision <= mark) {
      rows.set(key, this.row(key, e, "stale_ignored", `watermark:${mark}`, now, meta));
      return {
        outcome: "stale_ignored",
        reason: `watermark:${mark}`,
        committed: true,
        committed_outcome: "stale_ignored",
      };
    }
    if (e.aggregate.prev_revision !== mark) {
      rows.set(
        key,
        this.row(key, e, "held", `awaiting_revision:${e.aggregate.prev_revision}`, now, meta),
      );
      return {
        outcome: "held",
        reason: `awaiting_revision:${e.aggregate.prev_revision}`,
        committed: false,
        committed_outcome: null,
      };
    }
    const res = this.effect(proj, e);
    if ("reason" in res) {
      rows.set(key, this.row(key, e, "quarantined", res.reason, now, meta));
      return {
        outcome: "quarantined",
        reason: res.reason,
        committed: false,
        committed_outcome: null,
      };
    }
    rows.set(key, this.row(key, e, "applied", null, now, meta));
    wm.set(wk, e.aggregate.revision);
    fx.set(e.event_id, (fx.get(e.event_id) ?? 0) + 1);
    // Drain any held successor that now lines up with the new watermark.
    for (const r of [...rows.values()]) {
      if (r.outcome !== "held" || watermarkKey(r.envelope) !== wk) continue;
      if (r.envelope.aggregate.prev_revision !== e.aggregate.revision) continue;
      rows.delete(r.key);
      this.applyInto(r.envelope, r.key, now, rows, wm, proj, fx, {
        delivery_id: r.delivery_id,
        admission_digest: r.admission_digest,
        issued_at: r.issued_at,
      });
      break;
    }
    return { outcome: "applied", reason: null, committed: true, committed_outcome: "applied" };
  }

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
