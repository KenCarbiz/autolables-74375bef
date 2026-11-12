// AutoLabels rtgip-publish authorization. The caller names a fact (kind, tenant, rooftop, record
// id); everything that grants permission is re-derived here from rows: the signed-in user's
// accepted tenant_members row for that tenant, and the active rtgip_src.rooftop_stores mapping of
// that rooftop to one of that tenant's stores. Nothing the caller sends confers either.
import type { PublishAuthorizer } from "../rtgip2-runtime/runtime.ts";
import { PRODUCE_KINDS } from "./staging-adapter.ts";

export const PUBLISH_KINDS: readonly string[] = PRODUCE_KINDS;
export const PUBLISH_REF_KEYS: readonly string[] = ["episode_id", "milestone_id"];
export const PUBLISH_ROLES: readonly string[] = ["owner", "admin", "manager"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const labelsPublishAuthorizer: PublishAuthorizer = async (db, userId, req) => {
  if (!UUID.test(userId) || !UUID.test(req.tenant_id)) return { ok: false, reason: "not_a_member" };
  const member = await db.query(
    "SELECT role FROM public.tenant_members WHERE user_id = $1::uuid AND tenant_id = $2::uuid AND accepted_at IS NOT NULL",
    [userId, req.tenant_id],
  );
  if (!member.length) return { ok: false, reason: "not_a_member" };
  if (!member.some((m) => PUBLISH_ROLES.includes(String(m.role)))) return { ok: false, reason: "role_not_permitted" };
  const mapped = await db.query(
    `SELECT r.store_id FROM rtgip_src.rooftop_stores r
       JOIN public.dealer_stores d ON d.id = r.store_id AND d.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1::uuid AND r.rooftop_id = $2 AND r.status = 'active'`,
    [req.tenant_id, req.rooftop_id],
  );
  return mapped.length === 1 ? { ok: true } : { ok: false, reason: "rooftop_unmapped" };
};
