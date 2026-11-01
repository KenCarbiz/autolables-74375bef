import { json, preflight } from "../../http.ts";
import { afSignedHeaders, toAfOutbound } from "../adapters/autofilmV1.ts";
import { nextRetry } from "../backoff.ts";
import { downgradeToV10, outboundDirection, type Direction, type EnvelopeV1 } from "../envelope.ts";
import { sign } from "../signing.ts";

export interface OutboxRow {
  id: string;
  tenant_id: string;
  connection_id: string;
  event_id: string;
  attempts: number;
  envelope: EnvelopeV1;
}

export interface DispatchConnection {
  id: string;
  app: "autofilm" | "autocurb";
  status: string;
  endpoint_url: string | null;
  adapter: "rooftop.v1" | "autofilm.v1";
  external_rooftop_ref: string | null;
}

export interface DispatchStore {
  listDue(limit: number, nowIso: string): Promise<OutboxRow[]>;
  loadConnection(connectionId: string): Promise<DispatchConnection | null>;
  directionEnabled(tenantId: string, direction: Direction): Promise<boolean>;
  // integration.delivery_paused: pausing delivery keeps outbox rows; it never stops capture.
  deliveryAllowed?(tenantId: string): Promise<boolean>;
  lease(rowId: string, nowIso: string, leaseUntilIso: string): Promise<boolean>;
  activeKey(connectionId: string): Promise<{ key_id: string; secret: string } | null>;
  markDelivered(rowId: string, attempts: number, atIso: string, connectionId: string): Promise<void>;
  markFailure(
    rowId: string,
    update: { dead: boolean; attempts: number; errorCode: string; nextAttemptIso: string },
    connectionId: string,
  ): Promise<void>;
}

export interface DispatchDeps {
  enabled(): boolean;
  authorize(req: Request): boolean;
  store(): DispatchStore | null;
  fetcher?: typeof fetch;
  now?(): number;
  random?(): number;
}

const LEASE_MS = 10 * 60 * 1000;

export async function handleDispatch(req: Request, deps: DispatchDeps): Promise<Response> {
  const pf = preflight(req);
  if (pf) return pf;
  if (!deps.enabled()) return json(503, { ok: false, error: "integrations_disabled" });
  if (!deps.authorize(req)) return json(401, { ok: false, error: "not authorized" });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const store = deps.store();
  if (!store) return json(503, { ok: false, error: "unavailable" });
  const now = deps.now ?? Date.now;
  const send = deps.fetcher ?? fetch;

  const body = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
  const nowIso = new Date(now()).toISOString();

  let rows: OutboxRow[];
  try {
    rows = await store.listDue(limit, nowIso);
  } catch (_err) {
    return json(503, { ok: false, error: "unavailable" });
  }
  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

  for (const row of rows) {
    try {
      const connection = await store.loadConnection(row.connection_id);
      if (!connection || connection.status !== "active" || !connection.endpoint_url?.startsWith("https://")) {
        bump("skipped_connection");
        continue;
      }
      if (!(await store.directionEnabled(row.tenant_id, outboundDirection(connection.app)))) {
        bump("skipped_flag_off");
        continue;
      }
      if (store.deliveryAllowed && !(await store.deliveryAllowed(row.tenant_id))) {
        bump("skipped_paused");
        continue;
      }
      if (!(await store.lease(row.id, nowIso, new Date(now() + LEASE_MS).toISOString()))) continue;

      const attempts = row.attempts + 1;
      let httpStatus: number | null = null;
      let errorCode = "delivery_failed";

      const key = await store.activeKey(row.connection_id);
      if (!key) {
        errorCode = "no_active_key";
      } else {
        const isAf = connection.adapter === "autofilm.v1";
        const payload = isAf
          ? toAfOutbound(row.envelope, connection.external_rooftop_ref ?? "")
          : downgradeToV10(row.envelope);
        const rawBody = JSON.stringify(payload);
        const headers = isAf
          ? await afSignedHeaders(key.secret, rawBody, now())
          : await (async () => {
            const ts = String(Math.floor(now() / 1000));
            return {
              "Content-Type": "application/json",
              "X-Rooftop-Key-Id": key.key_id,
              "X-Rooftop-Timestamp": ts,
              "X-Rooftop-Signature": await sign(key.secret, ts, key.key_id, rawBody),
            };
          })();
        try {
          const res = await send(connection.endpoint_url, {
            method: "POST",
            redirect: "manual",
            headers,
            body: rawBody,
            signal: AbortSignal.timeout(10_000),
          });
          httpStatus = res.status;
          errorCode = `http_${res.status}`;
          await res.body?.cancel();
        } catch (_e) {
          errorCode = "network_error";
        }
      }

      if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) {
        await store.markDelivered(row.id, attempts, new Date(now()).toISOString(), connection.id);
        bump("delivered");
        continue;
      }
      const retry = nextRetry(attempts, httpStatus, deps.random);
      await store.markFailure(row.id, {
        dead: retry.dead,
        attempts,
        errorCode,
        nextAttemptIso: new Date(now() + (retry.delaySeconds ?? 0) * 1000).toISOString(),
      }, connection.id);
      bump(retry.dead ? "dead" : "retry");
    } catch (_err) {
      bump("error");
    }
  }

  return json(200, { ok: true, claimed: rows.length, outcomes: counts });
}
