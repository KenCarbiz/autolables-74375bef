import { json, preflight } from "../../http.ts";
import { decideAutofilmIngest, isAutofilmRequest, type AfIngestDecision, type AfSecret } from "../adapters/autofilmV1.ts";
import { inboundDirection, type Direction } from "../envelope.ts";
import {
  decideIngest, type ConnectionRecord, type ExistingReceipt, type InboxInsert, type IngestDecision, type KeyRecord,
} from "../ingestDecision.ts";

export interface ExistingLookup {
  existingByEventId: ExistingReceipt | null;
  existingByIdempotencyKey: ExistingReceipt | null;
}

export interface IngestStore {
  loadKey(keyId: string): Promise<KeyRecord | null>;
  keySecret(keyId: string): Promise<string | null>;
  loadConnection(connectionId: string): Promise<ConnectionRecord | null>;
  connectionSecrets(connectionId: string): Promise<AfSecret[]>;
  directionEnabled(tenantId: string, direction: Direction): Promise<boolean>;
  lookupExisting(connectionId: string, eventId: string, idempotencyKey: string): Promise<ExistingLookup>;
  resolveVinForRo(connectionId: string, roKey: string): Promise<string | null>;
  insertInbox(rows: InboxInsert[]): Promise<{ ids: string[] } | "conflict">;
  touchConnection(connectionId: string, outcome: { ok: true } | { ok: false; code: string }): Promise<void>;
}

export interface IngestDeps {
  enabled(): boolean;
  store(): IngestStore | null;
  now?(): number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(decision: IngestDecision, receiptIds: string[]): Response {
  const { httpStatus, code } = decision;
  if (httpStatus === 202) {
    return json(202, { ok: true, status: code, receipt_id: receiptIds[0] ?? null, receipt_ids: receiptIds });
  }
  if (httpStatus === 200 && decision.duplicateOf) {
    return json(200, {
      ok: true,
      status: "duplicate",
      receipt_id: decision.duplicateOf.id,
      original_status: decision.duplicateOf.status,
      received_at: decision.duplicateOf.received_at,
    });
  }
  return json(httpStatus, {
    ok: false,
    error: code,
    ...(httpStatus === 401 ? {} : { detail: decision.detail }),
  });
}

const insertsOf = (d: IngestDecision | AfIngestDecision): InboxInsert[] =>
  "inserts" in d ? d.inserts : d.insert ? [d.insert] : [];

async function persist(
  store: IngestStore,
  decide: (existing: ExistingLookup) => Promise<IngestDecision | AfIngestDecision>,
): Promise<{ decision: IngestDecision; receiptIds: string[] }> {
  const none: ExistingLookup = { existingByEventId: null, existingByIdempotencyKey: null };
  let decision = await decide(none);
  const inserts = insertsOf(decision);
  if (inserts.length === 0) return { decision, receiptIds: [] };

  const first = inserts[0];
  const existing = await store.lookupExisting(first.connection_id, first.event_id, first.idempotency_key);
  if (existing.existingByEventId || existing.existingByIdempotencyKey) {
    return { decision: await decide(existing), receiptIds: [] };
  }
  const written = await store.insertInbox(inserts);
  if (written === "conflict") {
    const raced = await store.lookupExisting(first.connection_id, first.event_id, first.idempotency_key);
    decision = await decide(raced);
    if (insertsOf(decision).length > 0) throw new Error("inbox_race_unresolved");
    return { decision, receiptIds: [] };
  }
  return { decision, receiptIds: written.ids };
}

export async function handleIngest(req: Request, deps: IngestDeps): Promise<Response> {
  const pf = preflight(req);
  if (pf) return pf;
  if (!deps.enabled()) return json(503, { ok: false, error: "integrations_disabled" });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const store = deps.store();
  if (!store) return json(503, { ok: false, error: "unavailable" });
  const now = deps.now ?? Date.now;

  try {
    const rawBody = await req.text();
    let connectionId: string | null = null;
    let result: { decision: IngestDecision; receiptIds: string[] };

    if (isAutofilmRequest(req.headers)) {
      const asked = new URL(req.url).searchParams.get("connection") ?? "";
      const connection = UUID.test(asked) ? await store.loadConnection(asked) : null;
      const secrets = connection && connection.status === "active" ? await store.connectionSecrets(connection.id) : [];
      const directionEnabled = connection
        ? await store.directionEnabled(connection.tenant_id, inboundDirection(connection.app) as Direction)
        : false;
      connectionId = connection?.id ?? null;
      result = await persist(store, (existing) => decideAutofilmIngest({
        headers: req.headers,
        rawBody,
        nowMs: now(),
        connection,
        secrets,
        directionEnabled,
        resolveVin: (id, ro) => store.resolveVinForRo(id, ro),
        ...existing,
      }));
    } else {
      const keyId = req.headers.get("x-rooftop-key-id") || "";
      const keyRecord = keyId ? await store.loadKey(keyId) : null;
      let secret: string | null = null;
      let directionEnabled = false;
      if (keyRecord && keyRecord.status !== "revoked") {
        secret = await store.keySecret(keyId);
        const direction = inboundDirection(keyRecord.connection.app);
        if (direction) directionEnabled = await store.directionEnabled(keyRecord.connection.tenant_id, direction);
      }
      connectionId = keyRecord?.connection.id ?? null;
      result = await persist(store, (existing) => decideIngest({
        headers: req.headers,
        rawBody,
        nowMs: now(),
        keyRecord,
        secret,
        directionEnabled,
        ...existing,
      }));
    }

    const { decision, receiptIds } = result;
    if (connectionId && decision.httpStatus !== 401) {
      const ok = decision.httpStatus === 200 || decision.httpStatus === 202;
      await store.touchConnection(connectionId, ok ? { ok: true } : { ok: false, code: decision.code }).catch(() => {});
    }
    return respond(decision, receiptIds);
  } catch (_err) {
    return json(503, { ok: false, error: "unavailable" });
  }
}
