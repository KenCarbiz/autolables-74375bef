import { describe, it, expect, beforeEach } from "vitest";
import { markSessionActive, clearSessionActive, consumeSessionExpired } from "./sessionExpiry";

describe("sessionExpiry", () => {
  beforeEach(() => sessionStorage.clear());

  it("a first-time visitor (never active) is not treated as expired", () => {
    expect(consumeSessionExpired()).toBe(false);
  });

  it("an active session that lapses reads as expired exactly once", () => {
    markSessionActive();
    expect(consumeSessionExpired()).toBe(true);
    // one-shot: a second gate hit is a normal login, not an expiry
    expect(consumeSessionExpired()).toBe(false);
  });

  it("an intentional sign-out is never shown as expired", () => {
    markSessionActive();
    clearSessionActive();
    expect(consumeSessionExpired()).toBe(false);
  });
});
