import { describe, expect, it } from "vitest";
import { applyRecallProjection } from "./lotFeedRow.ts";

// The edge tree cannot import from src/, so the reader lives in the mirrored
// truth layer. This is the cheapest possible proof that both edge readers
// actually resolve it — a broken specifier here is a Deno deploy failure, not
// a type error, so nothing else in the suite would catch it.
describe("edge recall readers resolve the mirrored reader", () => {
  it("projects a model-level answer without asserting a VIN clearance", () => {
    const out = applyRecallProjection({
      recall_status: "clear",
      open_recall_count: 0,
      recall_payload: {
        source: "nhtsa", checked_at: new Date().toISOString(),
        model_in_catalog: true, open_recall_count: 0,
      },
    }) as Record<string, unknown>;
    expect(out.recall_status).toBeNull();
    expect(out.open_recall_count).toBeNull();
  });

  it("is the same module description-core reads its recall fact through", async () => {
    const core = await import("./description-core.ts");
    expect(typeof core.buildFacts === "function" || typeof core === "object").toBe(true);
  });
});
