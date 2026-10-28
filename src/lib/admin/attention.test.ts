import { describe, it, expect } from "vitest";
import { buildAttentionQueue, rankAttention, type AttentionItem } from "./attention";
import { knownCount } from "./health";

const empty = { feed: null, priceEvidence: null, descriptions: null, routing: null, recall: null, publishing: null, documents: null };

describe("attention queue", () => {
  it("is empty when nothing needs attention", () => {
    expect(buildAttentionQueue(empty)).toEqual([]);
  });

  it("turns a failed read into a could-not-check row instead of silence", () => {
    const q = buildAttentionQueue({ ...empty, priceEvidence: { missing: { kind: "failed" }, mismatched: { kind: "failed" } } });
    expect(q).toHaveLength(1);
    expect(q[0].status).toBe("unknown");
    expect(q[0].action.href).toContain("price-rules");
  });

  it("does not list zero counts", () => {
    const q = buildAttentionQueue({ ...empty, priceEvidence: { missing: knownCount(0), mismatched: knownCount(0) }, descriptions: { blocked: knownCount(0) } });
    expect(q).toEqual([]);
  });

  it("ranks blocked above review, review above incomplete, and bounds the list", () => {
    const items: AttentionItem[] = [
      { id: "a", title: "A", detail: "", owner: null, status: "incomplete", action: { label: "x", href: "/a" } },
      { id: "b", title: "B", detail: "", owner: null, status: "blocked", action: { label: "x", href: "/b" } },
      { id: "c", title: "C", detail: "", owner: null, status: "review_required", action: { label: "x", href: "/c" } },
      { id: "d", title: "D", detail: "", owner: null, status: "needs_review", action: { label: "x", href: "/d" } },
    ];
    expect(rankAttention(items).map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
    expect(rankAttention(items, 2)).toHaveLength(2);
  });

  it("sends a degraded feed to diagnostics with inventory-preserved wording, and routing to the escalation editor", () => {
    const q = buildAttentionQueue({
      ...empty,
      feed: { state: "degraded", headline: "Provider rate limited (HTTP 429)", detail: "Inventory preserved.", affectedOutput: "Inventory", inventoryPreserved: true },
      routing: { ready: false, blockers: ["Store contact for unassigned requests is missing."], warnings: [], checks: [] },
    });
    expect(q[0]).toMatchObject({ id: "feed", status: "needs_review", action: { href: "/admin?tab=inventory-feed" } });
    expect(q[1]).toMatchObject({ id: "routing", status: "incomplete", action: { href: "/admin/customer-experience/escalation" } });
  });
});
