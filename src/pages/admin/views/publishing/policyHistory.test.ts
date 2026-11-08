import { describe, expect, it } from "vitest";
import { toPolicyHistory } from "./usePublishingData";

const row = (id: string, at: string, details: Record<string, unknown>, user = "u1") => ({ id, created_at: at, user_id: user, user_email: "a@b.c", details });

describe("policy history dedupe", () => {
  it("merges rows that share an idempotency key", () => {
    const out = toPolicyHistory([
      row("1", "2026-11-01T10:00:00Z", { idempotency_key: "k1", next: { ingest_auto_publish: true } }),
      row("2", "2026-11-01T10:00:01Z", { idempotency_key: "k1", next: { ingest_auto_publish: true } }),
    ]);
    expect(out).toHaveLength(1);
  });
  it("drops the writer row only for the same user and values as a keyed dialog row", () => {
    const out = toPolicyHistory([
      row("1", "2026-11-01T10:00:00Z", { idempotency_key: "k1", next: { ingest_auto_publish: true } }),
      row("2", "2026-11-01T10:00:02Z", { next: { ingest_auto_publish: true } }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["1"]);
  });
  it("keeps two distinct applies, even a second apart with different keys", () => {
    const out = toPolicyHistory([
      row("1", "2026-11-01T10:00:00Z", { idempotency_key: "k1", next: { ingest_auto_publish: true } }),
      row("2", "2026-11-01T10:00:01Z", { idempotency_key: "k2", next: { ingest_auto_publish: false } }),
    ]);
    expect(out).toHaveLength(2);
  });
  it("keeps an unkeyed row with different values or another user", () => {
    const dialog = row("1", "2026-11-01T10:00:00Z", { idempotency_key: "k1", next: { ingest_auto_publish: true } });
    expect(toPolicyHistory([dialog, row("2", "2026-11-01T10:00:02Z", { next: { ingest_auto_publish: false } })])).toHaveLength(2);
    expect(toPolicyHistory([dialog, row("3", "2026-11-01T10:00:02Z", { next: { ingest_auto_publish: true } }, "u2")])).toHaveLength(2);
  });
});
