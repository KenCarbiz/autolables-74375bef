import { createResilientAuthStorage } from "./resilientAuthStorage";

const key = "sb-test-auth-token";
const session = JSON.stringify({ access_token: "access", refresh_token: "refresh" });

describe("resilient auth storage", () => {
  beforeEach(() => localStorage.clear());

  it("persists immediately when the editor broker never responds", () => {
    const broker = {
      getItem: () => new Promise<string | null>(() => undefined),
      setItem: () => new Promise<void>(() => undefined),
      removeItem: () => new Promise<void>(() => undefined),
    };
    const storage = createResilientAuthStorage(broker, localStorage);

    storage.setItem(key, session);

    expect(localStorage.getItem(key)).toBe(session);
  });

  it("restores the persisted session through a fresh adapter", async () => {
    localStorage.setItem(key, session);
    const unavailableBroker = {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    };

    const reloadedStorage = createResilientAuthStorage(unavailableBroker, localStorage);

    await expect(reloadedStorage.getItem(key)).resolves.toBe(session);
  });

  it("removes the browser session without waiting for the broker", () => {
    localStorage.setItem(key, session);
    const broker = {
      getItem: () => new Promise<string | null>(() => undefined),
      setItem: () => new Promise<void>(() => undefined),
      removeItem: () => new Promise<void>(() => undefined),
    };
    const storage = createResilientAuthStorage(broker, localStorage);

    storage.removeItem(key);

    expect(localStorage.getItem(key)).toBeNull();
  });
});