import { describe, it, expect } from "vitest";
import { authorizeWorker } from "./policy";

const eq = async (a: string, b: string) => a === b;
const no = async () => false;
const yes = async () => true;
const KEY = "k".repeat(40);

describe("files-inventory-worker authorisation", () => {
  it("accepts the dedicated worker key", async () => {
    expect(await authorizeWorker(KEY, KEY, no, eq)).toBe("worker_key");
  });
  it("refuses a wrong or missing worker key", async () => {
    expect(await authorizeWorker("wrong", KEY, no, eq)).toBeNull();
    expect(await authorizeWorker(null, KEY, no, eq)).toBeNull();
  });
  it("is unavailable, not permissive, when no worker key is configured", async () => {
    expect(await authorizeWorker("", "", no, eq)).toBeNull();
    expect(await authorizeWorker("anything", undefined, no, eq)).toBeNull();
  });
  it("still accepts the service-role key for a manual operator call", async () => {
    expect(await authorizeWorker(null, KEY, yes, eq)).toBe("service_role");
  });
});
