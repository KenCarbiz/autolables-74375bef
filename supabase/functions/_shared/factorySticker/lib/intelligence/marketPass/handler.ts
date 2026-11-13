// GENERATED — do not edit.
// Mirror of src/lib/intelligence/marketPass/handler.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { readMarketFlag } from "../../market/flags.ts";
import { buildMarketPassAssessment } from "./assessment.ts";
import { toDealerContract, toPublicContract } from "./publicContract.ts";
import type { MarketPassRow } from "./rowEvidence.ts";
export interface MarketPassCaller {
    userId: string | null;
    memberTenantIds: string[];
}
export interface MarketPassRequest {
    row: MarketPassRow | null;
    settings: unknown;
    caller: MarketPassCaller;
    audience: "public" | "dealer";
    nowMs: number;
    expectedTenantId?: string | null;
}
export interface MarketPassResponse {
    status: number;
    body: unknown;
}
export function decideMarketPassResponse(req: MarketPassRequest): MarketPassResponse {
    const { row, caller } = req;
    if (!row || !row.vin)
        return { status: 404, body: { error: "not_found" } };
    if (req.expectedTenantId != null && req.expectedTenantId !== "" && row.tenant_id !== req.expectedTenantId) {
        return { status: 404, body: { error: "not_found" } };
    }
    const member = caller.userId != null && row.tenant_id != null && caller.memberTenantIds.includes(row.tenant_id);
    const published = row.status === "published";
    if (!published && !member)
        return { status: 404, body: { error: "not_found" } };
    if (!readMarketFlag(req.settings, "marketpass_v2"))
        return { status: 404, body: { error: "marketpass_disabled" } };
    if (req.audience === "dealer") {
        if (caller.userId == null)
            return { status: 401, body: { error: "sign_in_required" } };
        if (!member)
            return { status: 403, body: { error: "not_a_member_of_this_dealer" } };
    }
    const assessment = buildMarketPassAssessment({ row, settings: req.settings, nowMs: req.nowMs });
    if (req.audience === "dealer")
        return { status: 200, body: toDealerContract(assessment) };
    return { status: 200, body: toPublicContract(assessment) };
}
