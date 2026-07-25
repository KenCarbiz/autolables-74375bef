import { describe, it, expect, vi } from "vitest";
import { createLatestWriteQueue, createLoadSequencer } from "./writeSequencing";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe("createLoadSequencer", () => {
  it("accepts only the newest request", () => {
    const s = createLoadSequencer();
    const first = s.begin();
    const second = s.begin();
    expect(s.accepts(first)).toBe(false);
    expect(s.accepts(second)).toBe(true);
  });

  // The older response used to land last and paint the previous vehicle's
  // package over the one on screen.
  it("rejects a slow first load that resolves after a newer one", () => {
    const s = createLoadSequencer();
    const stale = s.begin();
    s.begin();
    expect(s.accepts(stale)).toBe(false);
  });

  it("rejects every request once unmounted, including the newest", () => {
    const s = createLoadSequencer();
    const req = s.begin();
    s.unmount();
    expect(s.accepts(req)).toBe(false);
    s.mount();
    expect(s.accepts(req)).toBe(true);
  });
});

describe("createLatestWriteQueue", () => {
  it("skips a write whose value is already persisted", async () => {
    const q = createLatestWriteQueue();
    const run = vi.fn(async () => ({ ok: true }));
    expect(await q.submit({ key: "note:prep", value: "same", persisted: "same", run })).toEqual({ ok: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("always writes a value different from the persisted one", async () => {
    const q = createLatestWriteQueue();
    const run = vi.fn(async () => ({ ok: true }));
    await q.submit({ key: "note:prep", value: "next", persisted: "prev", run });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("coalesces a second submit of the SAME in-flight value onto that write", async () => {
    const q = createLatestWriteQueue();
    const gate = deferred<{ ok: boolean }>();
    const run = vi.fn(() => gate.promise);
    const a = q.submit({ key: "check:costs", value: "true", persisted: "false", run });
    const b = q.submit({ key: "check:costs", value: "true", persisted: "false", run });
    expect(run).toHaveBeenCalledTimes(1);
    gate.resolve({ ok: true });
    expect(await a).toEqual({ ok: true });
    expect(await b).toEqual({ ok: true });
  });

  // A failed save must never be reported as saved to the second caller.
  it("reports the real failure to a coalesced submit", async () => {
    const q = createLatestWriteQueue();
    const gate = deferred<{ ok: boolean; error?: string }>();
    const run = vi.fn(() => gate.promise);
    const a = q.submit({ key: "note:prep", value: "x", persisted: "", run });
    const b = q.submit({ key: "note:prep", value: "x", persisted: "", run });
    gate.resolve({ ok: false, error: "denied" });
    expect(await a).toEqual({ ok: false, error: "denied" });
    expect(await b).toEqual({ ok: false, error: "denied" });
  });

  it("writes a DIFFERENT value even while another write is in flight", async () => {
    const q = createLatestWriteQueue();
    const first = deferred<{ ok: boolean }>();
    const run = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => ({ ok: true }));
    const a = q.submit({ key: "note:prep", value: "A", persisted: "", run });
    const b = q.submit({ key: "note:prep", value: "AB", persisted: "", run });
    first.resolve({ ok: true });
    await a; await b;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries after a failure — a failed write is not remembered as persisted", async () => {
    const q = createLatestWriteQueue();
    const run = vi.fn()
      .mockImplementationOnce(async () => ({ ok: false, error: "denied" }))
      .mockImplementationOnce(async () => ({ ok: true }));
    expect(await q.submit({ key: "note:prep", value: "A", persisted: "", run })).toEqual({ ok: false, error: "denied" });
    expect(await q.submit({ key: "note:prep", value: "A", persisted: "", run })).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("skips once the caller's snapshot has caught up", async () => {
    const q = createLatestWriteQueue();
    const run = vi.fn(async () => ({ ok: true }));
    await q.submit({ key: "note:prep", value: "A", persisted: "", run });
    await q.submit({ key: "note:prep", value: "A", persisted: "A", run });
    expect(run).toHaveBeenCalledTimes(1);
  });

  // The A17 window, made explicit: a submit landing before the snapshot
  // refreshes writes a redundant append-only row rather than dropping the
  // manager's value. Suppressing it would also swallow a genuine re-entry of a
  // value another user had since changed.
  it("re-writes rather than dropping a value the snapshot has not caught up to", async () => {
    const q = createLatestWriteQueue();
    const run = vi.fn(async () => ({ ok: true }));
    await q.submit({ key: "note:prep", value: "A", persisted: "", run });
    await q.submit({ key: "note:prep", value: "A", persisted: "", run });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("writes when the server reports a value somebody else changed", async () => {
    const q = createLatestWriteQueue();
    const run = vi.fn(async () => ({ ok: true }));
    await q.submit({ key: "note:prep", value: "A", persisted: "B", run });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs afterWrite only on success, before returning", async () => {
    const q = createLatestWriteQueue();
    const order: string[] = [];
    const res = await q.submit({
      key: "k", value: "v", persisted: "",
      run: async () => { order.push("write"); return { ok: true }; },
      afterWrite: async () => { order.push("reload"); },
    });
    expect(res.ok).toBe(true);
    expect(order).toEqual(["write", "reload"]);

    const skipped: string[] = [];
    await q.submit({
      key: "k2", value: "v", persisted: "",
      run: async () => ({ ok: false, error: "no" }),
      afterWrite: async () => { skipped.push("reload"); },
    });
    expect(skipped).toEqual([]);
  });

  it("keys are independent", async () => {
    const q = createLatestWriteQueue();
    const run = vi.fn(async () => ({ ok: true }));
    await q.submit({ key: "note:prep", value: "A", persisted: "", run });
    await q.submit({ key: "note:service", value: "A", persisted: "", run });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
