import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDealershipSelection } from "./useGroupInventory";
import { selectionKey } from "@/lib/inventoryScope/groupInventory";

beforeEach(() => window.localStorage.clear());

describe("useDealershipSelection", () => {
  it("starts empty (primary only), persists a choice and restores it on the next mount", () => {
    const first = renderHook(() => useDealershipSelection("t1", "u1"));
    expect(first.result.current.stored).toBeNull();
    act(() => first.result.current.select(["a", "b"]));
    expect(first.result.current.stored).toEqual(["a", "b"]);
    expect(JSON.parse(window.localStorage.getItem(selectionKey("u1", "t1"))!)).toEqual(["a", "b"]);
    first.unmount();
    const second = renderHook(() => useDealershipSelection("t1", "u1"));
    expect(second.result.current.stored).toEqual(["a", "b"]);
  });

  it("keeps selections apart per user and per tenant", () => {
    window.localStorage.setItem(selectionKey("u1", "t1"), JSON.stringify(["a"]));
    expect(renderHook(() => useDealershipSelection("t1", "u2")).result.current.stored).toBeNull();
    expect(renderHook(() => useDealershipSelection("t2", "u1")).result.current.stored).toBeNull();
    expect(renderHook(() => useDealershipSelection("t1", "u1")).result.current.stored).toEqual(["a"]);
  });

  it("clears the stored choice when set back to primary only", () => {
    const h = renderHook(() => useDealershipSelection("t1", "u1"));
    act(() => h.result.current.select(["a", "b"]));
    act(() => h.result.current.select(null));
    expect(window.localStorage.getItem(selectionKey("u1", "t1"))).toBeNull();
    expect(h.result.current.stored).toBeNull();
  });
});
