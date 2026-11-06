import { describe, expect, it, vi } from "vitest";
import { SCHEDULER_SECRET_HEADER, schedulerSecretValid } from "./schedulerAuth";

const secret = "a".repeat(64);
const req = (value?: string) =>
  new Request("https://example.test", { method: "POST", headers: value === undefined ? {} : { [SCHEDULER_SECRET_HEADER]: value } });
const db = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) });

describe("schedulerSecretValid", () => {
  it("trusts a secret the database confirms", async () => {
    const d = db(true);
    expect(await schedulerSecretValid(req(secret), d)).toBe(true);
    expect(d.rpc).toHaveBeenCalledWith("scheduler_secret_matches", { p_secret: secret });
  });

  it("refuses a secret the database does not confirm", async () => {
    expect(await schedulerSecretValid(req(secret), db(false))).toBe(false);
  });

  it("refuses when the check itself fails", async () => {
    expect(await schedulerSecretValid(req(secret), db(true, { message: "boom" }))).toBe(false);
    const throwing = { rpc: vi.fn(async () => { throw new Error("down"); }) };
    expect(await schedulerSecretValid(req(secret), throwing)).toBe(false);
  });

  it("never queries for a missing or malformed secret", async () => {
    for (const v of [undefined, "", "A".repeat(64), "a".repeat(63), `${"a".repeat(63)}g`, "eyJhbGciOiJIUzI1NiJ9.x.y"]) {
      const d = db(true);
      expect(await schedulerSecretValid(req(v), d)).toBe(false);
      expect(d.rpc).not.toHaveBeenCalled();
    }
  });
});
