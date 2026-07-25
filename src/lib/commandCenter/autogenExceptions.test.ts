import { describe, it, expect } from "vitest";
import {
  artifactLabel,
  artifactRetryRpc,
  buildAutogenExceptionRows,
} from "./autogenExceptions";

describe("artifactRetryRpc", () => {
  it("maps exactly the artifacts intake-autoprovision drafts through RPCs", () => {
    expect(artifactRetryRpc("addendum")).toBe("create_draft_addendum");
    expect(artifactRetryRpc("buyers_guide")).toBe("create_draft_buyers_guide");
    expect(artifactRetryRpc("k208")).toBe("create_draft_safety_inspection");
    expect(artifactRetryRpc("get_ready")).toBe("create_draft_get_ready");
    expect(artifactRetryRpc("window_sticker")).toBe("create_draft_window_sticker");
  });

  it("offers no RPC for the fire-and-forget edge artifacts", () => {
    for (const a of ["form_pdfs", "oem_window_sticker", "title_request_email", "ingest_orchestrate", "description", "get_ready_token"]) {
      expect(artifactRetryRpc(a)).toBeNull();
    }
  });
});

describe("buildAutogenExceptionRows", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "ex1",
    exception_type: "artifact_autogen_failed",
    status: "open",
    title: "Intake auto-generation failed: k208",
    explanation: "boom",
    source_values: { artifacts: { k208: "rpc timed out", form_pdfs: "http_500" } },
    ...over,
  });

  it("emits one row per failed artifact, carrying its retry RPC where one exists", () => {
    const rows = buildAutogenExceptionRows([row()]);
    expect(rows).toHaveLength(2);
    const k208 = rows.find((r) => r.artifact === "k208");
    const pdfs = rows.find((r) => r.artifact === "form_pdfs");
    expect(k208?.retryRpc).toBe("create_draft_safety_inspection");
    expect(k208?.message).toBe("rpc timed out");
    expect(pdfs?.retryRpc).toBeNull();
    expect(pdfs?.label).toBe("Official form PDFs");
  });

  it("drops resolved rows and foreign exception types", () => {
    expect(buildAutogenExceptionRows([row({ status: "resolved" })])).toEqual([]);
    expect(buildAutogenExceptionRows([row({ exception_type: "price_mismatch" })])).toEqual([]);
  });

  it("still surfaces a legacy row with no artifacts map", () => {
    const rows = buildAutogenExceptionRows([row({ source_values: {} })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].retryRpc).toBeNull();
    expect(rows[0].label).toMatch(/auto-generation failed/i);
  });

  it("humanizes an unknown artifact name instead of dropping it", () => {
    expect(artifactLabel("weird_new_artifact")).toBe("Weird New Artifact");
  });
});
