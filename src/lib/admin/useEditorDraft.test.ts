import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEditorDraft } from "./useEditorDraft";
import { colorError, contrastRatio, normalizeHex } from "./color";

type V = { name: string; tags: string[] };
const A: V = { name: "Alpha", tags: ["x"] };
const B: V = { name: "Beta", tags: [] };

describe("useEditorDraft", () => {
  it("starts clean and never calls anything on load", () => {
    const validate = vi.fn(() => ({}));
    const { result } = renderHook(() => useEditorDraft<V>({ scopeKey: "s1", baseline: A, validate }));
    expect(result.current.dirty).toBe(false);
    expect(result.current.changes).toEqual([]);
  });
  it("detects dirty by deep compare and lists changed keys", () => {
    const { result } = renderHook(() => useEditorDraft<V>({ scopeKey: "s1", baseline: A }));
    act(() => result.current.set("tags", ["x", "y"]));
    expect(result.current.dirty).toBe(true);
    expect(result.current.changedKeys).toEqual(["tags"]);
    act(() => result.current.set("tags", ["x"]));
    expect(result.current.dirty).toBe(false);
  });
  it("reset returns to baseline", () => {
    const { result } = renderHook(() => useEditorDraft<V>({ scopeKey: "s1", baseline: A }));
    act(() => result.current.set("name", "Zed"));
    act(() => result.current.reset());
    expect(result.current.draft).toEqual(A);
  });
  it("a scope switch never carries a draft", () => {
    const { result, rerender } = renderHook(({ k, b }) => useEditorDraft<V>({ scopeKey: k, baseline: b }), { initialProps: { k: "s1", b: A } });
    act(() => result.current.set("name", "Edited"));
    rerender({ k: "s2", b: B });
    expect(result.current.draft).toEqual(B);
    expect(result.current.dirty).toBe(false);
  });
  it("a new load generation restarts from the baseline", () => {
    const { result, rerender } = renderHook(({ g }) => useEditorDraft<V>({ scopeKey: "s1", generation: g, baseline: A }), { initialProps: { g: 0 } });
    act(() => result.current.set("name", "Edited"));
    rerender({ g: 1 });
    expect(result.current.dirty).toBe(false);
  });
  it("reports validation and markSaved rebases", () => {
    const validate = (d: V) => (d.name ? {} : { name: "Required" });
    const { result } = renderHook(() => useEditorDraft<V>({ scopeKey: "s1", baseline: A, validate }));
    act(() => result.current.set("name", ""));
    expect(result.current.valid).toBe(false);
    act(() => result.current.set("name", "New"));
    act(() => result.current.markSaved());
    expect(result.current.dirty).toBe(false);
    expect(result.current.baseline?.name).toBe("New");
  });
});

describe("color helpers", () => {
  it("normalizes to uppercase #RRGGBB", () => {
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex("#2457d6")).toBe("#2457D6");
    expect(normalizeHex("#24G7")).toBeNull();
    expect(normalizeHex("12345")).toBeNull();
  });
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });
  it("reports errors", () => {
    expect(colorError("")).toBeTruthy();
    expect(colorError("zzz")).toBeTruthy();
    expect(colorError("#fff")).toBeNull();
  });
});
