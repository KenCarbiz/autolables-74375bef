// ── marketpass-assessment request decision, without Deno ───────────────────
//
// The edge function fetches the row, the dealer settings and the caller's
// tenant memberships; everything after that is this pure function, so the
// authorization rules are tested in vitest rather than trusted to a deploy.
//
//   anonymous, published listing, flag on        -> public contract
//   member of the listing's tenant, ?audience=dealer -> dealer contract
//   any other caller asking for the dealer view  -> 401 / 403, nothing private
//   flag off for the listing's tenant            -> 404 marketpass_disabled

import { readMarketFlag } from "../../market/flags.ts";
import { buildMarketPassAssessment } from "./assessment.ts";
import { toDealerContract, toPublicContract } from "./publicContract.ts";
import type { MarketPassRow } from "./rowEvidence.ts";

export interface MarketPassCaller {
  /** Null for an anonymous caller or a token that did not verify. */
  userId: string | null;
  /** tenant_members.tenant_id for that user, as read by the server. */
  memberTenantIds: string[];
}

export interface MarketPassRequest {
  row: MarketPassRow | null;
  settings: unknown;
  caller: MarketPassCaller;
  audience: "public" | "dealer";
  nowMs: number;
}

export interface MarketPassResponse {
  status: number;
  body: unknown;
}

export function decideMarketPassResponse(req: MarketPassRequest): MarketPassResponse {
  const { row, caller } = req;
  if (!row || !row.vin) return { status: 404, body: { error: "not_found" } };
  const member = caller.userId != null && row.tenant_id != null && caller.memberTenantIds.includes(row.tenant_id);
  const published = row.status === "published";
  if (!published && !member) return { status: 404, body: { error: "not_found" } };
  if (!readMarketFlag(req.settings, "marketpass_v2")) return { status: 404, body: { error: "marketpass_disabled" } };

  if (req.audience === "dealer") {
    if (caller.userId == null) return { status: 401, body: { error: "sign_in_required" } };
    if (!member) return { status: 403, body: { error: "not_a_member_of_this_dealer" } };
  }
  const assessment = buildMarketPassAssessment({ row, settings: req.settings, nowMs: req.nowMs });
  if (req.audience === "dealer") return { status: 200, body: toDealerContract(assessment) };
  return { status: 200, body: toPublicContract(assessment) };
}
