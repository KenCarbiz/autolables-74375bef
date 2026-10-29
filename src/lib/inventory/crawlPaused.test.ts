import { describe, it, expect } from "vitest";
import { crawlPausedMessage } from "./crawlPaused";

const httpError = (status: number, body: unknown) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  });

describe("crawlPausedMessage", () => {
  it("returns the server's pause message", async () => {
    const e = httpError(503, { ok: false, paused: true, error: "crawl_paused", message: "Temporarily paused for pricing verification" });
    expect(await crawlPausedMessage(e)).toBe("Temporarily paused for pricing verification");
    expect(await crawlPausedMessage(e)).toBe("Temporarily paused for pricing verification");
  });

  it("returns null for any other failure", async () => {
    expect(await crawlPausedMessage(httpError(500, { error: "boom" }))).toBeNull();
    expect(await crawlPausedMessage(new Error("network"))).toBeNull();
    expect(await crawlPausedMessage(null)).toBeNull();
    expect(await crawlPausedMessage({ context: new Response("not json", { status: 503 }) })).toBeNull();
  });
});
