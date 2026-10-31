import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

import { friendlyMessage, explainError } from "./api";

describe("friendlyMessage", () => {
  it.each([
    ["platform_admin_required", /platform administrator/i],
    ["identity_not_confirmed", /confirm|tick/i],
    ["store_changed_since_loaded", /changed by someone else/i],
    ["sharing_across_groups_forbidden", /same dealer group/i],
    ["bulk_requires_verified_catalog: neovin,mds", /Verify them in the Provider catalog.*neovin,mds|neovin,mds.*Provider catalog/i],
    ["paid_enrichment_requires_verified_catalog", /verified rate/i],
    ["filescom_imports_never_trigger_enrichment", /never start paid/i],
    ['new row for relation "dealer_stores" violates check constraint "dealer_stores_check"', /subscribed/i],
    ['duplicate key value violates unique constraint "dealer_stores_one_primary"', /primary inventory store/i],
  ])("maps %s", (raw, expected) => {
    expect(friendlyMessage(raw)).toMatch(expected);
  });

  it("never passes raw SQL through", () => {
    const out = friendlyMessage('syntax error at or near "SELECT * FROM public.dealer_stores"');
    expect(out).not.toMatch(/SELECT|public\./);
    expect(explainError(new Error("column foo of relation bar violates not-null constraint"))).not.toMatch(/relation/);
  });
});
