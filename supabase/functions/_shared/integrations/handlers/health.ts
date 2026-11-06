import { json, preflight } from "../../http.ts";

export interface HealthStore {
  authenticate(jwt: string): Promise<{ userId: string } | null>;
  isPlatformAdmin(userId: string): Promise<boolean>;
  snapshot(nowMs: number): Promise<Record<string, unknown>>;
}

export interface HealthDeps {
  enabled(): boolean;
  store(): HealthStore | null;
  now?(): number;
}

export async function handleHealth(req: Request, deps: HealthDeps): Promise<Response> {
  const pf = preflight(req);
  if (pf) return pf;
  if (!deps.enabled()) return json(503, { ok: false, error: "integrations_disabled" });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const store = deps.store();
  if (!store) return json(503, { ok: false, error: "unavailable" });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { ok: false, error: "missing_token" });
  const user = await store.authenticate(jwt).catch(() => null);
  if (!user) return json(401, { ok: false, error: "invalid_token" });
  if (!(await store.isPlatformAdmin(user.userId).catch(() => false))) return json(403, { ok: false, error: "forbidden" });

  try {
    return json(200, { ok: true, ...(await store.snapshot((deps.now ?? Date.now)())) });
  } catch (_err) {
    return json(503, { ok: false, error: "unavailable" });
  }
}
